/*!
 * src/constants.js — unités de temps, clé de stockage et seuils partagés.
 *
 * Chargé en <script src="src/constants.js"> dans le navigateur (attache ses
 * membres sur window.Workly) et require() dans les tests Node.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.Workly = root.Workly || {}
    Object.assign(root.Workly, factory())
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE

  /** Clé localStorage de l'état complet (compat : ne jamais la renommer). */
  const STORAGE_KEY = 'workTracker'

  /** Objectif journalier par défaut, en heures. */
  const DEFAULT_GOAL_HOURS = 4

  /** Segments plus courts que ça (double-clic accidentel) sont écartés de la frise. */
  const MIN_SEGMENT_MS = SECOND

  /** Nombre de repères horaires maximum sur l'axe. */
  const MAX_TICKS = 12

  /**
   * Part minimale de la barre (%) pour un segment non nul, même très court.
   * Sans ce plancher, une pause de 30 s dans une journée de 5 h ne pèse que
   * 0,17 % de la frise : à l'écran elle fait un liseré de 1 px — invisible.
   * La distorsion induite reste bornée par FLOOR_BUDGET_PCT.
   */
  const MIN_SEGMENT_PCT = 2

  /** Budget total (%) que les planchers peuvent emprunter à la barre. */
  const FLOOR_BUDGET_PCT = 18

  /** Largeur minimale (px) d'un segment dans la frise — filet de sécurité CSS. */
  const MIN_SEGMENT_PX = 2

  const TYPE_WORK = 'work'
  const TYPE_BREAK = 'break'

  return {
    SECOND: SECOND,
    MINUTE: MINUTE,
    HOUR: HOUR,
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_GOAL_HOURS: DEFAULT_GOAL_HOURS,
    MIN_SEGMENT_MS: MIN_SEGMENT_MS,
    MAX_TICKS: MAX_TICKS,
    MIN_SEGMENT_PCT: MIN_SEGMENT_PCT,
    FLOOR_BUDGET_PCT: FLOOR_BUDGET_PCT,
    MIN_SEGMENT_PX: MIN_SEGMENT_PX,
    TYPE_WORK: TYPE_WORK,
    TYPE_BREAK: TYPE_BREAK
  }
})
