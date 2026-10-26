# Work Tracker

A simple and elegant work time tracking application with a beautiful user interface.

## Features

- ⏱️ Track work and break sessions
- 📊 Chronological timeline bar: work (blue) and breaks (orange, hatched) with width proportional to duration — a 1 h break next to 10 h of work is exactly 1/10 as wide, and short breaks keep a visible minimum width (2 % of the bar, capped at 18 % overall) so they never shrink to an invisible sliver
- 🖱️ Hover (or keyboard focus) a segment to see its exact start, end and duration
- 📊 View total work and break time statistics
- 📝 Timeline view of all activities
- 💾 Data persistence using localStorage
- 📱 Responsive design for mobile and desktop
- 🎨 Modern gradient UI design

## Getting Started

### Prerequisites

- Node.js (version 12 or higher)
- npm

### Installation

1. Clone or download this repository
2. Navigate to the project directory:
   ```bash
   cd 2509-workly
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

Start the server:

```bash
npm start
```

### Development

For development, you can also run:

```bash
npm run dev
```

## How to Use

1. **Start Working**: Click the "Start Working" button to begin tracking your work time
2. **Take a Break**: Click "Take a Break" to switch to break mode
3. **View Statistics**: See your total work time and break time in the statistics cards
4. **Chronological Timeline**: each work session and break is drawn as a coloured band, sized proportionally to how long it lasted. Hover a band to get its exact start time, end time and duration (e.g. *Break — Started at 16:10, Ended at 16:30, Duration 20 min*)
5. **Timeline**: Review your activity history in the timeline list below the bar
6. **Reset Data**: Use the "Reset All Data" button to clear all tracking data

## Testing

```bash
npm test            # unitaires (node:test) puis e2e (Playwright)
npm run test:unit   # helpers + machine à états + modèle de frise, sans navigateur
npm run test:e2e    # 15 scénarios navigateur sur un serveur de test (port 3099)
```

- Les **tests unitaires** tournent sur `work-tracker.js` : horloge et localStorage sont injectés,
  donc les scénarios de plusieurs heures sont instantanés et déterministes.
- Les **tests e2e** lancent l'app sur le port 3099 (jamais l'instance de prod) et pilotent
  l'horloge via `window.worklySetNow()`.
- `GET /health` renvoie la version et les fonctionnalités servies : utile pour vérifier
  qu'un déploiement expose bien le nouveau code.

## Project Structure

- `work-tracker.html` - Page : structure + styles (dont la frise et l'info-bulle)
- `work-tracker.js` - Logique : formatage, modèle de frise, machine à états, rendu DOM
- `server.js` - Express : fichiers statiques + `/health`
- `test/unit/` - Tests unitaires (`node --test`)
- `e2e/` - Suite Playwright (config, helpers, specs)
- `package.json` - Node.js project configuration

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js with Express.js
- **Data Storage**: Browser localStorage

## License

ISC License
