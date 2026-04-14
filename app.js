// ============================================================
//  NBA Live Scoreboard — app.js
//  Fetches live scores from ESPN's public API and renders them
// ============================================================

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const ESPN_STANDINGS  = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const ESPN_SUMMARY    = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const REFRESH_SECONDS = 30;

let countdownTimer = null;
let secondsLeft = REFRESH_SECONDS;

// ===== HELPERS =====

function formatDate(date) {
  // ESPN expects YYYYMMDD
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Get the current date in Philippine time
function getPhilippineDate(offsetDays = 0) {
  const now = new Date();
  const phStr = now.toLocaleString('en-US', { timeZone: 'Asia/Manila' });
  const phDate = new Date(phStr);
  phDate.setDate(phDate.getDate() + offsetDays);
  return phDate;
}

// Format a date nicely for display in Philippine time
function formatDisplayDate(espnDateStr) {
  // espnDateStr is YYYYMMDD — convert to readable date in PH time
  const y = parseInt(espnDateStr.substring(0, 4));
  const m = parseInt(espnDateStr.substring(4, 6)) - 1;
  const d = parseInt(espnDateStr.substring(6, 8));
  const date = new Date(y, m, d);
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function getTeamLogo(team) {
  // ESPN provides logos in the API response; fallback to CDN
  if (team.team && team.team.logo) return team.team.logo;
  const abbr = team.team ? team.team.abbreviation : 'NBA';
  return `https://a.espn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;
}

function getTeamName(team) {
  if (team.team && team.team.shortDisplayName) return team.team.shortDisplayName;
  if (team.team && team.team.displayName) return team.team.displayName;
  return 'TBD';
}

function getTeamAbbr(team) {
  return team.team ? team.team.abbreviation : '???';
}

function getTeamFullName(team) {
  if (team.team && team.team.displayName) return team.team.displayName;
  if (team.team && team.team.shortDisplayName) return team.team.shortDisplayName;
  return 'TBD';
}

function getScore(competitor) {
  return competitor.score || '—';
}

// NBA team primary colors for thumbnail backgrounds
const TEAM_COLORS = {
  ATL: '#e03a3e', BOS: '#007a33', BKN: '#000000', CHA: '#1d1160',
  CHI: '#ce1141', CLE: '#860038', DAL: '#00538c', DEN: '#0e2240',
  DET: '#c8102e', GS:  '#1d428a', GSW: '#1d428a', HOU: '#ce1141',
  IND: '#002d62', LAC: '#c8102e', LAL: '#552583', MEM: '#5d76a9',
  MIA: '#98002e', MIL: '#00471b', MIN: '#0c2340', NO:  '#0c2340',
  NOP: '#0c2340', NY:  '#006bb6', NYK: '#006bb6', OKC: '#007ac1',
  ORL: '#0077c0', PHI: '#006bb6', PHX: '#1d1160', POR: '#e03a3e',
  SAC: '#5a2d81', SA:  '#c4ced4', SAS: '#c4ced4', TOR: '#ce1141',
  UTA: '#002b5c', UTAH:'#002b5c', WAS: '#002b5c', WSH: '#002b5c'
};

function getTeamColor(team) {
  const abbr = getTeamAbbr(team);
  return TEAM_COLORS[abbr] || '#1a2e44';
}

// ===== STREAMFREE LIVE STREAM HELPERS =====

const STREAMFREE_BASE = 'https://streamfree.app';

// Map ESPN full team names → StreamFree URL slugs
const TEAM_SLUG_MAP = {
  'Atlanta Hawks': 'atlanta-hawks',
  'Boston Celtics': 'boston-celtics',
  'Brooklyn Nets': 'brooklyn-nets',
  'Charlotte Hornets': 'charlotte-hornets',
  'Chicago Bulls': 'chicago-bulls',
  'Cleveland Cavaliers': 'cleveland-cavaliers',
  'Dallas Mavericks': 'dallas-mavericks',
  'Denver Nuggets': 'denver-nuggets',
  'Detroit Pistons': 'detroit-pistons',
  'Golden State Warriors': 'golden-state-warriors',
  'Houston Rockets': 'houston-rockets',
  'Indiana Pacers': 'indiana-pacers',
  'LA Clippers': 'la-clippers',
  'Los Angeles Clippers': 'la-clippers',
  'Los Angeles Lakers': 'los-angeles-lakers',
  'Memphis Grizzlies': 'memphis-grizzlies',
  'Miami Heat': 'miami-heat',
  'Milwaukee Bucks': 'milwaukee-bucks',
  'Minnesota Timberwolves': 'minnesota-timberwolves',
  'New Orleans Pelicans': 'new-orleans-pelicans',
  'New York Knicks': 'new-york-knicks',
  'Oklahoma City Thunder': 'oklahoma-city-thunder',
  'Orlando Magic': 'orlando-magic',
  'Philadelphia 76ers': 'philadelphia-76ers',
  'Phoenix Suns': 'phoenix-suns',
  'Portland Trail Blazers': 'portland-trail-blazers',
  'Sacramento Kings': 'sacramento-kings',
  'San Antonio Spurs': 'san-antonio-spurs',
  'Toronto Raptors': 'toronto-raptors',
  'Utah Jazz': 'utah-jazz',
  'Washington Wizards': 'washington-wizards'
};

function slugifyTeamName(fullName) {
  if (TEAM_SLUG_MAP[fullName]) return TEAM_SLUG_MAP[fullName];
  // Generic fallback: lowercase, replace non-alphanum with hyphens, trim hyphens
  return fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildStreamFreeURL(awaySlug, homeSlug) {
  return `${STREAMFREE_BASE}/player/basketball/${awaySlug}-vs-${homeSlug}`;
}

// Ask our server proxy to find the working stream URL (tries both team orderings)
async function resolveStreamLink(awaySlug, homeSlug) {
  try {
    const res = await fetch(`/api/stream-link?away=${encodeURIComponent(awaySlug)}&home=${encodeURIComponent(homeSlug)}`);
    if (!res.ok) throw new Error('proxy error');
    const data = await res.json();
    return data.url;
  } catch (err) {
    console.warn('Stream link check failed, using default URL:', err);
    return buildStreamFreeURL(awaySlug, homeSlug);
  }
}

// After game cards render, async-check & update all live stream buttons
async function updateLiveStreamLinks() {
  const buttons = document.querySelectorAll('.live-thumb[data-away-slug]');
  const promises = Array.from(buttons).map(async (btn) => {
    const awaySlug = btn.getAttribute('data-away-slug');
    const homeSlug = btn.getAttribute('data-home-slug');
    if (!awaySlug || !homeSlug) return;

    const workingURL = await resolveStreamLink(awaySlug, homeSlug);
    btn.href = workingURL;
    btn.classList.remove('checking');
    btn.title = `Watch live on StreamFree`;
  });
  await Promise.all(promises);
}

function buildYouTubeLink(awayTeam, homeTeam, date) {
  const awayName = getTeamFullName(awayTeam);
  const homeName = getTeamFullName(homeTeam);
  const d = new Date(date);
  const month = d.toLocaleString('en-US', { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();
  const query = `${awayName} vs ${homeName} Full Game Highlights ${month} ${day} ${year} NBA`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function formatGameTime(dateStr) {
  const d = new Date(dateStr);
  let hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${mins} ${ampm}`;
}

// ===== RENDER GAME CARD =====

function renderGameCard(event, dayLabel = 'Today') {
  const competition = event.competitions[0];
  const competitors = competition.competitors;

  // ESPN lists home team first sometimes — normalize: [away, home]
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0];

  const status = event.status;
  const stateDesc = status.type.description; // "Final", "In Progress", "Scheduled"
  const isLive = status.type.state === 'in'; 
  const isFinal = status.type.state === 'post';
  const isScheduled = status.type.state === 'pre';

  // Extract Game Notes (Playoffs, Play-In, Series Summary, Game Number, etc.)
  let gameNote = '';
  const eventNote = event.notes && event.notes.length > 0 ? event.notes[0].headline : '';
  const compNote = competition.notes && competition.notes.length > 0 ? competition.notes[0].headline : '';
  const seriesTitle = competition.series ? competition.series.title : '';
  const seriesSummary = competition.series ? competition.series.summary : '';

  // Prefer the most descriptive note (often contains "Round Name - Game X")
  if (eventNote) {
    gameNote = eventNote;
  } else if (compNote) {
    gameNote = compNote;
  } else if (seriesTitle) {
    gameNote = seriesTitle;
  }

  // Append Series Standings (e.g., "BOS leads 1-0")
  if (seriesSummary) {
    gameNote = gameNote ? `${gameNote} • ${seriesSummary}` : seriesSummary;
  }

  // Fallback to Season Type if no notes exist
  if (!gameNote && event.season) {
    if (event.season.type === 1) gameNote = 'Preseason';
    else if (event.season.type === 2) gameNote = 'Regular Season';
  }

  const gameNoteHTML = gameNote ? `<div class="game-note" title="${gameNote}">${gameNote}</div>` : '';

  // Determine winner/loser for finished games
  let awayClass = '';
  let homeClass = '';
  let awayIndicator = '';
  let homeIndicator = '';

  if (isFinal) {
    const awayScore = parseInt(away.score) || 0;
    const homeScore = parseInt(home.score) || 0;
    if (awayScore > homeScore) {
      awayClass = 'winner';
      homeClass = 'loser';
      awayIndicator = '<span class="winner-indicator">◀</span>';
    } else {
      homeClass = 'winner';
      awayClass = 'loser';
      homeIndicator = '<span class="winner-indicator">◀</span>';
    }
  }

  // Build YouTube link for finished / live games
  const youtubeURL = buildYouTubeLink(away, home, event.date);
  const homeColor = getTeamColor(home);
  const awayColor = getTeamColor(away);
  const homeLogo = getTeamLogo(home);
  const awayLogo = getTeamLogo(away);

  // Generate a pseudo-random duration for the thumbnail (typical highlight ~10-20min)
  const durationMin = 10 + ((event.id || '').charCodeAt(0) % 10);
  const durationSec = (event.id || '').charCodeAt(1) % 60 || 30;
  const durationStr = `${durationMin}:${String(durationSec).padStart(2, '0')}`;

  // Status display
  let statusHTML = '';
  if (isFinal) {
    statusHTML = `
      <div class="status-label">Final</div>
      <div class="status-time">${dayLabel}</div>
      <a href="${youtubeURL}" target="_blank" rel="noopener" class="yt-thumbnail" title="Watch highlights on YouTube"
         style="background: linear-gradient(135deg, ${awayColor}, ${homeColor});">
        <div class="yt-thumb-logos">
          <img src="${awayLogo}" alt="" class="yt-thumb-team-logo" />
          <img src="${homeLogo}" alt="" class="yt-thumb-team-logo" />
        </div>
        <div class="yt-thumb-overlay">
          <div class="yt-thumb-label">HIGHLIGHTS</div>
          <div class="yt-thumb-play">▶</div>
        </div>
      </a>
    `;
  } else if (isLive) {
    const detail = status.type.shortDetail || status.type.detail || 'LIVE';
    const awaySlug = slugifyTeamName(getTeamFullName(away));
    const homeSlug = slugifyTeamName(getTeamFullName(home));
    const defaultStreamURL = buildStreamFreeURL(awaySlug, homeSlug);
    statusHTML = `
      <div class="status-label live">● LIVE</div>
      <div class="status-time">${detail}</div>
      <a href="${defaultStreamURL}" target="_blank" rel="noopener"
         class="yt-thumbnail live-thumb checking"
         data-away-slug="${awaySlug}" data-home-slug="${homeSlug}"
         title="Watch Live Stream"
         style="background: linear-gradient(135deg, ${awayColor}, ${homeColor});">
        <div class="yt-thumb-logos">
          <img src="${awayLogo}" alt="" class="yt-thumb-team-logo" />
          <img src="${homeLogo}" alt="" class="yt-thumb-team-logo" />
        </div>
        <div class="yt-thumb-overlay">
          <div class="yt-thumb-label live-label">WATCH<br>LIVE</div>
          <div class="yt-thumb-play live-play">▶</div>
        </div>
        <div class="live-dot-badge">● LIVE</div>
      </a>
    `;
  } else {
    // Scheduled
    const gameTime = formatGameTime(event.date);
    statusHTML = `
      <div class="status-label">Scheduled</div>
      <div class="status-time">${gameTime}</div>
      <a href="${youtubeURL}" target="_blank" rel="noopener" class="yt-thumbnail preview-thumb"
         style="background: linear-gradient(135deg, ${awayColor}, ${homeColor});">
        <div class="yt-thumb-logos">
          <img src="${awayLogo}" alt="" class="yt-thumb-team-logo" />
          <img src="${homeLogo}" alt="" class="yt-thumb-team-logo" />
        </div>
        <div class="yt-thumb-overlay">
          <div class="yt-thumb-label">GAME<br>PREVIEW</div>
        </div>
      </a>
    `;
  }

  const eventId = event.id;

  return `
    <div class="game-card" data-event-id="${eventId}" style="cursor:pointer;">
      <div class="game-teams">
        ${gameNoteHTML}
        <div class="team-row ${awayClass}">
          <img class="team-logo" src="${getTeamLogo(away)}" alt="${getTeamAbbr(away)}" loading="lazy" />
          <span class="team-name">${getTeamName(away)}</span>
          <span class="team-score">${isScheduled ? '' : getScore(away)}</span>
          ${awayIndicator}
        </div>
        <div class="team-row ${homeClass}">
          <img class="team-logo" src="${getTeamLogo(home)}" alt="${getTeamAbbr(home)}" loading="lazy" />
          <span class="team-name">${getTeamName(home)}</span>
          <span class="team-score">${isScheduled ? '' : getScore(home)}</span>
          ${homeIndicator}
        </div>
      </div>
      <div class="game-status">
        ${statusHTML}
      </div>
    </div>
  `;
}

// ===== FETCH & RENDER GAMES =====

async function fetchGames(dateStr) {
  try {
    const url = `${ESPN_SCOREBOARD}?dates=${dateStr}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    console.error('Error fetching games:', err);
    return [];
  }
}

async function loadGames() {
  // Use Philippine time to determine yesterday, today, and tomorrow
  const phYesterday = getPhilippineDate(-1);
  const phToday = getPhilippineDate(0);

  const yesterdayStr = formatDate(phYesterday);
  const todayStr = formatDate(phToday);

  // Get PH dates for display — shift +1 day since NBA games on US date X air in PH on date X+1
  const phNow = new Date();
  const dateOpts = { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };

  // "Yesterday" games (US date) → aired in PH today
  const phTodayDisplay = new Date(phNow);
  const phTodayStr = phTodayDisplay.toLocaleDateString('en-US', dateOpts);

  // "Today" games (US date) → will air in PH tomorrow
  const phTomorrowDisplay = new Date(phNow);
  phTomorrowDisplay.setDate(phTomorrowDisplay.getDate() + 1);
  const phTomorrowStr = phTomorrowDisplay.toLocaleDateString('en-US', dateOpts);

  // Update section headers
  const yesterdayHeader = document.getElementById('yesterday-header');
  const todayHeader = document.getElementById('today-header');
  if (yesterdayHeader) {
    yesterdayHeader.textContent = `Today — ${phTodayStr}`;
  }
  if (todayHeader) {
    todayHeader.textContent = `Tomorrow — ${phTomorrowStr}`;
  }

  // Fetch yesterday and today
  const [yesterdayGames, todayGames] = await Promise.all([
    fetchGames(yesterdayStr),
    fetchGames(todayStr)
  ]);

  // Render yesterday
  const yesterdayEl = document.getElementById('yesterday-games');
  if (yesterdayGames.length === 0) {
    yesterdayEl.innerHTML = '<div class="no-games">No games yesterday</div>';
  } else {
    yesterdayEl.innerHTML = yesterdayGames.map(e => renderGameCard(e, 'Today')).join('');
  }

  // Render today
  const todayEl = document.getElementById('today-games');
  if (todayGames.length === 0) {
    todayEl.innerHTML = '<div class="no-games">No games scheduled today</div>';
  } else {
    todayEl.innerHTML = todayGames.map(e => renderGameCard(e, 'Tomorrow')).join('');
  }

  // Async-check and update all live stream buttons
  updateLiveStreamLinks();

  // Update timestamp
  const now = new Date();
  document.getElementById('last-updated').textContent =
    `Last updated: ${now.toLocaleTimeString()}`;
}

// ===== AUTO REFRESH =====

function startCountdown() {
  secondsLeft = REFRESH_SECONDS;
  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    secondsLeft--;
    const el = document.getElementById('countdown');
    if (el) el.textContent = `Next refresh in ${secondsLeft}s`;

    if (secondsLeft <= 0) {
      clearInterval(countdownTimer);
      loadGames().then(startCountdown);
    }
  }, 1000);
}

// ===== STANDINGS =====

async function loadStandings(conference = 'east') {
  const tableWrap = document.getElementById('standings-table');
  tableWrap.innerHTML = '<div class="loading">Loading standings...</div>';

  try {
    const res = await fetch(ESPN_STANDINGS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // ESPN standings structure: children[0] = some grouping
    const conferences = data.children || [];
    // Find requested conference
    const conf = conferences.find(c => {
      const name = (c.name || c.abbreviation || '').toLowerCase();
      return name.includes(conference === 'east' ? 'east' : 'west');
    });

    if (!conf) {
      tableWrap.innerHTML = '<div class="no-games">Standings not available</div>';
      return;
    }

    // Get all teams from standings entries
    const entries = conf.standings ? conf.standings.entries : [];
    if (entries.length === 0) {
      tableWrap.innerHTML = '<div class="no-games">No standings data</div>';
      return;
    }

    // Sort by wins (find the wins stat)
    entries.sort((a, b) => {
      const aWins = a.stats?.find(s => s.name === 'wins')?.value || 0;
      const bWins = b.stats?.find(s => s.name === 'wins')?.value || 0;
      return bWins - aWins;
    });

    let html = `
      <table class="standings">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>W</th>
            <th>L</th>
            <th>PCT</th>
            <th>GB</th>
            <th>STRK</th>
          </tr>
        </thead>
        <tbody>
    `;

    entries.forEach((entry, i) => {
      const team = entry.team || {};
      const stats = entry.stats || [];
      const getStat = (name) => {
        const s = stats.find(s => s.name === name);
        return s ? (s.displayValue || s.value || '—') : '—';
      };
      const logo = team.logos && team.logos[0] ? team.logos[0].href : '';
      const teamName = team.shortDisplayName || team.displayName || 'Unknown';

      html += `
        <tr>
          <td>${i + 1}</td>
          <td>
            <div class="standings-team">
              <img src="${logo}" alt="${teamName}" />
              <span>${teamName}</span>
            </div>
          </td>
          <td>${getStat('wins')}</td>
          <td>${getStat('losses')}</td>
          <td>${getStat('winPercent')}</td>
          <td>${getStat('gamesBehind')}</td>
          <td>${getStat('streak')}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    tableWrap.innerHTML = html;

  } catch (err) {
    console.error('Standings error:', err);
    tableWrap.innerHTML = '<div class="no-games">Failed to load standings</div>';
  }
}

// ===== TAB SWITCHING =====

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      // Activate selected
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.getElementById(`${target}-tab`).classList.add('active');

      // Load data for tab if needed
      if (target === 'standings') {
        loadStandings('east');
      } else if (target === 'playoffs') {
        loadPlayoffs();
      }
    });
  });
}

// ===== PLAYOFFS =====

function getTeamFromEntry(entry) {
  if (!entry || !entry.team) return null;
  const playoffSeedStat = entry.stats?.find(s => s.name === 'playoffSeed');
  const wins = entry.stats?.find(s => s.name === 'wins')?.value || 0;
  const losses = entry.stats?.find(s => s.name === 'losses')?.value || 0;
  return {
    id: entry.team.id,
    name: entry.team.shortDisplayName || entry.team.displayName,
    logo: entry.team.logos?.[0]?.href || '',
    seed: playoffSeedStat ? playoffSeedStat.value : '?', // Use the playoffSeed stat value
    record: `${wins}-${losses}`
  };
}

function renderSeries(topSeedTeam, bottomSeedTeam, roundName, seriesName) {
  const top = topSeedTeam || { name: 'TBD', logo: '', seed: '?', record: '' };
  const bottom = bottomSeedTeam || { name: 'TBD', logo: '', seed: '?', record: '' };

  return `
    <div class="bracket-series" data-round="${roundName}" data-series="${seriesName}">
      <div class="series-teams">
        <div class="series-team">
          <span class="series-seed">${top.seed}</span>
          ${top.logo ? `<img src="${top.logo}" class="series-logo" />` : '<span class="series-logo-placeholder"></span>'}
          <span class="series-name">${top.name} ${top.record ? `<span class="team-record">(${top.record})</span>` : ''}</span>
        </div>
        <div class="series-team">
          <span class="series-seed">${bottom.seed}</span>
          ${bottom.logo ? `<img src="${bottom.logo}" class="series-logo" />` : '<span class="series-logo-placeholder"></span>'}
          <span class="series-name">${bottom.name} ${bottom.record ? `<span class="team-record">(${bottom.record})</span>` : ''}</span>
        </div>
      </div>
      <div class="series-connector"></div>
    </div>
  `;
}

function renderPlayIn(conferenceName, teams) {
  const team7 = teams.find(t => t.seed == 7);
  const team8 = teams.find(t => t.seed == 8);
  const team9 = teams.find(t => t.seed == 9);
  const team10 = teams.find(t => t.seed == 10);

  if (!team7 || !team8 || !team9 || !team10) {
    return '<div class="play-in-container"><p>Play-In teams not yet determined.</p></div>';
  }

  return `
    <div class="play-in-container">
      <h4 class="play-in-title">${conferenceName} Play-In Tournament</h4>
      <div class="play-in-bracket">
        <div class="play-in-matchup">
          <div class="play-in-header">7-vs-8 Game (Winner is 7th Seed)</div>
          ${renderSeries(team7, team8, 'play-in', '7v8')}
        </div>
        <div class="play-in-matchup">
          <div class="play-in-header">9-vs-10 Game (Loser is Eliminated)</div>
          ${renderSeries(team9, team10, 'play-in', '9v10')}
        </div>
        <div class="play-in-matchup">
          <div class="play-in-header">Final Game (Winner is 8th Seed)</div>
          <div class="bracket-series" data-round="play-in" data-series="final">
            <div class="series-teams">
              <div class="series-team"><span class="series-name">Loser of 7-vs-8</span></div>
              <div class="series-team"><span class="series-name">Winner of 9-vs-10</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderConferenceBracket(conferenceName, teams, align = 'left') {
  const team1 = teams.find(t => t.seed == 1);
  const team2 = teams.find(t => t.seed == 2);
  const team3 = teams.find(t => t.seed == 3);
  const team4 = teams.find(t => t.seed == 4);
  const team5 = teams.find(t => t.seed == 5);
  const team6 = teams.find(t => t.seed == 6);
  // Seeds 7 and 8 are determined by the play-in
  const team7 = { name: 'Play-In Winner', logo: '', seed: 7 };
  const team8 = { name: 'Play-In Winner', logo: '', seed: 8 };

  return `
    <div class="playoff-conference-bracket align-${align}">
      <h3 class="conference-bracket-title">${conferenceName} Conference</h3>
      <div class="bracket-body">
        <div class="bracket-round">
          <h4 class="bracket-round-title">First Round</h4>
          ${renderSeries(team1, team8, 'round1', '1v8')}
          ${renderSeries(team4, team5, 'round1', '4v5')}
          ${renderSeries(team3, team6, 'round1', '3v6')}
          ${renderSeries(team2, team7, 'round1', '2v7')}
        </div>
        <div class="bracket-round">
          <h4 class="bracket-round-title">Conf. Semifinals</h4>
          ${renderSeries(null, null, 'round2', 'semi1')}
          ${renderSeries(null, null, 'round2', 'semi2')}
        </div>
        <div class="bracket-round">
          <h4 class="bracket-round-title">Conf. Finals</h4>
          ${renderSeries(null, null, 'round3', 'final')}
        </div>
      </div>
    </div>
  `;
}

async function loadPlayoffs() {
  const contentEl = document.getElementById('playoffs-tab');
  contentEl.innerHTML = '<div class="loading">Loading Playoff Picture...</div>';

  try {
    const res = await fetch(ESPN_STANDINGS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const conferences = data.children || [];
    const eastConf = conferences.find(c => {
      const name = (c.name || c.abbreviation || '').toLowerCase();
      return name.includes('east');
    });
    const westConf = conferences.find(c => {
      const name = (c.name || c.abbreviation || '').toLowerCase();
      return name.includes('west');
    });

    if (!eastConf || !westConf) {
      contentEl.innerHTML = '<div class="no-games">Playoff data not available.</div>';
      return;
    }

    const eastTeams = (eastConf.standings?.entries || []).map(getTeamFromEntry);
    const westTeams = (westConf.standings?.entries || []).map(getTeamFromEntry);

    // Sort by seed just in case API order is not guaranteed
    eastTeams.sort((a, b) => a.seed - b.seed);
    westTeams.sort((a, b) => a.seed - b.seed);

    const finalsHTML = `
      <div class="nba-finals-bracket">
        <h3 class="conference-bracket-title">NBA Finals</h3>
        <div class="bracket-body">
          <div class="bracket-round">
            <h4 class="bracket-round-title">West Champ</h4>
            <div class="bracket-series" data-round="finals">
              <div class="series-teams">
                <div class="series-team single-team-spot">
                  <span class="series-logo-placeholder"></span>
                  <span class="series-name">TBD</span>
                </div>
              </div>
              <div class="series-connector"></div>
            </div>
          </div>
          <div class="bracket-round champion">
             <h4 class="bracket-round-title">NBA Champion</h4>
             <div class="bracket-series">
                <div class="series-teams">
                  <div class="series-team champion-spot">
                    <span class="series-logo-placeholder"></span>
                    <span class="series-name">TBD</span>
                  </div>
                </div>
             </div>
          </div>
          <div class="bracket-round align-right">
            <h4 class="bracket-round-title">East Champ</h4>
            <div class="bracket-series" data-round="finals">
              <div class="series-connector"></div>
              <div class="series-teams">
                <div class="series-team single-team-spot">
                  <span class="series-logo-placeholder"></span>
                  <span class="series-name">TBD</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    contentEl.innerHTML = `
      <div class="playoff-header">
        <h2>NBA Playoff Picture</h2>
        <p>Based on current standings. This is a projection and not the official bracket until standings are final.</p>
      </div>
      <div class="play-in-section">
        ${renderPlayIn('Western', westTeams)}
        ${renderPlayIn('Eastern', eastTeams)}
      </div>
      <div class="playoff-scroll-wrapper">
        <div class="playoff-bracket-section">
          ${renderConferenceBracket('Western', westTeams, 'left')}
          ${finalsHTML}
          ${renderConferenceBracket('Eastern', eastTeams, 'right')}
        </div>
      </div>
    `;

  } catch (err) {
    console.error('Playoffs error:', err);
    contentEl.innerHTML = '<div class="no-games">Failed to load playoff picture.</div>';
  }
}

// ===== CONFERENCE TOGGLE =====

function initConferenceToggle() {
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('conf-btn')) {
      document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      loadStandings(e.target.getAttribute('data-conf'));
    }
  });
}

// ===== GAME DETAIL MODAL =====

async function fetchGameSummary(eventId) {
  try {
    const res = await fetch(`${ESPN_SUMMARY}?event=${eventId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Error fetching game summary:', err);
    return null;
  }
}

function getPlayerStats(boxScore, teamIndex) {
  if (!boxScore || !boxScore.players || !boxScore.players[teamIndex]) return [];
  const teamData = boxScore.players[teamIndex];
  const stats = teamData.statistics && teamData.statistics[0];
  if (!stats) return [];
  return {
    labels: stats.labels || [],
    athletes: (stats.athletes || []).map(a => ({
      name: a.athlete ? (a.athlete.shortName || a.athlete.displayName || 'Unknown') : 'Unknown',
      position: a.athlete ? (a.athlete.position?.abbreviation || '') : '',
      headshot: a.athlete?.headshot?.href || '',
      stats: a.stats || [],
      starter: a.starter || false,
      didNotPlay: a.didNotPlay || false,
      reason: a.reason || ''
    }))
  };
}

function getTeamStats(boxScore, teamIndex) {
  if (!boxScore || !boxScore.teams || !boxScore.teams[teamIndex]) return [];
  const teamData = boxScore.teams[teamIndex];
  const stats = teamData.statistics || [];
  return stats;
}

function renderPlayerStatsTable(playerData, teamName, teamColor) {
  if (!playerData || !playerData.athletes || playerData.athletes.length === 0) {
    return `<div class="detail-no-data">No player stats available</div>`;
  }

  const labels = playerData.labels;
  // Key stat columns to show
  const showCols = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TO', '+/-'];
  const colIndices = showCols.map(col => labels.indexOf(col)).filter(i => i >= 0);
  const colNames = colIndices.map(i => labels[i]);

  const starters = playerData.athletes.filter(a => a.starter && !a.didNotPlay);
  const bench = playerData.athletes.filter(a => !a.starter && !a.didNotPlay);
  const dnp = playerData.athletes.filter(a => a.didNotPlay);

  function renderRows(players) {
    return players.map(p => {
      const statCells = colIndices.map(i => `<td>${p.stats[i] || '-'}</td>`).join('');
      return `
        <tr>
          <td class="player-name-cell">
            <span class="player-name">${p.name}</span>
            <span class="player-pos">${p.position}</span>
          </td>
          ${statCells}
        </tr>
      `;
    }).join('');
  }

  let html = `
    <div class="detail-team-stats-block">
      <div class="detail-team-header" style="border-left: 4px solid ${teamColor};">
        ${teamName}
      </div>
      <div class="detail-stats-table-wrap">
        <table class="detail-stats-table">
          <thead>
            <tr>
              <th class="player-name-col">Player</th>
              ${colNames.map(c => `<th>${c}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
  `;

  if (starters.length > 0) {
    html += `<tr class="section-divider"><td colspan="${colNames.length + 1}">Starters</td></tr>`;
    html += renderRows(starters);
  }
  if (bench.length > 0) {
    html += `<tr class="section-divider"><td colspan="${colNames.length + 1}">Bench</td></tr>`;
    html += renderRows(bench);
  }
  if (dnp.length > 0) {
    html += `<tr class="section-divider"><td colspan="${colNames.length + 1}">Did Not Play</td></tr>`;
    dnp.forEach(p => {
      html += `<tr class="dnp-row"><td class="player-name-cell"><span class="player-name">${p.name}</span></td><td colspan="${colNames.length}">${p.reason || 'DNP'}</td></tr>`;
    });
  }

  html += `</tbody></table></div></div>`;
  return html;
}

function renderTeamComparisonStats(boxScore) {
  if (!boxScore || !boxScore.teams || boxScore.teams.length < 2) {
    return '';
  }

  const team1 = boxScore.teams[0];
  const team2 = boxScore.teams[1];
  const stats1 = team1.statistics || [];
  const stats2 = team2.statistics || [];

  // Key team stats to display
  const keyStats = [
    'fieldGoalPct', 'threePointFieldGoalPct', 'freeThrowPct',
    'totalRebounds', 'offensiveRebounds', 'defensiveRebounds',
    'assists', 'steals', 'blocks', 'turnovers',
    'fastBreakPoints', 'pointsInPaint', 'pointsOffTurnovers'
  ];

  const statLabels = {
    fieldGoalPct: 'FG%', threePointFieldGoalPct: '3PT%', freeThrowPct: 'FT%',
    totalRebounds: 'Rebounds', offensiveRebounds: 'Off. Reb', defensiveRebounds: 'Def. Reb',
    assists: 'Assists', steals: 'Steals', blocks: 'Blocks', turnovers: 'Turnovers',
    fastBreakPoints: 'Fast Break Pts', pointsInPaint: 'Points in Paint',
    pointsOffTurnovers: 'Pts off Turnovers'
  };

  let rows = '';
  keyStats.forEach(key => {
    const s1 = stats1.find(s => s.name === key);
    const s2 = stats2.find(s => s.name === key);
    if (!s1 && !s2) return;
    const v1 = s1 ? (s1.displayValue || s1.value || '-') : '-';
    const v2 = s2 ? (s2.displayValue || s2.value || '-') : '-';
    const label = statLabels[key] || key;

    // Highlight higher value
    const n1 = parseFloat(v1) || 0;
    const n2 = parseFloat(v2) || 0;
    const isLower = key === 'turnovers'; // lower is better
    const cls1 = isLower ? (n1 < n2 ? 'stat-better' : '') : (n1 > n2 ? 'stat-better' : '');
    const cls2 = isLower ? (n2 < n1 ? 'stat-better' : '') : (n2 > n1 ? 'stat-better' : '');

    rows += `
      <tr>
        <td class="team-stat-val ${cls1}">${v1}</td>
        <td class="team-stat-label">${label}</td>
        <td class="team-stat-val ${cls2}">${v2}</td>
      </tr>
    `;
  });

  if (!rows) return '';

  const name1 = team1.team?.shortDisplayName || team1.team?.displayName || 'Team 1';
  const name2 = team2.team?.shortDisplayName || team2.team?.displayName || 'Team 2';
  const logo1 = team1.team?.logo || '';
  const logo2 = team2.team?.logo || '';

  return `
    <div class="detail-section">
      <h3 class="detail-section-title">Team Stats</h3>
      <table class="team-comparison-table">
        <thead>
          <tr>
            <th class="comp-team-header">
              ${logo1 ? `<img src="${logo1}" class="comp-team-logo" />` : ''}
              ${name1}
            </th>
            <th></th>
            <th class="comp-team-header">
              ${logo2 ? `<img src="${logo2}" class="comp-team-logo" />` : ''}
              ${name2}
            </th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderGameDetail(summary, eventId) {
  if (!summary) {
    return `<div class="detail-error">Failed to load game details. Please try again.</div>`;
  }

  const header = summary.header;
  const boxScore = summary.boxscore;
  const gameInfo = summary.gameInfo;

  // Get competitors from header
  const competition = header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};

  const awayTeam = away.team || {};
  const homeTeam = home.team || {};
  const awayLogo = awayTeam.logo || awayTeam.logos?.[0]?.href || '';
  const homeLogo = homeTeam.logo || homeTeam.logos?.[0]?.href || '';
  const awayName = awayTeam.shortDisplayName || awayTeam.displayName || 'Away';
  const homeName = homeTeam.shortDisplayName || homeTeam.displayName || 'Home';
  const awayFullName = awayTeam.displayName || awayName;
  const homeFullName = homeTeam.displayName || homeName;
  const awayAbbr = awayTeam.abbreviation || '???';
  const homeAbbr = homeTeam.abbreviation || '???';
  const awayScore = away.score || '—';
  const homeScore = home.score || '—';
  const awayRecord = away.record?.[0]?.displayValue || '';
  const homeRecord = home.record?.[0]?.displayValue || '';
  const awayColor = TEAM_COLORS[awayAbbr] || '#1a2e44';
  const homeColor = TEAM_COLORS[homeAbbr] || '#1a2e44';

  // Game status
  const gameState = header?.competitions?.[0]?.status?.type?.state || 'pre';
  const isLive = gameState === 'in';
  const isFinal = gameState === 'post';
  const isScheduled = gameState === 'pre';
  const statusText = header?.competitions?.[0]?.status?.type?.shortDetail || header?.competitions?.[0]?.status?.type?.detail || '';

  // Line scores (quarter/half scores)
  const awayLineScores = away.linescores || [];
  const homeLineScores = home.linescores || [];

  // Build scoreboard header
  let scoreboardHTML = `
    <div class="detail-scoreboard" style="background: linear-gradient(135deg, ${awayColor}cc, ${homeColor}cc);">
      <div class="detail-team-side">
        <img src="${awayLogo}" class="detail-team-logo" alt="${awayAbbr}" />
        <div class="detail-team-info">
          <span class="detail-team-name">${awayName}</span>
          ${awayRecord ? `<span class="detail-team-record">${awayRecord}</span>` : ''}
        </div>
        <span class="detail-team-score">${awayScore}</span>
      </div>
      <div class="detail-vs">
        <span class="detail-status-text ${isLive ? 'live' : ''}">${statusText}</span>
      </div>
      <div class="detail-team-side">
        <span class="detail-team-score">${homeScore}</span>
        <div class="detail-team-info" style="text-align:right;">
          <span class="detail-team-name">${homeName}</span>
          ${homeRecord ? `<span class="detail-team-record">${homeRecord}</span>` : ''}
        </div>
        <img src="${homeLogo}" class="detail-team-logo" alt="${homeAbbr}" />
      </div>
    </div>
  `;

  // Quarter scores table
  let quarterHTML = '';
  if (awayLineScores.length > 0 || homeLineScores.length > 0) {
    const numPeriods = Math.max(awayLineScores.length, homeLineScores.length);
    let periodHeaders = '';
    let awayPeriodScores = '';
    let homePeriodScores = '';
    for (let i = 0; i < numPeriods; i++) {
      const label = i < 4 ? `Q${i + 1}` : `OT${i - 3}`;
      periodHeaders += `<th>${label}</th>`;
      awayPeriodScores += `<td>${awayLineScores[i]?.displayValue || awayLineScores[i]?.value || '-'}</td>`;
      homePeriodScores += `<td>${homeLineScores[i]?.displayValue || homeLineScores[i]?.value || '-'}</td>`;
    }
    quarterHTML = `
      <div class="detail-section">
        <table class="quarter-scores-table">
          <thead>
            <tr><th></th>${periodHeaders}<th>T</th></tr>
          </thead>
          <tbody>
            <tr>
              <td class="quarter-team"><img src="${awayLogo}" class="quarter-team-logo" />${awayAbbr}</td>
              ${awayPeriodScores}
              <td class="quarter-total">${awayScore}</td>
            </tr>
            <tr>
              <td class="quarter-team"><img src="${homeLogo}" class="quarter-team-logo" />${homeAbbr}</td>
              ${homePeriodScores}
              <td class="quarter-total">${homeScore}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // Video / highlights / live stream section
  let videoHTML = '';

  if (isLive) {
    // Live stream link
    const awaySlug = slugifyTeamName(awayFullName);
    const homeSlug = slugifyTeamName(homeFullName);
    const streamURL = buildStreamFreeURL(awaySlug, homeSlug);
    videoHTML = `
      <div class="detail-section">
        <h3 class="detail-section-title">🔴 Live Stream</h3>
        <div class="detail-video-section">
          <a href="${streamURL}" target="_blank" rel="noopener"
             class="detail-live-btn" id="detail-live-btn"
             data-away-slug="${awaySlug}" data-home-slug="${homeSlug}">
            <span class="live-pulse-dot"></span>
            📺 Watch Live Stream
          </a>
          <p class="detail-video-note">Stream opens in a new tab on StreamFree</p>
        </div>
      </div>
    `;
  } else if (isFinal) {
    // YouTube highlights search
    const d = new Date(header?.competitions?.[0]?.date || Date.now());
    const month = d.toLocaleString('en-US', { month: 'long' });
    const day = d.getDate();
    const year = d.getFullYear();
    const ytQuery = `${awayFullName} vs ${homeFullName} Full Game Highlights ${month} ${day} ${year} NBA`;
    const ytURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery)}`;

    videoHTML = `
      <div class="detail-section">
        <h3 class="detail-section-title">🎬 Game Highlights</h3>
        <div class="detail-video-section">
          <a href="${ytURL}" target="_blank" rel="noopener" class="detail-highlights-btn">
            ▶ Watch Full Game Highlights on YouTube
          </a>
          <p class="detail-video-note">Opens YouTube search for this game's highlights</p>
        </div>
      </div>
    `;
  } else {
    // Scheduled — show preview
    const gameTime = formatGameTime(header?.competitions?.[0]?.date || '');
    videoHTML = `
      <div class="detail-section">
        <h3 class="detail-section-title">📅 Game Preview</h3>
        <div class="detail-video-section">
          <p class="detail-scheduled-msg">Game starts at <strong>${gameTime}</strong></p>
          <p class="detail-video-note">Live stream link will be available once the game begins</p>
        </div>
      </div>
    `;
  }

  // Team comparison stats
  const comparisonHTML = (!isScheduled && boxScore) ? renderTeamComparisonStats(boxScore) : '';

  // Player stats (box score)
  let playerStatsHTML = '';
  if (!isScheduled && boxScore && boxScore.players && boxScore.players.length >= 2) {
    // Determine which index is away / home
    const p0Team = boxScore.players[0]?.team?.displayName || '';
    const isP0Away = p0Team === awayFullName || boxScore.players[0]?.team?.abbreviation === awayAbbr;
    const awayIdx = isP0Away ? 0 : 1;
    const homeIdx = isP0Away ? 1 : 0;

    const awayPlayerData = getPlayerStats(boxScore, awayIdx);
    const homePlayerData = getPlayerStats(boxScore, homeIdx);

    playerStatsHTML = `
      <div class="detail-section">
        <h3 class="detail-section-title">📊 Box Score</h3>
        ${renderPlayerStatsTable(awayPlayerData, awayFullName, awayColor)}
        ${renderPlayerStatsTable(homePlayerData, homeFullName, homeColor)}
      </div>
    `;
  }

  // Game info (venue, attendance, officials)
  let gameInfoHTML = '';
  if (gameInfo) {
    const venue = gameInfo.venue;
    const attendance = gameInfo.attendance;
    const officials = gameInfo.officials || [];
    let infoItems = '';
    if (venue) {
      infoItems += `<div class="detail-info-item"><span class="info-label">Arena</span><span class="info-value">${venue.fullName || venue.shortName || 'N/A'}${venue.address?.city ? `, ${venue.address.city}` : ''}</span></div>`;
    }
    if (attendance) {
      infoItems += `<div class="detail-info-item"><span class="info-label">Attendance</span><span class="info-value">${Number(attendance).toLocaleString()}</span></div>`;
    }
    if (officials.length > 0) {
      const offNames = officials.map(o => o.displayName || o.fullName || '').filter(Boolean).join(', ');
      if (offNames) {
        infoItems += `<div class="detail-info-item"><span class="info-label">Officials</span><span class="info-value">${offNames}</span></div>`;
      }
    }
    if (infoItems) {
      gameInfoHTML = `
        <div class="detail-section">
          <h3 class="detail-section-title">ℹ️ Game Info</h3>
          <div class="detail-info-grid">${infoItems}</div>
        </div>
      `;
    }
  }

  return `
    ${scoreboardHTML}
    ${quarterHTML}
    ${videoHTML}
    ${comparisonHTML}
    ${playerStatsHTML}
    ${gameInfoHTML}
  `;
}

function openGameDetail(eventId) {
  const modal = document.getElementById('game-detail-modal');
  const content = document.getElementById('game-detail-content');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  content.innerHTML = '<div class="loading">Loading game details...</div>';

  fetchGameSummary(eventId).then(summary => {
    content.innerHTML = renderGameDetail(summary, eventId);

    // If live, resolve the stream link
    const liveBtn = document.getElementById('detail-live-btn');
    if (liveBtn) {
      const awaySlug = liveBtn.getAttribute('data-away-slug');
      const homeSlug = liveBtn.getAttribute('data-home-slug');
      resolveStreamLink(awaySlug, homeSlug).then(url => {
        liveBtn.href = url;
      });
    }
  });
}

function closeGameDetail() {
  const modal = document.getElementById('game-detail-modal');
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function initGameDetailListeners() {
  // Close modal
  document.querySelector('.game-detail-close').addEventListener('click', closeGameDetail);
  document.querySelector('.game-detail-backdrop').addEventListener('click', closeGameDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGameDetail();
  });

  // Click on game cards (delegate)
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.game-card[data-event-id]');
    if (!card) return;
    // Don't open modal if clicking a link inside the card
    if (e.target.closest('a')) return;
    const eventId = card.getAttribute('data-event-id');
    if (eventId) openGameDetail(eventId);
  });
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initConferenceToggle();
  initGameDetailListeners();
  loadGames().then(startCountdown);
});
