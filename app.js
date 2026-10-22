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

// ===== GAMES STATE & CONTROLS =====

const gamesState = {
  yesterdayGames: [],
  todayGames: [],
  statusFilter: 'all', // 'all', 'live', 'final', 'scheduled'
  searchQuery: ''
};

function filterGame(event, filter, query) {
  const status = event.status?.type?.state;
  if (filter === 'live' && status !== 'in') return false;
  if (filter === 'final' && status !== 'post') return false;
  if (filter === 'scheduled' && status !== 'pre') return false;

  if (query) {
    const comp = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    const textToMatch = competitors.map(c => {
      const t = c.team || {};
      return `${t.displayName || ''} ${t.shortDisplayName || ''} ${t.abbreviation || ''} ${t.location || ''} ${t.name || ''}`;
    }).join(' ') + ' ' + (event.name || '');
    if (!textToMatch.toLowerCase().includes(query)) return false;
  }
  return true;
}

function renderAllGames() {
  const filteredYesterday = gamesState.yesterdayGames.filter(e => filterGame(e, gamesState.statusFilter, gamesState.searchQuery));
  const filteredToday = gamesState.todayGames.filter(e => filterGame(e, gamesState.statusFilter, gamesState.searchQuery));

  const countYesterdayEl = document.getElementById('yesterday-games-count');
  if (countYesterdayEl) {
    countYesterdayEl.textContent = `${filteredYesterday.length} Game${filteredYesterday.length === 1 ? '' : 's'}`;
  }

  const countTodayEl = document.getElementById('today-games-count');
  if (countTodayEl) {
    countTodayEl.textContent = `${filteredToday.length} Game${filteredToday.length === 1 ? '' : 's'}`;
  }

  const yesterdayEl = document.getElementById('yesterday-games');
  if (yesterdayEl) {
    if (filteredYesterday.length === 0) {
      yesterdayEl.innerHTML = `<div class="no-games">${gamesState.searchQuery || gamesState.statusFilter !== 'all' ? 'No games matching filter' : 'No games yesterday'}</div>`;
    } else {
      yesterdayEl.innerHTML = filteredYesterday.map(e => renderGameCard(e, 'Today')).join('');
    }
  }

  const todayEl = document.getElementById('today-games');
  if (todayEl) {
    if (filteredToday.length === 0) {
      todayEl.innerHTML = `<div class="no-games">${gamesState.searchQuery || gamesState.statusFilter !== 'all' ? 'No games matching filter' : 'No games scheduled today'}</div>`;
    } else {
      todayEl.innerHTML = filteredToday.map(e => renderGameCard(e, 'Tomorrow')).join('');
    }
  }

  updateLiveStreamLinks();
}

function initGamesControls() {
  // Status filter pills
  const pillContainer = document.getElementById('games-status-pills');
  if (pillContainer) {
    pillContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.games-pill');
      if (!btn) return;
      pillContainer.querySelectorAll('.games-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      gamesState.statusFilter = btn.getAttribute('data-filter') || 'all';
      renderAllGames();
    });
  }

  // Search input
  const searchInput = document.getElementById('games-team-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      gamesState.searchQuery = e.target.value.trim().toLowerCase();
      renderAllGames();
    });
  }

  // Manual refresh button
  const refreshBtn = document.getElementById('manual-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      await loadGames();
      startCountdown();
      setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
    });
  }

  // Section jump buttons
  document.querySelectorAll('.games-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.games-jump-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-jump');
      const targetEl = document.getElementById(target === 'yesterday' ? 'section-yesterday-wrap' : 'section-today-wrap');
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// ===== RENDER GAME CARD =====

function renderGameCard(event, dayLabel = 'Today') {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];

  // ESPN lists home team first sometimes — normalize: [away, home]
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};

  const status = event.status || {};
  const statusType = status.type || {};
  const isLive = statusType.state === 'in';
  const isFinal = statusType.state === 'post';
  const isScheduled = statusType.state === 'pre';

  // Game notes (Playoffs, Play-In, Tournament, Series, Game Number)
  let gameNote = '';
  const eventNote = event.notes && event.notes.length > 0 ? event.notes[0].headline : '';
  const compNote = competition.notes && competition.notes.length > 0 ? competition.notes[0].headline : '';
  const seriesTitle = competition.series ? competition.series.title : '';
  const seriesSummary = competition.series ? competition.series.summary : '';

  if (eventNote) gameNote = eventNote;
  else if (compNote) gameNote = compNote;
  else if (seriesTitle) gameNote = seriesTitle;

  if (seriesSummary) {
    gameNote = gameNote ? `${gameNote} • ${seriesSummary}` : seriesSummary;
  }
  if (!gameNote && event.season) {
    if (event.season.type === 1) gameNote = 'Preseason';
    else if (event.season.type === 2) gameNote = 'Regular Season';
  }

  const gameNoteHTML = gameNote ? `<span class="game-note-pill" title="${gameNote}">${gameNote}</span>` : '';

  // Broadcaster
  const broadcastName = competition.broadcasts?.[0]?.names?.[0] || 
                        competition.geoBroadcasts?.[0]?.media?.shortName || '';
  const broadcastHTML = broadcastName ? `<span class="game-broadcast-tag">📺 ${broadcastName}</span>` : '';

  // Determine winner / loser
  let awayClass = '';
  let homeClass = '';
  let awayIndicator = '';
  let homeIndicator = '';

  const awayScore = parseInt(away.score) || 0;
  const homeScore = parseInt(home.score) || 0;

  if (isFinal) {
    if (awayScore > homeScore) {
      awayClass = 'winner';
      homeClass = 'loser';
      awayIndicator = '<span class="winner-indicator">◀</span>';
    } else if (homeScore > awayScore) {
      homeClass = 'winner';
      awayClass = 'loser';
      homeIndicator = '<span class="winner-indicator">◀</span>';
    }
  }

  // Records
  const awayRecord = away.records?.[0]?.summary || away.record?.[0]?.displayValue || '';
  const homeRecord = home.records?.[0]?.summary || home.record?.[0]?.displayValue || '';

  // Logos, colors & team info
  const awayLogo = getTeamLogo(away);
  const homeLogo = getTeamLogo(home);
  const awayName = getTeamName(away);
  const homeName = getTeamName(home);
  const awayAbbr = getTeamAbbr(away);
  const homeAbbr = getTeamAbbr(home);

  // Status Badge & Action Button
  let statusBadgeHTML = '';
  let actionBtnHTML = '';
  const youtubeURL = buildYouTubeLink(away, home, event.date);

  if (isFinal) {
    statusBadgeHTML = `<div class="game-status-badge status-final">FINAL</div>`;
    actionBtnHTML = `
      <a href="${youtubeURL}" target="_blank" rel="noopener" class="card-action-btn btn-highlights" title="Watch full highlights on YouTube">
        ▶ Highlights
      </a>
    `;
  } else if (isLive) {
    const detail = statusType.shortDetail || statusType.detail || 'LIVE';
    const awaySlug = slugifyTeamName(getTeamFullName(away));
    const homeSlug = slugifyTeamName(getTeamFullName(home));
    const defaultStreamURL = buildStreamFreeURL(awaySlug, homeSlug);

    statusBadgeHTML = `
      <div class="game-status-badge status-live">
        <span class="live-dot-pulse"></span> ${detail}
      </div>
    `;
    actionBtnHTML = `
      <a href="${defaultStreamURL}" target="_blank" rel="noopener"
         class="card-action-btn btn-live live-thumb checking"
         data-away-slug="${awaySlug}" data-home-slug="${homeSlug}"
         title="Watch Live Stream">
        🔴 Watch Live
      </a>
    `;
  } else {
    // Scheduled
    const gameTime = formatGameTime(event.date);
    statusBadgeHTML = `<div class="game-status-badge status-scheduled">⏰ ${gameTime}</div>`;
    actionBtnHTML = `
      <a href="${youtubeURL}" target="_blank" rel="noopener" class="card-action-btn btn-preview" title="Game Preview on YouTube">
        📅 Preview
      </a>
    `;
  }

  // Linescore Quarter Breakdown (Live or Final)
  let linescoreHTML = '';
  const awayLines = away.linescores || [];
  const homeLines = home.linescores || [];
  const numPeriods = Math.max(awayLines.length, homeLines.length);

  if (!isScheduled && numPeriods > 0) {
    const periodPills = [];
    for (let p = 0; p < numPeriods; p++) {
      const aVal = awayLines[p] ? (awayLines[p].value ?? awayLines[p].displayValue ?? '—') : '—';
      const hVal = homeLines[p] ? (homeLines[p].value ?? homeLines[p].displayValue ?? '—') : '—';
      const pLabel = p < 4 ? `Q${p + 1}` : (p === 4 ? 'OT' : `OT${p - 3}`);
      periodPills.push(`
        <span class="linescore-quarter">
          <span class="linescore-q-label">${pLabel}</span>
          <span class="linescore-q-score">${aVal}–${hVal}</span>
        </span>
      `);
    }
    linescoreHTML = `
      <div class="game-linescore-strip">
        <span class="linescore-q-label">Period:</span>
        ${periodPills.join('')}
      </div>
    `;
  }

  const eventId = event.id;

  return `
    <div class="game-card ${isLive ? 'card-live' : ''}" data-event-id="${eventId}">
      <div class="game-card-header">
        <div class="game-card-meta-left">
          ${broadcastHTML}
          ${gameNoteHTML}
        </div>
        ${statusBadgeHTML}
      </div>

      <div class="game-matchup-arena">
        <div class="team-row ${awayClass}">
          <div class="team-row-left">
            <div class="team-logo-wrap">
              <img class="team-logo" src="${awayLogo}" alt="${awayAbbr}" loading="lazy" />
            </div>
            <div class="team-info-box">
              <span class="team-name">${awayName}</span>
              ${awayRecord ? `<span class="team-record-badge">(${awayRecord})</span>` : ''}
            </div>
          </div>
          <div class="team-score-box">
            <span class="team-score">${isScheduled ? '—' : awayScore}</span>
            ${awayIndicator}
          </div>
        </div>

        <div class="team-row ${homeClass}">
          <div class="team-row-left">
            <div class="team-logo-wrap">
              <img class="team-logo" src="${homeLogo}" alt="${homeAbbr}" loading="lazy" />
            </div>
            <div class="team-info-box">
              <span class="team-name">${homeName}</span>
              ${homeRecord ? `<span class="team-record-badge">(${homeRecord})</span>` : ''}
            </div>
          </div>
          <div class="team-score-box">
            <span class="team-score">${isScheduled ? '—' : homeScore}</span>
            ${homeIndicator}
          </div>
        </div>
      </div>

      ${linescoreHTML}

      <div class="game-card-footer">
        <button class="card-btn-stats" data-event-id="${eventId}" type="button">
          📊 Box Score &amp; Details
        </button>
        ${actionBtnHTML}
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

  gamesState.yesterdayGames = yesterdayGames;
  gamesState.todayGames = todayGames;

  renderAllGames();

  // Update timestamp
  const now = new Date();
  const updatedEl = document.getElementById('last-updated');
  if (updatedEl) {
    updatedEl.textContent = `Last updated: ${now.toLocaleTimeString()}`;
  }
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

// ===== STANDINGS STATE & CONTROLS =====

const standingsState = {
  rawConferences: null,
  activeConf: 'east',
  sortKey: 'rank',
  sortDir: 'asc',
  searchQuery: '',
  eventsBound: false
};

function parseRecordWins(recordStr) {
  if (!recordStr || typeof recordStr !== 'string') return 0;
  const parts = recordStr.split('-');
  return parseInt(parts[0]) || 0;
}

function parseStreakNumeric(str) {
  if (!str || typeof str !== 'string') return 0;
  const num = parseInt(str.substring(1)) || 0;
  return str.startsWith('W') ? num : -num;
}

function extractStandingsTeams(confObj) {
  const entries = confObj?.standings?.entries || [];
  const teams = entries.map((entry) => {
    const team = entry.team || {};
    const stats = entry.stats || [];

    const getStat = (name, fallback = '—') => {
      const s = stats.find(item => item.name === name || item.abbreviation === name);
      return s ? (s.displayValue !== undefined ? s.displayValue : s.value) : fallback;
    };

    const getStatNum = (name, fallback = 0) => {
      const s = stats.find(item => item.name === name || item.abbreviation === name);
      if (!s) return fallback;
      const v = parseFloat(s.value !== undefined ? s.value : s.displayValue);
      return isNaN(v) ? fallback : v;
    };

    const wins = getStatNum('wins', 0);
    const losses = getStatNum('losses', 0);
    const pctNum = getStatNum('winPercent', wins + losses > 0 ? wins / (wins + losses) : 0);
    const pctStr = getStat('winPercent', pctNum.toFixed(3));
    const gb = getStat('gamesBehind', '—');
    const gbNum = getStatNum('gamesBehind', 0);
    const diff = getStatNum('differential', 0);
    const playoffSeed = getStatNum('playoffSeed', 0);
    const home = getStat('Home', '—');
    const away = getStat('Road', getStat('Away', '—'));
    const confRecord = getStat('vs. Conf.', getStat('Conf', '—'));
    const divRecord = getStat('vs. Div.', getStat('Div', '—'));
    const l10 = getStat('Last Ten Games', getStat('L10', '—'));
    const streak = getStat('streak', '—');

    return {
      rank: 0,
      playoffSeed,
      id: team.id,
      name: team.shortDisplayName || team.displayName || 'Unknown',
      fullName: team.displayName || team.shortDisplayName || 'Unknown',
      abbr: team.abbreviation || 'NBA',
      logo: (team.logos && team.logos[0] ? team.logos[0].href : '') || `https://a.espn.com/i/teamlogos/nba/500/${(team.abbreviation || '').toLowerCase()}.png`,
      wins,
      losses,
      pct: pctStr,
      pctNum,
      gb,
      gbNum,
      diff,
      home,
      homeWins: parseRecordWins(home),
      away,
      awayWins: parseRecordWins(away),
      confRecord,
      confWins: parseRecordWins(confRecord),
      divRecord,
      l10,
      l10Wins: parseRecordWins(l10),
      streak,
      streakNumeric: parseStreakNumeric(streak)
    };
  });

  // Sort by official NBA standings tiebreakers
  teams.sort((a, b) => {
    if (a.playoffSeed && b.playoffSeed && a.playoffSeed !== b.playoffSeed) {
      return a.playoffSeed - b.playoffSeed;
    }
    if (b.pctNum !== a.pctNum) return b.pctNum - a.pctNum;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return a.name.localeCompare(b.name);
  });

  // Assign conference rank 1 to 15
  teams.forEach((t, i) => { t.rank = i + 1; });

  return teams;
}

function renderStandingsLeaderBanner(leaderTeam, confLabel) {
  const bannerEl = document.getElementById('standings-leader-banner');
  if (!bannerEl || !leaderTeam) {
    if (bannerEl) bannerEl.innerHTML = '';
    return;
  }

  const diffStr = leaderTeam.diff > 0 ? `+${leaderTeam.diff}` : `${leaderTeam.diff}`;

  bannerEl.innerHTML = `
    <div class="leader-banner-card">
      <div class="leader-banner-left">
        <img class="leader-logo" src="${leaderTeam.logo}" alt="${leaderTeam.abbr}" />
        <div class="leader-text-box">
          <span class="leader-badge">👑 #1 SEED • ${confLabel.toUpperCase()} LEADER</span>
          <span class="leader-team-name">${leaderTeam.fullName}</span>
          <span class="leader-record-str">Record: <strong>${leaderTeam.wins}–${leaderTeam.losses}</strong> (${leaderTeam.pct}) • DIFF: <strong>${diffStr}</strong> • Streak: <strong>${leaderTeam.streak}</strong></span>
        </div>
      </div>
      <div class="leader-banner-right">
        <div class="leader-stat-item">
          <span class="leader-stat-label">WINS</span>
          <span class="leader-stat-value">${leaderTeam.wins}</span>
        </div>
        <div class="leader-stat-item">
          <span class="leader-stat-label">WIN %</span>
          <span class="leader-stat-value">${leaderTeam.pct}</span>
        </div>
        <div class="leader-stat-item">
          <span class="leader-stat-label">DIFF</span>
          <span class="leader-stat-value">${diffStr}</span>
        </div>
        <div class="leader-stat-item">
          <span class="leader-stat-label">HOME</span>
          <span class="leader-stat-value">${leaderTeam.home}</span>
        </div>
        <div class="leader-stat-item">
          <span class="leader-stat-label">AWAY</span>
          <span class="leader-stat-value">${leaderTeam.away}</span>
        </div>
        <div class="leader-stat-item">
          <span class="leader-stat-label">STREAK</span>
          <span class="leader-stat-value">${leaderTeam.streak}</span>
        </div>
      </div>
    </div>
  `;
}

function renderStandingsTable() {
  const tableWrap = document.getElementById('standings-table');
  if (!tableWrap || !standingsState.rawConferences) return;

  const confKeyword = standingsState.activeConf === 'east' ? 'east' : 'west';
  const confObj = standingsState.rawConferences.find(c => {
    const name = (c.name || c.abbreviation || '').toLowerCase();
    return name.includes(confKeyword);
  });

  if (!confObj) {
    tableWrap.innerHTML = '<div class="no-games">Conference standings not available</div>';
    return;
  }

  const allTeams = extractStandingsTeams(confObj);
  const confTitle = standingsState.activeConf === 'east' ? 'Eastern Conference' : 'Western Conference';

  // Render Leader Banner for the #1 seed (original rank === 1)
  const topTeam = allTeams.find(t => t.rank === 1) || allTeams[0];
  renderStandingsLeaderBanner(topTeam, confTitle);

  // Update Section Title & Badge
  const titleEl = document.getElementById('standings-conf-title');
  if (titleEl) titleEl.textContent = `${confTitle} Standings`;

  // Filter teams by search
  let displayTeams = allTeams;
  if (standingsState.searchQuery) {
    const q = standingsState.searchQuery;
    displayTeams = displayTeams.filter(t =>
      t.fullName.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.abbr.toLowerCase().includes(q)
    );
  }

  const countBadge = document.getElementById('standings-teams-badge');
  if (countBadge) {
    countBadge.textContent = `${displayTeams.length} Team${displayTeams.length === 1 ? '' : 's'}`;
  }

  // Sort displayTeams
  const { sortKey, sortDir } = standingsState;
  displayTeams.sort((a, b) => {
    let aVal = a[sortKey];
    let bVal = b[sortKey];

    // String compare for team name
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    // Numeric compare
    aVal = Number(aVal) || 0;
    bVal = Number(bVal) || 0;
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // Build Table HTML
  const columns = [
    { key: 'rank', label: '#', align: 'th-center' },
    { key: 'name', label: 'Team', align: 'th-left' },
    { key: 'wins', label: 'W', align: '' },
    { key: 'losses', label: 'L', align: '' },
    { key: 'pctNum', label: 'PCT', align: '' },
    { key: 'gbNum', label: 'GB', align: '' },
    { key: 'diff', label: 'DIFF', align: '' },
    { key: 'homeWins', label: 'HOME', align: '' },
    { key: 'awayWins', label: 'AWAY', align: '' },
    { key: 'confWins', label: 'CONF', align: '' },
    { key: 'l10Wins', label: 'L10', align: '' },
    { key: 'streakNumeric', label: 'STRK', align: '' }
  ];

  let theadHTML = '<thead><tr>';
  columns.forEach(col => {
    const isActive = sortKey === col.key;
    const arrow = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    theadHTML += `
      <th class="${col.align} ${isActive ? 'active-sort' : ''}" data-sort="${col.key}">
        ${col.label}${arrow}
      </th>
    `;
  });
  theadHTML += '</tr></thead>';

  const isDefaultView = sortKey === 'rank' && sortDir === 'asc' && !standingsState.searchQuery;

  let tbodyHTML = '<tbody>';
  displayTeams.forEach((team, index) => {
    // Cutoff divider line after #6 and #10 in default view
    if (isDefaultView && index === 6) {
      tbodyHTML += `
        <tr class="standings-cutoff-row cutoff-playoff">
          <td colspan="${columns.length}">🏆 Top 6 Guaranteed Playoff Line</td>
        </tr>
      `;
    }
    if (isDefaultView && index === 10) {
      tbodyHTML += `
        <tr class="standings-cutoff-row cutoff-playin">
          <td colspan="${columns.length}">⚔️ Seeds 7–10 Play-In Tournament Line</td>
        </tr>
      `;
    }

    const seedClass = team.rank <= 6 ? 'seed-playoff' : (team.rank <= 10 ? 'seed-playin' : 'seed-lottery');
    const rankBadgeClass = team.rank === 1 ? 'rank-first' : (team.rank <= 6 ? 'rank-playoff' : (team.rank <= 10 ? 'rank-playin' : ''));

    const diffDisplay = team.diff > 0 ? `+${team.diff}` : `${team.diff}`;

    tbodyHTML += `
      <tr class="${seedClass}">
        <td class="td-center ${sortKey === 'rank' ? 'sorted-standings-cell' : ''}">
          <span class="standings-rank-badge ${rankBadgeClass}">${team.rank}</span>
        </td>
        <td class="td-left ${sortKey === 'name' ? 'sorted-standings-cell' : ''}">
          <div class="standings-team">
            <img class="standings-team-logo" src="${team.logo}" alt="${team.abbr}" loading="lazy" />
            <span class="standings-team-name">${team.name}</span>
            <span class="standings-team-abbr">${team.abbr}</span>
          </div>
        </td>
        <td class="${sortKey === 'wins' ? 'sorted-standings-cell' : ''}">${team.wins}</td>
        <td class="${sortKey === 'losses' ? 'sorted-standings-cell' : ''}">${team.losses}</td>
        <td class="${sortKey === 'pctNum' ? 'sorted-standings-cell' : ''}">${team.pct}</td>
        <td class="${sortKey === 'gbNum' ? 'sorted-standings-cell' : ''}">${team.gb}</td>
        <td class="${sortKey === 'diff' ? 'sorted-standings-cell' : ''}">${diffDisplay}</td>
        <td class="${sortKey === 'homeWins' ? 'sorted-standings-cell' : ''}">${team.home}</td>
        <td class="${sortKey === 'awayWins' ? 'sorted-standings-cell' : ''}">${team.away}</td>
        <td class="${sortKey === 'confWins' ? 'sorted-standings-cell' : ''}">${team.confRecord}</td>
        <td class="${sortKey === 'l10Wins' ? 'sorted-standings-cell' : ''}">${team.l10}</td>
        <td class="${sortKey === 'streakNumeric' ? 'sorted-standings-cell' : ''}">${team.streak}</td>
      </tr>
    `;
  });
  tbodyHTML += '</tbody>';

  tableWrap.innerHTML = `
    <table class="standings">
      ${theadHTML}
      ${tbodyHTML}
    </table>
  `;

  // Bind column header click listeners
  tableWrap.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const colKey = th.getAttribute('data-sort');
      if (standingsState.sortKey === colKey) {
        standingsState.sortDir = standingsState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        standingsState.sortKey = colKey;
        // Default asc for rank/losses/gb, desc for other stats
        standingsState.sortDir = (colKey === 'rank' || colKey === 'losses' || colKey === 'gbNum') ? 'asc' : 'desc';
      }
      renderStandingsTable();
    });
  });
}

async function loadStandings(conference = 'east') {
  standingsState.activeConf = conference;
  const tableWrap = document.getElementById('standings-table');
  if (tableWrap && !standingsState.rawConferences) {
    tableWrap.innerHTML = '<div class="loading">Loading standings...</div>';
  }

  try {
    const res = await fetch(ESPN_STANDINGS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    standingsState.rawConferences = data.children || [];
    renderStandingsTable();
  } catch (err) {
    console.error('Standings error:', err);
    if (tableWrap) {
      tableWrap.innerHTML = '<div class="no-games">Failed to load standings</div>';
    }
  }
}

function initStandingsControls() {
  if (standingsState.eventsBound) return;
  standingsState.eventsBound = true;

  // Conference switch buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.conf-btn');
    if (!btn) return;
    document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const conf = btn.getAttribute('data-conf') || 'east';
    standingsState.sortKey = 'rank';
    standingsState.sortDir = 'asc';
    loadStandings(conf);
  });

  // Standings team search
  const searchInput = document.getElementById('standings-team-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      standingsState.searchQuery = e.target.value.trim().toLowerCase();
      renderStandingsTable();
    });
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
      const targetContent = document.getElementById(`${target}-tab`);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // Load data for tab if needed
      if (target === 'standings') {
        loadStandings(standingsState.activeConf || 'east');
      } else if (target === 'powerrankings') {
        loadPowerRankings();
      } else if (target === 'livetv') {
        startLiveTV();
      }

      // Pause live stream if navigating away from Live TV tab
      if (target !== 'livetv') {
        pauseLiveTV();
      }
    });
  });
}

// ===== POWER RANKINGS & LEAGUE LEADERS =====

const prState = {
  activeSubtab: 'teams', // 'teams' | 'players'
  teamsData: null,
  playersData: null,
  teamsSort: { key: 'powerScore', dir: 'desc' },
  playersSort: { key: 'pts', dir: 'desc' },
  teamsFilter: { conf: 'all', search: '' },
  playersFilter: { search: '' },
  eventsBound: false
};

const TEAM_STAT_LABELS = {
  powerScore: 'Power Index',
  ppg: 'Points (PPG)',
  oppPpg: 'Opponent PPG',
  diff: 'Point Differential',
  rpg: 'Rebounds (RPG)',
  apg: 'Assists (APG)',
  spg: 'Steals (SPG)',
  bpg: 'Blocks (BPG)',
  fgPct: 'Field Goal %',
  threePct: '3-Point %',
  ftPct: 'Free Throw %',
  winPct: 'Win %',
  wins: 'Wins',
  losses: 'Losses',
  streak: 'Streak',
  gamesPlayed: 'Games Played'
};

const PLAYER_STAT_LABELS = {
  pts: 'Scoring (PPG)',
  reb: 'Rebounds (RPG)',
  ast: 'Assists (APG)',
  stl: 'Steals (SPG)',
  blk: 'Blocks (BPG)',
  threePM: '3PT Made (3PM)',
  fgPct: 'Field Goal %',
  threePct: '3-Point %',
  ftPct: 'Free Throw %',
  min: 'Minutes (MPG)',
  to: 'Turnovers (TOPG)',
  gp: 'Games Played'
};

async function loadPowerRankings() {
  initPowerRankingsEvents();

  if (prState.activeSubtab === 'teams') {
    await ensureTeamsDataLoaded();
    renderTeamsView();
  } else {
    await ensurePlayersDataLoaded();
    renderPlayersView();
  }
}

function initPowerRankingsEvents() {
  if (prState.eventsBound) return;
  prState.eventsBound = true;

  // Subtab buttons (Teams vs Players)
  const subtabTeams = document.getElementById('pr-subtab-teams');
  const subtabPlayers = document.getElementById('pr-subtab-players');
  const viewTeams = document.getElementById('pr-teams-view');
  const viewPlayers = document.getElementById('pr-players-view');

  if (subtabTeams && subtabPlayers) {
    subtabTeams.addEventListener('click', async () => {
      prState.activeSubtab = 'teams';
      subtabTeams.classList.add('active');
      subtabPlayers.classList.remove('active');
      if (viewTeams) viewTeams.classList.add('active');
      if (viewPlayers) viewPlayers.classList.remove('active');
      await ensureTeamsDataLoaded();
      renderTeamsView();
    });

    subtabPlayers.addEventListener('click', async () => {
      prState.activeSubtab = 'players';
      subtabPlayers.classList.add('active');
      subtabTeams.classList.remove('active');
      if (viewPlayers) viewPlayers.classList.add('active');
      if (viewTeams) viewTeams.classList.remove('active');
      await ensurePlayersDataLoaded();
      renderPlayersView();
    });
  }

  // Category Pills - Teams
  const teamPillsWrap = document.getElementById('team-category-pills');
  if (teamPillsWrap) {
    teamPillsWrap.addEventListener('click', (e) => {
      const pill = e.target.closest('.pr-pill');
      if (!pill) return;
      const stat = pill.getAttribute('data-stat');
      if (!stat) return;

      teamPillsWrap.querySelectorAll('.pr-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      prState.teamsSort.key = stat;
      prState.teamsSort.dir = 'desc';
      renderTeamsView();
    });
  }

  // Category Pills - Players
  const playerPillsWrap = document.getElementById('player-category-pills');
  if (playerPillsWrap) {
    playerPillsWrap.addEventListener('click', (e) => {
      const pill = e.target.closest('.pr-pill');
      if (!pill) return;
      const stat = pill.getAttribute('data-stat');
      if (!stat) return;

      playerPillsWrap.querySelectorAll('.pr-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      prState.playersSort.key = stat;
      prState.playersSort.dir = 'desc';
      renderPlayersView();
    });
  }

  // Conference Filter - Teams
  const confFilterWrap = document.getElementById('pr-team-conf-filter');
  if (confFilterWrap) {
    confFilterWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.pr-conf-btn');
      if (!btn) return;
      confFilterWrap.querySelectorAll('.pr-conf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      prState.teamsFilter.conf = btn.getAttribute('data-conf') || 'all';
      renderTeamsView();
    });
  }

  // Search Input - Teams
  const teamSearch = document.getElementById('pr-team-search');
  if (teamSearch) {
    teamSearch.addEventListener('input', (e) => {
      prState.teamsFilter.search = e.target.value.trim().toLowerCase();
      renderTeamsView();
    });
  }

  // Search Input - Players
  const playerSearch = document.getElementById('pr-player-search');
  if (playerSearch) {
    playerSearch.addEventListener('input', (e) => {
      prState.playersFilter.search = e.target.value.trim().toLowerCase();
      renderPlayersView();
    });
  }

  // Table header clicks for dynamic sorting (delegation)
  document.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;

    const tableWrap = th.closest('.pr-table-wrapper');
    if (!tableWrap) return;

    const isTeamsTable = tableWrap.id === 'pr-teams-table-wrap';
    const isPlayersTable = tableWrap.id === 'pr-players-table-wrap';
    const sortKey = th.getAttribute('data-sort');
    if (!sortKey) return;

    if (isTeamsTable) {
      if (prState.teamsSort.key === sortKey) {
        prState.teamsSort.dir = prState.teamsSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        prState.teamsSort.key = sortKey;
        prState.teamsSort.dir = 'desc';
      }
      // Sync pill if available
      syncPillState('team-category-pills', sortKey);
      renderTeamsView();
    } else if (isPlayersTable) {
      if (prState.playersSort.key === sortKey) {
        prState.playersSort.dir = prState.playersSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        prState.playersSort.key = sortKey;
        prState.playersSort.dir = 'desc';
      }
      // Sync pill if available
      syncPillState('player-category-pills', sortKey);
      renderPlayersView();
    }
  });
}

function syncPillState(containerId, activeStat) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.querySelectorAll('.pr-pill').forEach(pill => {
    if (pill.getAttribute('data-stat') === activeStat) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

// Data Fetchers with Server + ESPN Direct Fallback
async function ensureTeamsDataLoaded() {
  if (prState.teamsData) return;

  const tableWrap = document.getElementById('pr-teams-table-wrap');
  if (tableWrap) tableWrap.innerHTML = '<div class="loading">Loading Team Power Rankings...</div>';

  try {
    const res = await fetch('/api/power-rankings/teams');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      prState.teamsData = data;
      return;
    }
    throw new Error('Empty team data received');
  } catch (err) {
    console.warn('Backend /api/power-rankings/teams failed, using direct ESPN client fallback:', err.message);
    prState.teamsData = await fetchTeamsClientFallback();
  }
}

async function fetchTeamsClientFallback() {
  try {
    const res = await fetch(ESPN_STANDINGS);
    if (!res.ok) throw new Error(`ESPN Standings HTTP ${res.status}`);
    const data = await res.json();
    const teams = [];

    (data.children || []).forEach(conf => {
      const confName = (conf.name || conf.abbreviation || '').toLowerCase().includes('east') ? 'Eastern' : 'Western';
      (conf.standings?.entries || []).forEach(entry => {
        const team = entry.team || {};
        const statsMap = {};
        (entry.stats || []).forEach(s => { statsMap[s.name] = s.value; });

        const wins = statsMap.wins || 0;
        const losses = statsMap.losses || 0;
        const winPct = statsMap.winPercent !== undefined ? statsMap.winPercent : (wins + losses > 0 ? wins / (wins + losses) : 0);
        const diff = statsMap.differential !== undefined ? statsMap.differential : 0;
        const ppg = statsMap.avgPointsFor || 0;
        const oppPpg = statsMap.avgPointsAgainst || 0;
        const streak = statsMap.streak || 0;

        const powerScore = Math.max(0, Math.round(
          (winPct * 45) + (diff * 1.5) + (ppg * 0.25)
        * 10) / 10);

        teams.push({
          id: team.id,
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
          rpg: 0,
          apg: 0,
          spg: 0,
          bpg: 0,
          fgPct: 0,
          threePct: 0,
          ftPct: 0,
          gamesPlayed: wins + losses || 1,
          powerScore
        });
      });
    });

    teams.sort((a, b) => b.powerScore - a.powerScore);
    teams.forEach((t, i) => { t.rank = i + 1; });
    return teams;
  } catch (e) {
    console.error('Client fallback failed for teams:', e);
    return [];
  }
}

async function ensurePlayersDataLoaded() {
  if (prState.playersData) return;

  const tableWrap = document.getElementById('pr-players-table-wrap');
  if (tableWrap) tableWrap.innerHTML = '<div class="loading">Loading Player Leaders...</div>';

  try {
    const res = await fetch('/api/power-rankings/players');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      prState.playersData = data;
      return;
    }
    throw new Error('Empty player data received');
  } catch (err) {
    console.warn('Backend /api/power-rankings/players failed, using direct ESPN client fallback:', err.message);
    prState.playersData = await fetchPlayersClientFallback();
  }
}

async function fetchPlayersClientFallback() {
  try {
    const url = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?limit=150';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN API HTTP ${res.status}`);
    const data = await res.json();

    const catDefs = {};
    (data.categories || []).forEach(c => { catDefs[c.name] = c.names; });

    const players = (data.athletes || []).map(item => {
      const a = item.athlete || {};
      const team = (a.teams && a.teams[0]) ? a.teams[0] : {};
      const stats = {};
      (item.categories || []).forEach(c => {
        const names = catDefs[c.name] || [];
        names.forEach((name, i) => {
          const raw = c.totals && c.totals[i] !== undefined ? c.totals[i] : (c.values && c.values[i] !== undefined ? c.values[i] : 0);
          const val = parseFloat(raw);
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
    return players;
  } catch (e) {
    console.error('Client fallback failed for players:', e);
    return [];
  }
}

// ===== RENDER TEAMS VIEW =====
function renderTeamsView() {
  const podiumEl = document.getElementById('pr-teams-podium');
  const tableWrap = document.getElementById('pr-teams-table-wrap');
  const sortLabel = document.getElementById('pr-team-sort-label');
  const countBadge = document.getElementById('pr-team-count-badge');

  if (!prState.teamsData || prState.teamsData.length === 0) {
    if (tableWrap) tableWrap.innerHTML = '<div class="no-games">No team data available right now.</div>';
    return;
  }

  // 1. Filter
  let list = [...prState.teamsData];
  if (prState.teamsFilter.conf !== 'all') {
    const isEast = prState.teamsFilter.conf === 'east';
    list = list.filter(t => isEast ? t.conference === 'Eastern' : t.conference === 'Western');
  }
  if (prState.teamsFilter.search) {
    const q = prState.teamsFilter.search;
    list = list.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.fullName || '').toLowerCase().includes(q) ||
      (t.abbreviation || '').toLowerCase().includes(q)
    );
  }

  // 2. Sort
  const key = prState.teamsSort.key;
  const isAsc = prState.teamsSort.dir === 'asc';

  list.sort((a, b) => {
    let valA = a[key] !== undefined ? a[key] : (a.stats?.[key] ?? 0);
    let valB = b[key] !== undefined ? b[key] : (b.stats?.[key] ?? 0);

    if (typeof valA === 'string') {
      return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return isAsc ? (valA - valB) : (valB - valA);
  });

  // Update header text
  const labelText = TEAM_STAT_LABELS[key] || key.toUpperCase();
  if (sortLabel) {
    sortLabel.innerHTML = `Ranked by: <strong>${labelText}</strong> ${isAsc ? '▲ (Ascending)' : '▼ (Descending)'}`;
  }
  if (countBadge) {
    countBadge.textContent = `${list.length} Team${list.length === 1 ? '' : 's'}`;
  }

  // 3. Render Top 3 Spotlight Podium
  if (podiumEl) {
    const top3 = list.slice(0, 3);
    if (top3.length === 0) {
      podiumEl.innerHTML = '';
    } else {
      podiumEl.innerHTML = renderTeamsPodium(top3, key, labelText);
    }
  }

  // 4. Render Interactive Full Table
  if (tableWrap) {
    tableWrap.innerHTML = renderTeamsTable(list, key, isAsc);
  }
}

function renderTeamsPodium(top3, sortKey, labelText) {
  return top3.map((team, idx) => {
    const rankNum = idx + 1;
    const rankClass = `rank-${rankNum}`;
    const medalText = rankNum === 1 ? '👑 #1' : `#${rankNum}`;

    let mainStatVal = team[sortKey] !== undefined ? team[sortKey] : 0;
    if (sortKey === 'winPct') mainStatVal = (mainStatVal * 100).toFixed(1) + '%';
    else if (sortKey === 'diff') mainStatVal = (mainStatVal > 0 ? '+' : '') + mainStatVal;
    else if (sortKey === 'fgPct' || sortKey === 'threePct' || sortKey === 'ftPct') mainStatVal = mainStatVal + '%';

    return `
      <div class="pr-podium-card ${rankClass}">
        <div class="pr-podium-badge-row">
          <span class="pr-rank-medal">${medalText}</span>
          <span class="pr-podium-subtag">${team.conference}</span>
        </div>
        <div class="pr-team-podium-body">
          <img src="${team.logo}" alt="${team.name}" class="pr-team-podium-logo" onerror="this.src='https://a.espn.com/i/teamlogos/nba/500/nba.png'" />
          <div class="pr-team-podium-info">
            <div class="pr-team-podium-name">${team.fullName}</div>
            <div class="pr-team-podium-meta">
              <span class="pr-conf-tag">${team.abbreviation}</span>
              <span>${team.wins}-${team.losses} (${team.winPct > 0 ? (team.winPct * 100).toFixed(0) : '0'}%)</span>
              <span>• Streak ${team.streak}</span>
            </div>
          </div>
        </div>
        <div class="pr-podium-stat-box">
          <div class="pr-stat-focus-row">
            <span class="pr-stat-focus-label">${labelText}</span>
            <span class="pr-stat-focus-value">${mainStatVal}</span>
          </div>
          <div class="pr-podium-mini-stats">
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">PPG</span>
              <span class="pr-mini-stat-value">${team.ppg || '—'}</span>
            </div>
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">RPG</span>
              <span class="pr-mini-stat-value">${team.rpg || '—'}</span>
            </div>
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">APG</span>
              <span class="pr-mini-stat-value">${team.apg || '—'}</span>
            </div>
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">DIFF</span>
              <span class="pr-mini-stat-value ${team.diff > 0 ? 'val-positive' : team.diff < 0 ? 'val-negative' : ''}">
                ${team.diff > 0 ? '+' : ''}${team.diff}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTeamsTable(list, sortKey, isAsc) {
  const getSortIcon = (k) => {
    if (sortKey !== k) return '<span class="pr-sort-icon">⇅</span>';
    return isAsc ? '<span class="pr-sort-icon">▲</span>' : '<span class="pr-sort-icon">▼</span>';
  };

  const getThClass = (k, align = '') => {
    const active = sortKey === k ? 'active-sort' : '';
    const alignClass = align ? `th-${align}` : '';
    return `class="${alignClass} ${active}"`.trim();
  };

  const rows = list.map((t, idx) => {
    const rankNum = idx + 1;
    const rankBadgeClass = rankNum === 1 ? 'rank-top1' : rankNum === 2 ? 'rank-top2' : rankNum === 3 ? 'rank-top3' : '';
    const diffDisplay = (t.diff > 0 ? '+' : '') + t.diff;
    const diffClass = t.diff > 0 ? 'val-positive' : t.diff < 0 ? 'val-negative' : '';

    return `
      <tr>
        <td class="td-center">
          <span class="pr-table-rank ${rankBadgeClass}">#${rankNum}</span>
        </td>
        <td class="td-left">
          <div class="pr-team-cell">
            <img src="${t.logo}" alt="${t.name}" class="pr-team-cell-logo" onerror="this.src='https://a.espn.com/i/teamlogos/nba/500/nba.png'" />
            <span class="pr-team-cell-name">${t.name}</span>
            <span class="pr-team-cell-abbr">(${t.abbreviation})</span>
            <span class="pr-conf-tag" style="margin-left: 4px;">${t.conference === 'Eastern' ? 'EAST' : 'WEST'}</span>
          </div>
        </td>
        <td class="td-center ${sortKey === 'powerScore' ? 'sorted-cell' : ''}">
          <strong class="val-highlight">${t.powerScore ?? '—'}</strong>
        </td>
        <td class="td-center ${sortKey === 'wins' || sortKey === 'losses' ? 'sorted-cell' : ''}">
          ${t.wins}-${t.losses}
        </td>
        <td class="${sortKey === 'winPct' ? 'sorted-cell' : ''}">
          ${(t.winPct * 100).toFixed(1)}%
        </td>
        <td class="${sortKey === 'ppg' ? 'sorted-cell' : ''}">
          <strong>${t.ppg}</strong>
        </td>
        <td class="${sortKey === 'oppPpg' ? 'sorted-cell' : ''}">
          ${t.oppPpg}
        </td>
        <td class="${sortKey === 'diff' ? 'sorted-cell' : ''}">
          <span class="${diffClass}">${diffDisplay}</span>
        </td>
        <td class="${sortKey === 'rpg' ? 'sorted-cell' : ''}">
          ${t.rpg || '—'}
        </td>
        <td class="${sortKey === 'apg' ? 'sorted-cell' : ''}">
          ${t.apg || '—'}
        </td>
        <td class="${sortKey === 'spg' ? 'sorted-cell' : ''}">
          ${t.spg || '—'}
        </td>
        <td class="${sortKey === 'bpg' ? 'sorted-cell' : ''}">
          ${t.bpg || '—'}
        </td>
        <td class="${sortKey === 'fgPct' ? 'sorted-cell' : ''}">
          ${t.fgPct ? t.fgPct + '%' : '—'}
        </td>
        <td class="${sortKey === 'threePct' ? 'sorted-cell' : ''}">
          ${t.threePct ? t.threePct + '%' : '—'}
        </td>
        <td class="${sortKey === 'ftPct' ? 'sorted-cell' : ''}">
          ${t.ftPct ? t.ftPct + '%' : '—'}
        </td>
        <td class="td-center ${sortKey === 'streak' ? 'sorted-cell' : ''}">
          ${t.streak}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table class="pr-table">
      <thead>
        <tr>
          <th ${getThClass('rank', 'center')} data-sort="rank">#</th>
          <th ${getThClass('name', 'left')} data-sort="name">Team ${getSortIcon('name')}</th>
          <th ${getThClass('powerScore', 'center')} data-sort="powerScore" title="Composite Power Rating">Power ${getSortIcon('powerScore')}</th>
          <th ${getThClass('wins', 'center')} data-sort="wins">W-L ${getSortIcon('wins')}</th>
          <th ${getThClass('winPct')} data-sort="winPct">Win % ${getSortIcon('winPct')}</th>
          <th ${getThClass('ppg')} data-sort="ppg">PPG ${getSortIcon('ppg')}</th>
          <th ${getThClass('oppPpg')} data-sort="oppPpg">OPP PPG ${getSortIcon('oppPpg')}</th>
          <th ${getThClass('diff')} data-sort="diff">DIFF ${getSortIcon('diff')}</th>
          <th ${getThClass('rpg')} data-sort="rpg">RPG ${getSortIcon('rpg')}</th>
          <th ${getThClass('apg')} data-sort="apg">APG ${getSortIcon('apg')}</th>
          <th ${getThClass('spg')} data-sort="spg">SPG ${getSortIcon('spg')}</th>
          <th ${getThClass('bpg')} data-sort="bpg">BPG ${getSortIcon('bpg')}</th>
          <th ${getThClass('fgPct')} data-sort="fgPct">FG% ${getSortIcon('fgPct')}</th>
          <th ${getThClass('threePct')} data-sort="threePct">3P% ${getSortIcon('threePct')}</th>
          <th ${getThClass('ftPct')} data-sort="ftPct">FT% ${getSortIcon('ftPct')}</th>
          <th ${getThClass('streak', 'center')} data-sort="streak">Strk ${getSortIcon('streak')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// ===== RENDER PLAYERS VIEW =====
function renderPlayersView() {
  const podiumEl = document.getElementById('pr-players-podium');
  const tableWrap = document.getElementById('pr-players-table-wrap');
  const sortLabel = document.getElementById('pr-player-sort-label');
  const countBadge = document.getElementById('pr-player-count-badge');

  if (!prState.playersData || prState.playersData.length === 0) {
    if (tableWrap) tableWrap.innerHTML = '<div class="no-games">No player statistics available right now.</div>';
    return;
  }

  // 1. Filter
  let list = [...prState.playersData];
  if (prState.playersFilter.search) {
    const q = prState.playersFilter.search;
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.shortName || '').toLowerCase().includes(q) ||
      (p.team?.name || '').toLowerCase().includes(q) ||
      (p.team?.abbreviation || '').toLowerCase().includes(q)
    );
  }

  // 2. Sort
  const key = prState.playersSort.key;
  const isAsc = prState.playersSort.dir === 'asc';

  list.sort((a, b) => {
    let valA = a.stats?.[key] !== undefined ? a.stats[key] : (a[key] ?? 0);
    let valB = b.stats?.[key] !== undefined ? b.stats[key] : (b[key] ?? 0);

    if (typeof valA === 'string') {
      return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return isAsc ? (valA - valB) : (valB - valA);
  });

  // Update header text
  const labelText = PLAYER_STAT_LABELS[key] || key.toUpperCase();
  if (sortLabel) {
    sortLabel.innerHTML = `Ranked by: <strong>${labelText}</strong> ${isAsc ? '▲ (Ascending)' : '▼ (Descending)'}`;
  }
  if (countBadge) {
    countBadge.textContent = `${list.length} Player${list.length === 1 ? '' : 's'}`;
  }

  // 3. Render Top 3 Spotlight Podium
  if (podiumEl) {
    const top3 = list.slice(0, 3);
    if (top3.length === 0) {
      podiumEl.innerHTML = '';
    } else {
      podiumEl.innerHTML = renderPlayersPodium(top3, key, labelText);
    }
  }

  // 4. Render Interactive Full Table
  if (tableWrap) {
    tableWrap.innerHTML = renderPlayersTable(list, key, isAsc);
  }
}

function renderPlayersPodium(top3, sortKey, labelText) {
  return top3.map((player, idx) => {
    const rankNum = idx + 1;
    const rankClass = `rank-${rankNum}`;
    const medalText = rankNum === 1 ? '👑 #1' : `#${rankNum}`;

    let mainStatVal = player.stats?.[sortKey] !== undefined ? player.stats[sortKey] : 0;
    if (sortKey === 'fgPct' || sortKey === 'threePct' || sortKey === 'ftPct') mainStatVal = mainStatVal + '%';

    return `
      <div class="pr-podium-card ${rankClass}">
        <div class="pr-podium-badge-row">
          <span class="pr-rank-medal">${medalText}</span>
          <span class="pr-podium-subtag">${player.team?.abbreviation || 'NBA'}</span>
        </div>
        <div class="pr-player-podium-body">
          <div class="pr-player-avatar-wrap">
            <img src="${player.headshot}" alt="${player.name}" class="pr-player-podium-headshot" onerror="this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/nophone.png&w=350&h=254'" />
            ${player.team?.logo ? `<img src="${player.team.logo}" alt="${player.team.abbreviation}" class="pr-player-podium-team-badge" onerror="this.style.display='none'" />` : ''}
          </div>
          <div class="pr-player-podium-info">
            <div class="pr-player-podium-name">${player.name}</div>
            <div class="pr-player-podium-meta">
              <span class="pr-pos-chip">${player.position}</span>
              <span>${player.team?.name || ''}</span>
              ${player.jersey ? `<span>${player.jersey}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="pr-podium-stat-box">
          <div class="pr-stat-focus-row">
            <span class="pr-stat-focus-label">${labelText}</span>
            <span class="pr-stat-focus-value">${mainStatVal}</span>
          </div>
          <div class="pr-podium-mini-stats">
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">PPG</span>
              <span class="pr-mini-stat-value">${player.stats.pts}</span>
            </div>
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">RPG</span>
              <span class="pr-mini-stat-value">${player.stats.reb}</span>
            </div>
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">APG</span>
              <span class="pr-mini-stat-value">${player.stats.ast}</span>
            </div>
            <div class="pr-mini-stat">
              <span class="pr-mini-stat-label">FG%</span>
              <span class="pr-mini-stat-value">${player.stats.fgPct ? player.stats.fgPct + '%' : '—'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPlayersTable(list, sortKey, isAsc) {
  const getSortIcon = (k) => {
    if (sortKey !== k) return '<span class="pr-sort-icon">⇅</span>';
    return isAsc ? '<span class="pr-sort-icon">▲</span>' : '<span class="pr-sort-icon">▼</span>';
  };

  const getThClass = (k, align = '') => {
    const active = sortKey === k ? 'active-sort' : '';
    const alignClass = align ? `th-${align}` : '';
    return `class="${alignClass} ${active}"`.trim();
  };

  const rows = list.map((p, idx) => {
    const rankNum = idx + 1;
    const rankBadgeClass = rankNum === 1 ? 'rank-top1' : rankNum === 2 ? 'rank-top2' : rankNum === 3 ? 'rank-top3' : '';

    return `
      <tr>
        <td class="td-center">
          <span class="pr-table-rank ${rankBadgeClass}">#${rankNum}</span>
        </td>
        <td class="td-left">
          <div class="pr-player-cell">
            <img src="${p.headshot}" alt="${p.name}" class="pr-player-cell-headshot" onerror="this.src='https://a.espncdn.com/combiner/i?img=/i/headshots/nophone.png&w=350&h=254'" />
            <div class="pr-player-cell-info">
              <span class="pr-player-cell-name">${p.name}</span>
              <span class="pr-player-cell-meta">${p.position} ${p.jersey ? '• ' + p.jersey : ''}</span>
            </div>
          </div>
        </td>
        <td class="td-left">
          <div class="pr-team-cell">
            ${p.team?.logo ? `<img src="${p.team.logo}" alt="${p.team.abbreviation}" class="pr-team-cell-logo" onerror="this.style.display='none'" />` : ''}
            <span class="pr-team-cell-abbr">${p.team?.abbreviation || 'NBA'}</span>
          </div>
        </td>
        <td class="${sortKey === 'pts' ? 'sorted-cell' : ''}">
          <strong class="val-highlight">${p.stats.pts}</strong>
        </td>
        <td class="${sortKey === 'reb' ? 'sorted-cell' : ''}">
          ${p.stats.reb}
        </td>
        <td class="${sortKey === 'ast' ? 'sorted-cell' : ''}">
          ${p.stats.ast}
        </td>
        <td class="${sortKey === 'stl' ? 'sorted-cell' : ''}">
          ${p.stats.stl}
        </td>
        <td class="${sortKey === 'blk' ? 'sorted-cell' : ''}">
          ${p.stats.blk}
        </td>
        <td class="${sortKey === 'threePM' ? 'sorted-cell' : ''}">
          ${p.stats.threePM}
        </td>
        <td class="${sortKey === 'fgPct' ? 'sorted-cell' : ''}">
          ${p.stats.fgPct ? p.stats.fgPct + '%' : '—'}
        </td>
        <td class="${sortKey === 'threePct' ? 'sorted-cell' : ''}">
          ${p.stats.threePct ? p.stats.threePct + '%' : '—'}
        </td>
        <td class="${sortKey === 'ftPct' ? 'sorted-cell' : ''}">
          ${p.stats.ftPct ? p.stats.ftPct + '%' : '—'}
        </td>
        <td class="${sortKey === 'min' ? 'sorted-cell' : ''}">
          ${p.stats.min}
        </td>
        <td class="td-center ${sortKey === 'gp' ? 'sorted-cell' : ''}">
          ${p.stats.gp}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table class="pr-table">
      <thead>
        <tr>
          <th ${getThClass('rank', 'center')} data-sort="rank">#</th>
          <th ${getThClass('name', 'left')} data-sort="name">Player ${getSortIcon('name')}</th>
          <th ${getThClass('team', 'left')} data-sort="team">Team ${getSortIcon('team')}</th>
          <th ${getThClass('pts')} data-sort="pts">PTS ${getSortIcon('pts')}</th>
          <th ${getThClass('reb')} data-sort="reb">REB ${getSortIcon('reb')}</th>
          <th ${getThClass('ast')} data-sort="ast">AST ${getSortIcon('ast')}</th>
          <th ${getThClass('stl')} data-sort="stl">STL ${getSortIcon('stl')}</th>
          <th ${getThClass('blk')} data-sort="blk">BLK ${getSortIcon('blk')}</th>
          <th ${getThClass('threePM')} data-sort="threePM">3PM ${getSortIcon('threePM')}</th>
          <th ${getThClass('fgPct')} data-sort="fgPct">FG% ${getSortIcon('fgPct')}</th>
          <th ${getThClass('threePct')} data-sort="threePct">3P% ${getSortIcon('threePct')}</th>
          <th ${getThClass('ftPct')} data-sort="ftPct">FT% ${getSortIcon('ftPct')}</th>
          <th ${getThClass('min')} data-sort="min">MIN ${getSortIcon('min')}</th>
          <th ${getThClass('gp', 'center')} data-sort="gp">GP ${getSortIcon('gp')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
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

// ===== LIVE TV (IPTV / M3U) STREAM CONTROLLER =====

let liveTvHls = null;
let currentStreamSource = 'primary'; // 'primary', 'backup', 'custom'

const LIVE_CHANNELS = {
  primary: {
    name: 'NBA TV Philippines',
    url: 'http://23.237.104.106:8080/USA_NBA/index.m3u8',
    quality: '1080p 60FPS'
  },
  backup: {
    name: 'NBA TV Server 2',
    url: 'http://23.237.104.106:8080/USA_NBA/tracks-v1a1/mono.m3u8',
    quality: '1080p Direct Track'
  }
};

function getEffectiveStreamUrl(rawUrl) {
  // If running on HTTPS (e.g. Render production) or stream needs proxying to bypass CORS & mixed-content
  const isHttps = window.location.protocol === 'https:';
  const isHttpStream = rawUrl.startsWith('http://');
  if (isHttps || isHttpStream) {
    return `/api/iptv-proxy?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

function updateStreamStatus(status, text) {
  const pill = document.getElementById('stream-status-pill');
  const textEl = document.getElementById('stream-status-text');
  if (!pill || !textEl) return;

  pill.className = `stream-status-pill ${status}`;
  textEl.textContent = text;
}

function showOverlay(message, showRetry = false) {
  const overlay = document.getElementById('livetv-overlay');
  const msgEl = document.getElementById('overlay-message');
  const retryBtn = document.getElementById('overlay-retry-btn');
  const spinner = overlay ? overlay.querySelector('.overlay-spinner') : null;

  if (overlay && msgEl) {
    overlay.classList.remove('hidden');
    msgEl.textContent = message;
    if (retryBtn) {
      if (showRetry) {
        retryBtn.classList.remove('hidden');
        if (spinner) spinner.style.display = 'none';
      } else {
        retryBtn.classList.add('hidden');
        if (spinner) spinner.style.display = 'block';
      }
    }
  }
}

function hideOverlay() {
  const overlay = document.getElementById('livetv-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function loadLiveTvStream(sourceKey = null) {
  if (sourceKey) currentStreamSource = sourceKey;
  const video = document.getElementById('livetv-video');
  if (!video) return;

  let streamUrl = '';
  let channelName = 'NBA TV Philippines';
  let qualityText = '1080p 60FPS';

  if (currentStreamSource === 'custom') {
    const savedCustom = localStorage.getItem('nba_custom_stream_url') || '';
    if (!savedCustom) {
      openCustomStreamModal();
      return;
    }
    streamUrl = savedCustom;
    channelName = 'Custom Stream';
    qualityText = 'Custom HLS / M3U';
  } else if (LIVE_CHANNELS[currentStreamSource]) {
    const chan = LIVE_CHANNELS[currentStreamSource];
    streamUrl = chan.url;
    channelName = chan.name;
    qualityText = chan.quality;
  } else {
    streamUrl = LIVE_CHANNELS.primary.url;
  }

  // Update channel name in UI
  const nameEl = document.getElementById('current-channel-name');
  if (nameEl) nameEl.textContent = channelName;

  const resEl = document.getElementById('stream-resolution-text');
  if (resEl) resEl.textContent = qualityText;

  showOverlay(`Connecting to ${channelName}...`);
  updateStreamStatus('buffering', 'Connecting...');

  // Destroy existing HLS instance if any
  if (liveTvHls) {
    liveTvHls.destroy();
    liveTvHls = null;
  }

  const effectiveUrl = getEffectiveStreamUrl(streamUrl);

  // Use Hls.js if supported
  if (window.Hls && Hls.isSupported()) {
    liveTvHls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      manifestLoadingTimeOut: 12000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 12000
    });

    liveTvHls.loadSource(effectiveUrl);
    liveTvHls.attachMedia(video);

    liveTvHls.on(Hls.Events.MANIFEST_PARSED, () => {
      hideOverlay();
      updateStreamStatus('online', 'Live');
      video.play().catch(() => {
        // Autoplay policy prevented playback, controls remain available for user interaction
      });
    });

    liveTvHls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('HLS stream error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (!effectiveUrl.includes('/api/iptv-proxy')) {
              const proxyFallback = `/api/iptv-proxy?url=${encodeURIComponent(streamUrl)}`;
              liveTvHls.loadSource(proxyFallback);
            } else {
              updateStreamStatus('error', 'Offline / Retry');
              showOverlay('Stream connection lost. Please retry or switch to Backup Server.', true);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            liveTvHls.recoverMediaError();
            break;
          default:
            liveTvHls.destroy();
            updateStreamStatus('error', 'Error');
            showOverlay('Unable to play stream. Try Backup Server or Custom Stream.', true);
            break;
        }
      }
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari, iOS, TV browsers)
    video.src = effectiveUrl;
    video.addEventListener('loadedmetadata', () => {
      hideOverlay();
      updateStreamStatus('online', 'Live');
      video.play().catch(() => {});
    }, { once: true });

    video.onerror = () => {
      updateStreamStatus('error', 'Error');
      showOverlay('Playback error. Please retry or switch source.', true);
    };
  } else {
    updateStreamStatus('error', 'Unsupported');
    showOverlay('HLS streaming is not supported on this browser.', false);
  }
}

function startLiveTV() {
  const video = document.getElementById('livetv-video');
  if (!video) return;

  if (!video.src && !liveTvHls) {
    loadLiveTvStream(currentStreamSource);
  } else {
    video.play().catch(() => {});
  }
}

function pauseLiveTV() {
  const video = document.getElementById('livetv-video');
  if (video) {
    video.pause();
  }
}

function openCustomStreamModal() {
  const modal = document.getElementById('custom-stream-modal');
  const input = document.getElementById('custom-stream-input');
  if (modal) {
    modal.classList.remove('hidden');
    if (input) {
      input.value = localStorage.getItem('nba_custom_stream_url') || '';
      input.focus();
    }
  }
}

function closeCustomStreamModal() {
  const modal = document.getElementById('custom-stream-modal');
  if (modal) modal.classList.add('hidden');
}

function initLiveTv() {
  // Update M3U URL input with current origin
  const m3uInput = document.getElementById('m3u-playlist-url');
  if (m3uInput) {
    m3uInput.value = `${window.location.origin}/nbatv.m3u`;
  }

  // Copy M3U Link button
  const copyBtn = document.getElementById('copy-m3u-btn');
  if (copyBtn && m3uInput) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(m3uInput.value).then(() => {
        const origText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.style.color = '#4ade80';
        setTimeout(() => {
          copyBtn.textContent = origText;
          copyBtn.style.color = '';
        }, 2000);
      }).catch(() => {
        m3uInput.select();
        document.execCommand('copy');
      });
    });
  }

  // Channel select dropdown
  const chanSelect = document.getElementById('channel-select');
  if (chanSelect) {
    chanSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        openCustomStreamModal();
      } else {
        loadLiveTvStream(val);
      }
    });
  }

  // Reload stream button
  const refreshBtn = document.getElementById('livetv-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadLiveTvStream(currentStreamSource);
    });
  }

  // Overlay retry button
  const retryBtn = document.getElementById('overlay-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      loadLiveTvStream(currentStreamSource);
    });
  }

  // Theater Mode button
  const theaterBtn = document.getElementById('theater-mode-btn');
  const playerWrapper = document.getElementById('livetv-player-wrapper');
  if (theaterBtn && playerWrapper) {
    theaterBtn.addEventListener('click', () => {
      playerWrapper.classList.toggle('theater-mode');
      theaterBtn.classList.toggle('active');
    });
  }

  // Fullscreen button
  const fsBtn = document.getElementById('fullscreen-btn');
  const video = document.getElementById('livetv-video');
  if (fsBtn && video) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        if (video.requestFullscreen) {
          video.requestFullscreen();
        } else if (video.webkitRequestFullscreen) {
          video.webkitRequestFullscreen();
        } else if (video.msRequestFullscreen) {
          video.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });
  }

  // Custom Stream Modal triggers
  const customModalBtn = document.getElementById('custom-stream-btn');
  if (customModalBtn) {
    customModalBtn.addEventListener('click', openCustomStreamModal);
  }

  const closeCustomBtn = document.getElementById('close-custom-modal');
  if (closeCustomBtn) {
    closeCustomBtn.addEventListener('click', closeCustomStreamModal);
  }

  const customBackdrop = document.querySelector('.custom-stream-backdrop');
  if (customBackdrop) {
    customBackdrop.addEventListener('click', closeCustomStreamModal);
  }

  // Apply custom stream button
  const applyCustomBtn = document.getElementById('apply-custom-stream');
  const customInput = document.getElementById('custom-stream-input');
  if (applyCustomBtn && customInput) {
    applyCustomBtn.addEventListener('click', () => {
      const url = customInput.value.trim();
      if (!url) return;
      localStorage.setItem('nba_custom_stream_url', url);
      closeCustomStreamModal();
      if (chanSelect) chanSelect.value = 'custom';
      loadLiveTvStream('custom');
    });
  }

  // Quick Presets in modal
  document.querySelectorAll('.preset-btn[data-url]').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (customInput) customInput.value = url;
    });
  });

  const resetPresetBtn = document.getElementById('reset-stream-btn');
  if (resetPresetBtn) {
    resetPresetBtn.addEventListener('click', () => {
      localStorage.removeItem('nba_custom_stream_url');
      if (customInput) customInput.value = '';
      closeCustomStreamModal();
      if (chanSelect) chanSelect.value = 'primary';
      loadLiveTvStream('primary');
    });
  }
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initGamesControls();
  initStandingsControls();
  initGameDetailListeners();
  initLiveTv();
  loadGames().then(startCountdown);
});
