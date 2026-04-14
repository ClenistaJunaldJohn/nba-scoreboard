# NBA Live Scoreboard - Developer Documentation

This document provides a comprehensive overview of the NBA Live Scoreboard project to assist with future development and maintenance.

## Project Overview
A real-time NBA scoreboard application designed for desktop and Smart TV browsers. It aggregates data from the ESPN Public API to display scores, standings, and game schedules.

### Tech Stack
- **Frontend:** Vanilla HTML5, CSS3, and JavaScript (ES6+).
- **Backend:** Node.js with Express.
- **Data Source:** ESPN Site/V2 APIs.
- **Live Streaming:** Integration with [StreamFree](https://streamfree.app/) for live game deep links.

---

## Architecture & Logic

### Backend (`server.js`)
- **Static Server:** Serves the frontend assets from the root directory.
- **Stream Link Proxy (`/api/stream-link`):** 
    - Validates StreamFree URLs before serving them to the client.
    - Attempts two URL patterns: `away-vs-home` and `home-vs-away`.
    - Returns the first reachable URL (HTTP 200-399) to ensure high link reliability.
- **Network Accessibility:** Configured to listen on `0.0.0.0` to allow local network access (e.g., from a Smart TV).

### Frontend (`app.js`)
- **Data Fetching:** Periodically fetches scoreboard data every 30 seconds.
- **Normalizing Timezones:** Contains logic to handle NBA game times (US Eastern) and display them appropriately for the user (includes specific offsets for Philippine Time).
- **Dynamic Rendering:**
    - **Game Cards:** Displays team logos, scores, game status (Live, Final, Scheduled), and custom backgrounds based on team colors.
    - **Game Detail Modal:** Fetches deeper game summaries (box scores, player stats, quarter scores) when a card is clicked.
    - **Standings:** Fetches and sorts NBA conference standings.
- **Utility Functions:** 
    - `TEAM_COLORS`: Mapping of NBA abbreviations to hex codes for UI consistency.
    - `TEAM_SLUG_MAP`: Mapping of ESPN team names to StreamFree-compatible URL slugs.

---

## Key Files
- `index.html`: Main application structure and modal containers.
- `style.css`: Responsive design with a dark theme, optimized for large screens (Smart TVs).
- `app.js`: Core frontend state management and API integration.
- `server.js`: Node.js entry point and stream validation logic.
- `package.json`: Project metadata and dependency management (Express).

---

## Building and Running

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS recommended)

### Commands
| Task | Command |
| :--- | :--- |
| **Install Dependencies** | `npm install` |
| **Start Server** | `npm start` or `node server.js` |
| **Access App** | Local: `http://localhost:3000` <br> Network: `http://<your-ip>:3000` |

---

## Development Conventions

- **Vanilla-First:** Avoid adding heavy frontend frameworks (React/Vue) unless a major architectural shift is requested. The project prioritizes fast load times on TV browsers.
- **State Management:** Currently managed via DOM manipulation and global variables. If complexity grows, consider a lightweight state store.
- **API Reliability:** Always implement fallbacks for ESPN API calls, as public endpoints can be throttled or change without notice.
- **Styling:** Maintain the dark, high-contrast theme to ensure readability across different screen types and distances.
