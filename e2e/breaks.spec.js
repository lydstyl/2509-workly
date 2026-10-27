'use strict'
/**
 * e2e — reproduction du bug signalé le 27/10/2026 :
 * « pause de plus d'une heure, et Total Break Time reste à 0 ».
 *
 * Le scénario est rejoué par l'interface : les boutons sont cliqués comme
 * Gabriel les clique, seule l'horloge est pilotée (window.worklySetNow).
 */
const { test, expect } = require('playwright/test')
const { HOUR, MINUTE, SECOND, at, seed, seedClock, consoleGuard, measureSegments } = require('./helpers')

/** Joue le scénario du rapport et rend la main une fois la pause terminée. */
async function replayReportedScenario(page) {
  await page.getByRole('button', { name: 'Start Working' }).click()

  // 10:21 → 12:53:36 de travail
  await page.evaluate((now) => window.worklySetNow(now), at(12, 53) + 36 * SECOND)
  await expect(page.locator('#totalWorkTime')).toContainText('2 hours 32 minutes 36 seconds')

  // Take a Break puis 1 h 08 min 24 s de pause
  await page.getByRole('button', { name: 'Take a Break' }).click()
  await expect(page.locator('#currentSessionTitle')).toHaveText('Current Break')
  await expect(page.locator('#totalBreakTime')).toContainText('0 minutes')

  await page.evaluate((now) => window.worklySetNow(now), at(14, 2))

  // Reprise du travail par le bouton principal
  await page.getByRole('button', { name: 'Start Working' }).click()
}

test('régression : la pause terminée par « Start Working » est comptée', async ({ page }) => {
  const guard = consoleGuard(page)
  await seed(page, { now: at(10, 21), state: null })
  await page.goto('/')

  await replayReportedScenario(page)

  // Le chiffre qui était faux à l'écran
  await expect(page.locator('#totalBreakTime')).toHaveText('1 hour 8 minutes 24 seconds')
  await expect(page.locator('#totalWorkTime')).toContainText('2 hours 32 minutes 36 seconds')

  // La pause apparaît dans la liste d'activité
  const items = page.locator('.timeline-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0).locator('.timeline-type')).toHaveText('Break Time')
  await expect(items.nth(0).locator('.timeline-duration')).toContainText('1 hour 8 minutes 24 seconds')
  await expect(items.nth(1).locator('.timeline-type')).toHaveText('Work Session')

  guard.assertClean('régression pause')
})

test('régression : la pause est visible sur la frise, avec sa durée', async ({ page }) => {
  await seed(page, { now: at(10, 21), state: null })
  await page.goto('/')
  await replayReportedScenario(page)

  const segments = await measureSegments(page)
  // travail → pause → reprise (segment « vivant », encore à 0 s)
  expect(segments.map((s) => s.type)).toEqual(['work', 'break', 'work'])
  expect(segments[2].live).toBe(true)

  const pause = segments[1]
  expect(pause.duration).toBe(HOUR + 8 * MINUTE + 24 * SECOND)
  expect(pause.widthPx).toBeGreaterThan(10)

  await expect(page.locator('#chronoSummary')).toContainText('breaks 1 h 08 (1×)')

  await page.locator('#chronoBar .chrono-seg').nth(1).hover()
  const tooltip = page.locator('#chronoTooltip')
  await expect(tooltip).toContainText('Break')
  await expect(tooltip).toContainText('Started at 12:53')
  await expect(tooltip).toContainText('Ended at 14:02')
  await expect(tooltip).toContainText('Duration 1 h 08')
})

test('régression : la pause comptée survit à un rechargement de page', async ({ page }) => {
  // seedClock et non seed : un reload rejouerait le script d'init qui vide le
  // localStorage, donc l'état à vérifier disparaîtrait avant l'assertion.
  await seedClock(page, at(10, 21))
  await page.goto('/')
  await page.evaluate(() => window.localStorage.removeItem('workTracker'))
  await page.reload()
  await replayReportedScenario(page)

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('workTracker')))
  expect(stored.totalBreak).toBe(HOUR + 8 * MINUTE + 24 * SECOND)
  expect(stored.timeline.filter((t) => t.type === 'break')).toHaveLength(1)

  await page.reload()
  await expect(page.locator('#totalBreakTime')).toHaveText('1 hour 8 minutes 24 seconds')
  await expect(page.locator('#totalWorkTime')).toContainText('2 hours 32 minutes 36 seconds')
})

test('cycle complet travail → pause → Stop → Resume → travail : aucun temps perdu', async ({
  page
}) => {
  await seed(page, { now: at(8, 0), state: null })
  await page.goto('/')

  await page.getByRole('button', { name: 'Start Working' }).click()
  await page.evaluate((now) => window.worklySetNow(now), at(9, 0))
  await page.getByRole('button', { name: 'Take a Break' }).click() // 1 h de travail archivée

  await page.evaluate((now) => window.worklySetNow(now), at(9, 20))
  await page.getByRole('button', { name: 'Stop' }).click() // 20 min de pause archivées
  await page.evaluate((now) => window.worklySetNow(now), at(11, 0)) // pause arrêtée : 1 h 40 qui ne compte pas

  await page.getByRole('button', { name: 'Resume' }).click()
  await page.evaluate((now) => window.worklySetNow(now), at(11, 30))
  await page.getByRole('button', { name: 'Start Working' }).click() // 30 min de pause archivées

  await expect(page.locator('#totalBreakTime')).toHaveText('50 minutes')
  await expect(page.locator('#totalWorkTime')).toContainText('1 hour')

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('workTracker')))
  expect(stored.totalWork).toBe(HOUR)
  expect(stored.totalBreak).toBe(50 * MINUTE)
  expect(stored.timeline).toHaveLength(3)
  expect(stored.timeline.reduce((acc, t) => acc + t.duration, 0)).toBe(HOUR + 50 * MINUTE)
})
