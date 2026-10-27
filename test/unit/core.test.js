'use strict'
/**
 * Tests unitaires de la machine à états (work ↔ break), de la persistance
 * et des calculs d'objectif. Aucun DOM : storage et horloge sont injectés.
 * Exécution : npm run test:unit  (node --test test/unit/)
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const W = require('../../src/index.js')

const { SECOND, MINUTE, HOUR, WorkTrackerCore, STORAGE_KEY } = W

const T0 = new Date(2026, 9, 16, 7, 0, 0).getTime() // 07:00 locale

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
  clock.set = (value) => {
    current = value
    return current
  }
  return clock
}

function newCore(options) {
  const opts = options || {}
  const storage = opts.storage || makeStorage()
  const clock = opts.clock || makeClock(T0)
  const core = new WorkTrackerCore({ storage, now: clock })
  return { core, storage, clock }
}

test('état initial par défaut', () => {
  const { core } = newCore()
  assert.equal(core.state.isWorking, false)
  assert.equal(core.state.currentStartTime, null)
  assert.deepEqual(core.state.timeline, [])
  assert.equal(core.state.totalWork, 0)
  assert.equal(core.state.totalBreak, 0)
  assert.equal(core.state.dailyGoal, 4)
  assert.equal(core.liveSegment(), null)
  assert.deepEqual(core.totals(), {
    work: 0,
    break: 0,
    workWithCurrent: 0,
    breakWithCurrent: 0,
    current: 0
  })
})

test('cycle complet : 10 h de travail puis 1 h de pause', () => {
  const { core, clock } = newCore()

  core.toggle() // Start Working
  assert.equal(core.state.isWorking, true)
  assert.equal(core.state.currentStartTime, T0)

  clock.advance(10 * HOUR)
  assert.equal(core.currentDuration(), 10 * HOUR)
  core.toggle() // Take a Break : archive le travail, démarre la pause

  assert.equal(core.state.isWorking, false)
  assert.equal(core.state.isBreakPaused, false)
  assert.equal(core.state.totalWork, 10 * HOUR)
  assert.equal(core.state.timeline.length, 1)
  assert.equal(core.state.timeline[0].type, 'work')
  assert.equal(core.state.timeline[0].startTime, T0)
  assert.equal(core.state.timeline[0].endTime, T0 + 10 * HOUR)
  assert.equal(core.state.timeline[0].duration, 10 * HOUR)

  clock.advance(HOUR)
  core.toggleBreakPause() // Stop : archive la pause

  assert.equal(core.state.totalBreak, HOUR)
  assert.equal(core.state.timeline.length, 2)
  assert.equal(core.state.timeline[0].type, 'break')
  assert.equal(core.state.timeline[0].startTime, T0 + 10 * HOUR)
  assert.equal(core.state.timeline[0].endTime, T0 + 11 * HOUR)
  assert.equal(core.state.isBreakPaused, true)
  assert.equal(core.state.currentStartTime, null)
  assert.equal(core.liveSegment(), null)
  assert.equal(core.currentDuration(), 0)
  assert.equal(core.totals().workWithCurrent, 10 * HOUR)
  assert.equal(core.totals().breakWithCurrent, HOUR)
})

test('la frise reflète le cycle : ratio 1/10 entre pause et travail', () => {
  const { core, clock } = newCore()
  core.toggle()
  clock.advance(10 * HOUR)
  core.toggle()
  clock.advance(HOUR)
  core.toggleBreakPause()

  const model = W.buildTimeline(core.sessions(), core.liveSegment())
  assert.equal(model.segments.length, 2)
  assert.equal(model.segments[0].type, 'work')
  assert.equal(model.segments[1].type, 'break')
  assert.equal(model.segments[0].durationLabel, '10 h')
  assert.equal(model.segments[1].durationLabel, '1 h')
  assert.ok(Math.abs(model.segments[0].widthPct / model.segments[1].widthPct - 10) < 1e-9)
})

test('Resume puis nouveau Stop : deux segments de pause distincts', () => {
  const { core, clock } = newCore()
  core.toggle()
  clock.advance(2 * HOUR)
  core.toggle() // pause en cours
  clock.advance(20 * MINUTE)
  core.toggleBreakPause() // Stop
  assert.equal(core.state.totalBreak, 20 * MINUTE)

  clock.advance(15 * MINUTE) // temps non suivi (pause arrêtée)
  core.toggleBreakPause() // Resume
  assert.equal(core.state.isBreakPaused, false)
  assert.equal(core.state.currentStartTime, T0 + 2 * HOUR + 35 * MINUTE)

  clock.advance(10 * MINUTE)
  core.toggleBreakPause() // Stop
  assert.equal(core.state.totalBreak, 30 * MINUTE)
  assert.equal(core.state.timeline.length, 3)
  assert.deepEqual(
    core.state.timeline.map((t) => t.type),
    ['break', 'break', 'work']
  )
})

test('la session en cours est comptée dans les totaux, jamais archivée deux fois', () => {
  const { core, clock } = newCore()
  core.toggle()
  clock.advance(3 * HOUR)

  const totals = core.totals()
  assert.equal(totals.work, 0)
  assert.equal(totals.workWithCurrent, 3 * HOUR)
  assert.equal(totals.breakWithCurrent, 0)
  assert.equal(core.sessions().length, 0)
  assert.deepEqual(core.liveSegment(), {
    type: 'work',
    startTime: T0,
    endTime: T0 + 3 * HOUR
  })

  core.toggle()
  assert.equal(core.sessions().length, 1)
  assert.equal(core.totals().work, 3 * HOUR)
})

test('pause en cours : comptée dans totalBreak même si le travail est archivé', () => {
  const { core, clock } = newCore()
  core.toggle()
  clock.advance(HOUR)
  core.toggle() // pause en cours
  clock.advance(12 * MINUTE)

  const totals = core.totals()
  assert.equal(totals.workWithCurrent, HOUR)
  assert.equal(totals.breakWithCurrent, 12 * MINUTE)
  assert.equal(core.liveSegment().type, 'break')
})

test('persistance : l’état est relu à l’identique dans une nouvelle instance', () => {
  const storage = makeStorage()
  const { core, clock } = newCore({ storage })
  core.toggle()
  clock.advance(4 * HOUR)
  core.toggle()
  clock.advance(30 * MINUTE)

  const reloaded = new WorkTrackerCore({ storage, now: () => clock() })
  assert.equal(reloaded.state.totalWork, 4 * HOUR)
  assert.equal(reloaded.state.isWorking, false)
  assert.equal(reloaded.state.isBreakPaused, false)
  assert.equal(reloaded.state.timeline.length, 1)
  assert.equal(reloaded.totals().breakWithCurrent, 30 * MINUTE)
  assert.deepEqual(
    JSON.parse(storage.getItem(STORAGE_KEY)),
    core.snapshot()
  )
})

test('persistance : stockage vide ou corrompu ⇒ valeurs par défaut, sans exception', () => {
  assert.equal(new WorkTrackerCore({ storage: makeStorage() }).state.dailyGoal, 4)
  assert.equal(new WorkTrackerCore({ storage: makeStorage('{pas du json') }).state.totalWork, 0)
  assert.equal(new WorkTrackerCore({ storage: makeStorage('null') }).state.totalWork, 0)
  assert.equal(new WorkTrackerCore({ storage: makeStorage('[]') }).state.totalWork, 0)
  assert.equal(
    new WorkTrackerCore({
      storage: { getItem: () => { throw new Error('quota') }, setItem: () => {} }
    }).state.totalWork,
    0
  )
})

test('resetAll remet tout à zéro et persiste', () => {
  const storage = makeStorage()
  const { core, clock } = newCore({ storage })
  core.toggle()
  clock.advance(2 * HOUR)
  core.toggle()
  clock.advance(5 * MINUTE)
  core.toggleBreakPause()

  assert.equal(core.state.timeline.length, 2)
  core.resetAll()

  assert.equal(core.state.timeline.length, 0)
  assert.equal(core.state.totalWork, 0)
  assert.equal(core.state.totalBreak, 0)
  assert.equal(core.state.currentStartTime, null)
  assert.equal(core.state.isBreakPaused, false)
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).totalWork, 0)
})

test('objectif : progression, reste à faire et dépassement', () => {
  const { core } = newCore()
  assert.equal(core.state.dailyGoal, 4)

  let progress = core.goalProgress(3 * HOUR)
  assert.equal(progress.isCompleted, false)
  assert.equal(progress.progressPercent, 75)
  assert.equal(progress.remainingHours, 1)
  assert.equal(progress.overHours, 0)

  progress = core.goalProgress(6 * HOUR)
  assert.equal(progress.isCompleted, true)
  assert.equal(progress.progressPercent, 100)
  assert.equal(progress.remainingHours, 0)
  assert.equal(progress.overHours, 2)

  assert.equal(core.setGoal(6), 6)
  assert.equal(core.goalProgress(3 * HOUR).progressPercent, 50)
  assert.equal(core.setGoal('n’importe quoi'), 4) // retour au défaut
  assert.equal(core.setGoal(-2), 4)
  assert.equal(new WorkTrackerCore({
    storage: makeStorage(JSON.stringify({ dailyGoal: 7.5 }))
  }).state.dailyGoal, 7.5)
})

test('finishEstimate : heure de fin prévue, null si rien à faire', () => {
  const { core, clock } = newCore()
  assert.equal(core.finishEstimate(2 * HOUR), '09:00')
  assert.equal(core.finishEstimate(0), null)
  assert.equal(core.finishEstimate(-1000), null)
  assert.equal(core.finishEstimate(undefined), null)

  clock.advance(3 * HOUR + 25 * MINUTE)
  assert.equal(core.finishEstimate(35 * MINUTE), '11:00')
})

test('toggleBreakPause sans session en cours : rien n’est archivé', () => {
  const { core } = newCore()
  core.toggleBreakPause()
  assert.equal(core.state.isBreakPaused, true)
  assert.equal(core.state.currentStartTime, null)
  assert.equal(core.state.totalBreak, 0)
  assert.equal(core.state.timeline.length, 0)
})

test('les durées ne dépendent jamais du temps réel (horloge injectée seule)', () => {
  const { core, clock } = newCore()
  core.toggle()
  const before = Date.now()
  clock.advance(42 * SECOND)
  const model = W.buildTimeline(core.sessions(), core.liveSegment())
  assert.equal(model.segments[0].duration, 42 * SECOND)
  assert.ok(Math.abs(Date.now() - before) < 5000) // le test n'a pas dormi
})
