'use strict'
/**
 * Régression — une pause ne doit JAMAIS disparaître.
 *
 * Bug constaté le 27/10/2026 : pause de 1 h 08 terminée par le bouton
 * principal (« Start Working »), Total Break Time restait à 0 et la pause
 * n'apparaissait ni dans la frise ni dans la liste.
 *
 * Cause : `toggle()` archivait le travail mais pas la pause qu'il terminait.
 * Ces tests reproduisent le scénario réel, minute par minute, avec une horloge
 * injectée.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const W = require('../../src/index.js')

const { SECOND, MINUTE, HOUR, WorkTrackerCore, STORAGE_KEY } = W

const T0 = new Date(2026, 9, 27, 10, 21, 0).getTime() // 27/10 10:21 locale

function makeStorage(initial) {
  const map = new Map()
  if (initial !== undefined) map.set(STORAGE_KEY, initial)
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    _map: map
  }
}

function makeClock(start) {
  let current = start
  const clock = () => current
  clock.advance = (ms) => {
    current += ms
    return current
  }
  return clock
}

function newCore(options) {
  const opts = options || {}
  const storage = opts.storage || makeStorage()
  const clock = opts.clock || makeClock(T0)
  return { core: new WorkTrackerCore({ storage, now: clock }), storage, clock }
}

/**
 * Scénario exact du rapport : 2 h 32 min 36 s de travail, puis 1 h 08 min 24 s
 * de pause, puis reprise du travail par le bouton principal.
 */
function replayReportedBug(options) {
  const ctx = newCore(options)
  const { core, clock } = ctx

  core.toggle() // Start Working 10:21
  clock.advance(2 * HOUR + 32 * MINUTE + 36 * SECOND) // 12:53:36
  core.toggle() // Take a Break
  clock.advance(1 * HOUR + 8 * MINUTE + 24 * SECOND) // 14:02
  core.toggle() // Start Working (fin de pause par le bouton principal)
  clock.advance(78 * SECOND) // 14:03:18

  return ctx
}

test('régression : une pause > 1 h terminée par « Start Working » est comptée', () => {
  const { core } = replayReportedBug()
  const totals = core.totals()

  assert.equal(totals.work, 2 * HOUR + 32 * MINUTE + 36 * SECOND)
  assert.equal(totals.break, 1 * HOUR + 8 * MINUTE + 24 * SECOND)
  assert.equal(totals.workWithCurrent, 2 * HOUR + 33 * MINUTE + 54 * SECOND)
  assert.equal(totals.breakWithCurrent, 1 * HOUR + 8 * MINUTE + 24 * SECOND)
})

test('régression : la pause apparaît dans la timeline et dans la frise', () => {
  const { core } = replayReportedBug()

  assert.equal(core.sessions().length, 2)
  const [pause, travail] = core.sessions()
  assert.equal(pause.type, 'break')
  assert.equal(travail.type, 'work')
  assert.equal(pause.duration, 1 * HOUR + 8 * MINUTE + 24 * SECOND)
  assert.equal(pause.startTime, T0 + 2 * HOUR + 32 * MINUTE + 36 * SECOND)
  assert.equal(pause.endTime, T0 + 3 * HOUR + 41 * MINUTE)

  const model = W.buildTimeline(core.sessions(), core.liveSegment())
  assert.deepEqual(
    model.segments.map((seg) => seg.type),
    ['work', 'break', 'work']
  )
  assert.equal(model.segments[1].durationLabel, '1 h 08')
  assert.ok(W.summaryText(model).includes('breaks 1 h 08 (1×)'))
})

test('régression : la pause survit à un rechargement de page', () => {
  const { storage, clock } = replayReportedBug()

  const reloaded = new WorkTrackerCore({ storage, now: () => clock() })
  assert.equal(reloaded.totals().breakWithCurrent, 1 * HOUR + 8 * MINUTE + 24 * SECOND)
  assert.equal(reloaded.state.isWorking, true)
  assert.equal(reloaded.state.timeline.length, 2)
  // le cache persisté et la timeline racontent la même histoire
  assert.equal(reloaded.state.totalBreak, 1 * HOUR + 8 * MINUTE + 24 * SECOND)
})

test('pause terminée par Stop puis reprise : pas de double comptage', () => {
  const { core, clock } = newCore()
  core.toggle() // travail
  clock.advance(HOUR)
  core.toggle() // pause
  clock.advance(30 * MINUTE)
  core.toggleBreakPause() // Stop : 30 min archivées
  clock.advance(2 * HOUR) // pause arrêtée : ce temps ne compte pas
  assert.equal(core.totals().break, 30 * MINUTE)

  core.toggle() // Start Working depuis une pause déjà arrêtée
  clock.advance(15 * MINUTE)
  core.toggle() // Take a Break
  clock.advance(10 * MINUTE)
  core.toggle() // Start Working : 10 min de plus

  assert.equal(core.totals().work, HOUR + 15 * MINUTE)
  assert.equal(core.totals().break, 40 * MINUTE)
  assert.equal(core.totals().breakWithCurrent, 40 * MINUTE)
})

test('enchaînement de 6 cycles : les totaux égalent le temps vécu', () => {
  const { core, clock } = newCore()
  const durations = [90, 5, 25, 65, 12, 3] // minutes
  let worked = 0
  let breaks = 0

  core.toggle() // démarre le travail à T0
  durations.forEach((minutes, index) => {
    const isWork = index % 2 === 0
    clock.advance(minutes * MINUTE)
    if (isWork) worked += minutes * MINUTE
    else breaks += minutes * MINUTE
    core.toggle() // alterne travail ↔ pause, en archivant la période écoulée
  })

  const totals = core.totals()
  assert.equal(totals.work, worked)
  assert.equal(totals.break, breaks)
  assert.equal(core.sessions().length, durations.length)
  // ordre du plus récent au plus ancien, sans trou
  const ordered = core.sessions().slice().reverse()
  for (let i = 1; i < ordered.length; i += 1) {
    assert.equal(ordered[i].startTime, ordered[i - 1].endTime)
  }
})

test('Stop pendant une session de travail ne crée pas de pause fantôme', () => {
  const { core, clock } = newCore()
  core.toggle() // travail
  clock.advance(HOUR)
  core.toggleBreakPause() // bouton masqué en pratique : doit être inerte

  assert.equal(core.state.isWorking, true)
  assert.equal(core.state.isBreakPaused, false)
  assert.equal(core.state.timeline.length, 0)
  assert.equal(core.totals().breakWithCurrent, 0)
  assert.equal(core.totals().workWithCurrent, HOUR)
})

test('totaux et timeline ne peuvent pas diverger (état corrompu réparé au chargement)', () => {
  const timeline = [
    { type: 'break', startTime: T0 + HOUR, endTime: T0 + HOUR + 20 * MINUTE },
    { type: 'work', startTime: T0, endTime: T0 + HOUR, duration: HOUR }
  ]
  // totals faux persistés par une ancienne version
  const corrupted = JSON.stringify({
    isWorking: false,
    currentStartTime: null,
    timeline: timeline,
    totalWork: 99 * HOUR,
    totalBreak: 0,
    dailyGoal: 4,
    isBreakPaused: true
  })

  const core = new WorkTrackerCore({ storage: makeStorage(corrupted) })
  assert.equal(core.state.totalWork, HOUR)
  assert.equal(core.state.totalBreak, 20 * MINUTE)
})

test('données héritées sans champ duration : la pause est quand même comptée', () => {
  const legacy = JSON.stringify({
    isWorking: false,
    currentStartTime: null,
    timeline: [
      { type: 'break', startTime: T0 + 4 * HOUR, endTime: T0 + 5 * HOUR },
      { type: 'work', startTime: T0, endTime: T0 + 4 * HOUR }
    ],
    totalWork: 0,
    totalBreak: 0,
    dailyGoal: 4,
    isBreakPaused: true
  })

  const core = new WorkTrackerCore({ storage: makeStorage(legacy) })
  assert.equal(core.totals().breakWithCurrent, HOUR)
  assert.equal(core.totals().workWithCurrent, 4 * HOUR)
})

test('une session de pause est en cours après un rechargement pendant la pause', () => {
  const storage = makeStorage()
  const clock = makeClock(T0)
  const core = new WorkTrackerCore({ storage, now: clock })

  core.toggle() // travail 10:21
  clock.advance(HOUR)
  core.toggle() // pause à 11:21
  clock.advance(90 * MINUTE) // 12:51, pause toujours en cours

  const reloaded = new WorkTrackerCore({ storage, now: () => clock() })
  assert.equal(reloaded.state.isWorking, false)
  assert.equal(reloaded.totals().breakWithCurrent, 90 * MINUTE)
  assert.deepEqual(reloaded.liveSegment(), {
    type: 'break',
    startTime: T0 + HOUR,
    endTime: T0 + HOUR + 90 * MINUTE
  })

  // et la pause est bien archivée à la reprise
  reloaded.toggle()
  assert.equal(reloaded.totals().break, 90 * MINUTE)
  assert.equal(reloaded.state.isWorking, true)
})
