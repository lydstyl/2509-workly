/*!
 * src/core.js — machine à états travail ↔ pause (aucun DOM).
 *
 * Invariants garantis par cette classe :
 *   1. Toute période vécue (travail ou pause) finit dans `timeline`, exactement
 *      une fois — quel que soit le bouton utilisé pour en sortir.
 *   2. `totalWork` / `totalBreak` sont des caches recalculés depuis `timeline`
 *      (`recomputeTotals`) : la timeline est la source de vérité unique, les
 *      deux valeurs ne peuvent donc pas diverger.
 *   3. Aucune durée ne dépend de `Date.now()` : l'horloge est injectée.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      Object.assign(
        {},
        require('./constants.js'),
        require('./timeline.js')
      )
    )
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory(root.Workly))
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict'

  const HOUR = W.HOUR
  const STORAGE_KEY = W.STORAGE_KEY
  const DEFAULT_GOAL_HOURS = W.DEFAULT_GOAL_HOURS
  const normalizeType = W.normalizeType
  const sessionDuration = W.sessionDuration
  const sumByType = W.sumByType

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

    /* ----- persistance ----- */

    load() {
      let saved = null
      try {
        saved = this.storage ? this.storage.getItem(STORAGE_KEY) : null
      } catch (err) {
        saved = null
      }
      if (!saved) {
        this.recomputeTotals()
        return this.state
      }

      let data = null
      try {
        data = JSON.parse(saved)
      } catch (err) {
        data = null
      }
      if (!data || typeof data !== 'object') {
        this.recomputeTotals()
        return this.state
      }

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
      this.recomputeTotals()
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

    /**
     * Recalcule les totaux depuis la timeline (source de vérité).
     * Répare au passage un état hérité d'une version qui perdait des pauses.
     */
    recomputeTotals() {
      const sums = sumByType(
        this.state.timeline.map(function (item) {
          return { type: normalizeType(item && item.type), duration: sessionDuration(item) }
        })
      )
      this.state.totalWork = sums.work
      this.state.totalBreak = sums.break
      return sums
    }

    snapshot() {
      return JSON.parse(JSON.stringify(this.state))
    }

    sessions() {
      return this.state.timeline.slice()
    }

    /* ----- session en cours ----- */

    /** Vrai si une période est en train de s'écouler (travail ou pause). */
    hasRunningSession() {
      const s = this.state
      if (!s.currentStartTime) return false
      return s.isWorking || !s.isBreakPaused
    }

    /** Durée de la session en cours (0 si rien ne tourne). */
    currentDuration() {
      if (!this.hasRunningSession()) return 0
      return Math.max(0, this.now() - this.state.currentStartTime)
    }

    /** Session en cours, ou null : sert de dernier segment « vivant » de la frise. */
    liveSegment() {
      const s = this.state
      if (!this.hasRunningSession()) return null
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

    /* ----- transitions ----- */

    /**
     * Archive la période en cours dans la timeline et met à jour le cache des
     * totaux. Ne fait rien s'il n'y a rien à archiver.
     * @returns {number} durée archivée (ms)
     */
    closeCurrentSession(now) {
      const s = this.state
      if (!s.currentStartTime) return 0
      const end = Number.isFinite(now) ? now : this.now()
      const duration = Math.max(0, end - s.currentStartTime)
      s.timeline.unshift({
        type: s.isWorking ? 'work' : 'break',
        duration: duration,
        startTime: s.currentStartTime,
        endTime: end
      })
      this.recomputeTotals()
      return duration
    }

    /**
     * Bouton principal : « Start Working » / « Take a Break ».
     * Travail → pause : la session de travail est archivée.
     * Pause → travail : la pause écoulée est archivée elle aussi (c'était le
     * bug : une pause terminée par le bouton principal disparaissait).
     */
    toggle() {
      const now = this.now()
      const s = this.state

      if (!s.isWorking) {
        // Pause → travail (ou démarrage à froid : rien à archiver).
        this.closeCurrentSession(now)
        s.isWorking = true
        s.currentStartTime = now
        s.isBreakPaused = false
      } else {
        // Travail → pause.
        this.closeCurrentSession(now)
        s.isWorking = false
        s.currentStartTime = now
        s.isBreakPaused = false
      }

      this.save()
      return this.snapshot()
    }

    /**
     * Bouton Stop/Resume pendant une pause.
     * Stop : la pause écoulée est archivée et le décompte s'arrête.
     * Resume : nouveau segment de pause (le temps arrêté n'est pas compté).
     * Sans effet pendant une session de travail.
     */
    toggleBreakPause() {
      const now = this.now()
      const s = this.state
      if (s.isWorking) return this.snapshot()

      if (s.isBreakPaused) {
        s.isBreakPaused = false
        s.currentStartTime = now
      } else {
        this.closeCurrentSession(now)
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

    /* ----- objectif ----- */

    setGoal(hours) {
      const value = Number.parseFloat(hours)
      this.state.dailyGoal = Number.isFinite(value) && value > 0 ? value : DEFAULT_GOAL_HOURS
      this.save()
      return this.state.dailyGoal
    }

    /**
     * Totaux affichés : période archivée + période en cours.
     * `breakWithCurrent` compte la pause qui s'écoule, comme avant.
     */
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
      const hours = String(d.getHours()).padStart(2, '0')
      const minutes = String(d.getMinutes()).padStart(2, '0')
      return `${hours}:${minutes}`
    }
  }

  return {
    defaultState: defaultState,
    WorkTrackerCore: WorkTrackerCore
  }
})
