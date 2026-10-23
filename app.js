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
  if (!team) return 'TBD';
  if (typeof team === 'string') return team;
  if (team.team && team.team.shortDisplayName) return team.team.shortDisplayName;
  if (team.team && team.team.displayName) return team.team.displayName;
  if (team.shortDisplayName) return team.shortDisplayName;
  if (team.displayName) return team.displayName;
  return 'TBD';
}

function getTeamAbbr(team) {
  if (!team) return '???';
  if (typeof team === 'string') return team;
  if (team.team && team.team.abbreviation) return team.team.abbreviation;
  if (team.abbreviation) return team.abbreviation;
  return '???';
}

function getTeamFullName(team) {
  if (!team) return 'TBD';
  if (typeof team === 'string') return team;
  if (team.team && team.team.displayName) return team.team.displayName;
  if (team.team && team.team.shortDisplayName) return team.team.shortDisplayName;
  if (team.displayName) return team.displayName;
  if (team.shortDisplayName) return team.shortDisplayName;
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

// ===== LIVE BROADCAST HLS STREAM CONFIGURATION =====

const LIVE_CHANNELS = {
  primary: {
    id: 'primary',
    name: 'NBA TV Philippines (Primary - 1080p)',
    url: 'http://23.237.104.106:8080/USA_NBA/index.m3u8',
    quality: '1080p 60FPS'
  },
  backup: {
    id: 'backup',
    name: 'NBA TV Server 2 (Direct Track)',
    url: 'http://23.237.104.106:8080/USA_NBA/tracks-v1a1/mono.m3u8',
    quality: '1080p Direct Track'
  },
  server3: {
    id: 'server3',
    name: 'NBA TV Server 3 (Live Feed)',
    url: 'http://198.58.104.90:8989/nba/index.m3u8',
    quality: '720p Direct Feed'
  }
};

function getEffectiveStreamUrl(rawUrl, referrer = '') {
  if (!rawUrl) return '';
  // Proxy all streams via /api/iptv-proxy to handle CORS headers, SSL mixed-content, and CDN referrer requirements
  let proxyUrl = `/api/iptv-proxy?url=${encodeURIComponent(rawUrl)}`;
  if (referrer) {
    proxyUrl += `&referrer=${encodeURIComponent(referrer)}`;
  }
  return proxyUrl;
}

// Format date nicely for YouTube search (e.g. "October 23, 2026")
function formatYouTubeDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) {
    const today = new Date();
    return today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Search bar keyword formula requested by user: "Team vs Team" + "Date Today"
// e.g. "Cleveland Cavaliers vs Philadelphia 76ers October 23, 2026"
// For preview games: append "Preview"
function getYouTubeSearchQuery(awayTeam, homeTeam, dateStr, isPreview = false) {
  const awayName = getTeamFullName(awayTeam);
  const homeName = getTeamFullName(homeTeam);
  const dateFormatted = formatYouTubeDate(dateStr);
  const baseQuery = `${awayName} vs ${homeName} ${dateFormatted}`;
  return isPreview ? `${baseQuery} Preview` : baseQuery;
}

function buildYouTubeLink(awayTeam, homeTeam, date, isPreview = false) {
  const query = getYouTubeSearchQuery(awayTeam, homeTeam, date, isPreview);
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

  if (isFinal) {
    const youtubeURL = buildYouTubeLink(away, home, event.date, false);
    statusBadgeHTML = `<div class="game-status-badge status-final">FINAL</div>`;
    actionBtnHTML = `
      <a href="${youtubeURL}" target="_blank" rel="noopener" class="card-action-btn btn-highlights" title="Watch full highlights on YouTube (${formatYouTubeDate(event.date)})">
        ▶ Highlights
      </a>
    `;
  } else if (isLive) {
    const detail = statusType.shortDetail || statusType.detail || 'LIVE';

    statusBadgeHTML = `
      <div class="game-status-badge status-live">
        <span class="live-dot-pulse"></span> ${detail}
      </div>
    `;
    actionBtnHTML = `
      <button type="button" class="card-action-btn btn-live card-watch-live-btn"
              data-event-id="${event.id}"
              title="Watch Live Game Broadcast">
        <span class="live-dot-pulse"></span> Watch Live
      </button>
    `;
  } else {
    // Scheduled (Upcoming)
    const gameTime = formatGameTime(event.date);
    const youtubePreviewURL = buildYouTubeLink(away, home, event.date, true);
    statusBadgeHTML = `<div class="game-status-badge status-scheduled">⏰ ${gameTime}</div>`;
    actionBtnHTML = `
      <a href="${youtubePreviewURL}" target="_blank" rel="noopener" class="card-action-btn btn-preview" title="Game Preview & Analysis on YouTube">
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
        destroyDetailGamePlayer();
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
  if (!boxScore || !boxScore.players || !boxScore.players[teamIndex]) return null;
  const teamData = boxScore.players[teamIndex];
  const stats = teamData.statistics && teamData.statistics[0];
  if (!stats) return null;
  return {
    team: teamData.team || {},
    labels: stats.labels || [],
    athletes: (stats.athletes || []).map(a => ({
      name: a.athlete ? (a.athlete.shortName || a.athlete.displayName || 'Unknown') : 'Unknown',
      fullName: a.athlete?.displayName || a.athlete?.fullName || 'Unknown',
      position: a.athlete ? (a.athlete.position?.abbreviation || '') : '',
      jersey: a.athlete?.jersey || '',
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

function renderPlayerStatsTable(playerData, teamName, teamColor, teamLogo) {
  if (!playerData || !playerData.athletes || playerData.athletes.length === 0) {
    return `<div class="detail-no-data">No player statistics recorded for this game.</div>`;
  }

  const labels = playerData.labels || [];
  const targetCols = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TO', '+/-'];
  const colIndices = targetCols.map(col => labels.indexOf(col)).filter(i => i >= 0);
  const colNames = colIndices.map(i => labels[i]);
  const ptsIdx = labels.indexOf('PTS');

  const starters = playerData.athletes.filter(a => a.starter && !a.didNotPlay);
  const bench = playerData.athletes.filter(a => !a.starter && !a.didNotPlay);
  const dnp = playerData.athletes.filter(a => a.didNotPlay);

  function renderRows(players) {
    return players.map(p => {
      const ptsVal = ptsIdx >= 0 ? parseInt(p.stats[ptsIdx]) || 0 : 0;
      const isHighScorer = ptsVal >= 20;
      const isEpicScorer = ptsVal >= 30;

      const statCells = colIndices.map(i => {
        const val = p.stats[i] || '-';
        const label = labels[i];
        const isPts = label === 'PTS';
        const cellClass = isPts ? (isEpicScorer ? 'stat-epic-pts' : (isHighScorer ? 'stat-high-pts' : 'stat-pts')) : '';
        return `<td class="${cellClass}">${val}</td>`;
      }).join('');

      const avatarHTML = p.headshot
        ? `<img src="${p.headshot}" class="player-table-avatar" alt="${p.name}" loading="lazy" onerror="this.style.display='none'" />`
        : `<span class="player-table-avatar-fallback">${p.name.charAt(0)}</span>`;

      return `
        <tr class="player-stat-row">
          <td class="player-name-cell">
            <div class="player-cell-content">
              ${avatarHTML}
              <div class="player-cell-meta">
                <span class="player-name ${isHighScorer ? 'highlight-player' : ''}">
                  ${p.fullName || p.name}
                  ${isEpicScorer ? '<span class="scorer-crown" title="30+ PTS Game">👑</span>' : ''}
                </span>
                <span class="player-sub">${p.jersey ? '#' + p.jersey : ''}${p.position ? (p.jersey ? ' • ' : '') + p.position : ''}</span>
              </div>
            </div>
          </td>
          ${statCells}
        </tr>
      `;
    }).join('');
  }

  let html = `
    <div class="detail-team-stats-block" data-team="${playerData.team?.abbreviation || ''}">
      <div class="detail-team-boxscore-header" style="border-left: 4px solid ${teamColor};">
        <div class="boxscore-header-left">
          ${teamLogo ? `<img src="${teamLogo}" class="boxscore-team-logo" alt="${teamName}" />` : ''}
          <span class="boxscore-team-title">${teamName}</span>
        </div>
        <span class="boxscore-count-badge">${playerData.athletes.length} Players</span>
      </div>
      <div class="detail-stats-table-wrap">
        <table class="detail-stats-table">
          <thead>
            <tr>
              <th class="player-name-col">Player</th>
              ${colNames.map(c => `<th class="${c === 'PTS' ? 'col-pts-header' : ''}">${c}</th>`).join('')}
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
      const avatarHTML = p.headshot
        ? `<img src="${p.headshot}" class="player-table-avatar" alt="${p.name}" loading="lazy" onerror="this.style.display='none'" />`
        : `<span class="player-table-avatar-fallback">${p.name.charAt(0)}</span>`;
      html += `
        <tr class="dnp-row">
          <td class="player-name-cell">
            <div class="player-cell-content">
              ${avatarHTML}
              <div class="player-cell-meta">
                <span class="player-name">${p.fullName || p.name}</span>
                <span class="player-sub">${p.jersey ? '#' + p.jersey : ''}${p.position ? ' ' + p.position : ''}</span>
              </div>
            </div>
          </td>
          <td colspan="${colNames.length}" class="dnp-reason">${p.reason || 'DNP — Coach\'s Decision'}</td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div></div>`;
  return html;
}

function renderTeamComparisonStats(boxScore, awayFullName, homeFullName, awayColor, homeColor, awayLogo, homeLogo) {
  if (!boxScore || !boxScore.teams || boxScore.teams.length < 2) {
    return `<div class="detail-no-data">Team comparison statistics will update as the game progresses.</div>`;
  }

  const team1 = boxScore.teams[0];
  const team2 = boxScore.teams[1];
  const stats1 = team1.statistics || [];
  const stats2 = team2.statistics || [];

  const keyStats = [
    { key: 'fieldGoalPct', label: 'Field Goal %', isPct: true, isLower: false },
    { key: 'threePointFieldGoalPct', label: '3-Point %', isPct: true, isLower: false },
    { key: 'freeThrowPct', label: 'Free Throw %', isPct: true, isLower: false },
    { key: 'totalRebounds', label: 'Total Rebounds', isPct: false, isLower: false },
    { key: 'offensiveRebounds', label: 'Offensive Reb', isPct: false, isLower: false },
    { key: 'defensiveRebounds', label: 'Defensive Reb', isPct: false, isLower: false },
    { key: 'assists', label: 'Assists', isPct: false, isLower: false },
    { key: 'steals', label: 'Steals', isPct: false, isLower: false },
    { key: 'blocks', label: 'Blocks', isPct: false, isLower: false },
    { key: 'turnovers', label: 'Turnovers', isPct: false, isLower: true },
    { key: 'pointsInPaint', label: 'Points in Paint', isPct: false, isLower: false },
    { key: 'fastBreakPoints', label: 'Fast Break Pts', isPct: false, isLower: false },
    { key: 'pointsOffTurnovers', label: 'Pts off Turnovers', isPct: false, isLower: false }
  ];

  let barsHTML = '';
  keyStats.forEach(item => {
    const s1 = stats1.find(s => s.name === item.key);
    const s2 = stats2.find(s => s.name === item.key);
    if (!s1 && !s2) return;

    const v1 = s1 ? (s1.displayValue || s1.value || '0') : '0';
    const v2 = s2 ? (s2.displayValue || s2.value || '0') : '0';
    const n1 = parseFloat(v1) || 0;
    const n2 = parseFloat(v2) || 0;

    const is1Better = item.isLower ? (n1 < n2) : (n1 > n2);
    const is2Better = item.isLower ? (n2 < n1) : (n2 > n1);

    const sum = (n1 + n2) || 1;
    const pct1 = Math.min(100, Math.max(12, Math.round((n1 / sum) * 100)));
    const pct2 = Math.min(100, Math.max(12, Math.round((n2 / sum) * 100)));

    barsHTML += `
      <div class="team-comp-row">
        <div class="comp-val comp-val-left ${is1Better ? 'better' : ''}">${v1}${item.isPct && !v1.includes('%') ? '%' : ''}</div>
        <div class="comp-bars-wrap">
          <div class="comp-bar-half left">
            <div class="comp-bar-fill left ${is1Better ? 'glow' : ''}" style="width: ${pct1}%; background: ${awayColor};"></div>
          </div>
          <div class="comp-label">${item.label}</div>
          <div class="comp-bar-half right">
            <div class="comp-bar-fill right ${is2Better ? 'glow' : ''}" style="width: ${pct2}%; background: ${homeColor};"></div>
          </div>
        </div>
        <div class="comp-val comp-val-right ${is2Better ? 'better' : ''}">${v2}${item.isPct && !v2.includes('%') ? '%' : ''}</div>
      </div>
    `;
  });

  return `
    <div class="detail-section detail-comp-section">
      <div class="team-comp-legend">
        <div class="comp-team-legend-item left">
          ${awayLogo ? `<img src="${awayLogo}" class="comp-legend-logo" alt="${awayFullName}" />` : ''}
          <span class="comp-legend-name">${awayFullName}</span>
        </div>
        <div class="comp-legend-center">HEAD-TO-HEAD STATS</div>
        <div class="comp-team-legend-item right">
          <span class="comp-legend-name">${homeFullName}</span>
          ${homeLogo ? `<img src="${homeLogo}" class="comp-legend-logo" alt="${homeFullName}" />` : ''}
        </div>
      </div>
      <div class="team-comp-bars-list">
        ${barsHTML}
      </div>
    </div>
  `;
}

function renderModalGameLeaders(leaders, awayAbbr, homeAbbr, awayColor, homeColor) {
  if (!leaders || leaders.length === 0) return '';

  const categories = [
    { key: 'points', label: 'Points Leader', icon: '🔥', statKey: 'PTS' },
    { key: 'rebounds', label: 'Rebounds Leader', icon: '💪', statKey: 'REB' },
    { key: 'assists', label: 'Assists Leader', icon: '🎯', statKey: 'AST' }
  ];

  let cardsHTML = '';

  categories.forEach(cat => {
    // Find leader for each team
    let awayLeader = null;
    let homeLeader = null;

    leaders.forEach(tl => {
      const isAwayTeam = tl.team?.abbreviation === awayAbbr;
      const cObj = (tl.leaders || []).find(c => c.name === cat.key);
      const lead = cObj?.leaders?.[0];
      if (lead) {
        if (isAwayTeam) awayLeader = { ...lead, team: tl.team };
        else homeLeader = { ...lead, team: tl.team };
      }
    });

    if (!awayLeader && !homeLeader) return;

    function renderLeaderSide(l, teamColor, alignRight = false) {
      if (!l) return '<div class="leader-player-side empty">—</div>';
      const a = l.athlete || {};
      const name = a.displayName || a.fullName || 'Player';
      const jersey = a.jersey ? `#${a.jersey}` : '';
      const pos = a.position?.abbreviation || '';
      const headshot = a.headshot?.href || '';
      const statVal = l.displayValue || l.value || '0';
      const summary = l.summary || '';

      const avatar = headshot
        ? `<img src="${headshot}" class="leader-headshot" alt="${name}" onerror="this.style.display='none'" />`
        : `<div class="leader-headshot-fallback">${name.charAt(0)}</div>`;

      return `
        <div class="leader-player-side ${alignRight ? 'align-right' : ''}">
          <div class="leader-avatar-wrap" style="border-color: ${teamColor};">
            ${avatar}
            <span class="leader-jersey-pill" style="background:${teamColor};">${jersey || pos || '★'}</span>
          </div>
          <div class="leader-meta">
            <span class="leader-name" title="${name}">${name}</span>
            <span class="leader-pos">${pos ? pos + ' • ' : ''}${l.team?.abbreviation || ''}</span>
            <div class="leader-stat-badge">
              <span class="leader-stat-num">${statVal}</span>
              <span class="leader-stat-label">${cat.statKey}</span>
            </div>
            ${summary ? `<span class="leader-summary-note" title="${summary}">${summary}</span>` : ''}
          </div>
        </div>
      `;
    }

    cardsHTML += `
      <div class="leader-duel-card">
        <div class="leader-card-header">
          <span class="leader-cat-icon">${cat.icon}</span>
          <span class="leader-cat-title">${cat.label}</span>
        </div>
        <div class="leader-duel-body">
          ${renderLeaderSide(awayLeader, awayColor, false)}
          <div class="leader-vs-divider">VS</div>
          ${renderLeaderSide(homeLeader, homeColor, true)}
        </div>
      </div>
    `;
  });

  if (!cardsHTML) return '';

  return `
    <div class="detail-section detail-leaders-section">
      <div class="detail-section-header">
        <h3 class="detail-section-title">⭐ Top Game Performers</h3>
        <span class="detail-section-badge">Head-to-Head Duel</span>
      </div>
      <div class="leader-duels-grid">
        ${cardsHTML}
      </div>
    </div>
  `;
}

function renderModalHighlightsBanner(awayFullName, homeFullName, eventDate) {
  // Strictly formatted: "Team vs Team" + "Date Today"
  const ytQuery = getYouTubeSearchQuery(awayFullName, homeFullName, eventDate, false);
  const ytHighlightsURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery)}`;
  const ytRecapURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery + ' Full Highlights Recap')}`;
  const ytPlaysURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery + ' Top Plays Dunks')}`;

  return `
    <div class="detail-highlights-banner">
      <div class="detail-yt-hero-card">
        <div class="yt-hero-glow"></div>
        <div class="yt-hero-header">
          <div class="yt-badge">
            <span class="yt-badge-icon">▶</span>
            <span class="yt-badge-text">OFFICIAL YOUTUBE HIGHLIGHTS</span>
          </div>
          <span class="yt-verified-pill">NBA Game Highlights</span>
        </div>

        <div class="yt-hero-body">
          <h4 class="yt-hero-title">${awayFullName} vs ${homeFullName} Highlights</h4>
          <p class="yt-hero-subtitle">Watch official game highlights, clutch plays, and full recap video directly on YouTube.</p>

          <div class="yt-cta-group">
            <a href="${ytHighlightsURL}" target="_blank" rel="noopener" class="detail-yt-primary-btn" title="Watch full highlights on YouTube">
              <span class="yt-play-triangle">▶</span> Watch Full Game Highlights on YouTube
            </a>
            <div class="yt-sub-actions">
              <a href="${ytRecapURL}" target="_blank" rel="noopener" class="detail-yt-secondary-btn" title="Watch 10-minute game recap">
                🎬 Game Recap
              </a>
              <a href="${ytPlaysURL}" target="_blank" rel="noopener" class="detail-yt-secondary-btn" title="Watch top plays & dunks">
                🔥 Top Plays
              </a>
            </div>
          </div>
        </div>

        <div class="yt-keyword-footer">
          <span class="yt-kw-label">🔍 YouTube Search Keyword:</span>
          <code class="yt-kw-code" id="modal-yt-keyword">${ytQuery}</code>
          <button type="button" class="btn-copy-keyword" data-copy="${ytQuery}" title="Copy search query to clipboard">
            📋 Copy Keyword
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderModalPreviewBanner(awayFullName, homeFullName, eventDate, summary) {
  // Strictly formatted: "Team vs Team" + "Date Today" + "Preview"
  const ytPreviewQuery = getYouTubeSearchQuery(awayFullName, homeFullName, eventDate, true);
  const ytPreviewURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytPreviewQuery)}`;
  const ytAnalysisURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(awayFullName + ' vs ' + homeFullName + ' Pregame Tactical Analysis')}`;
  const ytOddsURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(awayFullName + ' vs ' + homeFullName + ' Prediction and Betting Lines')}`;

  const gameTimePH = formatGameTime(eventDate);
  const predictor = summary?.predictor;
  let predictorHTML = '';

  if (predictor && predictor.homeTeam && predictor.awayTeam) {
    const homeProb = parseFloat(predictor.homeTeam.gameProjection) || 50;
    const awayProb = parseFloat(predictor.awayTeam.gameProjection) || 50;
    predictorHTML = `
      <div class="modal-predictor-card">
        <div class="predictor-header">
          <span class="predictor-title">🎯 ESPN Matchup Predictor</span>
          <span class="predictor-sub">Projected Win Probability</span>
        </div>
        <div class="predictor-bar-wrap">
          <div class="predictor-bar-half left" style="width: ${awayProb}%;">
            <span class="pred-text">${awayProb}%</span>
          </div>
          <div class="predictor-bar-half right" style="width: ${homeProb}%;">
            <span class="pred-text">${homeProb}%</span>
          </div>
        </div>
        <div class="predictor-teams-row">
          <span class="pred-team-name">${awayFullName}</span>
          <span class="pred-team-name">${homeFullName}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="detail-preview-banner">
      <div class="detail-preview-hero-card">
        <div class="preview-hero-glow"></div>
        <div class="preview-hero-header">
          <div class="preview-badge">
            <span class="preview-badge-icon">📅</span>
            <span class="preview-badge-text">UPCOMING MATCHUP PREVIEW</span>
          </div>
          <span class="preview-tipoff-pill">⏰ Tip-off: ${gameTimePH} (PH Time)</span>
        </div>

        <div class="preview-hero-body">
          <h4 class="preview-hero-title">${awayFullName} vs ${homeFullName} Matchup Preview</h4>
          <p class="preview-hero-subtitle">Game is scheduled and has not started yet. Explore pregame breakdowns, tactical scouting reports, and key predictions on YouTube.</p>

          ${predictorHTML}

          <div class="preview-cta-group">
            <a href="${ytPreviewURL}" target="_blank" rel="noopener" class="detail-preview-primary-btn" title="Watch pregame analysis & preview on YouTube">
              <span class="yt-play-triangle">▶</span> Watch Game Preview & Analysis on YouTube
            </a>
            <div class="yt-sub-actions">
              <a href="${ytAnalysisURL}" target="_blank" rel="noopener" class="detail-yt-secondary-btn" title="Pregame breakdown">
                🎙️ Tactical Breakdown
              </a>
              <a href="${ytOddsURL}" target="_blank" rel="noopener" class="detail-yt-secondary-btn" title="Matchup predictions">
                🎯 Predictions & Lines
              </a>
            </div>
          </div>
        </div>

        <div class="yt-keyword-footer preview-kw-footer">
          <span class="yt-kw-label">🔍 YouTube Search Keyword:</span>
          <code class="yt-kw-code" id="modal-yt-keyword">${ytPreviewQuery}</code>
          <button type="button" class="btn-copy-keyword" data-copy="${ytPreviewQuery}" title="Copy search query to clipboard">
            📋 Copy Keyword
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderModalLiveBanner(awayName, homeName, eventId, competition) {
  const broadcasts = competition?.broadcasts || [];
  const broadcastNames = broadcasts.flatMap(b => b.names || []).filter(Boolean);
  const broadcastDisplay = broadcastNames.length > 0 ? broadcastNames.join(', ') : 'NBA TV / League Pass';

  return `
    <div class="detail-section detail-stream-section">
      <div class="detail-stream-header">
        <div class="detail-stream-title-group">
          <span class="detail-stream-live-badge"><span class="live-dot-pulse"></span> LIVE BROADCAST</span>
          <span class="detail-broadcast-network" id="detail-broadcast-network">📺 ${broadcastDisplay}</span>
          <span class="detail-quality-tag" id="detail-quality-tag">Matching live feeds...</span>
        </div>
        <div class="detail-stream-controls-top">
          <div class="detail-stream-server-wrap">
            <div class="detail-server-header-row">
              <label class="detail-server-label">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>
                <span>Stream Source / Server:</span>
              </label>

              <!-- TV-Friendly Custom Dropdown Selector for Game Broadcast -->
              <div class="tv-custom-select-wrap modal-custom-select-wrap" id="detail-custom-select-wrap">
                <button type="button" class="tv-custom-select-trigger detail-select-trigger" id="detail-select-trigger" aria-haspopup="listbox" aria-expanded="false" tabindex="0">
                  <span class="tv-select-trigger-content">
                    <span class="tv-select-icon">📡</span>
                    <span class="tv-select-label" id="detail-select-label">Searching feeds...</span>
                  </span>
                  <span class="tv-select-chevron">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  </span>
                </button>
                <div class="tv-custom-dropdown-menu hidden" id="detail-dropdown-menu" role="listbox">
                  <div class="tv-dropdown-loading">Searching live streams from GitHub repo...</div>
                </div>
              </div>
            </div>

            <!-- Quick TV Server Switcher Pills (Instant 1-Click for TV Remotes) -->
            <div class="tv-server-pills-bar modal-pills-bar" id="detail-server-pills" role="radiogroup" aria-label="Game Stream Server">
              <div class="modal-pills-loading">Searching live streams from GitHub repo...</div>
            </div>

            <!-- Native select visually hidden via sr-only-select, kept synced for backwards compatibility -->
            <select id="detail-stream-server" class="detail-server-select sr-only-select" data-event-id="${eventId}" tabindex="-1" aria-hidden="true">
              <option value="">Searching live streams from GitHub repo...</option>
            </select>
          </div>
        </div>
      </div>

      <div class="detail-player-wrapper" id="detail-player-wrapper">
        <div class="detail-video-container">
          <video id="detail-game-video" class="detail-game-video" playsinline controls preload="auto"></video>
          <div id="detail-video-overlay" class="detail-video-overlay hidden">
            <div class="overlay-spinner"></div>
            <p id="detail-overlay-msg" class="overlay-message">Connecting to ${awayName} vs ${homeName} live broadcast feed...</p>
            <button id="detail-overlay-retry" class="tv-btn tv-btn-primary hidden">Retry Stream</button>
          </div>
        </div>
        <div class="detail-player-bottom-bar">
          <div class="detail-player-status">
            <span class="stream-status-pill online" id="detail-status-pill">
              <span class="status-dot"></span>
              <span id="detail-status-text">Connected</span>
            </span>
            <span class="detail-stream-desc" id="detail-stream-desc">doms9/iptv Live Events</span>
          </div>
          <div class="detail-player-actions">
            <button id="detail-fullscreen-btn" class="detail-action-btn" title="Fullscreen mode (Smart TV & Desktop)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
              <span>Fullscreen</span>
            </button>
            <button id="detail-copy-stream-btn" class="detail-action-btn" title="Copy direct .m3u8 stream link for VLC or Smart TV">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy .m3u8</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGameDetail(summary, eventId) {
  if (!summary) {
    return `<div class="detail-error">Failed to load game details. Please check your connection and try again.</div>`;
  }

  const header = summary.header;
  const boxScore = summary.boxscore;
  const gameInfo = summary.gameInfo;
  const leaders = summary.leaders || [];
  const article = summary.article;
  const seasonSeries = summary.seasonseries && summary.seasonseries.length > 0 ? summary.seasonseries[0] : null;

  // Get competitors from header
  const competition = header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};

  const awayTeam = away.team || {};
  const homeTeam = home.team || {};
  const awayLogo = awayTeam.logo || awayTeam.logos?.[0]?.href || getTeamLogo(away);
  const homeLogo = homeTeam.logo || homeTeam.logos?.[0]?.href || getTeamLogo(home);
  const awayName = awayTeam.shortDisplayName || awayTeam.displayName || 'Away';
  const homeName = homeTeam.shortDisplayName || homeTeam.displayName || 'Home';
  const awayFullName = awayTeam.displayName || awayName;
  const homeFullName = homeTeam.displayName || homeName;
  const awayAbbr = awayTeam.abbreviation || 'CLE';
  const homeAbbr = homeTeam.abbreviation || 'PHI';
  const awayScore = away.score || '—';
  const homeScore = home.score || '—';
  const awayRecord = away.record?.[0]?.displayValue || '';
  const homeRecord = home.record?.[0]?.displayValue || '';
  const awayColor = TEAM_COLORS[awayAbbr] || '#860038';
  const homeColor = TEAM_COLORS[homeAbbr] || '#006bb6';

  // Game status
  const gameState = header?.competitions?.[0]?.status?.type?.state || 'pre';
  const isLive = gameState === 'in';
  const isFinal = gameState === 'post';
  const isScheduled = gameState === 'pre';
  const statusDetail = header?.competitions?.[0]?.status?.type?.detail || '';
  const statusShort = header?.competitions?.[0]?.status?.type?.shortDetail || statusDetail || '';
  const eventDate = competition?.date || header?.date || new Date().toISOString();

  // Determine winner
  const numAwayScore = parseInt(awayScore) || 0;
  const numHomeScore = parseInt(homeScore) || 0;
  const awayWon = isFinal && numAwayScore > numHomeScore;
  const homeWon = isFinal && numHomeScore > numAwayScore;

  // Broadcaster
  const broadcasts = competition?.broadcasts || [];
  const broadcastNames = broadcasts.flatMap(b => b.names || []).filter(Boolean);
  const broadcastDisplay = broadcastNames.length > 0 ? broadcastNames.join(', ') : 'NBA TV / League Pass';

  // Season & Stage Note
  let seasonNote = 'NBA Regular Season';
  if (header?.season?.type === 1) seasonNote = 'Preseason';
  else if (header?.season?.type === 3) seasonNote = 'NBA Playoffs';
  if (competition?.notes && competition.notes.length > 0) {
    seasonNote = competition.notes[0].headline || seasonNote;
  }

  // Venue & Date Display
  const venue = gameInfo?.venue;
  const venueDisplay = venue ? `${venue.fullName || venue.shortName || 'NBA Arena'}${venue.address?.city ? ', ' + venue.address.city : ''}` : 'NBA Arena';
  const formattedGameDate = formatYouTubeDate(eventDate);

  // Scoreboard Header
  const scoreboardHTML = `
    <div class="detail-scoreboard" style="background: linear-gradient(135deg, ${awayColor}38 0%, #0a0f1d 50%, ${homeColor}38 100%);">
      <div class="detail-scoreboard-meta-bar">
        <div class="meta-bar-left">
          <span class="meta-badge broadcast">📺 ${broadcastDisplay}</span>
          <span class="meta-badge season">${seasonNote}</span>
          ${seasonSeries?.summary ? `<span class="meta-badge series">⚔️ ${seasonSeries.summary}</span>` : ''}
        </div>
        <div class="meta-bar-right">
          <span class="meta-badge venue" title="${venueDisplay}">📍 ${venueDisplay}</span>
          <span class="meta-badge date">📅 ${formattedGameDate}</span>
        </div>
      </div>

      <div class="detail-matchup-arena">
        <!-- Away Team -->
        <div class="detail-team-arena-card away ${awayWon ? 'is-winner' : ''}">
          <div class="detail-team-logo-wrap">
            <img src="${awayLogo}" class="detail-team-logo" alt="${awayAbbr}" />
            ${awayWon ? '<span class="detail-winner-trophy" title="Game Winner">🏆</span>' : ''}
          </div>
          <div class="detail-team-text">
            <span class="detail-team-full-name">${awayFullName}</span>
            <div class="detail-team-sub-row">
              <span class="detail-team-abbr-pill" style="border-color:${awayColor}; color:${awayColor};">${awayAbbr}</span>
              ${awayRecord ? `<span class="detail-record-pill">(${awayRecord})</span>` : ''}
              ${awayWon ? `<span class="detail-winner-text">WINNER</span>` : ''}
            </div>
          </div>
          <div class="detail-score-box ${awayWon ? 'winner-score' : ''}">
            ${awayScore}
          </div>
        </div>

        <!-- Center Status Node -->
        <div class="detail-status-center-node">
          ${isLive ? `
            <div class="detail-hub-live">
              <span class="live-dot-pulse"></span>
              <span class="hub-live-text">${statusShort || 'LIVE'}</span>
              <span class="hub-sub-note">In Progress</span>
            </div>
          ` : (isFinal ? `
            <div class="detail-hub-final">
              <span class="hub-final-tag">FINAL</span>
              <span class="hub-final-sub">${statusShort !== 'Final' ? statusShort : 'Official Score'}</span>
            </div>
          ` : `
            <div class="detail-hub-scheduled">
              <span class="hub-time-tag">⏰ ${formatGameTime(eventDate)}</span>
              <span class="hub-scheduled-sub">Philippine Time</span>
            </div>
          `)}
        </div>

        <!-- Home Team -->
        <div class="detail-team-arena-card home ${homeWon ? 'is-winner' : ''}">
          <div class="detail-score-box ${homeWon ? 'winner-score' : ''}">
            ${homeScore}
          </div>
          <div class="detail-team-text align-right">
            <span class="detail-team-full-name">${homeFullName}</span>
            <div class="detail-team-sub-row justify-end">
              ${homeWon ? `<span class="detail-winner-text">WINNER</span>` : ''}
              ${homeRecord ? `<span class="detail-record-pill">(${homeRecord})</span>` : ''}
              <span class="detail-team-abbr-pill" style="border-color:${homeColor}; color:${homeColor};">${homeAbbr}</span>
            </div>
          </div>
          <div class="detail-team-logo-wrap">
            <img src="${homeLogo}" class="detail-team-logo" alt="${homeAbbr}" />
            ${homeWon ? '<span class="detail-winner-trophy" title="Game Winner">🏆</span>' : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  // Quarter-by-Quarter Linescore Strip
  let linescoreHTML = '';
  const awayLineScores = away.linescores || [];
  const homeLineScores = home.linescores || [];

  if (awayLineScores.length > 0 || homeLineScores.length > 0) {
    const numPeriods = Math.max(awayLineScores.length, homeLineScores.length);
    let periodHeaders = '';
    let awayPeriodScores = '';
    let homePeriodScores = '';

    for (let i = 0; i < numPeriods; i++) {
      const label = i < 4 ? `Q${i + 1}` : (i === 4 ? 'OT' : `OT${i - 3}`);
      const aVal = awayLineScores[i]?.displayValue ?? awayLineScores[i]?.value ?? '-';
      const hVal = homeLineScores[i]?.displayValue ?? homeLineScores[i]?.value ?? '-';

      const numA = parseInt(aVal) || 0;
      const numH = parseInt(hVal) || 0;
      const aHi = numA > numH ? 'q-high' : '';
      const hHi = numH > numA ? 'q-high' : '';

      periodHeaders += `<th>${label}</th>`;
      awayPeriodScores += `<td class="${aHi}">${aVal}</td>`;
      homePeriodScores += `<td class="${hHi}">${hVal}</td>`;
    }

    linescoreHTML = `
      <div class="detail-linescore-wrapper">
        <table class="detail-linescore-table">
          <thead>
            <tr>
              <th class="col-team">TEAM</th>
              ${periodHeaders}
              <th class="col-total">T</th>
            </tr>
          </thead>
          <tbody>
            <tr class="${awayWon ? 'winner-row' : ''}">
              <td class="col-team-name">
                <img src="${awayLogo}" class="linescore-logo" alt="${awayAbbr}" />
                <span class="linescore-abbr">${awayAbbr}</span>
              </td>
              ${awayPeriodScores}
              <td class="col-total score-total">${awayScore}</td>
            </tr>
            <tr class="${homeWon ? 'winner-row' : ''}">
              <td class="col-team-name">
                <img src="${homeLogo}" class="linescore-logo" alt="${homeAbbr}" />
                <span class="linescore-abbr">${homeAbbr}</span>
              </td>
              ${homePeriodScores}
              <td class="col-total score-total">${homeScore}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // Smart Status Showcase (Finished Highlights vs Live Player vs Scheduled Preview)
  let statusBannerHTML = '';
  if (isLive) {
    statusBannerHTML = renderModalLiveBanner(awayName, homeName, eventId, competition);
  } else if (isFinal) {
    statusBannerHTML = renderModalHighlightsBanner(awayFullName, homeFullName, eventDate);
  } else {
    statusBannerHTML = renderModalPreviewBanner(awayFullName, homeFullName, eventDate, summary);
  }

  // Leaders Spotlight
  const leadersHTML = renderModalGameLeaders(leaders, awayAbbr, homeAbbr, awayColor, homeColor);

  // Full 13 Team Comparison Stats
  const teamComparisonHTML = (!isScheduled && boxScore)
    ? renderTeamComparisonStats(boxScore, awayFullName, homeFullName, awayColor, homeColor, awayLogo, homeLogo)
    : '';

  // Box Score Player Tables
  let playerStatsHTML = '';
  if (!isScheduled && boxScore && boxScore.players && boxScore.players.length >= 2) {
    const p0Team = boxScore.players[0]?.team?.displayName || '';
    const isP0Away = p0Team === awayFullName || boxScore.players[0]?.team?.abbreviation === awayAbbr;
    const awayIdx = isP0Away ? 0 : 1;
    const homeIdx = isP0Away ? 1 : 0;

    const awayPlayerData = getPlayerStats(boxScore, awayIdx);
    const homePlayerData = getPlayerStats(boxScore, homeIdx);

    playerStatsHTML = `
      <div class="boxscore-section-wrap">
        <div class="boxscore-toolbar">
          <div class="boxscore-team-filters">
            <button class="boxscore-team-pill active" data-team-filter="all">🏀 Both Teams</button>
            <button class="boxscore-team-pill" data-team-filter="${awayAbbr}">${awayAbbr}</button>
            <button class="boxscore-team-pill" data-team-filter="${homeAbbr}">${homeAbbr}</button>
          </div>
          <span class="boxscore-hint">💡 Highlights 20+ PTS in gold, 30+ PTS with 👑</span>
        </div>
        ${renderPlayerStatsTable(awayPlayerData, awayFullName, awayColor, awayLogo)}
        ${renderPlayerStatsTable(homePlayerData, homeFullName, homeColor, homeLogo)}
      </div>
    `;
  } else {
    playerStatsHTML = `<div class="detail-no-data">Player box score statistics will become available once the game gets underway.</div>`;
  }

  // Game Info & Story Article
  let gameStoryHTML = '';
  if (article && (article.headline || article.description)) {
    gameStoryHTML = `
      <div class="modal-story-card">
        <div class="story-badge">📰 ESPN GAME RECAP STORY</div>
        <h4 class="story-headline">${article.headline || 'Game Recap'}</h4>
        <p class="story-body">${article.description || ''}</p>
      </div>
    `;
  }

  let gameInfoGridHTML = '';
  if (gameInfo) {
    const venue = gameInfo.venue;
    const attendance = gameInfo.attendance;
    const officials = gameInfo.officials || [];
    let items = '';

    if (venue) {
      items += `
        <div class="game-info-cell">
          <span class="info-icon">🏟️</span>
          <div class="info-text">
            <span class="cell-label">Arena / Venue</span>
            <span class="cell-val">${venue.fullName || venue.shortName || 'N/A'}${venue.address?.city ? ', ' + venue.address.city : ''}</span>
          </div>
        </div>
      `;
    }
    if (attendance) {
      items += `
        <div class="game-info-cell">
          <span class="info-icon">👥</span>
          <div class="info-text">
            <span class="cell-label">Official Attendance</span>
            <span class="cell-val">${Number(attendance).toLocaleString()} fans</span>
          </div>
        </div>
      `;
    }
    if (seasonSeries?.summary) {
      items += `
        <div class="game-info-cell">
          <span class="info-icon">⚔️</span>
          <div class="info-text">
            <span class="cell-label">Season Series</span>
            <span class="cell-val">${seasonSeries.summary}</span>
          </div>
        </div>
      `;
    }
    if (officials.length > 0) {
      const offNames = officials.map(o => o.displayName || o.fullName || '').filter(Boolean).join(', ');
      if (offNames) {
        items += `
          <div class="game-info-cell col-span-2">
            <span class="info-icon">⚖️</span>
            <div class="info-text">
              <span class="cell-label">Game Referees / Officials</span>
              <span class="cell-val">${offNames}</span>
            </div>
          </div>
        `;
      }
    }
    if (items) {
      gameInfoGridHTML = `
        <div class="modal-info-grid">
          ${items}
        </div>
      `;
    }
  }

  // Overview Tab Composite
  const overviewStorySnippet = article?.headline ? `
    <div class="overview-story-teaser">
      <div class="teaser-icon">📰</div>
      <div class="teaser-content">
        <span class="teaser-title">${article.headline}</span>
        <button type="button" class="btn-jump-story">Read Story & Details →</button>
      </div>
    </div>
  ` : '';

  // Segmented Modal Navigation Bar
  const navTabsHTML = `
    <div class="modal-tabs-bar">
      <button class="modal-tab-btn active" data-modal-tab="overview">
        <span class="tab-icon">⚡</span> Overview
      </button>
      <button class="modal-tab-btn" data-modal-tab="boxscore">
        <span class="tab-icon">📊</span> Box Score
      </button>
      <button class="modal-tab-btn" data-modal-tab="teamstats">
        <span class="tab-icon">📈</span> Team Comparison
      </button>
      <button class="modal-tab-btn" data-modal-tab="gameinfo">
        <span class="tab-icon">ℹ️</span> Game Info & Story
      </button>
    </div>
  `;

  return `
    <div class="modal-broadcast-shell">
      ${scoreboardHTML}
      ${linescoreHTML}
      ${statusBannerHTML}
      ${navTabsHTML}

      <div class="modal-tab-panes-wrap">
        <!-- Pane 1: Overview -->
        <div class="modal-tab-pane active" id="modal-pane-overview">
          ${overviewStorySnippet}
          ${leadersHTML}
          ${teamComparisonHTML}
        </div>

        <!-- Pane 2: Box Score -->
        <div class="modal-tab-pane" id="modal-pane-boxscore">
          ${playerStatsHTML}
        </div>

        <!-- Pane 3: Team Comparison -->
        <div class="modal-tab-pane" id="modal-pane-teamstats">
          ${teamComparisonHTML || '<div class="detail-no-data">Team stats comparison will update once the game starts.</div>'}
        </div>

        <!-- Pane 4: Game Info & Story -->
        <div class="modal-tab-pane" id="modal-pane-gameinfo">
          ${gameStoryHTML}
          ${gameInfoGridHTML}
        </div>
      </div>
    </div>
  `;
}

function initModalInteractions(modalContent, summary, eventId) {
  if (!modalContent) return;

  // 1. Modal tab navigation
  const tabBtns = modalContent.querySelectorAll('.modal-tab-btn');
  const tabPanes = modalContent.querySelectorAll('.modal-tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-modal-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = modalContent.querySelector(`#modal-pane-${target}`);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // 2. Boxscore team filter pills
  const boxscorePills = modalContent.querySelectorAll('.boxscore-team-pill');
  boxscorePills.forEach(pill => {
    pill.addEventListener('click', () => {
      boxscorePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const teamFilter = pill.getAttribute('data-team-filter');
      const blocks = modalContent.querySelectorAll('.detail-team-stats-block');

      blocks.forEach(block => {
        const teamKey = block.getAttribute('data-team');
        if (teamFilter === 'all' || teamFilter === teamKey) {
          block.style.display = 'block';
        } else {
          block.style.display = 'none';
        }
      });
    });
  });

  // 3. Copy search keyword buttons
  modalContent.querySelectorAll('.btn-copy-keyword').forEach(copyBtn => {
    copyBtn.addEventListener('click', async () => {
      const textToCopy = copyBtn.getAttribute('data-copy') || '';
      if (!textToCopy) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.warn('Failed to copy keyword:', err);
      }
    });
  });

  // 4. Read Full Recap jumper
  const readRecapBtn = modalContent.querySelector('.btn-jump-story');
  if (readRecapBtn) {
    readRecapBtn.addEventListener('click', () => {
      const infoTabBtn = modalContent.querySelector('.modal-tab-btn[data-modal-tab="gameinfo"]');
      if (infoTabBtn) infoTabBtn.click();
    });
  }
}

function openGameDetail(eventId, autoPlayStream = false) {
  const modal = document.getElementById('game-detail-modal');
  const panel = modal?.querySelector('.game-detail-panel');
  const content = document.getElementById('game-detail-content');
  if (panel) panel.scrollTop = 0;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  content.innerHTML = '<div class="loading">Loading game details...</div>';

  fetchGameSummary(eventId).then(summary => {
    content.innerHTML = renderGameDetail(summary, eventId);
    initModalInteractions(content, summary, eventId);
    if (panel) panel.scrollTop = 0;

    const isLive = summary?.header?.competitions?.[0]?.status?.type?.state === 'in';
    if (isLive) {
      initDetailGamePlayer(eventId, autoPlayStream, summary);
    }
  });
}

function closeGameDetail() {
  const modal = document.getElementById('game-detail-modal');
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  destroyDetailGamePlayer();
}

// ===== IN-MODAL LIVE GAME STREAM CONTROLLER (DOMS9/IPTV REPO) =====

let detailGameHls = null;
let detailActiveServers = [];
let currentDetailServerObj = null;

function destroyDetailGamePlayer() {
  if (detailGameHls) {
    try {
      detailGameHls.stopLoad();
      detailGameHls.detachMedia();
      detailGameHls.destroy();
    } catch (e) {}
    detailGameHls = null;
  }
  const video = document.getElementById('detail-game-video');
  if (video) {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.style.display = 'none';
    } catch (e) {}
  }
  currentDetailServerObj = null;
  detailActiveServers = [];
}

function updateDetailStreamStatus(status, text) {
  const pill = document.getElementById('detail-status-pill');
  const textEl = document.getElementById('detail-status-text');
  if (pill) pill.className = `stream-status-pill ${status}`;
  if (textEl) textEl.textContent = text;
}

function showDetailOverlay(msg, showRetry = false) {
  const overlay = document.getElementById('detail-video-overlay');
  const msgEl = document.getElementById('detail-overlay-msg');
  const retryBtn = document.getElementById('detail-overlay-retry');
  const spinner = overlay?.querySelector('.overlay-spinner');

  if (overlay && msgEl) {
    overlay.classList.remove('hidden');
    msgEl.textContent = msg;
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

function hideDetailOverlay() {
  const overlay = document.getElementById('detail-video-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function loadDetailGameStream(serverObj, autoPlay = true) {
  if (!serverObj || !serverObj.url) return;
  currentDetailServerObj = serverObj;

  const video = document.getElementById('detail-game-video');
  if (!video) return;
  video.style.display = '';

  const streamUrl = serverObj.url;
  const streamReferrer = serverObj.referrer || '';
  const serverName = serverObj.name || 'Live Game Feed';

  const descEl = document.getElementById('detail-stream-desc');
  if (descEl) descEl.textContent = `${serverName} • HLS Live`;

  showDetailOverlay(`Connecting to ${serverName}...`);
  updateDetailStreamStatus('buffering', 'Connecting...');

  if (detailGameHls) {
    detailGameHls.destroy();
    detailGameHls = null;
  }

  // Pause 24/7 NBA TV live player so bandwidth/audio doesn't conflict
  pauseLiveTV();

  const effectiveUrl = getEffectiveStreamUrl(streamUrl, streamReferrer);

  if (window.Hls && Hls.isSupported()) {
    detailGameHls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      manifestLoadingTimeOut: 12000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 12000
    });

    detailGameHls.loadSource(effectiveUrl);
    detailGameHls.attachMedia(video);

    detailGameHls.on(Hls.Events.MANIFEST_PARSED, () => {
      hideDetailOverlay();
      updateDetailStreamStatus('online', 'Live');
      if (autoPlay) {
        const modal = document.getElementById('game-detail-modal');
        const panel = modal?.querySelector('.game-detail-panel');
        video.play().catch(() => {});
        if (panel && panel.scrollTop < 60) {
          panel.scrollTop = 0;
          requestAnimationFrame(() => { if (panel) panel.scrollTop = 0; });
        }
      }
    });

    detailGameHls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('Game modal HLS error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            updateDetailStreamStatus('error', 'Offline / Retry');
            showDetailOverlay('Stream connection lost. Please retry or switch to another server above.', true);
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            detailGameHls.recoverMediaError();
            break;
          default:
            detailGameHls.destroy();
            updateDetailStreamStatus('error', 'Error');
            showDetailOverlay('Unable to play this feed. Please choose another server above.', true);
            break;
        }
      }
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari, iOS, TV browsers)
    video.src = effectiveUrl;
    video.addEventListener('loadedmetadata', () => {
      hideDetailOverlay();
      updateDetailStreamStatus('online', 'Live');
      if (autoPlay) {
        const modal = document.getElementById('game-detail-modal');
        const panel = modal?.querySelector('.game-detail-panel');
        video.play().catch(() => {});
        if (panel && panel.scrollTop < 60) {
          panel.scrollTop = 0;
          requestAnimationFrame(() => { if (panel) panel.scrollTop = 0; });
        }
      }
    }, { once: true });

    video.onerror = () => {
      updateDetailStreamStatus('error', 'Error');
      showDetailOverlay('Playback error. Please retry or switch server.', true);
    };
  } else {
    updateDetailStreamStatus('error', 'Unsupported');
    showDetailOverlay('HLS streaming is not supported on this browser.', false);
  }
}

// ===== TV-FRIENDLY SERVER SELECTOR FOR GAME MODAL =====
function setupDetailTvServerControls(eventId, servers, initialServerId) {
  const pillsContainer = document.getElementById('detail-server-pills');
  const dropdownMenu = document.getElementById('detail-dropdown-menu');
  const triggerBtn = document.getElementById('detail-select-trigger');
  const triggerLabel = document.getElementById('detail-select-label');
  const serverSelect = document.getElementById('detail-stream-server');

  let currentActiveId = initialServerId || (servers.length > 0 ? servers[0].id : 'custom');

  function updateDetailActiveUI(selectedId) {
    currentActiveId = selectedId;

    // 1. Update quick TV pills
    if (pillsContainer) {
      pillsContainer.querySelectorAll('.tv-server-pill').forEach(pill => {
        const sid = pill.getAttribute('data-server-id');
        pill.classList.toggle('active', sid === selectedId);
      });
    }

    // 2. Update custom dropdown items
    if (dropdownMenu) {
      dropdownMenu.querySelectorAll('.tv-dropdown-item').forEach(item => {
        const val = item.getAttribute('data-value');
        item.classList.toggle('active', val === selectedId);
      });
    }

    // 3. Update trigger button label
    if (triggerLabel) {
      if (selectedId === 'custom') {
        triggerLabel.textContent = '⚙ Custom Stream URL';
      } else {
        const found = servers.find(s => s.id === selectedId);
        triggerLabel.textContent = found ? found.name : 'Choose Feed';
      }
    }

    // 4. Update hidden native select
    if (serverSelect) {
      serverSelect.value = selectedId;
    }
  }

  function handleServerSelection(targetId) {
    updateDetailActiveUI(targetId);
    if (dropdownMenu) {
      dropdownMenu.classList.add('hidden');
      if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'false');
    }

    if (targetId === 'custom') {
      const savedCustom = localStorage.getItem('nba_custom_stream_url') || '';
      const inputUrl = prompt('Enter custom HLS (.m3u8) live stream URL:', savedCustom);
      if (inputUrl && inputUrl.trim()) {
        const customUrl = inputUrl.trim();
        localStorage.setItem('nba_custom_stream_url', customUrl);
        const customServer = {
          id: 'custom',
          name: 'Custom Stream URL',
          url: customUrl,
          referrer: '',
          quality: 'Custom'
        };
        loadDetailGameStream(customServer, true);
      } else {
        if (currentDetailServerObj) {
          updateDetailActiveUI(currentDetailServerObj.id);
        }
      }
      return;
    }

    const chosen = servers.find(s => s.id === targetId);
    if (chosen) {
      localStorage.setItem(`nba_game_server_${eventId}`, chosen.id);
      loadDetailGameStream(chosen, true);
    }
  }

  // Populate TV quick pills
  if (pillsContainer) {
    if (servers.length > 0) {
      let pillsHTML = servers.map(s => `
        <button type="button" class="tv-server-pill ${s.id === currentActiveId ? 'active' : ''}" data-server-id="${s.id}" tabindex="0" title="${s.name}">
          <span class="server-pill-status"></span>
          <span class="server-pill-name">${s.name}</span>
          <span class="server-pill-badge">${s.quality || 'HD'}</span>
        </button>
      `).join('');
      pillsHTML += `
        <button type="button" class="tv-server-pill custom-pill ${currentActiveId === 'custom' ? 'active' : ''}" data-server-id="custom" tabindex="0" title="Custom M3U8 Stream URL">
          <span class="server-pill-icon">⚙️</span>
          <span class="server-pill-name">Custom URL</span>
        </button>
      `;
      pillsContainer.innerHTML = pillsHTML;
    } else {
      pillsContainer.innerHTML = `
        <div class="modal-pills-empty">
          <span class="empty-feed-hint">No active feeds in catalog</span>
          <button type="button" class="tv-server-pill custom-pill active" data-server-id="custom" tabindex="0">
            <span class="server-pill-icon">⚙️</span>
            <span class="server-pill-name">Enter Custom URL</span>
          </button>
        </div>
      `;
    }

    // Attach pill clicks
    pillsContainer.querySelectorAll('.tv-server-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        const sid = pill.getAttribute('data-server-id');
        handleServerSelection(sid);
      });
    });
  }

  // Populate custom TV dropdown menu
  if (dropdownMenu) {
    if (servers.length > 0) {
      let menuHTML = servers.map(s => `
        <button type="button" class="tv-dropdown-item ${s.id === currentActiveId ? 'active' : ''}" data-value="${s.id}" tabindex="0">
          <span class="dropdown-item-info">
            <span class="dropdown-item-title">${s.name}</span>
            <span class="dropdown-item-desc">${s.quality || 'Live Broadcast Feed'} • GitHub IPTV</span>
          </span>
          <span class="dropdown-item-check">✓</span>
        </button>
      `).join('');
      menuHTML += `
        <button type="button" class="tv-dropdown-item custom-opt ${currentActiveId === 'custom' ? 'active' : ''}" data-value="custom" tabindex="0">
          <span class="dropdown-item-info">
            <span class="dropdown-item-title">⚙️ Custom .m3u8 Stream URL...</span>
            <span class="dropdown-item-desc">Enter any direct HLS stream URL</span>
          </span>
          <span class="dropdown-item-check">✓</span>
        </button>
      `;
      dropdownMenu.innerHTML = menuHTML;
    } else {
      dropdownMenu.innerHTML = `
        <button type="button" class="tv-dropdown-item custom-opt active" data-value="custom" tabindex="0">
          <span class="dropdown-item-info">
            <span class="dropdown-item-title">⚙️ Custom .m3u8 Stream URL...</span>
            <span class="dropdown-item-desc">Enter your own live stream link</span>
          </span>
          <span class="dropdown-item-check">✓</span>
        </button>
      `;
    }

    // Attach dropdown item clicks
    dropdownMenu.querySelectorAll('.tv-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const sid = item.getAttribute('data-value');
        handleServerSelection(sid);
      });
    });
  }

  // Toggle trigger button
  if (triggerBtn && dropdownMenu) {
    triggerBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isHidden = dropdownMenu.classList.contains('hidden');
      document.querySelectorAll('.tv-custom-dropdown-menu').forEach(m => m.classList.add('hidden'));
      if (isHidden) {
        dropdownMenu.classList.remove('hidden');
        triggerBtn.setAttribute('aria-expanded', 'true');
        const activeOpt = dropdownMenu.querySelector('.tv-dropdown-item.active') || dropdownMenu.querySelector('.tv-dropdown-item');
        if (activeOpt) activeOpt.focus();
      } else {
        dropdownMenu.classList.add('hidden');
        triggerBtn.setAttribute('aria-expanded', 'false');
      }
    };
  }

  // Update initial label & selection state
  updateDetailActiveUI(currentActiveId);
}

function initDetailGamePlayer(eventId, autoPlay = true, summary = null) {
  const video = document.getElementById('detail-game-video');
  if (!video) return;

  const serverSelect = document.getElementById('detail-stream-server');
  const retryBtn = document.getElementById('detail-overlay-retry');
  const fullscreenBtn = document.getElementById('detail-fullscreen-btn');
  const copyBtn = document.getElementById('detail-copy-stream-btn');
  const qualityTag = document.getElementById('detail-quality-tag');

  // Extract team names and abbreviations from summary
  const competition = summary?.header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const awayTeam = away.team || {};
  const homeTeam = home.team || {};
  const awayFullName = awayTeam.displayName || awayTeam.shortDisplayName || '';
  const homeFullName = homeTeam.displayName || homeTeam.shortDisplayName || '';
  const awayAbbr = awayTeam.abbreviation || '';
  const homeAbbr = homeTeam.abbreviation || '';
  const broadcastNames = (competition?.broadcasts || []).flatMap(b => b.names || []).filter(Boolean);
  const broadcastDisplay = broadcastNames.length > 0 ? broadcastNames.join(', ') : '';

  const queryParams = new URLSearchParams({
    eventId: eventId || '',
    away: awayFullName,
    home: homeFullName,
    awayAbbr: awayAbbr,
    homeAbbr: homeAbbr,
    broadcast: broadcastDisplay
  });

  if (qualityTag) qualityTag.textContent = 'Searching feeds...';
  if (serverSelect) {
    serverSelect.innerHTML = '<option value="">Searching live streams from GitHub repo...</option>';
    serverSelect.disabled = true;
  }

  fetch(`/api/game-stream?${queryParams.toString()}`)
    .then(res => res.json())
    .then(data => {
      detailActiveServers = data.activeServers || [];
      if (serverSelect) serverSelect.disabled = false;

      if (detailActiveServers.length > 0) {
        if (qualityTag) {
          qualityTag.textContent = `${detailActiveServers.length} Live Feeds`;
        }

        // Render options for each matched stream from doms9/iptv repo
        let optionsHTML = detailActiveServers.map(s => 
          `<option value="${s.id}">${s.name}</option>`
        ).join('');
        optionsHTML += `<option value="custom">⚙ Custom .m3u8 Stream...</option>`;
        if (serverSelect) serverSelect.innerHTML = optionsHTML;

        // Restore saved server or default to first server
        const savedServerId = localStorage.getItem(`nba_game_server_${eventId}`);
        let targetServer = detailActiveServers.find(s => s.id === savedServerId) || detailActiveServers[0];

        if (serverSelect) serverSelect.value = targetServer.id;
        setupDetailTvServerControls(eventId, detailActiveServers, targetServer.id);
        loadDetailGameStream(targetServer, autoPlay);

      } else {
        // No matches found in repo
        if (qualityTag) qualityTag.textContent = 'No Feeds Found';
        if (serverSelect) {
          serverSelect.innerHTML = `
            <option value="">No live game feed in directory</option>
            <option value="custom">⚙ Custom .m3u8 Stream...</option>
          `;
        }
        setupDetailTvServerControls(eventId, [], 'custom');
        showDetailOverlay('No active live streams found for this game in the repository yet. You can use Custom .m3u8 Stream or check back closer to game time.', true);
        updateDetailStreamStatus('error', 'No Stream');
      }
    })
    .catch(err => {
      console.error('Failed to load game streams:', err);
      if (qualityTag) qualityTag.textContent = 'Error loading feeds';
      if (serverSelect) {
        serverSelect.disabled = false;
        serverSelect.innerHTML = '<option value="custom">⚙ Custom .m3u8 Stream...</option>';
      }
      setupDetailTvServerControls(eventId, [], 'custom');
      showDetailOverlay('Failed to connect to stream catalog. You can enter a custom .m3u8 URL.', true);
      updateDetailStreamStatus('error', 'Error');
    });

  // Server selection dropdown handler (fallback sync)
  if (serverSelect) {
    serverSelect.onchange = (e) => {
      const val = e.target.value;
      setupDetailTvServerControls(eventId, detailActiveServers, val);
      if (val === 'custom') {
        const savedCustom = localStorage.getItem('nba_custom_stream_url') || '';
        const inputUrl = prompt('Enter custom HLS (.m3u8) live stream URL:', savedCustom);
        if (inputUrl && inputUrl.trim()) {
          const customUrl = inputUrl.trim();
          localStorage.setItem('nba_custom_stream_url', customUrl);
          const customServer = {
            id: 'custom',
            name: 'Custom Stream URL',
            url: customUrl,
            referrer: '',
            quality: 'Custom'
          };
          loadDetailGameStream(customServer, true);
        } else {
          if (currentDetailServerObj) {
            serverSelect.value = currentDetailServerObj.id;
          }
        }
        return;
      }

      const chosen = detailActiveServers.find(s => s.id === val);
      if (chosen) {
        localStorage.setItem(`nba_game_server_${eventId}`, chosen.id);
        loadDetailGameStream(chosen, true);
      }
    };
  }

  // Retry button
  if (retryBtn) {
    retryBtn.onclick = () => {
      if (currentDetailServerObj) {
        loadDetailGameStream(currentDetailServerObj, true);
      } else if (detailActiveServers.length > 0) {
        loadDetailGameStream(detailActiveServers[0], true);
      }
    };
  }

  // Fullscreen button
  if (fullscreenBtn) {
    fullscreenBtn.onclick = () => {
      if (!document.fullscreenElement) {
        if (video.requestFullscreen) video.requestFullscreen();
        else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
        else if (video.msRequestFullscreen) video.msRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    };
  }

  // Copy .m3u8 Link button
  if (copyBtn) {
    copyBtn.onclick = () => {
      if (!currentDetailServerObj) return;
      const proxyUrl = getEffectiveStreamUrl(currentDetailServerObj.url, currentDetailServerObj.referrer || '');
      const fullCopyUrl = `${window.location.origin}${proxyUrl}`;
      navigator.clipboard.writeText(fullCopyUrl).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied Link!';
        copyBtn.style.color = '#4ade80';
        setTimeout(() => {
          copyBtn.textContent = orig;
          copyBtn.style.color = '';
        }, 2000);
      }).catch(() => {
        prompt('Copy stream URL:', fullCopyUrl);
      });
    };
  }

  // Video and scoreboard fit cleanly within the viewport
}

function initGameDetailListeners() {
  // Close modal
  document.querySelector('.game-detail-close').addEventListener('click', closeGameDetail);
  document.querySelector('.game-detail-backdrop').addEventListener('click', closeGameDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.keyCode === 27 || e.keyCode === 10009 || e.keyCode === 461 || e.key === 'BrowserBack') {
      closeGameDetail();
    }
  });

  // Click delegation
  document.addEventListener('click', (e) => {
    // 1. Direct Watch Live button on game card
    const liveBtn = e.target.closest('.card-watch-live-btn');
    if (liveBtn) {
      e.preventDefault();
      e.stopPropagation();
      const eventId = liveBtn.getAttribute('data-event-id');
      if (eventId) openGameDetail(eventId, true);
      return;
    }

    // 2. Box score button on game card
    const boxScoreBtn = e.target.closest('.card-btn-stats') || e.target.closest('.btn-boxscore');
    if (boxScoreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const eventId = boxScoreBtn.getAttribute('data-event-id') || boxScoreBtn.closest('.game-card[data-event-id]')?.getAttribute('data-event-id');
      if (eventId) openGameDetail(eventId, false);
      return;
    }

    // 3. Whole game card click
    const card = e.target.closest('.game-card[data-event-id]');
    if (!card) return;
    // Don't trigger if clicking an external link (like YouTube preview or highlights)
    if (e.target.closest('a')) return;
    const eventId = card.getAttribute('data-event-id');
    if (eventId) openGameDetail(eventId, false);
  });
}

// ===== LIVE TV (IPTV / M3U) STREAM CONTROLLER =====

let liveTvHls = null;
let currentStreamSource = 'primary'; // 'primary', 'backup', 'server3', 'custom'

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
  video.style.display = '';
  loadLiveTvStream(currentStreamSource);
}

function pauseLiveTV() {
  const video = document.getElementById('livetv-video');
  if (liveTvHls) {
    try {
      liveTvHls.stopLoad();
      liveTvHls.detachMedia();
      liveTvHls.destroy();
    } catch (e) {}
    liveTvHls = null;
  }
  if (video) {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.style.display = 'none';
    } catch (e) {}
  }
  updateStreamStatus('offline', 'Paused');
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

  // TV-Friendly Server Selector & Controls for Live TV
  setupLiveTvServerControls();

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
  const chanSelect = document.getElementById('channel-select');
  if (applyCustomBtn && customInput) {
    applyCustomBtn.addEventListener('click', () => {
      const url = customInput.value.trim();
      if (!url) return;
      localStorage.setItem('nba_custom_stream_url', url);
      closeCustomStreamModal();
      if (chanSelect) chanSelect.value = 'custom';
      // Sync TV pills and trigger label
      syncLiveTvActiveUI('custom');
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
      syncLiveTvActiveUI('primary');
      loadLiveTvStream('primary');
    });
  }
}

// ===== TV-FRIENDLY SERVER SELECTOR FOR LIVE TV (NBA TV PHILIPPINES) =====

function syncLiveTvActiveUI(val) {
  const triggerLabel = document.getElementById('channel-select-label');
  const pillsContainer = document.getElementById('livetv-server-pills');
  const dropdownMenu = document.getElementById('channel-dropdown-menu');
  const chanSelect = document.getElementById('channel-select');

  // 1. Update quick pills
  if (pillsContainer) {
    pillsContainer.querySelectorAll('.tv-server-pill').forEach(pill => {
      const pServer = pill.getAttribute('data-server');
      pill.classList.toggle('active', pServer === val);
    });
  }

  // 2. Update custom dropdown items
  if (dropdownMenu) {
    dropdownMenu.querySelectorAll('.tv-dropdown-item').forEach(item => {
      const itemVal = item.getAttribute('data-value');
      item.classList.toggle('active', itemVal === val);
    });
  }

  // 3. Update trigger label
  if (triggerLabel) {
    if (val === 'primary') {
      triggerLabel.textContent = 'NBA TV Philippines (Primary - 1080p)';
    } else if (val === 'backup') {
      triggerLabel.textContent = 'NBA TV Server 2 (Backup HD)';
    } else if (val === 'server3') {
      triggerLabel.textContent = 'NBA TV Server 3 (Live Feed)';
    } else if (val === 'custom') {
      triggerLabel.textContent = 'Custom M3U8 Stream URL';
    }
  }

  // 4. Update hidden select
  if (chanSelect && chanSelect.value !== val) {
    chanSelect.value = val;
  }
}

function setupLiveTvServerControls() {
  const chanSelect = document.getElementById('channel-select');
  const triggerBtn = document.getElementById('channel-select-trigger');
  const dropdownMenu = document.getElementById('channel-dropdown-menu');
  const pillsContainer = document.getElementById('livetv-server-pills');

  // Handle pill clicks (instant 1-click on TV remote)
  if (pillsContainer) {
    pillsContainer.querySelectorAll('.tv-server-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        const serverKey = pill.getAttribute('data-server');
        syncLiveTvActiveUI(serverKey);
        if (dropdownMenu) dropdownMenu.classList.add('hidden');
        if (serverKey === 'custom') {
          openCustomStreamModal();
        } else {
          loadLiveTvStream(serverKey);
        }
      });
    });
  }

  // Handle custom dropdown trigger toggle
  if (triggerBtn && dropdownMenu) {
    triggerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isHidden = dropdownMenu.classList.contains('hidden');
      document.querySelectorAll('.tv-custom-dropdown-menu').forEach(m => m.classList.add('hidden'));
      if (isHidden) {
        dropdownMenu.classList.remove('hidden');
        triggerBtn.setAttribute('aria-expanded', 'true');
        const activeOpt = dropdownMenu.querySelector('.tv-dropdown-item.active') || dropdownMenu.querySelector('.tv-dropdown-item');
        if (activeOpt) activeOpt.focus();
      } else {
        dropdownMenu.classList.add('hidden');
        triggerBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Handle dropdown option clicks
    dropdownMenu.querySelectorAll('.tv-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const val = item.getAttribute('data-value');
        syncLiveTvActiveUI(val);
        dropdownMenu.classList.add('hidden');
        triggerBtn.setAttribute('aria-expanded', 'false');
        triggerBtn.focus();
        if (val === 'custom') {
          openCustomStreamModal();
        } else {
          loadLiveTvStream(val);
        }
      });
    });
  }

  // Fallback select change listener
  if (chanSelect) {
    chanSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      syncLiveTvActiveUI(val);
      if (val === 'custom') {
        openCustomStreamModal();
      } else {
        loadLiveTvStream(val);
      }
    });
  }
}

// ===== TV MODE & REMOTE NAVIGATION SUPPORT =====

function isTvDevice() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const tvRegex = /(google[ _]?tv|android tv|smart[ -]?tv|hbbtv|appletv|pov_tv|tizen|webos|viera|bravia|netcast|roku|aftb|aftt|aftm|afts|crkey|mi[ -]?box|shield|tv\b)/i;
  return tvRegex.test(ua);
}

// Measure TV screen dimensions dynamically and adjust layout variables & classes
function autoAdjustForTvScreen() {
  const vw = window.innerWidth || document.documentElement.clientWidth || screen.width;
  const vh = window.innerHeight || document.documentElement.clientHeight || screen.height;
  const isTv = document.body.classList.contains('tv-mode') || isTvDevice();

  const root = document.documentElement;

  // Calculate available vertical space for TV video
  // Header: ~56-60px, Broadcast header: ~48-52px, Margins: ~20px
  const reservedHeight = isTv ? 122 : 116;
  let videoMaxH = Math.max(260, Math.min(vh - reservedHeight, Math.round(vw * (9 / 16))));
  // Ensure player never overflows the TV viewport (leaves comfortable breathing room)
  videoMaxH = Math.min(videoMaxH, Math.round(vh * 0.72));

  root.style.setProperty('--tv-video-max-height', `${videoMaxH}px`);
  root.style.setProperty('--tv-screen-w', `${vw}px`);
  root.style.setProperty('--tv-screen-h', `${vh}px`);

  // Set height-based layout classes for precise responsive scaling
  document.body.classList.toggle('tv-height-compact', vh < 640);
  document.body.classList.toggle('tv-height-standard', vh >= 640 && vh < 900);
  document.body.classList.toggle('tv-height-spacious', vh >= 900);

  // Set width-based classes
  document.body.classList.toggle('tv-width-compact', vw < 1100);
  document.body.classList.toggle('tv-width-standard', vw >= 1100 && vw < 1600);
  document.body.classList.toggle('tv-width-widescreen', vw >= 1600);
}

function setTvMode(enabled) {
  document.body.classList.toggle('tv-mode', enabled);
  try {
    localStorage.setItem('nba_tv_mode', enabled ? 'true' : 'false');
  } catch (e) {}

  const btn = document.getElementById('tv-mode-btn');
  if (btn) {
    btn.classList.toggle('active', enabled);
    const textEl = btn.querySelector('.tv-mode-text');
    if (textEl) textEl.textContent = enabled ? 'TV Mode ON' : 'TV Mode';
  }

  // Recalculate screen dimensions and layout
  autoAdjustForTvScreen();
}

function initTvMode() {
  let enable = false;
  try {
    const saved = localStorage.getItem('nba_tv_mode');
    if (saved !== null) {
      enable = saved === 'true';
    } else {
      enable = isTvDevice();
    }
  } catch (e) {
    enable = isTvDevice();
  }
  setTvMode(enable);

  const btn = document.getElementById('tv-mode-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = document.body.classList.contains('tv-mode');
      setTvMode(!current);
    });
  }

  // Listen for screen size / orientation changes on TV or browser
  window.addEventListener('resize', autoAdjustForTvScreen);
  window.addEventListener('orientationchange', autoAdjustForTvScreen);
  autoAdjustForTvScreen();

  // Close any open custom TV dropdown menu when clicking anywhere else
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tv-custom-select-wrap')) {
      document.querySelectorAll('.tv-custom-dropdown-menu').forEach(menu => {
        menu.classList.add('hidden');
      });
      document.querySelectorAll('.tv-custom-select-trigger').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Global Remote Control (D-pad & Back) key handler
  window.addEventListener('keydown', handleRemoteKeyNavigation);
}

function handleRemoteKeyNavigation(e) {
  const key = e.key;
  const code = e.keyCode;

  // TV Remote Back / Escape keys
  if (key === 'Escape' || code === 27 || code === 10009 || code === 461 || key === 'BrowserBack') {
    // 1. Close open custom dropdown menus first
    const openMenu = document.querySelector('.tv-custom-dropdown-menu:not(.hidden)');
    if (openMenu) {
      openMenu.classList.add('hidden');
      e.preventDefault();
      return;
    }
    // 2. Close Custom Stream Modal
    const customModal = document.getElementById('custom-stream-modal');
    if (customModal && !customModal.classList.contains('hidden')) {
      closeCustomStreamModal();
      e.preventDefault();
      return;
    }
    // 3. Close Game Detail Modal
    const detailModal = document.getElementById('game-detail-modal');
    if (detailModal && !detailModal.classList.contains('hidden')) {
      closeGameDetail();
      e.preventDefault();
      return;
    }
  }

  // When navigating with D-pad Arrow keys, auto-scroll focused element into comfortable view
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 40);
  }
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initGamesControls();
  initStandingsControls();
  initGameDetailListeners();
  initLiveTv();
  initTvMode();
  loadGames().then(startCountdown);
});
