'use strict'
/**
 * Tests unitaires des helpers de formatage.
 * Exécution : npm run test:unit  (node --test test/unit/)
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const W = require('../../work-tracker.js')

const { SECOND, MINUTE, HOUR } = W

test('formatDuration : unités non nulles, jamais de "0 second" superflu', () => {
  assert.equal(W.formatDuration(0), '0 seconds')
  assert.equal(W.formatDuration(45 * SECOND), '45 seconds')
  assert.equal(W.formatDuration(MINUTE), '1 minute')
  assert.equal(W.formatDuration(20 * MINUTE), '20 minutes')
  assert.equal(W.formatDuration(HOUR), '1 hour')
  assert.equal(W.formatDuration(2 * HOUR), '2 hours')
  assert.equal(W.formatDuration(HOUR + 5 * MINUTE), '1 hour 5 minutes')
  assert.equal(W.formatDuration(HOUR + 5 * MINUTE + 3 * SECOND), '1 hour 5 minutes 3 seconds')
  assert.equal(W.formatDuration(10 * HOUR), '10 hours')
})

test('formatDuration : une durée négative ne casse pas (max 0)', () => {
  assert.equal(W.formatDuration(-5000), '0 seconds')
})

test('formatClock : chronomètre HH:MM:SS', () => {
  assert.equal(W.formatClock(0), '00:00:00')
  assert.equal(W.formatClock(SECOND), '00:00:01')
  assert.equal(W.formatClock(MINUTE + SECOND), '00:01:01')
  assert.equal(W.formatClock(HOUR + MINUTE + SECOND), '01:01:01')
  assert.equal(W.formatClock(10 * HOUR + SECOND), '10:00:01')
})

test('formatHours : heures décimales à la française', () => {
  assert.equal(W.formatHours(HOUR), '1,00')
  assert.equal(W.formatHours(90 * MINUTE), '1,50')
  assert.equal(W.formatHours(15 * MINUTE), '0,25')
})

test('formatShortDuration : format compact de la frise', () => {
  assert.equal(W.formatShortDuration(0), '0 s')
  assert.equal(W.formatShortDuration(45 * SECOND), '45 s')
  assert.equal(W.formatShortDuration(MINUTE), '1 min')
  assert.equal(W.formatShortDuration(20 * MINUTE), '20 min')
  assert.equal(W.formatShortDuration(HOUR), '1 h')
  assert.equal(W.formatShortDuration(90 * MINUTE), '1 h 30')
  assert.equal(W.formatShortDuration(3 * HOUR + 18 * MINUTE), '3 h 18')
  assert.equal(W.formatShortDuration(10 * HOUR), '10 h')
})

test('formatTimeOfDay / formatDate : heure et date locales, 24 h', () => {
  const ts = new Date(2026, 9, 16, 16, 10, 30).getTime()
  assert.equal(W.formatTimeOfDay(ts), '16:10')
  assert.equal(W.formatDate(ts), '16/10/2026')

  const early = new Date(2026, 0, 3, 7, 5).getTime()
  assert.equal(W.formatTimeOfDay(early), '07:05')
  assert.equal(W.formatDate(early), '03/01/2026')
})

test('isSameDay compare des dates calendaires', () => {
  const a = new Date(2026, 9, 16, 0, 30).getTime()
  const b = new Date(2026, 9, 16, 23, 30).getTime()
  const c = new Date(2026, 9, 17, 0, 30).getTime()
  assert.equal(W.isSameDay(a, b), true)
  assert.equal(W.isSameDay(a, c), false)
})
