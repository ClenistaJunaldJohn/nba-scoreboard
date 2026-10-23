const express = require('express');
const http = require('http');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from current directory
app.use(express.static(__dirname));

// ===== LIVE NBA TV CHANNELS (FOR "WATCH NBA TV" BUTTON ONLY) =====
const WATCH_NBATV_CHANNELS = [
  {
    id: 'primary',
    name: 'NBA TV Philippines',
    quality: '1080p 60FPS',
    url: 'http://23.237.104.106:8080/USA_NBA/index.m3u8',
    description: 'Official NBA TV broadcast feed with live games and studio coverage'
  },
  {
    id: 'backup',
    name: 'NBA TV Server 2',
    quality: '1080p Direct Track',
    url: 'http://23.237.104.106:8080/USA_NBA/tracks-v1a1/mono.m3u8',
    description: 'High performance backup stream with low latency'
  },
  {
    id: 'server3',
    name: 'NBA TV Server 3',
    quality: '720p Direct Feed',
    url: 'http://198.58.104.90:8989/nba/index.m3u8',
    description: 'Alternative direct live game feed'
  }
];

// Helper to fetch text with redirect support
function fetchText(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirected = new URL(res.headers.location, url).toString();
          return fetchText(redirected, timeoutMs).then(resolve).catch(reject);
        } catch (e) {
          return reject(e);
        }
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
  });
}

// Parse M3U playlist with #EXTVLCOPT headers (http-referrer, http-user-agent)
function parseM3UEvents(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const items = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      if (current && current.url) items.push(current);
      current = { extinf: line, referrer: '', userAgent: '', url: '' };
    } else if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
      if (current) current.referrer = line.replace('#EXTVLCOPT:http-referrer=', '').trim();
    } else if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      if (current) current.userAgent = line.replace('#EXTVLCOPT:http-user-agent=', '').trim();
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      if (current) {
        current.url = line;
        items.push(current);
        current = null;
      }
    }
  }
  if (current && current.url) items.push(current);
  return items;
}

// In-memory cache for doms9/iptv live events (90s TTL)
let eventsCache = { data: null, timestamp: 0 };
const EVENTS_CACHE_TTL = 90 * 1000;

async function fetchEventsPlaylist() {
  const now = Date.now();
  if (eventsCache.data && (now - eventsCache.timestamp < EVENTS_CACHE_TTL)) {
    return eventsCache.data;
  }

  const primaryUrl = 'https://raw.githubusercontent.com/doms9/iptv/refs/heads/default/M3U8/events.m3u8';
  const fallbackUrl = 'https://raw.githubusercontent.com/doms9/iptv/refs/heads/default/M3U8/kodi.m3u8';

  let rawText = '';
  try {
    rawText = await fetchText(primaryUrl, 9000);
  } catch (err) {
    console.warn('Events playlist primary fetch failed, trying fallback:', err.message);
    try {
      rawText = await fetchText(fallbackUrl, 9000);
    } catch (e2) {
      console.error('All events playlist fetches failed:', e2.message);
      return eventsCache.data || [];
    }
  }

  const parsed = parseM3UEvents(rawText);
  if (parsed.length > 0) {
    eventsCache = { data: parsed, timestamp: now };
  }
  return parsed.length > 0 ? parsed : (eventsCache.data || []);
}

function formatServerDisplayName(rawTitle, idx) {
  let title = rawTitle;
  if (/NBA\s*League\s*Pass/i.test(title)) {
    const tag = title.match(/\(([^)]+)\)$/)?.[1] || 'HD';
    return `Server ${idx + 1} • NBA League Pass (${tag})`;
  }
  if (/ESPN\s*2\s*\|\s*HD/i.test(title)) {
    const tag = title.match(/\(([^)]+)\)$/)?.[1] || 'TVF90';
    return `Server ${idx + 1} • ESPN 2 HD (${tag})`;
  }
  if (/ESPN\s*2/i.test(title)) {
    const tag = title.match(/\(([^)]+)\)$/)?.[1] || 'Feed';
    return `Server ${idx + 1} • ESPN 2 (${tag})`;
  }
  if (/STRMCNTR/i.test(title)) {
    return `Server ${idx + 1} • StreamCenter English HD`;
  }
  if (/\(XYZ\)/i.test(title)) {
    return `Server ${idx + 1} • XYZ Stream (1080p)`;
  }
  if (/FUTBOLX/i.test(title)) {
    return `Server ${idx + 1} • FutbolX Main Feed`;
  }
  if (/SPRTSPASS/i.test(title)) {
    return `Server ${idx + 1} • SportsPass Direct`;
  }
  if (/FAWA/i.test(title)) {
    const num = title.match(/(\d+)\s*\(FAWA\)/i)?.[1] || 'Feed';
    return `Server ${idx + 1} • FAWA Sports Feed ${num}`;
  }
  if (/STRMGATE/i.test(title)) {
    return `Server ${idx + 1} • StreamGate English`;
  }
  if (/DAMITV/i.test(title)) {
    return `Server ${idx + 1} • DamiTV Live`;
  }
  if (/FLYEMBD/i.test(title)) {
    return `Server ${idx + 1} • FlyEmbed Stream`;
  }
  if (/iSTRMEAST/i.test(title)) {
    return `Server ${idx + 1} • StreamEast Feed`;
  }
  if (/TVF90/i.test(title)) {
    const op = title.match(/OP\d+/i)?.[0] || 'Feed';
    return `Server ${idx + 1} • TVF90 (${op})`;
  }

  title = title.replace(/^\[(Basketball|NBA|NBA Basketball|Live Event)\]\s*/i, '');
  title = title.replace(/^[A-Za-z0-9\s.]+(vs\.?|at)\s+[A-Za-z0-9\s.]+\s*\|\s*/i, '');
  title = title.replace(/^[A-Za-z0-9\s.]+(vs\.?|at)\s+[A-Za-z0-9\s.]+\s*/i, '');
  title = title.trim();
  if (!title) title = 'Live Game Feed';
  return `Server ${idx + 1} • ${title}`;
}

// API: Resolve live broadcast HLS streams for a specific game from doms9/iptv
app.get('/api/game-stream', async (req, res) => {
  const { eventId, broadcast, away, home, awayAbbr, homeAbbr } = req.query;

  try {
    const events = await fetchEventsPlaylist();
    const awayWords = [
      (away || '').toLowerCase(),
      (awayAbbr || '').toLowerCase(),
      ...((away || '').toLowerCase().split(/\s+/))
    ].filter(w => w.length > 2);

    const homeWords = [
      (home || '').toLowerCase(),
      (homeAbbr || '').toLowerCase(),
      ...((home || '').toLowerCase().split(/\s+/))
    ].filter(w => w.length > 2);

    const matched = events.filter(it => {
      const t = it.extinf.toLowerCase();
      const hasAway = awayWords.some(w => t.includes(w));
      const hasHome = homeWords.some(w => t.includes(w));
      return hasAway && hasHome;
    });

    const activeServers = matched.map((m, idx) => {
      const nameMatch = m.extinf.match(/tvg-name="([^"]+)"/) || m.extinf.match(/,(.+)$/);
      const rawTitle = nameMatch ? nameMatch[1].trim() : 'Live Game';
      return {
        id: `doms9_${idx + 1}`,
        rawTitle,
        name: formatServerDisplayName(rawTitle, idx),
        url: m.url,
        referrer: m.referrer || '',
        userAgent: m.userAgent || '',
        quality: 'Live HD'
      };
    });

    const displayBroadcast = broadcast && broadcast !== 'undefined' ? broadcast : 'NBA Live Broadcast';
    const gameTitle = (away && home) ? `${away} vs ${home}` : 'Live Game';

    res.json({
      eventId: eventId || null,
      gameTitle,
      broadcast: displayBroadcast,
      totalServers: activeServers.length,
      activeServers
    });
  } catch (err) {
    console.error('Game stream resolver error:', err.message);
    res.json({
      eventId: eventId || null,
      gameTitle: `${away || ''} vs ${home || ''}`,
      broadcast: broadcast || 'NBA Live Broadcast',
      totalServers: 0,
      activeServers: []
    });
  }
});


// ===== IPTV LIVE STREAM PROXY =====
// Solves CORS and Mixed-Content (HTTPS site loading HTTP stream on Render/Smart TV)
app.options('/api/iptv-proxy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.sendStatus(204);
});

app.get('/api/iptv-proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    return res.status(400).send('Invalid url parameter');
  }

  const customReferrer = req.query.referrer || req.query.ref || '';
  const effectiveReferrer = customReferrer || (parsedUrl.origin + '/');
  const customUserAgent = req.query.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const client = parsedUrl.protocol === 'http:' ? http : https;
  const proxyReq = client.get(targetUrl, {
    headers: {
      'User-Agent': customUserAgent,
      'Referer': effectiveReferrer
    },
    timeout: 12000
  }, (proxyRes) => {
    // Handle HTTP redirects (301, 302, 307, 308)
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      try {
        const redirected = new URL(proxyRes.headers.location, targetUrl).toString();
        let redirectUrl = `/api/iptv-proxy?url=${encodeURIComponent(redirected)}`;
        if (customReferrer) redirectUrl += `&referrer=${encodeURIComponent(customReferrer)}`;
        return res.redirect(redirectUrl);
      } catch (e) {
        return res.redirect(proxyRes.headers.location);
      }
    }

    const contentType = proxyRes.headers['content-type'] || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const isPlaylist = targetUrl.toLowerCase().includes('.m3u8') ||
                       targetUrl.toLowerCase().includes('.m3u') ||
                       contentType.includes('mpegurl') ||
                       contentType.includes('application/x-mpegurl');

    if (isPlaylist) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      let body = '';
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        const refParam = customReferrer ? `&referrer=${encodeURIComponent(customReferrer)}` : '';
        // Rewrite all URI lines in the m3u8 playlist to route back through this proxy
        const rewritten = body.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          // Rewrite EXT-X-KEY or EXT-X-MAP URIs if present
          if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:')) {
            return line.replace(/URI="([^"]+)"/, (m, uri) => {
              try {
                const absolute = new URL(uri, targetUrl).toString();
                return `URI="/api/iptv-proxy?url=${encodeURIComponent(absolute)}${refParam}"`;
              } catch (e) {
                return m;
              }
            });
          }

          if (trimmed.startsWith('#')) return line;
          try {
            const absoluteUrl = new URL(trimmed, targetUrl).toString();
            return `/api/iptv-proxy?url=${encodeURIComponent(absoluteUrl)}${refParam}`;
          } catch (e) {
            return line;
          }
        }).join('\n');
        res.send(rewritten);
      });
    } else {
      // Binary segments (.ts, .aac, .m4s, etc.)
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      } else if (targetUrl.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/MP2T');
      }
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('IPTV proxy error:', err.message);
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send('Proxy timeout');
  });
});

// API: Channels catalog strictly for Watch NBA TV button
app.get('/api/iptv/channels', (req, res) => {
  res.json(WATCH_NBATV_CHANNELS);
});

// ===== POWER RANKINGS & LEAGUE LEADERS API =====

function fetchJSON(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout for ${url}`)); });
  });
}

// In-memory caches for fast responses
let teamsCache = { data: null, timestamp: 0 };
let playersCache = { data: null, timestamp: 0 };
const PR_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// API: Team Power Rankings with full statistics
app.get('/api/power-rankings/teams', async (req, res) => {
  const now = Date.now();
  if (teamsCache.data && (now - teamsCache.timestamp < PR_CACHE_TTL)) {
    return res.json(teamsCache.data);
  }

  try {
    const standingsData = await fetchJSON('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings');
    const entries = [];
    (standingsData.children || []).forEach(conf => {
      const confName = (conf.name || conf.abbreviation || '').toLowerCase().includes('east') ? 'Eastern' : 'Western';
      (conf.standings?.entries || []).forEach(entry => {
        entries.push({ entry, confName });
      });
    });

    const teamsWithStats = await Promise.all(entries.map(async ({ entry, confName }) => {
      const team = entry.team || {};
      const teamId = team.id;
      const statsMap = {};
      (entry.stats || []).forEach(s => { statsMap[s.name] = s.value; });

      let detailStats = {};
      try {
        const statsData = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/statistics`, 4000);
        (statsData.results?.stats?.categories || []).forEach(cat => {
          (cat.stats || []).forEach(s => {
            detailStats[s.name] = s.value;
          });
        });
      } catch (e) {
        // Fallback to empty if individual call fails
      }

      const wins = statsMap.wins || 0;
      const losses = statsMap.losses || 0;
      const winPct = statsMap.winPercent !== undefined ? statsMap.winPercent : (wins + losses > 0 ? wins / (wins + losses) : 0);
      const diff = statsMap.differential !== undefined ? statsMap.differential : 0;
      const ppg = detailStats.avgPoints !== undefined ? detailStats.avgPoints : (statsMap.avgPointsFor || 0);
      const oppPpg = statsMap.avgPointsAgainst || 0;
      const rpg = detailStats.avgRebounds || detailStats.totalRebounds || 0;
      const apg = detailStats.avgAssists || 0;
      const spg = detailStats.avgSteals || 0;
      const bpg = detailStats.avgBlocks || 0;
      const fgPct = detailStats.fieldGoalPct || 0;
      const threePct = detailStats.threePointPct || 0;
      const ftPct = detailStats.freeThrowPct || 0;
      const streak = statsMap.streak || 0;
      const gamesPlayed = detailStats.gamesPlayed || (wins + losses) || 1;

      // Power Index Score formula:
      const powerScore = Math.max(0, Math.round(
        (winPct * 45) +
        (diff * 1.5) +
        (ppg * 0.18) +
        (rpg * 0.12) +
        (apg * 0.15) +
        (fgPct * 0.1) +
        (streak > 0 ? Math.min(streak, 5) * 0.8 : Math.max(streak, -5) * 0.5)
      * 10) / 10);

      return {
        id: teamId,
        name: team.shortDisplayName || team.name || 'Unknown',
        fullName: team.displayName || team.shortDisplayName || 'Unknown',
        abbreviation: team.abbreviation || 'NBA',
        logo: (team.logos && team.logos[0] && team.logos[0].href) || `https://a.espn.com/i/teamlogos/nba/500/${(team.abbreviation || '').toLowerCase()}.png`,
        conference: confName,
        wins,
        losses,
        winPct: Math.round(winPct * 1000) / 1000,
        streak: streak > 0 ? `W${streak}` : streak < 0 ? `L${Math.abs(streak)}` : '—',
        diff: Math.round(diff * 10) / 10,
        ppg: Math.round(ppg * 10) / 10,
        oppPpg: Math.round(oppPpg * 10) / 10,
        rpg: Math.round(rpg * 10) / 10,
        apg: Math.round(apg * 10) / 10,
        spg: Math.round(spg * 10) / 10,
        bpg: Math.round(bpg * 10) / 10,
        fgPct: Math.round(fgPct * 10) / 10,
        threePct: Math.round(threePct * 10) / 10,
        ftPct: Math.round(ftPct * 10) / 10,
        gamesPlayed,
        powerScore
      };
    }));

    teamsWithStats.sort((a, b) => b.powerScore - a.powerScore);
    teamsWithStats.forEach((t, i) => { t.rank = i + 1; });

    teamsCache = { data: teamsWithStats, timestamp: now };
    res.json(teamsWithStats);
  } catch (err) {
    console.error('Power rankings teams error:', err.message);
    if (teamsCache.data) return res.json(teamsCache.data);
    res.status(500).json({ error: 'Failed to fetch team power rankings', details: err.message });
  }
});

// API: Player Leaders with individual statistics
app.get('/api/power-rankings/players', async (req, res) => {
  const now = Date.now();
  if (playersCache.data && (now - playersCache.timestamp < PR_CACHE_TTL)) {
    return res.json(playersCache.data);
  }

  try {
    const data = await fetchJSON('https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?limit=150');
    const catDefs = {};
    (data.categories || []).forEach(c => {
      catDefs[c.name] = c.names;
    });

    const players = (data.athletes || []).map(item => {
      const a = item.athlete || {};
      const team = (a.teams && a.teams[0]) ? a.teams[0] : {};
      const stats = {};
      (item.categories || []).forEach(c => {
        const names = catDefs[c.name] || [];
        names.forEach((name, i) => {
          const rawVal = c.totals && c.totals[i] !== undefined ? c.totals[i] : (c.values && c.values[i] !== undefined ? c.values[i] : 0);
          const val = parseFloat(rawVal);
          stats[name] = isNaN(val) ? 0 : val;
        });
      });

      return {
        id: a.id,
        name: a.displayName || 'Unknown Player',
        shortName: a.shortName || a.displayName || '',
        headshot: (a.headshot && a.headshot.href) || `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${a.id}.png&w=350&h=254`,
        jersey: a.jersey ? `#${a.jersey}` : '',
        position: (a.position && a.position.abbreviation) || '—',
        team: {
          id: team.id || a.teamId || '',
          name: team.shortDisplayName || team.name || a.teamShortName || 'NBA',
          fullName: team.displayName || a.teamName || 'NBA',
          abbreviation: team.abbreviation || 'NBA',
          logo: (team.logos && team.logos[0] && team.logos[0].href) || (a.teamLogos && a.teamLogos[0] && a.teamLogos[0].href) || `https://a.espn.com/i/teamlogos/nba/500/${(team.abbreviation || '').toLowerCase()}.png`
        },
        stats: {
          pts: Math.round((stats.avgPoints || 0) * 10) / 10,
          reb: Math.round((stats.avgRebounds || 0) * 10) / 10,
          ast: Math.round((stats.avgAssists || 0) * 10) / 10,
          stl: Math.round((stats.avgSteals || 0) * 10) / 10,
          blk: Math.round((stats.avgBlocks || 0) * 10) / 10,
          threePM: Math.round((stats.avgThreePointFieldGoalsMade || 0) * 10) / 10,
          fgPct: Math.round((stats.fieldGoalPct || 0) * 10) / 10,
          threePct: Math.round((stats.threePointFieldGoalPct || 0) * 10) / 10,
          ftPct: Math.round((stats.freeThrowPct || 0) * 10) / 10,
          min: Math.round((stats.avgMinutes || 0) * 10) / 10,
          to: Math.round((stats.avgTurnovers || 0) * 10) / 10,
          gp: stats.gamesPlayed || 0
        }
      };
    });

    players.sort((a, b) => b.stats.pts - a.stats.pts);
    players.forEach((p, i) => { p.rank = i + 1; });

    playersCache = { data: players, timestamp: now };
    res.json(players);
  } catch (err) {
    console.error('Power rankings players error:', err.message);
    if (playersCache.data) return res.json(playersCache.data);
    res.status(500).json({ error: 'Failed to fetch player rankings', details: err.message });
  }
});

// Start server on all network interfaces so Smart TV can access it
app.listen(PORT, '0.0.0.0', () => {
  // Get local IP for easy access
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  console.log('');
  console.log('===========================================');
  console.log('  NBA Live Scoreboard is running!');
  console.log('===========================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('');
  console.log('  Open the Network URL on your Smart TV');
  console.log('  to view the scoreboard on the big screen!');
  console.log('===========================================');
  console.log('');
});
