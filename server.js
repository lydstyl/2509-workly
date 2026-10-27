const express = require('express')
const path = require('path')
const pkg = require('./package.json')

const app = express()
const PORT = process.env.PORT || 3005

/**
 * Sonde de vie + marqueur de version : sert à vérifier qu'un déploiement
 * expose bien le nouveau code (et pas l'image précédente).
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: pkg.name,
    version: pkg.version,
    features: [
      'chrono-timeline',
      'segment-tooltip',
      'timeline-axis',
      'break-min-width',
      'modular-src',
      'break-persist'
    ],
    uptime_s: Math.round(process.uptime())
  })
})

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)))

// Route to serve the work-tracker.html file at the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'work-tracker.html'))
})

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`)
  console.log(`📊 Work Tracker is available at http://localhost:${PORT}`)
})
