/*!
 * work-tracker.js — Workly
 *
 * Deux couches, volontairement séparées :
 *   1. LOGIQUE PURE (formatage + buildTimeline + WorkTrackerCore) : aucune
 *      dépendance au DOM, testable en Node (`node --test`).
 *   2. RENDU (`WorklyApp`) : branche la logique sur le DOM et la frise
 *      chronologique proportionnelle.
 *
 * Chargé en <script src="work-tracker.js"> dans le navigateur (expose
 * window.Workly) et require() dans les tests unitaires.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.Workly = factory()
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE

  const STORAGE_KEY = 'workTracker'
  const DEFAULT_GOAL_HOURS = 4
  /** Segments plus courts que ça (double-clic accidentel) sont écartés de la frise. */
  const MIN_SEGMENT_MS = SECOND
  /** Nombre de repères horaires maximum sur l'axe. */
  const MAX_TICKS = 12
  /**
   * Part minimale de la barre (%) pour un segment non nul, même très court.
   * Sans ce plancher, une pause de 30 s dans une journée de 5 h ne pèse que
   * 0,17 % de la frise : à l'écran elle fait un liseré de 1 px — invisible.
   * La distorsion induite reste bornée par FLOOR_BUDGET_PCT.
   */
  const MIN_SEGMENT_PCT = 2
  /** Budget total (%) que les planchers peuvent emprunter à la barre. */
  const FLOOR_BUDGET_PCT = 18
  /** Largeur minimale (px) d'un segment dans la frise — filet de sécurité CSS. */
  const MIN_SEGMENT_PX = 2

  /* ------------------------------------------------------------------ *
   * Formatage
   * ------------------------------------------------------------------ */

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  /** "3 hours 18 minutes 5 seconds" (unités non nulles conservées). */
  function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / SECOND)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    const parts = []
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
    if (seconds > 0 || parts.length === 0) {
      parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`)
    }
    return parts.join(' ')
  }

  /** "HH:MM:SS" — chrono de la session en cours. */
  function formatClock(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / SECOND)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  }

  /** "1,25" — heures décimales à la française. */
  function formatHours(ms) {
    return (Math.max(0, ms) / HOUR).toFixed(2).replace('.', ',')
  }

  /** "20 min", "1 h", "3 h 18", "45 s" — compact, pour la frise. */
  function formatShortDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / SECOND)
    if (totalSeconds < 60) return `${totalSeconds} s`
    const minutes = Math.floor(totalSeconds / 60)
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `${hours} h` : `${hours} h ${pad2(rest)}`
  }

  /** "16:10" — heure de la journée, format 24 h. */
  function formatTimeOfDay(timestamp) {
    const d = new Date(timestamp)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }

  /** "16/10/2026" */
  function formatDate(timestamp) {
    const d = new Date(timestamp)
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
  }

  function isSameDay(a, b) {
    const da = new Date(a)
    const db = new Date(b)
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    )
  }

  /* ------------------------------------------------------------------ *
   * Frise chronologique — modèle purement calculé
   * ------------------------------------------------------------------ */

  /**
   * Largeurs (%) de la frise : proportionnelles aux durées, mais tout segment
   * non nul garde au moins `minWidthPct` de la barre — sinon une pause de
   * quelques secondes tombe sous le pixel et disparaît de la frise.
   *
   * Water-filling : on épingle au plancher les segments trop fins, on
   * redistribue le reste au prorata des durées, et on recommence tant qu'un
   * segment repasse sous le plancher. Le plancher effectif est borné par
   * `floorBudgetPct` (part totale maximale prise à la barre) et par 100/n.
   */
  function computeWidths(durations, totalMs, options) {
    const opts = options || {}
    const count = durations.length
    const proportional = durations.map(function (duration) {
      return totalMs > 0 ? (duration / totalMs) * 100 : 0
    })
    if (count < 2 || totalMs <= 0) return proportional

    const requested = opts.minWidthPct === undefined ? MIN_SEGMENT_PCT : opts.minWidthPct
    const budget = opts.floorBudgetPct === undefined ? FLOOR_BUDGET_PCT : opts.floorBudgetPct
    if (!(requested > 0) || !(budget > 0)) return proportional

    const pinned = []
    for (let i = 0; i < count; i += 1) {
      if (durations[i] > 0 && proportional[i] < requested) pinned.push(i)
    }
    if (!pinned.length) return proportional

    const floor = Math.min(requested, budget / pinned.length, 100 / count)
    const widths = proportional.slice()

    for (let pass = 0; pass <= count; pass += 1) {
      const free = []
      let freeMs = 0
      for (let i = 0; i < count; i += 1) {
        if (pinned.indexOf(i) === -1) {
          free.push(i)
          freeMs += durations[i]
        }
      }
      const freePct = Math.max(0, 100 - floor * pinned.length)
      let added = false
      if (freeMs > 0) {
        for (let k = 0; k < free.length; k += 1) {
          const width = (durations[free[k]] / freeMs) * freePct
          if (durations[free[k]] > 0 && width < floor) {
            pinned.push(free[k])
            added = true
          }
        }
      }
      if (added) continue

      for (let i = 0; i < count; i += 1) {
        widths[i] = pinned.indexOf(i) === -1 ? 0 : floor
      }
      if (freeMs > 0) {
        for (let k = 0; k < free.length; k += 1) {
          widths[free[k]] = (durations[free[k]] / freeMs) * freePct
        }
      }
      break
    }

    // La somme doit valoir 100 % : le résidu d'arrondi va au plus gros segment
    // (sinon les repères de l'axe dérivent par rapport à la barre).
    let sum = 0
    let biggest = 0
    for (let i = 0; i < count; i += 1) {
      sum += widths[i]
      if (widths[i] > widths[biggest]) biggest = i
    }
    if (sum > 0) widths[biggest] += 100 - sum
    return widths
  }

  /**
   * Construit le modèle de la frise : segments ordonnés chronologiquement,
   * avec largeur proportionnelle à la durée.
   *
   * @param {Array<{type:string,startTime:number,endTime:number}>} sessions
   *        Timeline brute (celle du localStorage : le plus récent en premier).
   * @param {{type:string,startTime:number,endTime:number}|null} live
   *        Session en cours (non encore archivée), ajoutée en dernier.
   * @param {{minDurationMs?:number,maxTicks?:number}} [options]
   * @returns {{segments:Array,totalMs:number,droppedMs:number,ticks:Array}}
   */
  function buildTimeline(sessions, live, options) {
    const opts = options || {}
    const minDuration = opts.minDurationMs === undefined ? MIN_SEGMENT_MS : opts.minDurationMs
    const maxTicks = opts.maxTicks === undefined ? MAX_TICKS : opts.maxTicks

    const raw = (Array.isArray(sessions) ? sessions : [])
      .map(function (item) {
        return {
          type: item && item.type === 'break' ? 'break' : 'work',
          startTime: Number(item && item.startTime),
          endTime: Number(item && item.endTime),
          isLive: false
        }
      })
      .filter(function (item) {
        return Number.isFinite(item.startTime) && Number.isFinite(item.endTime)
      })

    if (live && Number.isFinite(Number(live.startTime))) {
      const startTime = Number(live.startTime)
      raw.push({
        type: live.type === 'break' ? 'break' : 'work',
        startTime: startTime,
        endTime: Number.isFinite(Number(live.endTime)) ? Number(live.endTime) : startTime,
        isLive: true
      })
    }

    raw.forEach(function (item) {
      item.duration = Math.max(0, item.endTime - item.startTime)
    })

    // Une session en cours est toujours gardée (même longue de 0 s) : c'est
    // elle qui dessine la frise « au fur et à mesure ».
    const kept = raw.filter(function (item) {
      return item.isLive || item.duration >= minDuration
    })
    const droppedMs = raw.reduce(function (acc, item) {
      return acc + item.duration
    }, 0) - kept.reduce(function (acc, item) {
      return acc + item.duration
    }, 0)

    kept.sort(function (a, b) {
      return a.startTime - b.startTime || a.endTime - b.endTime
    })

    const totalMs = kept.reduce(function (acc, item) {
      return acc + item.duration
    }, 0)

    let cursor = 0
    const widths = computeWidths(
      kept.map(function (item) {
        return item.duration
      }),
      totalMs,
      opts
    )
    const segments = kept.map(function (item, index) {
      const startPct = cursor
      const widthPct = widths[index]
      cursor += widthPct
      const durationMs = item.duration
      let durationLabel = formatShortDuration(durationMs)
      if (durationMs > 0 && durationMs < SECOND) durationLabel = '< 1 s'
      return {
        type: item.type,
        index: index,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: durationMs,
        durationLabel: durationLabel,
        isLive: item.isLive,
        startPct: startPct,
        endPct: startPct + widthPct,
        widthPct: widthPct,
        visible: durationMs > 0
      }
    })

    return {
      segments: segments,
      totalMs: totalMs,
      droppedMs: droppedMs,
      ticks: buildTicks(segments, maxTicks)
    }
  }

  /**
   * Position (en % de la barre) d'un instant, calculée sur la géométrie
   * *affichée* (startPct / widthPct) et non sur les durées brutes : les
   * segments courts sont élargis au plancher visuel, les repères doivent donc
   * suivre la même échelle pour rester sous le bon bloc.
   *
   * @param {Array} segments segments du modèle (avec startPct / widthPct)
   * @param {number} totalMs conservé pour compatibilité d'appel (non utilisé)
   * @param {number} timestamp instant à placer
   */
  function timeToPct(segments, totalMs, timestamp) {
    if (!segments.length) return 0
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]
      if (!(seg.duration > 0) || timestamp <= seg.startTime) return seg.startPct
      if (timestamp <= seg.endTime) {
        return seg.startPct + ((timestamp - seg.startTime) / seg.duration) * seg.widthPct
      }
    }
    return 100
  }

  /** Repères horaires (1 h, 2 h… selon l'étendue) placés sous la frise. */
  function buildTicks(segments, maxTicks) {
    if (!segments.length) return []
    const totalMs = segments.reduce(function (acc, seg) {
      return acc + seg.duration
    }, 0)
    if (totalMs <= 0) return []

    const start = segments[0].startTime
    const end = segments[segments.length - 1].endTime
    const span = Math.max(end - start, 1)

    let step = HOUR
    while (span / step > (maxTicks || MAX_TICKS) && step < 24 * HOUR) step *= 2

    const ticks = []
    let t = Math.ceil(start / step) * step
    // Un repère pile sur le début serait rogné au bord de la barre : on démarre
    // au premier multiple strictement postérieur (le début est déjà dans le résumé).
    if (t <= start) t += step
    while (t <= end && ticks.length < 200) {
      ticks.push({
        ts: t,
        pct: timeToPct(segments, totalMs, t),
        label: formatTimeOfDay(t)
      })
      t += step
    }
    return ticks
  }

  /* ------------------------------------------------------------------ *
   * Cœur métier — état + transitions (aucun DOM)
   * ------------------------------------------------------------------ */

  function defaultState() {
    return {
      isWorking: false,
      currentStartTime: null,
      timeline: [],
      totalWork: 0,
      totalBreak: 0,
      dailyGoal: DEFAULT_GOAL_HOURS,
      isBreakPaused: false
    }
  }

  class WorkTrackerCore {
    /**
     * @param {{storage?:object, now?:function():number}} [options]
     *        storage : objet localStorage-like (getItem/setItem).
     *        now     : horloge injectable (tests).
     */
    constructor(options) {
      const opts = options || {}
      this.storage = opts.storage || null
      this.now = typeof opts.now === 'function' ? opts.now : function () { return Date.now() }
      this.state = defaultState()
      this.load()
    }

    load() {
      let saved = null
      try {
        saved = this.storage ? this.storage.getItem(STORAGE_KEY) : null
      } catch (err) {
        saved = null
      }
      if (!saved) return this.state

      let data = null
      try {
        data = JSON.parse(saved)
      } catch (err) {
        data = null
      }
      if (!data || typeof data !== 'object') return this.state

      const base = defaultState()
      this.state = {
        isWorking: data.isWorking || false,
        currentStartTime: data.currentStartTime || null,
        timeline: Array.isArray(data.timeline) ? data.timeline : [],
        totalWork: data.totalWork || 0,
        totalBreak: data.totalBreak || 0,
        dailyGoal: data.dailyGoal || base.dailyGoal,
        isBreakPaused: data.isBreakPaused || false
      }
      return this.state
    }

    save() {
      if (!this.storage) return
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state))
      } catch (err) {
        /* quota / mode privé : on garde l'état en mémoire */
      }
    }

    snapshot() {
      return JSON.parse(JSON.stringify(this.state))
    }

    sessions() {
      return this.state.timeline.slice()
    }

    /** Durée de la session en cours (0 si rien ne tourne). */
    currentDuration() {
      if (!this.state.currentStartTime) return 0
      if (!this.state.isWorking && this.state.isBreakPaused) return 0
      return Math.max(0, this.now() - this.state.currentStartTime)
    }

    /** Session en cours, ou null : sert de dernier segment « vivant » de la frise. */
    liveSegment() {
      const s = this.state
      if (!s.currentStartTime) return null
      if (!s.isWorking && s.isBreakPaused) return null
      return {
        type: s.isWorking ? 'work' : 'break',
        startTime: s.currentStartTime,
        endTime: this.now()
      }
    }

    toSessionsWithLive() {
      const live = this.liveSegment()
      return live ? this.sessions().concat([live]) : this.sessions()
    }

    /** Alternance travail ↔ pause (+ démarrage du décompte de pause). */
    toggle() {
      const now = this.now()
      const s = this.state

      if (!s.isWorking) {
        s.isWorking = true
        s.currentStartTime = now
        s.isBreakPaused = false
      } else {
        if (s.currentStartTime) {
          s.timeline.unshift({
            type: 'work',
            duration: now - s.currentStartTime,
            startTime: s.currentStartTime,
            endTime: now
          })
          s.totalWork += now - s.currentStartTime
        }
        s.isWorking = false
        s.currentStartTime = now
        s.isBreakPaused = false
      }

      this.save()
      return this.snapshot()
    }

    /** Bouton Stop/Resume pendant une pause. */
    toggleBreakPause() {
      const now = this.now()
      const s = this.state

      if (s.isBreakPaused) {
        s.isBreakPaused = false
        s.currentStartTime = now
      } else {
        if (s.currentStartTime) {
          s.timeline.unshift({
            type: 'break',
            duration: now - s.currentStartTime,
            startTime: s.currentStartTime,
            endTime: now
          })
          s.totalBreak += now - s.currentStartTime
        }
        s.isBreakPaused = true
        s.currentStartTime = null
      }

      this.save()
      return this.snapshot()
    }

    resetAll() {
      this.state = defaultState()
      this.save()
      return this.snapshot()
    }

    setGoal(hours) {
      const value = Number.parseFloat(hours)
      this.state.dailyGoal = Number.isFinite(value) && value > 0 ? value : DEFAULT_GOAL_HOURS
      this.save()
      return this.state.dailyGoal
    }

    totals() {
      const s = this.state
      const current = this.currentDuration()
      return {
        work: s.totalWork,
        break: s.totalBreak,
        workWithCurrent: s.totalWork + (s.isWorking ? current : 0),
        breakWithCurrent: s.totalBreak + (!s.isWorking && !s.isBreakPaused ? current : 0),
        current: current
      }
    }

    goalProgress(totalWorkMs) {
      const workedHours = Math.max(0, totalWorkMs) / HOUR
      const goalHours = this.state.dailyGoal || DEFAULT_GOAL_HOURS
      const remainingHours = Math.max(goalHours - workedHours, 0)
      return {
        workedHours: workedHours,
        goalHours: goalHours,
        progressPercent: Math.min((workedHours / goalHours) * 100, 100),
        remainingHours: remainingHours,
        overHours: Math.max(workedHours - goalHours, 0),
        isCompleted: workedHours >= goalHours
      }
    }

    /** Heure de fin estimée ("HH:MM") si `remainingMs` de travail reste à faire. */
    finishEstimate(remainingMs) {
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null
      const d = new Date(this.now() + remainingMs)
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }
  }

  /* ------------------------------------------------------------------ *
   * Rendu — DOM
   * ------------------------------------------------------------------ */

  const LABELS = {
    work: 'Work session',
    break: 'Break'
  }

  class WorklyApp {
    constructor(core, doc) {
      this.core = core
      this.doc = doc || (typeof document !== 'undefined' ? document : null)
      if (!this.doc) throw new Error('WorklyApp requires a document')
      this.el = this.collectElements()
      this._chronoKey = ''
      this._chronoModel = null
      this._hoveredIndex = null
      this.bindEvents()
      this.render()
      this.startTimer()
    }

    collectElements() {
      const byId = (id) => this.doc.getElementById(id)
      return {
        mainButton: byId('mainButton'),
        stopResumeButton: byId('stopResumeButton'),
        resetButton: byId('resetButton'),
        currentSession: byId('currentSession'),
        currentSessionTitle: byId('currentSessionTitle'),
        currentSessionTime: byId('currentSessionTime'),
        totalWorkTime: byId('totalWorkTime'),
        totalWorkTimeHours: byId('totalWorkTimeHours'),
        totalBreakTime: byId('totalBreakTime'),
        timelineContent: byId('timelineContent'),
        chronoBar: byId('chronoBar'),
        chronoAxis: byId('chronoAxis'),
        chronoSummary: byId('chronoSummary'),
        chronoTooltip: byId('chronoTooltip'),
        chronoWrap: byId('chronoWrap'),
        goalInput: byId('goalInput'),
        goalProgressFill: byId('goalProgressFill'),
        goalRemaining: byId('goalRemaining'),
        finishEstimation: byId('finishEstimation'),
        finishTime: byId('finishTime')
      }
    }

    bindEvents() {
      this.el.mainButton.addEventListener('click', () => {
        this.core.toggle()
        this.render()
      })
      this.el.stopResumeButton.addEventListener('click', () => {
        this.core.toggleBreakPause()
        this.render()
      })
      this.el.resetButton.addEventListener('click', () => {
        if (
          this.doc.defaultView.confirm(
            'Are you sure you want to reset all tracking data? This cannot be undone.'
          )
        ) {
          this.core.resetAll()
          this.render()
        }
      })
      this.el.goalInput.addEventListener('change', () => {
        this.core.setGoal(this.el.goalInput.value)
        this.render()
      })

      // Info-bulle au survol / au focus clavier des segments de la frise.
      const bar = this.el.chronoBar
      bar.addEventListener('mouseover', (event) => {
        const seg = event.target.closest ? event.target.closest('.chrono-seg') : null
        if (seg) this.showTooltipFor(seg, event)
      })
      bar.addEventListener('mousemove', (event) => {
        const seg = event.target.closest ? event.target.closest('.chrono-seg') : null
        if (seg) this.positionTooltip(event)
      })
      bar.addEventListener('mouseout', (event) => {
        const related = event.relatedTarget
        if (!related || !related.closest || !related.closest('.chrono-seg')) this.hideTooltip()
      })
      bar.addEventListener('focusin', (event) => {
        const seg = event.target.closest ? event.target.closest('.chrono-seg') : null
        if (seg) this.showTooltipFor(seg, event)
      })
      bar.addEventListener('focusout', () => this.hideTooltip())
    }

    refresh() {
      this.render()
    }

    /* ----- info-bulle ----- */

    tooltipLines(seg) {
      const isBreak = seg.dataset.type === 'break'
      const start = Number(seg.dataset.start)
      const end = Number(seg.dataset.end)
      const duration = Number(seg.dataset.duration)
      const live = seg.dataset.live === 'true'
      const total = Number(seg.dataset.total) || 0

      const lines = []
      if (!isSameDay(start, this.core.now())) {
        lines.push(`<div class="tip-line tip-muted">${formatDate(start)}</div>`)
      }
      lines.push(
        `<div class="tip-line">Started at <strong>${formatTimeOfDay(start)}</strong></div>`
      )
      if (live) {
        lines.push('<div class="tip-line">Ended at <strong>— still running</strong></div>')
      } else {
        lines.push(
          `<div class="tip-line">Ended at <strong>${formatTimeOfDay(end)}</strong></div>`
        )
      }
      lines.push(`<div class="tip-line">Duration <strong>${formatShortDuration(duration)}</strong></div>`)
      if (total > 0) {
        lines.push(
          `<div class="tip-line tip-muted">${((duration / total) * 100)
            .toFixed(1)
            .replace('.', ',')} % of tracked time</div>`
        )
      }
      return lines.join('')
    }

    /** Contenu de l'info-bulle d'un segment (début, fin, durée, part du total). */
    updateTooltipContent(seg) {
      const tip = this.el.chronoTooltip
      if (!tip) return
      const isBreak = seg.dataset.type === 'break'
      tip.innerHTML =
        `<div class="tip-head ${isBreak ? 'break' : 'work'}">${
          isBreak ? LABELS.break : LABELS.work
        }${seg.dataset.live === 'true' ? ' · running' : ''}</div>` +
        this.tooltipLines(seg)
    }

    showTooltipFor(seg, event) {
      const tip = this.el.chronoTooltip
      if (!tip) return
      this._hoveredIndex = Number(seg.dataset.index)
      this.updateTooltipContent(seg)
      tip.hidden = false
      tip.classList.add('visible')
      if (event && event.clientX !== undefined && event.type !== 'focusin') {
        this.positionTooltip(event)
      } else {
        const rect = seg.getBoundingClientRect()
        const width = tip.offsetWidth || 200
        let left = rect.left + rect.width / 2 - width / 2
        left = Math.max(8, Math.min(left, this.doc.defaultView.innerWidth - width - 8))
        tip.style.left = `${left}px`
        tip.style.top = `${rect.bottom + 8}px`
      }
    }

    positionTooltip(event) {
      const tip = this.el.chronoTooltip
      if (!tip || tip.hidden) return
      const width = tip.offsetWidth || 200
      const height = tip.offsetHeight || 80
      const view = this.doc.defaultView
      let left = event.clientX + 14
      let top = event.clientY + 14
      if (left + width > view.innerWidth - 8) left = event.clientX - width - 14
      if (top + height > view.innerHeight - 8) top = event.clientY - height - 14
      tip.style.left = `${Math.max(8, left)}px`
      tip.style.top = `${Math.max(8, top)}px`
    }

    hideTooltip() {
      const tip = this.el.chronoTooltip
      this._hoveredIndex = null
      if (!tip) return
      tip.classList.remove('visible')
      tip.hidden = true
    }

    /* ----- rendu ----- */

    render() {
      const totals = this.core.totals()
      this.renderControls()
      this.renderCurrentSession()
      this.renderTotals(totals)
      this.renderGoal(totals.workWithCurrent)
      this.renderChrono()
      this.renderList()
    }

    renderControls() {
      const s = this.core.state
      if (s.isWorking) {
        this.el.mainButton.textContent = 'Take a Break'
        this.el.mainButton.className = 'main-button break-mode'
        this.el.stopResumeButton.style.display = 'none'
      } else {
        this.el.mainButton.textContent = 'Start Working'
        this.el.mainButton.className = 'main-button'
        this.el.stopResumeButton.style.display = 'inline-block'
        if (s.isBreakPaused) {
          this.el.stopResumeButton.textContent = 'Resume'
          this.el.stopResumeButton.className = 'stop-resume-button resume-mode'
        } else {
          this.el.stopResumeButton.textContent = 'Stop'
          this.el.stopResumeButton.className = 'stop-resume-button'
        }
      }
    }

    renderCurrentSession() {
      const s = this.core.state
      if (s.currentStartTime && (s.isWorking || !s.isBreakPaused)) {
        this.el.currentSession.style.display = 'block'
        this.el.currentSessionTitle.textContent = s.isWorking ? 'Current Work Session' : 'Current Break'
        this.el.currentSessionTime.textContent = formatClock(this.core.currentDuration())
      } else {
        this.el.currentSession.style.display = 'none'
      }
    }

    renderTotals(totals) {
      this.el.totalWorkTime.textContent =
        totals.workWithCurrent > 0 ? formatDuration(totals.workWithCurrent) : '0 minutes'
      this.el.totalWorkTimeHours.textContent =
        totals.workWithCurrent > 0
          ? `${formatHours(totals.workWithCurrent)} heures · ${formatHours(
              totals.workWithCurrent * 1.1
            )} heures (+10%)`
          : '0,00 heures · 0,00 heures (+10%)'
      this.el.totalBreakTime.textContent =
        totals.breakWithCurrent > 0 ? formatDuration(totals.breakWithCurrent) : '0 minutes'
    }

    renderGoal(totalWorkMs) {
      const progress = this.core.goalProgress(totalWorkMs)
      this.el.goalProgressFill.style.width = `${progress.progressPercent}%`

      if (progress.isCompleted) {
        this.el.goalProgressFill.className = 'goal-progress-fill completed'
        this.el.goalRemaining.className = 'goal-remaining completed'
        this.el.goalRemaining.textContent = `Goal achieved! +${formatDuration(progress.overHours * HOUR)}`
        this.el.finishEstimation.style.display = 'none'
        return
      }

      this.el.goalProgressFill.className = 'goal-progress-fill'
      this.el.goalRemaining.className = 'goal-remaining'
      const remainingMs = progress.remainingHours * HOUR
      this.el.goalRemaining.textContent = `${formatDuration(remainingMs)} remaining`

      const s = this.core.state
      const finish = s.isWorking && s.currentStartTime ? this.core.finishEstimate(remainingMs) : null
      if (finish) {
        this.el.finishEstimation.style.display = 'block'
        this.el.finishTime.textContent = finish
      } else {
        this.el.finishEstimation.style.display = 'none'
      }
    }

    /** Frise chronologique : une barre, largeurs proportionnelles aux durées. */
    renderChrono() {
      const model = buildTimeline(this.core.sessions(), this.core.liveSegment())
      const bar = this.el.chronoBar
      const empty = this.doc.getElementById('chronoEmpty')
      this._chronoModel = model

      if (!model.segments.length) {
        this._chronoKey = ''
        this._hoveredIndex = null
        this.hideTooltip()
        bar.innerHTML = ''
        bar.style.display = 'none'
        this.el.chronoAxis.innerHTML = ''
        this.el.chronoSummary.textContent = ''
        if (empty) empty.style.display = 'block'
        return
      }

      bar.style.display = 'flex'
      if (empty) empty.style.display = 'none'

      // Clé de structure : si elle ne bouge pas (mêmes sessions, même type),
      // on met à jour les noeuds en place au lieu de tout réécrire — sinon le
      // survol en cours serait perdu à chaque tick d'une seconde.
      const key = model.segments
        .map((seg) => `${seg.type}:${seg.startTime}:${seg.isLive}`)
        .join('|')

      if (key !== this._chronoKey || bar.children.length !== model.segments.length) {
        this._chronoKey = key
        bar.innerHTML = model.segments
          .map((seg) => this.segmentMarkup(seg, model))
          .join('')
      } else {
        model.segments.forEach((seg, index) => {
          const node = bar.children[index]
          if (!node) return
          const text = this.segmentLabel(seg)
          node.dataset.duration = String(seg.duration)
          node.dataset.total = String(model.totalMs)
          node.dataset.widthPct = seg.widthPct.toFixed(4)
          node.style.flexGrow = String(seg.widthPct)
          node.setAttribute('aria-label', text)
          node.title = text

          let labelNode = node.querySelector('.chrono-seg-label')
          if (seg.widthPct >= 6) {
            if (!labelNode && this.doc.createElement) {
              labelNode = this.doc.createElement('span')
              labelNode.className = 'chrono-seg-label'
              labelNode.style.pointerEvents = 'none'
              node.appendChild(labelNode)
            }
            if (labelNode) labelNode.textContent = seg.durationLabel
          } else if (labelNode && labelNode.remove) {
            labelNode.remove()
          }
        })
      }

      this.el.chronoAxis.innerHTML = model.ticks
        .map(
          (tick) =>
            `<div class="chrono-tick" data-ts="${tick.ts}" style="left:${tick.pct.toFixed(
              4
            )}%"><span>${tick.label}</span></div>`
        )
        .join('')

      const first = model.segments[0]
      const last = model.segments[model.segments.length - 1]
      const workMs = model.segments.reduce(
        (acc, s) => (s.type === 'work' ? acc + s.duration : acc),
        0
      )
      const breakMs = model.segments.reduce(
        (acc, s) => (s.type === 'break' ? acc + s.duration : acc),
        0
      )
      const breakCount = model.segments.reduce(
        (acc, s) => (s.type === 'break' ? acc + 1 : acc),
        0
      )
      this.el.chronoSummary.textContent =
        `${formatTimeOfDay(first.startTime)} → ${formatTimeOfDay(last.endTime)} · ` +
        `${formatShortDuration(model.totalMs)} tracked · work ${formatShortDuration(workMs)} · ` +
        `breaks ${formatShortDuration(breakMs)}` +
        (breakCount ? ` (${breakCount}×)` : '')

      // Une info-bulle ouverte doit suivre la session en cours qui grandit.
      const hovered = this._hoveredIndex
      if (!this.el.chronoTooltip.hidden && hovered !== null && bar.children[hovered]) {
        this.updateTooltipContent(bar.children[hovered])
      }
    }

    /** Libellé lisible d'un segment (aria-label + title natif). */
    segmentLabel(seg) {
      const type = seg.type === 'break' ? LABELS.break : LABELS.work
      const end = seg.isLive ? 'now' : formatTimeOfDay(seg.endTime)
      return `${type}${seg.isLive ? ' (running)' : ''}, ${formatTimeOfDay(
        seg.startTime
      )} to ${end}, ${seg.durationLabel}`
    }

    /** HTML d'un segment de frise. */
    segmentMarkup(seg, model) {
      const text = this.segmentLabel(seg)
      const label = seg.widthPct >= 6 ? `<span class="chrono-seg-label">${seg.durationLabel}</span>` : ''
      return (
        `<div class="chrono-seg ${seg.type}${seg.isLive ? ' live' : ''}"` +
        ` role="listitem" tabindex="0"` +
        ` data-type="${seg.type}"` +
        ` data-index="${seg.index}"` +
        ` data-start="${seg.startTime}"` +
        ` data-end="${seg.endTime}"` +
        ` data-duration="${seg.duration}"` +
        ` data-total="${model.totalMs}"` +
        ` data-live="${seg.isLive ? 'true' : 'false'}"` +
        ` data-width-pct="${seg.widthPct.toFixed(4)}"` +
        ` style="flex-grow:${seg.widthPct}"` +
        ` aria-label="${text}" title="${text}">${label}</div>`
      )
    }

    renderList() {
      const sessions = this.core.sessions()
      if (!sessions.length) {
        this.el.timelineContent.innerHTML =
          '<div class="empty-timeline">No activities recorded yet. Start working to begin tracking!</div>'
        return
      }

      this.el.timelineContent.innerHTML = sessions
        .map((item) => {
          const start = new Date(item.startTime)
          return `
                        <div class="timeline-item">
                            <div class="timeline-dot ${item.type}"></div>
                            <div class="timeline-content">
                                <div class="timeline-type ${item.type}">
                                    ${item.type === 'work' ? 'Work Session' : 'Break Time'}
                                </div>
                                <div class="timeline-duration">
                                    Duration: ${formatDuration(item.duration)}
                                </div>
                            </div>
                            <div class="timeline-time">
                                ${formatTimeOfDay(item.startTime)}<br>
                                <small>${formatDate(start.getTime())}</small>
                            </div>
                        </div>
                    `
        })
        .join('')
    }

    startTimer() {
      const view = this.doc.defaultView || {}
      this.timer = (view.setInterval || setInterval)(() => {
        const s = this.core.state
        if (s.currentStartTime) this.render()
      }, 1000)
    }
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_GOAL_HOURS: DEFAULT_GOAL_HOURS,
    MIN_SEGMENT_MS: MIN_SEGMENT_MS,
    MIN_SEGMENT_PCT: MIN_SEGMENT_PCT,
    FLOOR_BUDGET_PCT: FLOOR_BUDGET_PCT,
    MIN_SEGMENT_PX: MIN_SEGMENT_PX,
    MAX_TICKS: MAX_TICKS,
    SECOND: SECOND,
    MINUTE: MINUTE,
    HOUR: HOUR,
    pad2: pad2,
    formatDuration: formatDuration,
    formatClock: formatClock,
    formatHours: formatHours,
    formatShortDuration: formatShortDuration,
    formatTimeOfDay: formatTimeOfDay,
    formatDate: formatDate,
    isSameDay: isSameDay,
    buildTimeline: buildTimeline,
    computeWidths: computeWidths,
    buildTicks: buildTicks,
    timeToPct: timeToPct,
    defaultState: defaultState,
    WorkTrackerCore: WorkTrackerCore,
    WorklyApp: WorklyApp
  }
})
