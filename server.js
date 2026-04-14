const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from current directory
app.use(express.static(__dirname));

// ===== STREAM LINK CHECKER =====

// Check if a URL is reachable (HTTP 200-399)
function checkURL(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
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
