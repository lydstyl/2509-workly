'use strict'
/**
 * Tests unitaires du rendu de la frise (chrono-view.js) : ce sont des
 * fabriques de chaînes, donc testables sans navigateur.
 *
 * Le HTML produit est vérifié sur ses parties signifiantes (attributs
 * data-*, classes, libellés) — pas sur la mise en forme exacte.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const W = require('../../src/index.js')

const { HOUR, MINUTE, at } = (() => {
  const base = new Date(2026, 9, 27, 0, 0, 0).getTime()
  return { HOUR: W.HOUR, MINUTE: W.MINUTE, at: (h, m) => base + h * HOUR + (m || 0) * MINUTE }
})()

function modelOf(sessions, live) {
  return W.buildTimeline(sessions, live)
}

const TRAVAIL = { type: 'work', startTime: at(8, 0), endTime: at(10, 0), duration: 2 * HOUR }
const PAUSE = { type: 'break', startTime: at(10, 0), endTime: at(10, 30), duration: 30 * MINUTE }

test('segmentMarkup : attributs data-*, style et libellé', () => {
  const model = modelOf([PAUSE, TRAVAIL])
  const html = W.segmentMarkup(model.segments[0], model)

  assert.match(html, /class="chrono-seg work"/)
  assert.match(html, /data-type="work"/)
  assert.match(html, /data-index="0"/)
  assert.match(html, new RegExp(`data-start="${at(8, 0)}"`))
  assert.match(html, new RegExp(`data-end="${at(10, 0)}"`))
  assert.match(html, new RegExp(`data-duration="${2 * HOUR}"`))
  assert.match(html, /data-live="false"/)
  assert.match(html, /style="flex-grow:/)
  assert.match(html, /role="listitem" tabindex="0"/)
  assert.match(html, /<span class="chrono-seg-label">2 h<\/span>/)
})

test('segmentMarkup : segment vivant marqué, pause hachurée', () => {
  const model = modelOf([TRAVAIL], { type: 'break', startTime: at(11, 0), endTime: at(11, 0) })
  const live = model.segments[model.segments.length - 1]
  const html = W.segmentMarkup(live, model)

  assert.equal(live.isLive, true)
  assert.match(html, /class="chrono-seg break live"/)
  assert.match(html, /data-live="true"/)
  assert.match(html, /Break \(running\)/)
})

test('segmentMarkup : pas de libellé dans un segment trop étroit', () => {
  // 1 min de pause sur 10 h de travail : le plancher visuel (2 %) reste < 6 %
  const travail = { type: 'work', startTime: at(6, 0), endTime: at(16, 0), duration: 10 * HOUR }
  const micro = { type: 'break', startTime: at(16, 0), endTime: at(16, 1), duration: MINUTE }
  const model = modelOf([micro, travail])
  const html = W.segmentMarkup(model.segments[1], model)

  assert.ok(model.segments[1].widthPct < W.LABEL_MIN_PCT)
  assert.doesNotMatch(html, /chrono-seg-label/)
})

test('segmentLabel : phrase lisible (aria + title)', () => {
  const model = modelOf([PAUSE, TRAVAIL])
  assert.equal(W.segmentLabel(model.segments[0]), 'Work session, 08:00 to 10:00, 2 h')
  assert.equal(W.segmentLabel(model.segments[1]), 'Break, 10:00 to 10:30, 30 min')
})

test('summaryText : plage horaire, total, travail et pauses', () => {
  const model = modelOf([PAUSE, TRAVAIL])
  assert.equal(
    W.summaryText(model),
    '08:00 → 10:30 · 2 h 30 tracked · work 2 h · breaks 30 min (1×)'
  )
})

test('summaryText : sans pause, pas de compteur', () => {
  const model = modelOf([TRAVAIL])
  assert.equal(W.summaryText(model), '08:00 → 10:00 · 2 h tracked · work 2 h · breaks 0 s')
})

test('summaryText : chaîne vide quand il n’y a aucun segment', () => {
  assert.equal(W.summaryText(modelOf([])), '')
})

test('ticksMarkup : un repère positionné par heure entamée', () => {
  const travail = { type: 'work', startTime: at(9, 0), endTime: at(12, 0), duration: 3 * HOUR }
  const model = modelOf([travail])
  const html = W.ticksMarkup(model.ticks)

  assert.equal(model.ticks.length, 3) // 10:00, 11:00, 12:00
  assert.equal(model.ticks[0].label, '10:00')
  assert.match(html, /class="chrono-tick" data-ts="/)
  assert.match(html, /style="left:\d+(\.\d+)?%"><span>10:00<\/span>/)
})

test('tooltipLines : début, fin, durée et part du total', () => {
  const model = modelOf([PAUSE, TRAVAIL])
  const lines = W.tooltipLines(
    Object.assign({}, model.segments[1], { total: model.totalMs }),
    at(10, 30)
  )

  assert.match(lines, /Started at <strong>10:00<\/strong>/)
  assert.match(lines, /Ended at <strong>10:30<\/strong>/)
  assert.match(lines, /Duration <strong>30 min<\/strong>/)
  assert.match(lines, /20,0 % of tracked time/)
})

test('tooltipLines : un segment d’un autre jour affiche sa date', () => {
  const vieux = {
    type: 'work',
    startTime: at(9, 0) - 24 * HOUR,
    endTime: at(10, 0) - 24 * HOUR,
    duration: HOUR
  }
  const model = modelOf([vieux])
  const lines = W.tooltipLines(Object.assign({}, model.segments[0], { total: model.totalMs }), at(9, 0))
  assert.match(lines, /26\/10\/2026/)
})

test('tooltipLines : session vivante ⇒ « still running »', () => {
  const model = modelOf([], { type: 'work', startTime: at(9, 0), endTime: at(9, 30) })
  const lines = W.tooltipLines(Object.assign({}, model.segments[0], { total: model.totalMs }), at(9, 30))
  assert.match(lines, /still running/)
  assert.doesNotMatch(lines, /Ended at <strong>09:30/)
})

test('les modules s’assemblent sans DOM et exposent une API stable', () => {
  const api = [
    'SECOND',
    'MINUTE',
    'HOUR',
    'STORAGE_KEY',
    'DEFAULT_GOAL_HOURS',
    'formatDuration',
    'formatClock',
    'formatHours',
    'formatShortDuration',
    'formatTimeOfDay',
    'formatDate',
    'isSameDay',
    'formatPercent',
    'normalizeSessions',
    'sessionDuration',
    'sumByType',
    'computeWidths',
    'buildTimeline',
    'buildTicks',
    'timeToPct',
    'segmentLabel',
    'segmentMarkup',
    'ticksMarkup',
    'summaryText',
    'tooltipLines',
    'ChronoTooltip',
    'defaultState',
    'WorkTrackerCore',
    'WorklyApp'
  ]
  api.forEach((name) => assert.notEqual(W[name], undefined, `export manquant : ${name}`))
})
