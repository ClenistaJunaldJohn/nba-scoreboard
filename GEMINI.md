# NBA Live Scoreboard - Developer Documentation

This document provides a comprehensive overview of the NBA Live Scoreboard project to assist with future development and maintenance.

## Project Overview
A real-time NBA scoreboard application designed for desktop and Smart TV browsers. It aggregates data from the ESPN Public API to display scores, standings, and game schedules.

### Tech Stack
- **Frontend:** Vanilla HTML5, CSS3, and JavaScript (ES6+).
- **Backend:** Node.js with Express.
- **Data Source:** ESPN Site/V2 APIs.
- **Live Streaming:** Direct in-app HLS (.m3u / .m3u8) video streaming powered by Hls.js with multi-server IPTV proxying.

---

## Architecture & Logic

### Backend (`server.js`)
- **Static Server:** Serves the frontend assets from the root directory.
- **Game Stream Catalog (`/api/game-stream`):**
    - Dynamically parses and matches live games from the GitHub IPTV repository (`https://github.com/doms9/iptv` via `events.m3u8` and fallback `kodi.m3u8`).
    - Matches active team names and abbreviations (e.g., Cavaliers vs 76ers, Nuggets vs Thunder).
    - Resolves multi-server broadcast options with clean formatted labels (e.g. *Server 1 • XYZ Stream (1080p)*, *Server 2 • StreamCenter English HD*, *Server 4 • NBA League Pass (STRMXHD)*, *Server 5 • ESPN 2 HD*).
    - Extracts upstream `#EXTVLCOPT:http-referrer` and `http-user-agent` parameters needed by CDN edge nodes.
    - Caches the external events playlist in memory with a 90-second TTL.
- **IPTV Stream Proxy (`/api/iptv-proxy`):**
    - Proxies external `.m3u8` playlists and `.ts` video chunks.
    - Resolves and rewrites sub-manifest, key, and media segment URLs to route through the proxy with full CORS headers (`Access-Control-Allow-Origin: *`).
    - Forwards custom `referrer` query parameters into upstream HTTP `Referer` headers, bypassing CDN anti-hotlinking and 403 Forbidden protections.
    - Bypasses mixed-content restrictions when the web app is served over HTTPS (e.g., Render) while accessing HTTP streams.
- **Channels Catalog (`/api/iptv/channels`):**
    - Returns metadata for 24/7 NBA TV Philippines broadcast servers strictly for the top-nav "Watch NBA TV" button.
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
    - **Game Detail Modal (Game-Specific Live Broadcast):**
        - Fetches deeper game summaries (box scores, player stats, quarter scores, and team head-to-head comparison).
        - **Embedded Game-Specific Live HLS Video Player:** Triggered by "Watch Live" or opening an in-progress game.
        - **Dynamic Game Server Switcher:** Queries `/api/game-stream` to populate server selections exclusively matched to that specific matchup from the `doms9/iptv` GitHub repository (e.g. *XYZ Stream (1080p)*, *StreamCenter English HD*, *NBA League Pass*, *ESPN 2*, plus custom M3U8 input).
        - **Separation of Concerns:** 24/7 NBA TV Philippines channels are completely excluded from the game modal so users only receive streams for the specific game they selected.
        - Includes Fullscreen TV mode and direct `.m3u8` link copying with anti-hotlink referrers preserved.
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
- **Live TV (IPTV Streaming - Dedicated for "WATCH NBA TV" Button):**
    - Integrated "Watch NBA TV" button on the far right of the navigation bar with animated live pulse indicator.
    - Full 24/7 HLS video player powered by `hls.js` with fallback to native video playback on Safari and Smart TVs.
- **TV & Google TV Optimizations (10-Foot UI):**
    - **TV Mode Toggle & Auto-Detection:** Automatically detects Smart TV / Google TV / Android TV user agents and adds `.tv-mode` to `<body>` (also toggleable via the header `📺 TV Mode` button).
    - **Enlarged Touch/Click Targets:** 46px–54px min-height buttons, status pills, search inputs, and modal controls for effortless navigation via TV remotes (D-pad and virtual mouse).
    - **High-Visibility Spatial Navigation:** Prominent glowing cyan focus halo (`:focus-visible` with 3px outline and shadow) and auto-scroll into view when moving through elements with remote arrow keys.
    - **Remote Key Navigation:** Full TV remote control mapping: `Back` / `Escape` (codes 27, 10009, 461, BrowserBack) cleanly closes modals and custom dropdowns; D-pad arrows smoothly navigate and center focused elements.
- **TV-Friendly Stream Source / Server Switchers:**
    - **Problem Solved:** Native HTML `<select>` dropdowns fail to open or respond to remote clicks on Google TV / Android TV browsers ("hindi ma pindot ng maayos").
    - **Quick TV Server Switcher Pills:** Horizontal bar of large, 1-click remote buttons (`[ 🟢 Server 1 (1080p) ]`, `[ ⚪ Server 2 (Backup HD) ]`, `[ ⚪ Server 3 (Live Feed) ]`, `[ ⚙️ Custom URL ]`). Users on TV can switch servers with a single remote press without opening any dropdowns.
    - **Custom TV Dropdown Trigger & Popover:** A 48px high-contrast trigger button opening an in-page, custom styled glassmorphism popup menu with large option cards, active checkmarks, and arrow-key spatial navigation (instead of buggy Android native dialogs).
    - **Universal Implementation:** Implemented identically for both **Watch NBA TV** (`#channel-select`) and the **Watch Live Game Modal** (`#detail-stream-server`), while keeping the underlying `<select>` synced for backwards compatibility.
- **Utility Functions:** 
    - `TEAM_COLORS`: Mapping of NBA abbreviations to hex codes for UI consistency.
    - `LIVE_CHANNELS`: Multi-server stream registry for the 24/7 NBA TV Philippines feed.

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
