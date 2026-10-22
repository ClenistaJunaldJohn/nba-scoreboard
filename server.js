const express = require('express');
const http = require('http');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from current directory
app.use(express.static(__dirname));

// ===== STREAM LINK CHECKER =====

// Check if a URL is reachable (HTTP 200-399)
function checkURL(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(url, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      // Drain the response body to free memory
      res.resume();
      // 200-399 means page exists (including redirects to the actual player page)
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// API: Resolve the best working stream URL for a live game
// Tries: away-vs-home, then home-vs-away, then returns best guess
app.get('/api/stream-link', async (req, res) => {
  const { away, home } = req.query;
  const BASE = 'https://streamfree.app/player/basketball';

  if (!away || !home) {
    return res.json({ url: 'https://streamfree.app/', checked: false });
  }

  const primaryURL  = `${BASE}/${away}-vs-${home}`;
  const fallbackURL = `${BASE}/${home}-vs-${away}`;

  try {
    // Try primary (away-vs-home) first
    const primaryOk = await checkURL(primaryURL);
    if (primaryOk) {
      return res.json({ url: primaryURL, pattern: 'away-vs-home', checked: true });
    }

    // Try fallback (home-vs-away)
    const fallbackOk = await checkURL(fallbackURL);
    if (fallbackOk) {
      return res.json({ url: fallbackURL, pattern: 'home-vs-away', checked: true });
    }

    // Neither worked — return primary as best guess
    return res.json({ url: primaryURL, pattern: 'away-vs-home', checked: false });
  } catch (err) {
    console.error('Stream link check error:', err.message);
    return res.json({ url: primaryURL, pattern: 'away-vs-home', checked: false });
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

  const client = parsedUrl.protocol === 'http:' ? http : https;
  const proxyReq = client.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': parsedUrl.origin + '/'
    },
    timeout: 12000
  }, (proxyRes) => {
    // Handle HTTP redirects (301, 302, 307, 308)
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      try {
        const redirected = new URL(proxyRes.headers.location, targetUrl).toString();
        return res.redirect(`/api/iptv-proxy?url=${encodeURIComponent(redirected)}`);
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
        // Rewrite all URI lines in the m3u8 playlist to route back through this proxy
        const rewritten = body.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          try {
            const absoluteUrl = new URL(trimmed, targetUrl).toString();
            return `/api/iptv-proxy?url=${encodeURIComponent(absoluteUrl)}`;
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

// API: Channels catalog
app.get('/api/iptv/channels', (req, res) => {
  res.json([
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
    }
  ]);
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
