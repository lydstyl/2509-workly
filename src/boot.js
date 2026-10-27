/*!
 * src/boot.js — amorçage navigateur : charge le dernier et ne fait que
 * brancher le cœur métier sur la page.
 */
;(function (root) {
  'use strict'

  const W = root.Workly
  if (!W) throw new Error('boot.js : les modules Workly ne sont pas chargés')

  // Horloge injectable : les tests e2e la pilotent via window.__WORKLY_NOW__.
  const clock = function () {
    return typeof root.__WORKLY_NOW__ === 'number' ? root.__WORKLY_NOW__ : Date.now()
  }

  function boot() {
    const core = new W.WorkTrackerCore({
      storage: root.localStorage,
      now: clock
    })
    const app = new W.WorklyApp(core)

    // Exposé pour les tests (unitaires e2e) et le débogage.
    root.worklyCore = core
    root.worklyApp = app
    root.worklySetNow = function (ts) {
      root.__WORKLY_NOW__ = ts
      app.refresh()
    }
    return app
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
