'use strict'
/**
 * Tests unitaires du modèle de frise chronologique (proportions, ordre, tooltips).
 * Exécution : npm run test:unit  (node --test test/unit/)
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const W = require('../../work-tracker.js')

const { SECOND, MINUTE, HOUR, buildTimeline } = W

const T0 = new Date(2026, 9, 16, 6, 0, 0).getTime() // 06:00 locale

function seg(type, startMs, durationMs) {
  return { type, startTime: startMs, endTime: startMs + durationMs, duration: durationMs }
}

test('buildTimeline : timeline vide', () => {
  const model = buildTimeline([], null)
  assert.deepEqual(model.segments, [])
  assert.equal(model.totalMs, 0)
  assert.equal(model.droppedMs, 0)
  assert.deepEqual(model.ticks, [])
})

test('buildTimeline : entrées corrompues ignorées, pas de crash', () => {
  const model = buildTimeline(
    [null, { type: 'work' }, { type: 'work', startTime: 'nope', endTime: 3 }],
    null
  )
  assert.equal(model.segments.length, 0)
  assert.equal(model.totalMs, 0)
})

test('buildTimeline : largeurs proportionnelles (pause 1 h vs travail 10 h ⇒ 1/10)', () => {
  // La timeline brute du localStorage est « plus récent en premier ».
  const timeline = [seg('break', T0 + 10 * HOUR, HOUR), seg('work', T0, 10 * HOUR)]
  const model = buildTimeline(timeline, null)

  assert.equal(model.segments.length, 2)
  assert.equal(model.totalMs, 11 * HOUR)

  const [work, brk] = model.segments
  assert.equal(work.type, 'work')
  assert.equal(brk.type, 'break')

  // Largeur de la pause = 1/10 de celle du travail
  assert.ok(Math.abs(work.widthPct / brk.widthPct - 10) < 1e-9)
  assert.ok(Math.abs(work.widthPct - (10 / 11) * 100) < 1e-6)
  assert.ok(Math.abs(brk.widthPct - (1 / 11) * 100) < 1e-6)

  // Les segments couvrent exactement la barre, sans trou ni recouvrement
  assert.equal(work.startPct, 0)
  assert.ok(Math.abs(work.endPct - brk.startPct) < 1e-9)
  assert.ok(Math.abs(brk.endPct - 100) < 1e-9)
})

test('buildTimeline : ordre chronologique garanti même si l’entrée est inversée', () => {
  const timeline = [
    seg('work', T0 + 3 * HOUR, HOUR),
    seg('break', T0 + 2 * HOUR, HOUR),
    seg('work', T0, 2 * HOUR)
  ]
  const model = buildTimeline(timeline, null)
  assert.deepEqual(
    model.segments.map((s) => s.startTime),
    [T0, T0 + 2 * HOUR, T0 + 3 * HOUR]
  )
  assert.deepEqual(
    model.segments.map((s) => s.type),
    ['work', 'break', 'work']
  )
  assert.deepEqual(
    model.segments.map((s) => s.index),
    [0, 1, 2]
  )
})

test('buildTimeline : la somme des largeurs vaut 100 %', () => {
  const timeline = [
    seg('break', T0 + 9 * HOUR + 20 * MINUTE, 13 * MINUTE),
    seg('work', T0 + 3 * HOUR, 3 * HOUR),
    seg('break', T0 + 2 * HOUR, HOUR),
    seg('work', T0, 2 * HOUR)
  ]
  const model = buildTimeline(timeline, null)
  const sum = model.segments.reduce((acc, s) => acc + s.widthPct, 0)
  assert.ok(Math.abs(sum - 100) < 1e-6)
})

test('buildTimeline : la session en cours est ajoutée en dernier et marquée live', () => {
  const timeline = [seg('work', T0, 2 * HOUR)]
  const live = { type: 'break', startTime: T0 + 2 * HOUR, endTime: T0 + 2 * HOUR + 20 * MINUTE }
  const model = buildTimeline(timeline, live)

  assert.equal(model.segments.length, 2)
  const last = model.segments[1]
  assert.equal(last.isLive, true)
  assert.equal(last.type, 'break')
  assert.equal(last.durationLabel, '20 min')
  assert.equal(model.segments[0].isLive, false)
  assert.ok(Math.abs(last.widthPct - (20 / 140) * 100) < 1e-6)
})

test('buildTimeline : session live conservée même à durée nulle (micro-segments écartés)', () => {
  const timeline = [seg('work', T0, 500), seg('break', T0 - 10 * MINUTE, 10 * MINUTE)]
  const model = buildTimeline(timeline, { type: 'work', startTime: T0 + 500, endTime: T0 + 500 })

  assert.equal(model.segments.length, 2) // le micro-segment de 500 ms est écarté
  assert.equal(model.droppedMs, 500)
  assert.equal(model.segments[1].isLive, true)
  assert.equal(model.segments[1].duration, 0)
  assert.equal(model.totalMs, 10 * MINUTE)
})

test('buildTimeline : durée < 1 s écrite dans le libellé', () => {
  const live = { type: 'work', startTime: T0, endTime: T0 + 250 }
  const model = buildTimeline([], live)
  assert.equal(model.segments[0].durationLabel, '< 1 s')
})

test('buildTicks : un repère par heure sur une plage de 10 h', () => {
  const model = buildTimeline([seg('work', T0, 10 * HOUR)], null)
  assert.deepEqual(
    model.ticks.map((t) => t.label),
    ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']
  )
  // Le repère 12:00 est à 6 h sur 10 h ⇒ 60 % de la barre
  const noon = model.ticks.find((t) => t.label === '12:00')
  assert.ok(Math.abs(noon.pct - 60) < 1e-9)
  // Repères strictement croissants et dans la barre
  let previous = -1
  for (const tick of model.ticks) {
    assert.ok(tick.pct > previous && tick.pct <= 100)
    previous = tick.pct
  }
})

test('buildTicks : le pas s’élargit sur une longue plage (limite de repères)', () => {
  const model = buildTimeline([seg('work', T0, 30 * HOUR)], null, { maxTicks: 12 })
  assert.ok(model.ticks.length <= 12, `trop de repères : ${model.ticks.length}`)
  // pas de 4 h : 00:00, 04:00, 08:00…
  const minutes = model.ticks.map((t) => Number(t.label.slice(3)))
  assert.ok(minutes.every((m) => m % 60 === 0))
})

test('buildTicks : plage sans durée ⇒ aucun repère', () => {
  const model = buildTimeline([], { type: 'work', startTime: T0, endTime: T0 })
  assert.deepEqual(model.ticks, [])
})

test('timeToPct : interpole dans le segment qui contient l’instant', () => {
  const timeline = [seg('break', T0 + 2 * HOUR, HOUR), seg('work', T0, 2 * HOUR)]
  const model = buildTimeline(timeline, null)
  const total = model.totalMs

  assert.equal(W.timeToPct(model.segments, total, T0), 0)
  // 1 h après le début = 1/3 de la durée totale
  assert.ok(Math.abs(W.timeToPct(model.segments, total, T0 + HOUR) - 100 / 3) < 1e-9)
  // instant dans la pause (3ᵉ heure sur 3)
  assert.ok(Math.abs(W.timeToPct(model.segments, total, T0 + 2 * HOUR + 30 * MINUTE) - 250 / 3) < 1e-9)
  assert.equal(W.timeToPct(model.segments, total, T0 + 99 * HOUR), 100)
  assert.equal(W.timeToPct([], 0, T0), 0)
})

test('buildTimeline : minDurationMs configurable', () => {
  const timeline = [seg('work', T0, 2 * SECOND), seg('work', T0 + 3 * SECOND, 2 * SECOND)]
  assert.equal(buildTimeline(timeline, null, { minDurationMs: 0 }).segments.length, 2)
  assert.equal(buildTimeline(timeline, null, { minDurationMs: 10 * SECOND }).segments.length, 0)
  assert.equal(buildTimeline(timeline, null, { minDurationMs: 10 * SECOND }).droppedMs, 4 * SECOND)
})

/* ------------------------------------------------------------------ *
 * Plancher de largeur : une pause courte doit rester VISIBLE
 * ------------------------------------------------------------------ */

test('plancher : une pause de 30 s dans 5 h garde au moins MIN_SEGMENT_PCT de la barre', () => {
  const timeline = [
    seg('work', T0 + 4 * HOUR + 30 * SECOND, HOUR),
    seg('work', T0, 4 * HOUR),
    seg('break', T0 + 4 * HOUR, 30 * SECOND)
  ]
  const model = buildTimeline(timeline, null)
  const brk = model.segments.find((s) => s.type === 'break')

  // sans plancher : 30 s / 5 h = 0,17 % (≈ 1 px) ⇒ invisible
  assert.ok(brk.widthPct >= W.MIN_SEGMENT_PCT - 1e-9)
  const sum = model.segments.reduce((acc, s) => acc + s.widthPct, 0)
  assert.ok(Math.abs(sum - 100) < 1e-6)
  // les blocs de travail restent très majoritaires
  const work = model.segments.filter((s) => s.type === 'work')
  assert.ok(work.reduce((acc, s) => acc + s.widthPct, 0) > 94)
})

test('plancher : budget total borné quand les pauses sont nombreuses', () => {
  const timeline = [seg('work', T0, 5 * HOUR)]
  for (let i = 0; i < 12; i += 1) {
    timeline.push(seg('break', T0 + HOUR + i * 10 * MINUTE, 10 * SECOND))
  }
  const model = buildTimeline(timeline, null)
  const breakPct = model.segments
    .filter((s) => s.type === 'break')
    .reduce((acc, s) => acc + s.widthPct, 0)

  assert.ok(breakPct <= W.FLOOR_BUDGET_PCT + 1e-6, `budget dépassé : ${breakPct} %`)
  assert.ok(breakPct > 10, `pauses trop effacées : ${breakPct} %`)
  const sum = model.segments.reduce((acc, s) => acc + s.widthPct, 0)
  assert.ok(Math.abs(sum - 100) < 1e-6)
})

test('plancher : aucun effet quand tous les segments dépassent le plancher', () => {
  const durations = [10 * HOUR, HOUR]
  assert.deepEqual(W.computeWidths(durations, 11 * HOUR), [(10 / 11) * 100, (1 / 11) * 100])
})

test('plancher : les repères restent sous le bloc élargi (même géométrie)', () => {
  // 30 s de pause à 10:00, puis 2 h de travail ; le bloc pause est élargi,
  // donc 10:00 doit tomber au début de la pause et 11:00 dans le travail.
  const timeline = [seg('work', T0 + 30 * SECOND, 2 * HOUR), seg('break', T0 + 30 * SECOND - 30 * SECOND, 30 * SECOND)]
  const model = buildTimeline(timeline, null)
  const brk = model.segments[0]
  const work = model.segments[1]

  assert.ok(brk.type === 'break' && work.type === 'work')
  assert.ok(Math.abs(W.timeToPct(model.segments, model.totalMs, brk.startTime) - brk.startPct) < 1e-9)
  assert.ok(Math.abs(W.timeToPct(model.segments, model.totalMs, work.startTime) - work.startPct) < 1e-9)
  const midWork = W.timeToPct(model.segments, model.totalMs, work.startTime + HOUR)
  assert.ok(midWork > work.startPct && midWork < work.startPct + work.widthPct)
  // la pause élargie ne doit pas dépasser le bloc de travail
  assert.ok(brk.widthPct < work.widthPct)
})
