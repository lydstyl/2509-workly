'use strict'
/**
 * Configuration Playwright (e2e).
 *
 * L'app est servie par son propre serveur Express sur un port de test (3099),
 * avec la vraie base localStorage du navigateur : aucun état réel n'est touché
 * (les données de prod vivent dans le navigateur de Gabriel, pas ici).
 *
 *   npm run test:e2e
 */
const path = require('path')
const { defineConfig } = require('playwright/test')

const PORT = Number(process.env.WORKLY_TEST_PORT || 3099)
const BASE_URL = `http://127.0.0.1:${PORT}`

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.js',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: path.join(__dirname, 'test-results'),
  use: {
    baseURL: BASE_URL,
    timezoneId: 'Europe/Paris',
    locale: 'en-GB',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node server.js',
    cwd: path.join(__dirname, '..'),
    env: { PORT: String(PORT), NODE_ENV: 'test' },
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 30000
  }
})
