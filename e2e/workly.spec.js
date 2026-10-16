'use strict'
/**
 * e2e — non-régression de l'app existante (totaux, objectif, liste, reset)
 * + santé du service et compatibilité des données déjà en localStorage.
 */
const { test, expect } = require('playwright/test')
const { HOUR, MINUTE, at, stateWith, seed, consoleGuard } = require('./helpers')

test('/health expose la version et la fonctionnalité de frise', async ({ request }) => {
  const response = await request.get('/health')
  expect(response.ok()).toBeTruthy()
  const health = await response.json()
  expect(health.status).toBe('ok')
  expect(health.app).toBe('2509-workly')
  expect(health.version).toBe('1.1.0')
  expect(health.features).toContain('chrono-timeline')
})

test('les assets sont bien servis (work-tracker.js compris)', async ({ request }) => {
  const page = await request.get('/')
  expect(page.ok()).toBeTruthy()
  expect(await page.text()).toContain('work-tracker.js')

  const script = await request.get('/work-tracker.js')
  expect(script.ok()).toBeTruthy()
  expect(await script.text()).toContain('buildTimeline')
})

test('l’app démarre sans erreur console et sans session', async ({ page }) => {
  const guard = consoleGuard(page)
  await seed(page, { now: at(9, 0), state: null })
  await page.goto('/')

  await expect(page).toHaveTitle(/Workly/)
  await expect(page.locator('#totalWorkTime')).toHaveText('0 minutes')
  await expect(page.locator('#totalBreakTime')).toHaveText('0 minutes')
  await expect(page.locator('#goalRemaining')).toContainText('4 hours')
  await expect(page.locator('#currentSession')).toBeHidden()
  await expect(page.locator('.empty-timeline')).toBeVisible()

  guard.assertClean('démarrage')
})

test('objectif atteint : progression, message et estimation de fin', async ({ page }) => {
  // 5 h déjà travaillées pour un objectif de 4 h
  const work = { type: 'work', startTime: at(6, 0), endTime: at(11, 0), duration: 5 * HOUR }
  await seed(page, { now: at(11, 0), state: stateWith([work]) })
  await page.goto('/')

  await expect(page.locator('#goalProgressFill')).toHaveCSS('width', /.+/)
  await expect(page.locator('#goalRemaining')).toContainText('Goal achieved!')
  await expect(page.locator('#goalRemaining')).toContainText('1 hour')
  await expect(page.locator('#finishEstimation')).toBeHidden()
  await expect(page.locator('#totalWorkTimeHours')).toContainText('5,00 heures')
})

test('objectif non atteint pendant une session : estimation de fin affichée', async ({ page }) => {
  await seed(page, { now: at(9, 0), state: null })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Working' }).click()
  await page.evaluate((now) => window.worklySetNow(now), at(10, 0))

  await expect(page.locator('#currentSessionTitle')).toHaveText('Current Work Session')
  await expect(page.locator('#currentSessionTime')).toHaveText('01:00:00')
  await expect(page.locator('#goalRemaining')).toContainText('3 hours')
  await expect(page.locator('#finishEstimation')).toBeVisible()
  await expect(page.locator('#finishTime')).toHaveText('13:00') // 10:00 + 3 h
})

test('l’ancienne forme de données (sans champ duration) reste lisible', async ({ page }) => {
  const legacy = {
    isWorking: false,
    currentStartTime: null,
    timeline: [
      { type: 'break', startTime: at(12, 0), endTime: at(12, 30) },
      { type: 'work', startTime: at(8, 0), endTime: at(12, 0) }
    ],
    totalWork: 4 * HOUR,
    totalBreak: 30 * MINUTE,
    dailyGoal: 4,
    isBreakPaused: true
  }
  await seed(page, { now: at(13, 0), state: legacy })
  await page.goto('/')

  await expect(page.locator('#chronoBar .chrono-seg')).toHaveCount(2)
  const durations = await page
    .locator('#chronoBar .chrono-seg')
    .evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.duration)))
  expect(durations[0]).toBe(4 * HOUR)
  expect(durations[1]).toBe(30 * MINUTE)

  // la liste détaillée reste alimentée
  await expect(page.locator('.timeline-item')).toHaveCount(2)
  await expect(page.locator('.timeline-type.work')).toContainText('Work Session')
  await expect(page.locator('#totalWorkTime')).toContainText('4 hours')
})

test('Reset All Data repart d’un état vierge', async ({ page }) => {
  await seed(page, { now: at(12, 0), state: null })
  await page.goto('/')

  await page.getByRole('button', { name: 'Start Working' }).click()
  await page.evaluate((now) => window.worklySetNow(now), at(13, 30))
  await expect(page.locator('#totalWorkTime')).toContainText('1 hour 30 minutes')

  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Reset All Data' }).click()

  await expect(page.locator('#totalWorkTime')).toHaveText('0 minutes')
  await expect(page.locator('#totalBreakTime')).toHaveText('0 minutes')
  await expect(page.locator('#currentSession')).toBeHidden()
  await expect(page.locator('.empty-timeline')).toBeVisible()
})
