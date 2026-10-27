/*!
 * src/format.js — formatage des durées, heures et dates (aucune dépendance).
 *
 * Toutes les fonctions sont pures : pas de DOM, pas d'horloge implicite
 * (sauf `new Date(timestamp)` sur un instant fourni).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./constants.js'))
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory(root.Workly))
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict'

  const SECOND = W.SECOND
  const HOUR = W.HOUR

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  /** "3 hours 18 minutes 5 seconds" (unités non nulles conservées). */
  function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / SECOND)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    const parts = []
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
    if (seconds > 0 || parts.length === 0) {
      parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`)
    }
    return parts.join(' ')
  }

  /** "HH:MM:SS" — chrono de la session en cours. */
  function formatClock(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / SECOND)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  }

  /** "1,25" — heures décimales à la française. */
  function formatHours(ms) {
    return (Math.max(0, ms) / HOUR).toFixed(2).replace('.', ',')
  }

  /** "20 min", "1 h", "3 h 18", "45 s" — compact, pour la frise. */
  function formatShortDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / SECOND)
    if (totalSeconds < 60) return `${totalSeconds} s`
    const minutes = Math.floor(totalSeconds / 60)
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `${hours} h` : `${hours} h ${pad2(rest)}`
  }

  /** "16:10" — heure de la journée, format 24 h. */
  function formatTimeOfDay(timestamp) {
    const d = new Date(timestamp)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }

  /** "16/10/2026" */
  function formatDate(timestamp) {
    const d = new Date(timestamp)
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
  }

  function isSameDay(a, b) {
    const da = new Date(a)
    const db = new Date(b)
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    )
  }

  /** "9,1" — pourcentage à la française (1 décimale). */
  function formatPercent(value) {
    return Number(value).toFixed(1).replace('.', ',')
  }

  return {
    pad2: pad2,
    formatDuration: formatDuration,
    formatClock: formatClock,
    formatHours: formatHours,
    formatShortDuration: formatShortDuration,
    formatTimeOfDay: formatTimeOfDay,
    formatDate: formatDate,
    isSameDay: isSameDay,
    formatPercent: formatPercent
  }
})
