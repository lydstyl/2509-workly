/*!
 * src/chrono-view.js — fabriques de HTML/libellés pour la frise (aucun DOM).
 *
 * Toutes les fonctions retournent des chaînes : elles sont testables en Node
 * et ne lisent jamais l'état de la page.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      Object.assign({}, require('./constants.js'), require('./format.js'))
    )
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory(root.Workly))
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict'

  const formatShortDuration = W.formatShortDuration
  const formatTimeOfDay = W.formatTimeOfDay
  const formatPercent = W.formatPercent

  /** Libellés affichés (une seule source pour la frise, la liste et l'info-bulle). */
  const LABELS = {
    work: 'Work session',
    break: 'Break'
  }

  /** Libellé lisible d'un segment (aria-label + title natif). */
  function segmentLabel(seg) {
    const type = seg.type === 'break' ? LABELS.break : LABELS.work
    const end = seg.isLive ? 'now' : formatTimeOfDay(seg.endTime)
    return `${type}${seg.isLive ? ' (running)' : ''}, ${formatTimeOfDay(
      seg.startTime
    )} to ${end}, ${seg.durationLabel}`
  }

  /** Seuil (%) à partir duquel le libellé de durée tient dans le segment. */
  const LABEL_MIN_PCT = 6

  function labelMarkup(seg) {
    return seg.widthPct >= LABEL_MIN_PCT
      ? `<span class="chrono-seg-label">${seg.durationLabel}</span>`
      : ''
  }

  /** HTML d'un segment de frise. */
  function segmentMarkup(seg, model) {
    const text = segmentLabel(seg)
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
      ` aria-label="${text}" title="${text}">${labelMarkup(seg)}</div>`
    )
  }

  /** HTML des repères horaires de l'axe. */
  function ticksMarkup(ticks) {
    return ticks
      .map(
        (tick) =>
          `<div class="chrono-tick" data-ts="${tick.ts}" style="left:${tick.pct.toFixed(
            4
          )}%"><span>${tick.label}</span></div>`
      )
      .join('')
  }

  /**
   * Résumé textuel sous la frise :
   * « 10:21 → 14:02 · 3 h 41 tracked · work 2 h 32 · breaks 1 h 08 (1×) »
   */
  function summaryText(model) {
    const segments = model.segments
    if (!segments.length) return ''
    const first = segments[0]
    const last = segments[segments.length - 1]
    const workMs = segments.reduce((acc, s) => (s.type === 'work' ? acc + s.duration : acc), 0)
    const breakMs = segments.reduce((acc, s) => (s.type === 'break' ? acc + s.duration : acc), 0)
    const breakCount = segments.reduce((acc, s) => (s.type === 'break' ? acc + 1 : acc), 0)
    return (
      `${formatTimeOfDay(first.startTime)} → ${formatTimeOfDay(last.endTime)} · ` +
      `${formatShortDuration(model.totalMs)} tracked · work ${formatShortDuration(workMs)} · ` +
      `breaks ${formatShortDuration(breakMs)}` +
      (breakCount ? ` (${breakCount}×)` : '')
    )
  }

  /** Lignes de l'info-bulle d'un segment (début, fin, durée, part du total). */
  function tooltipLines(seg, now) {
    const lines = []
    if (!W.isSameDay(seg.startTime, now)) {
      lines.push(`<div class="tip-line tip-muted">${W.formatDate(seg.startTime)}</div>`)
    }
    lines.push(
      `<div class="tip-line">Started at <strong>${formatTimeOfDay(seg.startTime)}</strong></div>`
    )
    if (seg.isLive) {
      lines.push('<div class="tip-line">Ended at <strong>— still running</strong></div>')
    } else {
      lines.push(
        `<div class="tip-line">Ended at <strong>${formatTimeOfDay(seg.endTime)}</strong></div>`
      )
    }
    lines.push(
      `<div class="tip-line">Duration <strong>${formatShortDuration(seg.duration)}</strong></div>`
    )
    if (seg.total > 0) {
      lines.push(
        `<div class="tip-line tip-muted">${formatPercent(
          (seg.duration / seg.total) * 100
        )} % of tracked time</div>`
      )
    }
    return lines.join('')
  }

  return {
    LABELS: LABELS,
    LABEL_MIN_PCT: LABEL_MIN_PCT,
    segmentLabel: segmentLabel,
    labelMarkup: labelMarkup,
    segmentMarkup: segmentMarkup,
    ticksMarkup: ticksMarkup,
    summaryText: summaryText,
    tooltipLines: tooltipLines
  }
})
