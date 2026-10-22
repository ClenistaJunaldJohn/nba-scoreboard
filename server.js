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
