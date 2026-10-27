'use strict'
/**
 * src/index.js — point d'entrée Node (tests unitaires).
 *
 * Le navigateur charge les modules un par un en <script> (voir
 * work-tracker.html) ; ici on les assemble dans le même namespace plat que
 * `window.Workly`, pour que les tests utilisent exactement la même API.
 */
module.exports = Object.assign(
  {},
  require('./constants.js'),
  require('./format.js'),
  require('./timeline.js'),
  require('./chrono-view.js'),
  require('./tooltip.js'),
  require('./core.js'),
  require('./app.js')
)
