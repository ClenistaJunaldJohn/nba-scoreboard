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
- **IPTV Stream Proxy (`/api/iptv-proxy`):**
    - Proxies external `.m3u8` playlists and `.ts` video chunks.
    - Resolves and rewrites sub-manifest and media segment URLs to route through the proxy with full CORS headers (`Access-Control-Allow-Origin: *`).
    - Bypasses mixed-content restrictions when the web app is served over HTTPS (e.g., Render) while accessing HTTP streams.
- **Channels Catalog (`/api/iptv/channels`):**
    - Returns metadata for NBA TV channels and backup streams.
- **Power Rankings & League Leaders APIs:**
    - `/api/power-rankings/teams`: Aggregates team standings and in-depth performance statistics (PPG, RPG, APG, DIFF, FG%, 3PT%, FT%, SPG, BPG, Power Index) with in-memory 3-minute TTL caching.
    - `/api/power-rankings/players`: Fetches and parses top individual player statistics (PTS, REB, AST, STL, BLK, 3PM, FG%, 3PT%, FT%, MPG, GP) with in-memory 3-minute TTL caching.
- **Network Accessibility:** Configured to listen on `0.0.0.0` to allow local network access (e.g., from a Smart TV).

### Frontend (`app.js`)
- **Data Fetching:** Periodically fetches scoreboard data every 30 seconds.
- **Normalizing Timezones:** Contains logic to handle NBA game times (US Eastern) and display them appropriately for the user (includes specific offsets for Philippine Time).
- **Dynamic Rendering:**
    - **Game Cards & Controls:** 
        - Broadcast-style card headers with official network tags (`📺 ESPN`, `📺 NBA League Pass`), tournament/season notes, and glowing live badges.
        - High-contrast matchup arena featuring official team logos, abbreviations, full team names, record badges `(W-L)`, bold tabular scores, and winner chevron indicators.
        - Detailed quarter-by-quarter linescore strips (`Q1`–`Q4`, `OT`) for finished and live games.
        - Dedicated card footer with `📊 Box Score & Details` modal trigger alongside smart action buttons (`▶ Highlights`, `🔴 Watch Live`, `📅 Preview`).
        - Integrated Games Controls bar: 4 quick status filter pills (`🏀 All Games`, `Live Now`, `✅ Finished`, `⏰ Upcoming`), real-time team search filter, manual refresh button with spinning indicator, and smooth section jump buttons (`Today's Results`, `Tomorrow's Schedule`).
    - **Game Detail Modal:** Fetches deeper game summaries (box scores, player stats, quarter scores, and team head-to-head comparison) when any card or Box Score button is clicked.
    - **Standings Tab:**
        - Official conference switcher (`Eastern Conference` vs `Western Conference`) with persistent active state.
        - **#1 Seed Spotlight Banner:** Prominent hero card spotlighting the conference leader with high-res logo, gold crown `#1 SEED` badge, full record, win%, differential, home/away splits, and current streak.
        - **Rich 12-Column Table:** Complete conference picture displaying `#`, `TEAM`, `W`, `L`, `PCT`, `GB`, `DIFF`, `HOME`, `AWAY`, `CONF`, `L10`, and `STRK`.
        - **Visual Playoff Picture:** Color-coded rank badges (Gold `#1`, Green Playoff `1–6`, Orange Play-In `7–10`, Slate Lottery `11–15`) and interactive playoff cutoff divider rows (`🏆 Top 6 Guaranteed Playoff Line` and `⚔️ Seeds 7–10 Play-In Tournament Line`).
        - **Interactive Sorting & Search:** Real-time search filter and clickable column headers with ascending/descending toggles and active highlight column styling.
    - **Power Rankings & League Leaders:**
        - Replaces the playoff section during the early/regular season.
        - **Sub-Tabs:** Dedicated views for **Team Rankings** and **Player Leaders**.
        - **Top 3 Spotlight Podium:** Visual top-3 spotlight cards with rank medals (#1 Gold with crown, #2 Silver, #3 Bronze), player avatars / team logos, and prominent stat counters for the active category.
        - **Multi-Category Sorting:** Quick-filter pill buttons and interactive, clickable table headers with ascending/descending toggles and visual indicators (`▲`/`▼`) for any category (PPG, RPG, APG, DIFF, FG%, 3PT%, SPG, BPG, etc.).
        - **Real-Time Filtering:** Real-time search by player or team name, plus Eastern/Western conference filter.
        - **Resilient Fallback:** Automatically falls back directly to ESPN public APIs if the local server endpoints are unavailable.
- **Live TV (IPTV Streaming):**
    - Integrated "Watch NBA TV" button on the far right of the navigation bar with animated live pulse indicator.
    - Full HLS video player powered by `hls.js` with fallback to native video playback on Safari and Smart TVs.
    - Features channel server switcher (NBA TV Philippines, Backup HD, Custom URL), Theater Mode, Fullscreen, and stream status monitoring.
    - Provides direct M3U playlist file (`nbatv.m3u`) for Smart TV IPTV players (VLC, TiviMate, Smart IPTV, OTT Navigator).
    - Remembers custom M3U/M3U8 URLs in `localStorage`.
    - Automatically pauses stream when switching to other tabs to optimize CPU and network bandwidth.
- **Utility Functions:** 
    - `TEAM_COLORS`: Mapping of NBA abbreviations to hex codes for UI consistency.
    - `TEAM_SLUG_MAP`: Mapping of ESPN team names to StreamFree-compatible URL slugs.

---

## Key Files
- `index.html`: Main application structure, modal containers, and Live TV player layout.
- `style.css`: Responsive design with a dark theme, optimized for large screens (Smart TVs) and mobile.
- `app.js`: Core frontend state management, API integration, and Live TV HLS stream player.
- `server.js`: Node.js entry point, stream validation, and IPTV stream proxy.
- `nbatv.m3u`: M3U playlist file for NBA TV Philippines live streams.
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
