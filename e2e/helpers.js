'use strict'
/** Helpers communs aux specs e2e. */
const { expect } = require('playwright/test')

const STORAGE_KEY = 'workTracker'
const HOUR = 3600 * 1000
const MINUTE = 60 * 1000
const SECOND = 1000

/** Instant fixe (jour de test) en heure locale du navigateur (Europe/Paris). */
function at(hours, minutes, day = 16) {
  return new Date(2026, 9, day, hours, minutes || 0, 0).getTime()
}

/** Construit un état localStorage workTracker cohérent avec la timeline fournie. */
function stateWith(timeline, overrides) {
  const totalWork = timeline
    .filter((t) => t.type === 'work')
    .reduce((acc, t) => acc + t.duration, 0)
  const totalBreak = timeline
    .filter((t) => t.type === 'break')
    .reduce((acc, t) => acc + t.duration, 0)
  return Object.assign(
    {
      isWorking: false,
      currentStartTime: null,
      timeline: timeline,
      totalWork: totalWork,
      totalBreak: totalBreak,
      dailyGoal: 4,
      isBreakPaused: true
    },
    overrides || {}
  )
}

/** Pose l'horloge (et éventuellement l'état) avant le chargement de la page. */
async function seed(page, options) {
  const opts = options || {}
  await page.addInitScript(
    (payload) => {
      window.__WORKLY_NOW__ = payload.now
      if (payload.state) {
        window.localStorage.setItem(payload.key, JSON.stringify(payload.state))
      } else {
        window.localStorage.removeItem(payload.key)
      }
    },
    { key: STORAGE_KEY, now: opts.now, state: opts.state || null }
  )
}

/**
 * Pose l'horloge SANS toucher au localStorage : indispensable pour tester un
 * `page.reload()`, sinon le script d'init remet le storage à zéro à chaque
 * navigation (et efface l'état qu'on veut justement vérifier).
 */
async function seedClock(page, now) {
  await page.addInitScript((value) => {
    window.__WORKLY_NOW__ = value
  }, now)
}

/** Aucune erreur console / exception JS ne doit passer inaperçue. */
function consoleGuard(page) {
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))
  return {
    errors: errors,
    assertClean(label) {
      expect(errors, `erreurs console sur ${label} : ${errors.join(' | ')}`).toEqual([])
    }
  }
}

/** Mesure les segments rendus : type, durée déclarée, largeur réelle en px. */
function measureSegments(page) {
  return page.locator('#chronoBar .chrono-seg').evaluateAll((nodes) =>
    nodes.map((node) => ({
      type: node.dataset.type,
      duration: Number(node.dataset.duration),
      widthPct: Number(node.dataset.widthPct),
      widthPx: node.getBoundingClientRect().width,
      start: Number(node.dataset.start),
      end: Number(node.dataset.end),
      live: node.dataset.live === 'true'
    }))
  )
}

module.exports = {
  STORAGE_KEY,
  HOUR,
  MINUTE,
  SECOND,
  at,
  stateWith,
  seed,
  seedClock,
  consoleGuard,
  measureSegments
}
