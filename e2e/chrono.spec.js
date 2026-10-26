'use strict'
/**
 * e2e — frise chronologique proportionnelle + info-bulle au survol.
 * Le temps est piloté : window.worklySetNow() avance l'horloge de l'app,
 * aucun test n'attend de vraies minutes.
 */
const { test, expect } = require('playwright/test')
const { HOUR, MINUTE, SECOND, at, stateWith, seed, consoleGuard, measureSegments } = require('./helpers')

/** Scénario de référence : 10 h de travail puis 1 h de pause (ratio 1/10). */
const WORK_10H = { type: 'work', startTime: at(6, 0), endTime: at(16, 0), duration: 10 * HOUR }
const BREAK_1H = { type: 'break', startTime: at(16, 0), endTime: at(17, 0), duration: HOUR }

test('la frise affiche travail et pause avec des largeurs proportionnelles (1/10)', async ({
  page
}) => {
  const guard = consoleGuard(page)
  await seed(page, { now: at(17, 0), state: stateWith([BREAK_1H, WORK_10H]) }) // timeline : plus récent en premier
  await page.goto('/')

  const segments = page.locator('#chronoBar .chrono-seg')
  await expect(segments).toHaveCount(2)
  await expect(segments.nth(0)).toHaveAttribute('data-type', 'work')
  await expect(segments.nth(1)).toHaveAttribute('data-type', 'break')
  await expect(page.locator('#chronoBar')).toBeVisible()

  const measured = await measureSegments(page)
  expect(measured[0].duration).toBe(10 * HOUR)
  expect(measured[1].duration).toBe(HOUR)
  // le travail précède chronologiquement la pause
  expect(measured[0].end).toBeLessThanOrEqual(measured[1].start)

  // largeur réelle dans le navigateur : pause ≈ 1/10 du travail
  const ratio = measured[0].widthPx / measured[1].widthPx
  expect(ratio).toBeGreaterThan(9.5)
  expect(ratio).toBeLessThan(10.5)

  // les pourcentages annoncés correspondent au reste de la barre
  const bar = await page.locator('#chronoBar').boundingBox()
  expect(Math.abs(measured[0].widthPx / bar.width - measured[0].widthPct / 100)).toBeLessThan(0.02)
  expect(Math.abs(measured[1].widthPx / bar.width - measured[1].widthPct / 100)).toBeLessThan(0.02)

  guard.assertClean('frise 10 h / 1 h')
})

test('au survol : début, fin et durée exacte du segment', async ({ page }) => {
  const guard = consoleGuard(page)
  await seed(page, { now: at(17, 0), state: stateWith([BREAK_1H, WORK_10H]) })
  await page.goto('/')

  const tooltip = page.locator('#chronoTooltip')
  await expect(tooltip).toBeHidden()

  // survol de la pause : commencée à 16:00, terminée à 17:00, durée 1 h
  await page.locator('#chronoBar .chrono-seg').nth(1).hover()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Break')
  await expect(tooltip).toContainText('Started at 16:00')
  await expect(tooltip).toContainText('Ended at 17:00')
  await expect(tooltip).toContainText('Duration 1 h')
  await expect(tooltip).toContainText('9,1 % of tracked time')

  // survol du travail
  await page.locator('#chronoBar .chrono-seg').nth(0).hover()
  await expect(tooltip).toContainText('Work session')
  await expect(tooltip).toContainText('Started at 06:00')
  await expect(tooltip).toContainText('Ended at 16:00')
  await expect(tooltip).toContainText('Duration 10 h')

  // la souris quitte la frise : l'info-bulle disparaît
  await page.mouse.move(5, 5)
  await expect(tooltip).toBeHidden()

  guard.assertClean('info-bulle')
})

test('l’info-bulle s’ouvre aussi au clavier (focus)', async ({ page }) => {
  await seed(page, { now: at(17, 0), state: stateWith([BREAK_1H, WORK_10H]) })
  await page.goto('/')

  const tooltip = page.locator('#chronoTooltip')
  await page.locator('#chronoBar .chrono-seg').nth(1).focus()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Started at 16:00')
  await expect(tooltip).toContainText('Ended at 17:00')

  await page.locator('#mainButton').focus()
  await expect(tooltip).toBeHidden()
})

test('une pause minuscule (1 min sur 10 h) reste visible et survolable', async ({ page }) => {
  const work = { type: 'work', startTime: at(6, 0), endTime: at(16, 0), duration: 10 * HOUR }
  const tiny = { type: 'break', startTime: at(16, 0), endTime: at(16, 1), duration: MINUTE }
  await seed(page, { now: at(16, 5), state: stateWith([tiny, work]) })
  await page.goto('/')

  const breakSeg = page.locator('#chronoBar .chrono-seg').nth(1)
  const box = await breakSeg.boundingBox()
  expect(box.width).toBeGreaterThanOrEqual(2) // largeur minimale, sinon 0,17 %

  await breakSeg.hover()
  const tooltip = page.locator('#chronoTooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Started at 16:00')
  await expect(tooltip).toContainText('Ended at 16:01')
  await expect(tooltip).toContainText('Duration 1 min')
})

test('la frise se dessine au fur et à mesure : travail, pause, reprise', async ({ page }) => {
  const guard = consoleGuard(page)
  await seed(page, { now: at(9, 0), state: null })
  await page.goto('/')

  // rien à afficher au départ
  await expect(page.locator('#chronoBar')).toBeHidden()
  await expect(page.locator('#chronoEmpty')).toBeVisible()

  // 1) début du travail : un segment « en cours » apparaît tout de suite
  await page.getByRole('button', { name: 'Start Working' }).click()
  await expect(page.locator('#chronoBar .chrono-seg')).toHaveCount(1)
  await expect(page.locator('#chronoBar .chrono-seg').first()).toHaveAttribute('data-live', 'true')
  await expect(page.locator('#chronoEmpty')).toBeHidden()

  // 2) deux heures plus tard : le segment a grandi
  await page.evaluate((now) => window.worklySetNow(now), at(11, 0))
  let measured = await measureSegments(page)
  expect(measured[0].duration).toBe(2 * HOUR)
  expect(measured[0].live).toBe(true)

  // 3) pause : le travail est figé, la pause démarre
  await page.getByRole('button', { name: 'Take a Break' }).click()
  await expect(page.locator('#chronoBar .chrono-seg')).toHaveCount(2)
  await page.evaluate((now) => window.worklySetNow(now), at(11, 15))
  measured = await measureSegments(page)
  expect(measured[0].type).toBe('work')
  expect(measured[0].duration).toBe(2 * HOUR)
  expect(measured[1].type).toBe('break')
  expect(measured[1].duration).toBe(15 * MINUTE)
  expect(measured[1].live).toBe(true)

  // 4) Stop : la pause est archivée, ratio 2 h / 15 min = 8
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.locator('#chronoBar .chrono-seg')).toHaveCount(2)
  measured = await measureSegments(page)
  expect(measured[1].duration).toBe(15 * MINUTE)
  expect(measured.every((s) => !s.live)).toBe(true)
  const ratio = measured[0].widthPx / measured[1].widthPx
  expect(ratio).toBeGreaterThan(7.6)
  expect(ratio).toBeLessThan(8.4)

  // 5) la pause archivée est documentée au survol
  await page.locator('#chronoBar .chrono-seg').nth(1).hover()
  const tooltip = page.locator('#chronoTooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Started at 11:00')
  await expect(tooltip).toContainText('Ended at 11:15')
  await expect(tooltip).toContainText('Duration 15 min')

  // 6) les totaux du haut restent cohérents
  await expect(page.locator('#totalWorkTime')).toContainText('2 hours')
  await expect(page.locator('#totalBreakTime')).toContainText('15 minutes')

  guard.assertClean('parcours travail/pause')
})

test('l’info-bulle ne clignote pas pendant qu’une session tourne', async ({ page }) => {
  await seed(page, { now: at(9, 0), state: null })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Working' }).click()

  await page.locator('#chronoBar .chrono-seg').first().hover()
  const tooltip = page.locator('#chronoTooltip')
  await expect(tooltip).toBeVisible()

  // plusieurs ticks d'affichage (1 s) : le segment est mis à jour en place,
  // le noeud survolé ne doit pas être détruit
  await page.waitForTimeout(2500)
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Work session')
  await expect(tooltip).toContainText('running')
})

test('axe horaire et résumé de la plage suivie', async ({ page }) => {
  await seed(page, { now: at(17, 0), state: stateWith([BREAK_1H, WORK_10H]) })
  await page.goto('/')

  const ticks = page.locator('#chronoAxis .chrono-tick')
  await expect(ticks.first()).toContainText('07:00')
  await expect(ticks.last()).toContainText('17:00')
  await expect(ticks).toHaveCount(11)

  const positions = await ticks.evaluateAll((nodes) =>
    nodes.map((n) => Number.parseFloat(n.style.left))
  )
  for (let i = 1; i < positions.length; i += 1) {
    expect(positions[i]).toBeGreaterThan(positions[i - 1])
  }

  await expect(page.locator('#chronoSummary')).toContainText('06:00 → 17:00')
  await expect(page.locator('#chronoSummary')).toContainText('11 h tracked')
  await expect(page.locator('#chronoSummary')).toContainText('work 10 h')
  await expect(page.locator('#chronoSummary')).toContainText('breaks 1 h')
})

test('Reset All Data vide aussi la frise', async ({ page }) => {
  await seed(page, { now: at(17, 0), state: stateWith([BREAK_1H, WORK_10H]) })
  await page.goto('/')
  await expect(page.locator('#chronoBar .chrono-seg')).toHaveCount(2)

  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Reset All Data' }).click()

  await expect(page.locator('#chronoBar')).toBeHidden()
  await expect(page.locator('#chronoEmpty')).toBeVisible()
  await expect(page.locator('#chronoBar .chrono-seg')).toHaveCount(0)
})

test('une pause courte reste visible : largeur minimale + compteur de pauses', async ({ page }) => {
  const guard = consoleGuard(page)
  // journée réaliste : 4 h 55 de travail haché de pauses de 20 à 40 s
  const timeline = [
    { type: 'work', startTime: at(13, 54), endTime: at(16, 37), duration: 163 * MINUTE },
    { type: 'break', startTime: at(13, 50), endTime: at(13, 54), duration: 4 * MINUTE },
    { type: 'work', startTime: at(11, 11), endTime: at(13, 50), duration: 159 * MINUTE },
    { type: 'break', startTime: at(11, 10), endTime: at(11, 10) + 40 * SECOND, duration: 40 * SECOND },
    { type: 'break', startTime: at(10, 20), endTime: at(10, 20) + 20 * SECOND, duration: 20 * SECOND }
  ]
  await seed(page, { now: at(16, 37), state: stateWith(timeline) })
  await page.goto('/')

  const measured = await measureSegments(page)
  const breaks = measured.filter((s) => s.type === 'break')
  expect(breaks.length).toBe(3)

  const bar = await page.locator('#chronoBar').boundingBox()
  for (const brk of breaks) {
    // ≥ 8 px de large quel que soit le poids réel de la pause (< 1 % du total)
    expect(brk.widthPx).toBeGreaterThanOrEqual(8)
    expect(brk.widthPct).toBeGreaterThanOrEqual(1.9)
    // et la géométrie annoncée reste celle du rendu
    expect(Math.abs(brk.widthPx / bar.width - brk.widthPct / 100)).toBeLessThan(0.02)
  }

  // les pauses restent minoritaires : le travail garde l'essentiel de la barre
  const workPx = measured.filter((s) => s.type === 'work').reduce((a, s) => a + s.widthPx, 0)
  expect(workPx / bar.width).toBeGreaterThan(0.9)

  // le résumé annonce le nombre de pauses, pas seulement leur durée
  await expect(page.locator('#chronoSummary')).toContainText('breaks 5 min (3×)')

  // une pause élargie reste survolable et documentée
  await page.locator('#chronoBar .chrono-seg.break').first().hover()
  const tooltip = page.locator('#chronoTooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Break')
  await expect(tooltip).toContainText('20 s')

  guard.assertClean('pause courte visible')
})
