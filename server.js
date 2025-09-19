const express = require('express')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3005

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
