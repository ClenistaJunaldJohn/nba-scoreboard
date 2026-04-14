# NBA Live Scoreboard

A live NBA scoreboard web app that displays real-time scores, standings, and game schedules using the ESPN public API. Designed to work on desktop browsers and Smart TVs.

---

## Features

- **Live Scores** — Auto-refreshes every 30 seconds with real-time game data
- **Today & Tomorrow Games** — Shows games for today and tomorrow (based on US Eastern time)
- **Standings** — Eastern and Western conference standings
- **YouTube Highlights** — Click finished game thumbnails to search for full game highlights on YouTube
- **Game Preview** — Scheduled games show a preview thumbnail linking to YouTube
- **Smart TV Support** — Accessible over local network for viewing on Smart TVs

---

## Live Game Streaming

When a game is **currently live**, a **"WATCH LIVE"** button appears on the game card. Clicking it opens the game directly in the **StreamFree media player**.

> **https://streamfree.app/player/basketball/{away-team}-vs-{home-team}**

### How it works:
1. The app detects live games via the ESPN API (`status.type.state === 'in'`)
2. Team names are converted to URL slugs (e.g. "Los Angeles Lakers" → `los-angeles-lakers`)
3. The server-side proxy (`/api/stream-link`) checks if the stream URL is valid:
   - **Primary:** `{away-slug}-vs-{home-slug}` (e.g. `orlando-magic-vs-los-angeles-lakers`)
   - **Fallback:** `{home-slug}-vs-{away-slug}` (tries reversed team order if primary fails)
4. A red pulsing **📺 WATCH LIVE** button links directly to the working StreamFree player page
5. The link opens in a new tab, going straight to the embedded media player (no manual searching needed)

---

## How to Run

1. Open PowerShell (or Terminal) and run:
   ```
   cd ~\Desktop\nba-scoreboard
   node server.js
   ```

2. Open your browser to:
   ```
   http://localhost:3000
   ```

3. On your Smart TV (same Wi-Fi network):
   ```
   http://<your-local-ip>:3000
   ```

4. To stop: Press `Ctrl + C` in the terminal.

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript
- **Backend:** Node.js + Express (static file server)
- **Data Source:** ESPN Public API
- **Live Streams:** [StreamFree](https://streamfree.app/) (game-specific deep links with server-side URL validation)
