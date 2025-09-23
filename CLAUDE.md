# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a simple work time tracking application built as a single HTML file with embedded CSS and JavaScript. The application helps users track their work sessions and break times with a clean, responsive interface.

## Architecture

- **Single-file architecture**: The entire application is contained in `work-tracker.html`
- **No build process**: Pure HTML/CSS/JavaScript with no external dependencies or frameworks
- **Client-side storage**: Uses `localStorage` for data persistence
- **State management**: Implemented via a JavaScript class `WorkTracker` that manages application state

## Core Components

### WorkTracker Class (`work-tracker.html:356-589`)
The main application controller that handles:
- State management (work/break tracking)
- Data persistence via localStorage
- UI updates and event handling
- Time calculations and formatting

### Key Methods
- `toggleState()`: Switches between work and break modes
- `updateDisplay()`: Updates all UI elements
- `saveData()`/`loadData()`: Handles localStorage persistence
- `formatTime()`: Converts milliseconds to human-readable format

## Development

### Running the Application
Simply open `work-tracker.html` in any modern web browser. No server or build process required.

### Testing
Since this is a client-side only application with no test framework:
- Manual testing in browser required
- Test localStorage functionality by refreshing the page
- Verify responsive design on different screen sizes
- Check timer accuracy by comparing with system clock

### Data Structure
The application stores data in localStorage with this structure:
```javascript
{
  isWorking: boolean,
  currentStartTime: timestamp,
  timeline: [{ type, duration, startTime, endTime }],
  totalWork: milliseconds,
  totalBreak: milliseconds
}
```

## File Structure
```
.
├── work-tracker.html    # Complete application (HTML + CSS + JS)
└── .git/               # Git repository
```