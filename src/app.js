/*!
 * src/app.js — câblage DOM : boutons, chiffres, frise, liste.
 *
 * Toute la logique (formatage, modèle de frise, machine à états) vit dans les
 * modules `format` / `timeline` / `chrono-view` / `core` ; ce module ne fait
 * que les brancher sur la page et décider *quand* redessiner.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      Object.assign(
        {},
        require('./constants.js'),
        require('./format.js'),
        require('./timeline.js'),
        require('./chrono-view.js'),
        require('./tooltip.js')
      )
    )
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory(root.Workly))
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict'

  const HOUR = W.HOUR
  const formatDuration = W.formatDuration
  const formatClock = W.formatClock
  const formatHours = W.formatHours
  const formatTimeOfDay = W.formatTimeOfDay
  const formatDate = W.formatDate
  const buildTimeline = W.buildTimeline
  const segmentMarkup = W.segmentMarkup
  const segmentLabel = W.segmentLabel
  const labelMarkup = W.labelMarkup
  const ticksMarkup = W.ticksMarkup
  const summaryText = W.summaryText
  const LABEL_MIN_PCT = W.LABEL_MIN_PCT
  const ChronoTooltip = W.ChronoTooltip

  /** Éléments de la page, par identifiant. */
  const ELEMENT_IDS = {
    mainButton: 'mainButton',
    stopResumeButton: 'stopResumeButton',
    resetButton: 'resetButton',
    currentSession: 'currentSession',
    currentSessionTitle: 'currentSessionTitle',
    currentSessionTime: 'currentSessionTime',
    totalWorkTime: 'totalWorkTime',
    totalWorkTimeHours: 'totalWorkTimeHours',
    totalBreakTime: 'totalBreakTime',
    timelineContent: 'timelineContent',
    chronoBar: 'chronoBar',
    chronoAxis: 'chronoAxis',
    chronoSummary: 'chronoSummary',
    chronoEmpty: 'chronoEmpty',
    chronoTooltip: 'chronoTooltip',
    chronoWrap: 'chronoWrap',
    goalInput: 'goalInput',
    goalProgressFill: 'goalProgressFill',
    goalRemaining: 'goalRemaining',
    finishEstimation: 'finishEstimation',
    finishTime: 'finishTime'
  }

  /** Intervalle de rafraîchissement du chrono (ms). */
  const TICK_MS = 1000

  class WorklyApp {
    constructor(core, doc) {
      this.core = core
      this.doc = doc || (typeof document !== 'undefined' ? document : null)
      if (!this.doc) throw new Error('WorklyApp requires a document')
      this.el = this.collectElements()
      this.tooltip = new ChronoTooltip(this.el.chronoTooltip, {
        doc: this.doc,
        now: () => this.core.now()
      })
      this._chronoKey = ''
      this._chronoModel = null
      this.bindEvents()
      this.render()
      this.startTimer()
    }

    collectElements() {
      const elements = {}
      Object.keys(ELEMENT_IDS).forEach((key) => {
        elements[key] = this.doc.getElementById(ELEMENT_IDS[key])
      })
      return elements
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
        const view = this.doc.defaultView
        const ask = view && typeof view.confirm === 'function' ? view.confirm.bind(view) : null
        if (!ask || ask('Are you sure you want to reset all tracking data? This cannot be undone.')) {
          this.core.resetAll()
          this.render()
        }
      })
      this.el.goalInput.addEventListener('change', () => {
        this.core.setGoal(this.el.goalInput.value)
        this.render()
      })

      this.bindChronoEvents()
    }

    /** Survol / focus clavier des segments de la frise. */
    bindChronoEvents() {
      const bar = this.el.chronoBar
      const segmentOf = (event) => {
        const target = event.target
        return target && target.closest ? target.closest('.chrono-seg') : null
      }

      bar.addEventListener('mouseover', (event) => {
        const seg = segmentOf(event)
        if (seg) this.tooltip.show(seg, event)
      })
      bar.addEventListener('mousemove', (event) => {
        if (segmentOf(event)) this.tooltip.move(event)
      })
      bar.addEventListener('mouseout', (event) => {
        const related = event.relatedTarget
        if (!related || !related.closest || !related.closest('.chrono-seg')) this.tooltip.hide()
      })
      bar.addEventListener('focusin', (event) => {
        const seg = segmentOf(event)
        if (seg) this.tooltip.show(seg, event)
      })
      bar.addEventListener('focusout', () => this.tooltip.hide())
    }

    refresh() {
      this.render()
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
        return
      }

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

    renderCurrentSession() {
      const s = this.core.state
      if (!this.core.hasRunningSession()) {
        this.el.currentSession.style.display = 'none'
        return
      }
      this.el.currentSession.style.display = 'block'
      this.el.currentSessionTitle.textContent = s.isWorking ? 'Current Work Session' : 'Current Break'
      this.el.currentSessionTime.textContent = formatClock(this.core.currentDuration())
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
      this._chronoModel = model

      if (!model.segments.length) {
        this._chronoKey = ''
        this.tooltip.hide()
        bar.innerHTML = ''
        bar.style.display = 'none'
        this.el.chronoAxis.innerHTML = ''
        this.el.chronoSummary.textContent = ''
        if (this.el.chronoEmpty) this.el.chronoEmpty.style.display = 'block'
        return
      }

      bar.style.display = 'flex'
      if (this.el.chronoEmpty) this.el.chronoEmpty.style.display = 'none'

      // Clé de structure : si elle ne bouge pas (mêmes sessions, même type),
      // on met à jour les nœuds en place au lieu de tout réécrire — sinon le
      // survol en cours serait perdu à chaque tick d'une seconde.
      const key = model.segments.map((seg) => `${seg.type}:${seg.startTime}:${seg.isLive}`).join('|')
      if (key !== this._chronoKey || bar.children.length !== model.segments.length) {
        this._chronoKey = key
        bar.innerHTML = model.segments.map((seg) => segmentMarkup(seg, model)).join('')
      } else {
        this.updateChronoSegments(model)
      }

      this.el.chronoAxis.innerHTML = ticksMarkup(model.ticks)
      this.el.chronoSummary.textContent = summaryText(model)

      // Une info-bulle ouverte doit suivre la session en cours qui grandit.
      const hovered = this.tooltip.index
      if (this.tooltip.isOpen && hovered !== null && bar.children[hovered]) {
        this.tooltip.update(bar.children[hovered])
      }
    }

    /** Mise à jour en place des nœuds existants (pas de réécriture HTML). */
    updateChronoSegments(model) {
      const bar = this.el.chronoBar
      model.segments.forEach((seg, index) => {
        const node = bar.children[index]
        if (!node) return
        const text = segmentLabel(seg)
        node.dataset.duration = String(seg.duration)
        node.dataset.total = String(model.totalMs)
        node.dataset.widthPct = seg.widthPct.toFixed(4)
        node.style.flexGrow = String(seg.widthPct)
        node.setAttribute('aria-label', text)
        node.title = text

        let labelNode = node.querySelector('.chrono-seg-label')
        if (seg.widthPct >= LABEL_MIN_PCT) {
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

    renderList() {
      const sessions = this.core.sessions()
      if (!sessions.length) {
        this.el.timelineContent.innerHTML =
          '<div class="empty-timeline">No activities recorded yet. Start working to begin tracking!</div>'
        return
      }

      this.el.timelineContent.innerHTML = sessions
        .map((item) => {
          const isBreak = item.type === 'break'
          return `
                        <div class="timeline-item">
                            <div class="timeline-dot ${isBreak ? 'break' : 'work'}"></div>
                            <div class="timeline-content">
                                <div class="timeline-type ${isBreak ? 'break' : 'work'}">
                                    ${isBreak ? 'Break Time' : 'Work Session'}
                                </div>
                                <div class="timeline-duration">
                                    Duration: ${formatDuration(item.duration)}
                                </div>
                            </div>
                            <div class="timeline-time">
                                ${formatTimeOfDay(item.startTime)}<br>
                                <small>${formatDate(item.startTime)}</small>
                            </div>
                        </div>
                    `
        })
        .join('')
    }

    startTimer() {
      const view = this.doc.defaultView || {}
      const every = view.setInterval || setInterval
      this.timer = every(() => {
        if (this.core.hasRunningSession()) this.render()
      }, TICK_MS)
    }

    stopTimer() {
      const view = this.doc.defaultView || {}
      const clear = view.clearInterval || clearInterval
      if (this.timer) clear(this.timer)
      this.timer = null
    }
  }

  return {
    ELEMENT_IDS: ELEMENT_IDS,
    TICK_MS: TICK_MS,
    WorklyApp: WorklyApp
  }
})
