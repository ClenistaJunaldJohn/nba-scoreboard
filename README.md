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

## Live Game Streaming (Direct In-App HLS / M3U)

When a game is **currently live**, a pulsing **"WATCH LIVE"** button appears on the game card. Clicking it immediately opens the in-app broadcast player with real-time video streaming directly inside the project—**no external streaming websites or new browser tabs required**.

### How it works:
1. The app detects live games via the ESPN API (`status.type.state === 'in'`) and identifies the official broadcast network (e.g. ESPN, NBA TV).
2. Clicking **"🔴 Watch Live"** on any card opens the Game Detail Modal and automatically initializes the **direct HLS video player**.
3. **Multi-Server Streaming Support:**
   - **Primary HD (1080p 60FPS)**: Official high-definition live game feed.
   - **Server 2 (Direct Track)**: High-performance low-latency track.
   - **Server 3 (Live Feed)**: Alternative live broadcast feed.
   - **Custom M3U8 Stream URL**: Input your own custom stream link per game or globally.
4. **Smart TV & IPTV Player Ready**: Copy direct `.m3u8` links or download `nbatv.m3u` for VLC, TiviMate, Smart IPTV, and OTT Navigator.
5. **Theater & Fullscreen Mode**: Seamlessly hop into the widescreen Live TV tab or fullscreen for Smart TV viewing.

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
- **Live Streams:** Direct in-app HLS (.m3u / .m3u8) video streaming with multi-server IPTV proxy
