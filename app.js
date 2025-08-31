// StudyTube Pro — Code-oriented black+green UI with live matrix background
(function () {
  // ------- Helpers -------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORAGE_KEYS = {
    playlist: (pid) => `studytube-pro:playlist:${pid}`,
    progress: (pid) => `studytube-pro:progress:${pid}`,
    todos: (pid) => `studytube-pro:todos:${pid}`,
    theme: 'studytube-pro:theme',
    lastVideoIndex: (pid) => `studytube-pro:last-video-index:${pid}`,
    settings: 'studytube-pro:settings',
  };

  const state = {
    playlistId: 'PLQEaRBV9gAFu4ovJ41PywklqI7IyXwr01',
    apiKey: '',
    ids: [],
    titles: {},
    thumbs: {},
    durations: {},
    player: null,
    currentIndex: 0,
    isInitialPlay: true,
    sessionStart: Date.now(),
    timerSeconds: 25 * 60,
    timerInterval: null,
    timerRunning: false,
    videoProgress: {},
    filter: 'all',
    playbackRate: 1,
    bgRunning: true,
  };

  // ------- Toast -------
  function toast(message, type = 'info') {
    const host = $('#toast');
    const note = document.createElement('div');
    note.className = `note ${type}`;
    note.textContent = message;
    host.appendChild(note);
    setTimeout(() => { note.style.opacity = '0'; note.style.transform = 'translateX(10px)'; }, 2600);
    setTimeout(() => note.remove(), 3000);
  }

  const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const loadJSON = (k, d = null) => { try { const x = localStorage.getItem(k); return x ? JSON.parse(x) : d; } catch { return d; } };

  // ------- Theme -------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  function initTheme() {
    const settings = loadJSON(STORAGE_KEYS.settings, {});
    const theme = settings.theme || loadJSON(STORAGE_KEYS.theme, 'dark');
    applyTheme(theme);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const s = loadJSON(STORAGE_KEYS.settings, {});
    saveJSON(STORAGE_KEYS.settings, { ...s, theme: next });
    saveJSON(STORAGE_KEYS.theme, next);
    toast(`theme → ${next}`, 'success');
  }

  // ------- Clock -------
  function updateClock() {
    const now = new Date();
    $('#digitalClock').textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#dateDisplay').textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const elapsed = Math.floor((Date.now() - state.sessionStart) / 60000);
    $('#sessionTime').textContent = `${elapsed}m`;
  }

  // ------- Timer -------
  const fmt = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  };
  function updateTimerDisplay() { $('#timerDisplay').textContent = fmt(state.timerSeconds); }
  function startTimer() {
    if (state.timerRunning || state.timerSeconds <= 0) return;
    state.timerRunning = true;
    state.timerInterval = setInterval(() => {
      state.timerSeconds--;
      updateTimerDisplay();
      if (state.timerSeconds <= 0) {
        pauseTimer();
        toast('🎉 session complete — take a break', 'success');
      }
    }, 1000);
    toast('⏱ timer started', 'success');
  }
  function pauseTimer() {
    state.timerRunning = false;
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  }
  function resetTimer() {
    pauseTimer();
    const active = $('.timer-presets .chip.active');
    const minutes = active ? parseInt(active.dataset.minutes) : 25;
    state.timerSeconds = minutes * 60;
    updateTimerDisplay();
  }
  function setupTimer() {
    $('#timerStart').addEventListener('click', startTimer);
    $('#timerPause').addEventListener('click', pauseTimer);
    $('#timerReset').addEventListener('click', resetTimer);
    $$('.timer-presets .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.timer-presets .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        resetTimer();
      });
    });
    updateTimerDisplay();
  }

  // ------- Title parsing -------
  function parseVideoTitle(title, index) {
    let t = (title || '')
      .replace(/^(DSA Playlist in C\+\+\s*[-|:]?\s*)/i, '')
      .replace(/^(Coder Army\s*[-|:]?\s*)/i, '')
      .replace(/^(Data Structures?\s*[-|:]?\s*)/i, '')
      .replace(/^(Algorithm\s*[-|:]?\s*)/i, '')
      .trim();
    const patterns = [
      /^Lecture\s*(\d+)\s*:\s*(.+)$/i,
      /^Lec\s*(\d+)\s*:\s*(.+)$/i,
      /^(\d+)\s*:\s*(.+)$/,
      /^(\d+)\s*[-–]\s*(.+)$/,
      /^(\d+)\.\s*(.+)$/,
      /^(.+)\s*[-–]\s*Lecture\s*(\d+)$/i,
      /^(.+)$/
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = t.match(patterns[i]);
      if (m) {
        let n, text;
        if (i === patterns.length - 1) { n = index + 1; text = m[1].trim(); }
        else if (i === patterns.length - 2) { n = parseInt(m[2]) || (index + 1); text = m[1].trim(); }
        else { n = parseInt(m[1]) || (index + 1); text = m[2].trim(); }
        const nn = n.toString().padStart(2, '0');
        return { lectureNumber: n, formattedTitle: `Lecture ${nn}: ${text}`, shortTitle: text, originalTitle: text };
      }
    }
    const n = index + 1; const nn = n.toString().padStart(2, '0');
    return { lectureNumber: n, formattedTitle: `Lecture ${nn}: ${t}`, shortTitle: t, originalTitle: t };
  }

  // ------- Progress -------
  function saveVideoProgress() {
    if (!state.player || typeof state.player.getPlaylistIndex !== 'function') return;
    try {
      const currentTime = Math.floor(state.player.getCurrentTime() || 0);
      const duration = Math.floor(state.player.getDuration() || 0);
      const videoIndex = state.player.getPlaylistIndex();
      if (duration > 0 && videoIndex >= 0) {
        state.videoProgress[videoIndex] = {
          currentTime,
          duration,
          percentage: Math.min(100, Math.floor((currentTime / duration) * 100)),
          lastWatched: Date.now()
        };
        saveJSON(STORAGE_KEYS.progress(state.playlistId), state.videoProgress);
        saveJSON(STORAGE_KEYS.lastVideoIndex(state.playlistId), videoIndex);
        updateVideoProgressDisplay();
        updatePlaylistProgress();
        updateStats();
      }
    } catch {}
  }
  function loadVideoProgress() {
    state.videoProgress = loadJSON(STORAGE_KEYS.progress(state.playlistId), {});
    state.currentIndex = loadJSON(STORAGE_KEYS.lastVideoIndex(state.playlistId), 0);
  }
  function resetVideoProgress(videoIndex = null) {
    const idx = videoIndex !== null ? videoIndex : state.player?.getPlaylistIndex();
    if (idx >= 0) {
      delete state.videoProgress[idx];
      saveJSON(STORAGE_KEYS.progress(state.playlistId), state.videoProgress);
      updateVideoProgressDisplay();
      updatePlaylistProgress();
      updateStats();
      toast(`progress reset for lecture ${idx + 1}`, 'warning');
    }
  }
  function updateVideoProgressDisplay() {
    const idx = state.player?.getPlaylistIndex() ?? state.currentIndex;
    const p = state.videoProgress[idx];
    if (p) {
      $('#videoProgress').textContent = `progress: ${p.percentage}% (${fmt(p.currentTime)} / ${fmt(p.duration)})`;
      $('#lastWatched').textContent = new Date(p.lastWatched).toLocaleString();
    } else {
      $('#videoProgress').textContent = 'No progress saved';
      $('#lastWatched').textContent = '—';
    }
  }

  // ------- Stats -------
  function updateStats() {
    const current = (state.player?.getPlaylistIndex() ?? 0) + 1;
    const total = state.ids.length;
    const vals = Object.values(state.videoProgress);
    const watchedCount = vals.filter(x => x.percentage >= 90).length;
    const progressing = vals.filter(x => x.percentage > 5 && x.percentage < 90).length;
    const completion = total > 0 ? Math.round((watchedCount / total) * 100) : 0;

    $('#currentVideo').textContent = current;
    $('#totalVideos').textContent = total;
    $('#completionPercent').textContent = `${completion}%`;
    $('#courseProgressFill').style.width = `${completion}%`;
    $('#courseProgressLabel').textContent = `${completion}% complete`;

    $('#kpiWatched').textContent = watchedCount;
    $('#kpiInProgress').textContent = progressing;
    $('#kpiUnwatched').textContent = Math.max(0, total - watchedCount - progressing);
  }

  // ------- YouTube API -------
  function injectYouTubeAPI() {
    return new Promise(resolve => {
      if (window.YT && window.YT.Player) return resolve();
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      window.onYouTubeIframeAPIReady = () => resolve();
      document.head.appendChild(tag);
    });
  }

  function createPlayer(playlistId) {
    state.playlistId = playlistId;
    if (state.player) try { state.player.destroy(); } catch {}
    loadVideoProgress();

    state.player = new YT.Player('player', {
      height: '390',
      width: '640',
      playerVars: {
        listType: 'playlist',
        list: playlistId,
        index: state.currentIndex,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        color: 'white'
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      }
    });
  }

  function onPlayerReady() {
    const poll = setInterval(() => {
      try {
        const list = state.player.getPlaylist?.() || [];
        if (list.length) {
          clearInterval(poll);
          state.ids = list;
          buildPlaylist();
          updateStats();
          fetchPlaylistDetails();
          fetchVideoDetails();
          updateCurrentVideo();
          setPlaybackRate(state.playbackRate);
          toast(`loaded playlist (${list.length} lectures)`, 'success');
        }
      } catch {}
    }, 200);
  }

  function resumeVideoProgress() {
    const idx = state.currentIndex;
    const p = state.videoProgress[idx];
    if (p && p.currentTime > 5) {
      state.player.seekTo(p.currentTime, true);
      toast(`resumed @ ${fmt(p.currentTime)}`, 'success');
    }
  }

  function onPlayerStateChange(e) {
    if (e.data === YT.PlayerState.PLAYING && state.isInitialPlay) {
      resumeVideoProgress();
      state.isInitialPlay = false;
    }
    if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
      updateCurrentVideo();
      updateStats();
      saveVideoProgress();
    }
    if (e.data === YT.PlayerState.PLAYING) {
      const iv = setInterval(() => {
        if (state.player.getPlayerState() === YT.PlayerState.PLAYING) saveVideoProgress();
        else clearInterval(iv);
      }, 10000);
    }
  }

  function updateCurrentVideo() {
    try {
      const data = state.player.getVideoData();
      const index = state.player.getPlaylistIndex() ?? 0;
      const vid = state.ids[index];
      const rawTitle = data?.title || state.titles[vid] || `Video ${index + 1}`;
      const parsed = parseVideoTitle(rawTitle, index);

      $('#videoTitle').textContent = `> ${parsed.formattedTitle}`;
      $('#videoMeta').textContent = `id: ${data?.video_id || vid} • video ${index + 1}/${state.ids.length} • Coder Army`;
      $('#miniTitle').textContent = parsed.formattedTitle;
      $('#miniMeta').textContent = `video ${index + 1} / ${state.ids.length}`;

      updateVideoProgressDisplay();
      updateActivePlaylistItem();
      $('#speedStat').textContent = `${state.playbackRate}x`;
    } catch {}
  }

  // ------- Metadata -------
  async function fetchPlaylistDetails() {
    const apiKey = $('#apiKey').value.trim();
    if (!apiKey || !state.playlistId) return;
    try {
      const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${state.playlistId}&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('API request failed');
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        const title = data.items[0].snippet.title;
        $('#courseTitle').innerHTML = `<span class="mono">$</span> ${title}`;
        $('#crumbCourse').textContent = title.toLowerCase().replace(/\s+/g, '-');
      }
    } catch {
      toast('playlist title fetch failed', 'error');
    }
  }

  async function fetchVideoDetails() {
    const apiKey = $('#apiKey').value.trim();
    if (!apiKey || !state.ids.length) {
      buildPlaylist($('#playlistSearch').value);
      return;
    }
    toast('fetching lecture metadata…', 'info');
    try {
      for (let i = 0; i < state.ids.length; i += 50) {
        const chunk = state.ids.slice(i, i + 50).join(',');
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${chunk}&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('API request failed');
        const data = await res.json();
        (data.items || []).forEach(item => {
          state.titles[item.id] = item.snippet?.title || '';
          const t = item.snippet?.thumbnails;
          state.thumbs[item.id] = (t?.medium?.url || t?.high?.url || t?.default?.url || '');
          state.durations[item.id] = parseISODuration(item.contentDetails?.duration);
        });
      }
      buildPlaylist($('#playlistSearch').value);
      updateCurrentVideo();
      toast('lecture metadata loaded', 'success');
    } catch {
      toast('video details fetch failed', 'error');
    }
  }

  function parseISODuration(d) {
    if (!d) return 0;
    const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    return h * 3600 + min * 60 + s;
  }

  // ------- Playlist -------
  function buildPlaylist(filterText = '') {
    const container = $('#playlistList');
    container.innerHTML = '';
    const q = (filterText || '').toLowerCase().trim();
    const total = state.ids.length;
    let visible = 0;

    state.ids.forEach((videoId, index) => {
      const rawTitle = state.titles[videoId] || `Video ${index + 1}`;
      const parsed = parseVideoTitle(rawTitle, index);
      const p = state.videoProgress[index];
      const watched = p && p.percentage >= 90;
      const inProgress = p && p.percentage > 5 && p.percentage < 90;

      if (state.filter === 'unwatched' && (watched || inProgress)) return;
      if (state.filter === 'progress' && !inProgress) return;
      if (state.filter === 'watched' && !watched) return;

      const searchStr = `${parsed.formattedTitle} ${parsed.shortTitle} ${rawTitle}`.toLowerCase();
      if (q && !searchStr.includes(q)) return;

      visible++;

      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.dataset.index = index;

      const thumb = state.thumbs[videoId] || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      const dur = state.durations[videoId] ? fmt(state.durations[videoId]) : '';

      item.innerHTML = `
        <img class="playlist-thumb" src="${thumb}" alt="Thumbnail for ${parsed.shortTitle}">
        <div class="playlist-body">
          <div class="lecture-title mono">${parsed.formattedTitle}</div>
          <div class="lecture-desc">${parsed.shortTitle}</div>
          <div class="lecture-meta">
            <span>Coder Army</span>
            ${dur ? `<span>⏱ ${dur}</span>` : ''}
            <span>id:${videoId}</span>
            ${watched ? `<span class="badge">✓ done</span>` : inProgress ? `<span class="badge">▶ progress</span>` : `<span class="badge">🆕 new</span>`}
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${p ? p.percentage : 0}%"></div></div>
        </div>
        <div class="playlist-actions">
          <button class="reset-progress" title="Reset progress" data-reset="${index}">↺</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target && e.target.dataset.reset !== undefined) return;
        state.player.playVideoAt(index);
        toast(`playing ${parsed.formattedTitle}`, 'info');
      });

      container.appendChild(item);
    });

    updateActivePlaylistItem();
    $('#playlistCount').textContent = visible === total ? `${total} videos` : `${visible} of ${total} videos`;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-reset]');
      if (btn) resetVideoProgress(parseInt(btn.dataset.reset, 10));
    });
  }

  function updateActivePlaylistItem() {
    const currentIndex = state.player?.getPlaylistIndex() ?? 0;
    $$('.playlist-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.index) === currentIndex));
    const active = $('.playlist-item.active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const updatePlaylistProgress = () => buildPlaylist($('#playlistSearch').value);

  // ------- Settings -------
  function persistSettings(partial) {
    const cur = loadJSON(STORAGE_KEYS.settings, {});
    const next = { ...cur, ...partial };
    saveJSON(STORAGE_KEYS.settings, next);
  }
  function loadSettingsUI() {
    const s = loadJSON(STORAGE_KEYS.settings, {});
    $('#mPlaylistId').value = s.playlistId || state.playlistId || '';
    $('#mApiKey').value = s.apiKey || state.apiKey || '';
    $('#mDefaultSpeed').value = String(s.defaultSpeed || state.playbackRate || 1);
    $('#mTheme').value = s.theme || (document.documentElement.getAttribute('data-theme') || 'dark');
  }

  // ------- Keyboard -------
  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.key === '/') {
        e.preventDefault(); $('#globalSearch').focus();
      } else if (e.key.toLowerCase() === 't') {
        toggleTheme();
      } else if (e.key.toLowerCase() === 's') {
        $('#openSettings').click();
      } else if (e.key.toLowerCase() === 'r') {
        resumeVideoProgress();
      } else if (e.key.toLowerCase() === 'j') {
        state.player?.previousVideo();
      } else if (e.key.toLowerCase() === 'k') {
        state.player?.nextVideo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        const st = state.player?.getPlayerState();
        if (st === YT.PlayerState.PLAYING) state.player.pauseVideo();
        else state.player?.playVideo();
      } else if (e.key.toLowerCase() === 'g') {
        const num = prompt('Jump to Lecture #');
        const n = parseInt(num || '', 10);
        if (n >= 1 && n <= state.ids.length) state.player?.playVideoAt(n - 1);
      }
    });
  }

  // ------- Import/Export -------
  function exportData() {
    const blob = new Blob([JSON.stringify({
      playlistId: state.playlistId,
      progress: loadJSON(STORAGE_KEYS.progress(state.playlistId), {}),
      todos: loadJSON(STORAGE_KEYS.todos(state.playlistId), []),
      lastVideoIndex: loadJSON(STORAGE_KEYS.lastVideoIndex(state.playlistId), 0),
      settings: loadJSON(STORAGE_KEYS.settings, {}),
      exportedAt: new Date().toISOString(),
      version: 1
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `studytube-pro-${state.playlistId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('exported data', 'success');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !data.playlistId) throw new Error('Invalid file');
        saveJSON(STORAGE_KEYS.progress(data.playlistId), data.progress || {});
        saveJSON(STORAGE_KEYS.todos(data.playlistId), data.todos || []);
        saveJSON(STORAGE_KEYS.lastVideoIndex(data.playlistId), data.lastVideoIndex || 0);
        saveJSON(STORAGE_KEYS.settings, data.settings || {});
        state.playlistId = data.playlistId;
        $('#playlistId').value = data.playlistId;
        $('#apiKey').value = data.settings?.apiKey || '';
        toast('imported data — reloading', 'success');
        setTimeout(() => { state.isInitialPlay = true; createPlayer(state.playlistId); }, 300);
      } catch {
        toast('import failed', 'error');
      }
    };
    reader.readAsText(file);
  }

  // ------- Notes / Todos -------
  let todos = [];
  function loadTodos() { todos = loadJSON(STORAGE_KEYS.todos(state.playlistId), []); renderTodos(); }
  function saveTodos() { saveJSON(STORAGE_KEYS.todos(state.playlistId), todos); }
  function addTodo() {
    const input = $('#todoInput');
    const text = input.value.trim();
    if (!text) return;
    todos.push({ id: crypto.randomUUID(), text, completed: false, videoIndex: state.player?.getPlaylistIndex() ?? 0, timestamp: Date.now() });
    input.value = '';
    saveTodos(); renderTodos();
    toast('note added', 'success');
  }
  function toggleTodo(id) {
    const t = todos.find(x => x.id === id);
    if (t) { t.completed = !t.completed; saveTodos(); renderTodos(); toast(t.completed ? 'task complete' : 'task reopened', 'info'); }
  }
  function deleteTodo(id) { todos = todos.filter(x => x.id !== id); saveTodos(); renderTodos(); toast('note deleted', 'warning'); }
  function renderTodos() {
    const list = $('#todoList');
    list.innerHTML = '';
    if (!todos.length) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No notes yet. Add your first note above.'; list.appendChild(p); return;
    }
    todos.slice().reverse().forEach(todo => {
      const item = document.createElement('div');
      item.className = `todo-item ${todo.completed ? 'done' : ''}`;
      item.innerHTML = `
        <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} />
        <div>
          <div class="todo-text mono">${todo.text}</div>
          <div class="todo-meta">L${(todo.videoIndex || 0) + 1} • ${new Date(todo.timestamp).toLocaleString()}</div>
        </div>
        <button class="todo-delete">🗑</button>
      `;
      item.querySelector('.todo-checkbox').addEventListener('change', () => toggleTodo(todo.id));
      item.querySelector('.todo-delete').addEventListener('click', () => deleteTodo(todo.id));
      list.appendChild(item);
    });
  }

  // ------- Playback rate -------
  function setPlaybackRate(rate) {
    try {
      state.playbackRate = parseFloat(rate) || 1;
      state.player?.setPlaybackRate(state.playbackRate);
      $('#speedStat').textContent = `${state.playbackRate}x`;
      const s = loadJSON(STORAGE_KEYS.settings, {});
      persistSettings({ defaultSpeed: state.playbackRate, theme: s.theme || (document.documentElement.getAttribute('data-theme') || 'dark'), apiKey: $('#apiKey').value.trim(), playlistId: state.playlistId });
    } catch {}
  }

  // ------- Tabs & Nav -------
  function setupTabsAndNav() {
    $$('.tabbar .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tabbar .tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      });
    });
    $$('.nav-item[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $$('.tabbar .tab').forEach(t => {
          const match = t.dataset.tab === tab;
          t.classList.toggle('active', match);
          document.getElementById(`tab-${t.dataset.tab}`).classList.toggle('active', match);
        });
      });
    });
    $$('.filters .chip').forEach(ch => {
      ch.addEventListener('click', () => {
        $$('.filters .chip').forEach(c => c.classList.remove('active'));
        ch.classList.add('active');
        state.filter = ch.dataset.filter;
        buildPlaylist($('#playlistSearch').value);
      });
    });
  }

  // ------- Live Matrix Background -------
  function startMatrix() {
    const canvas = $('#bgMatrix');
    const ctx = canvas.getContext('2d');
    let w, h, cols, drops, rafId;
    const fontSize = 14;
    const chars = '01abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ#$%*+-/<>=[]{}()'.split('');
    function resize() {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      cols = Math.floor(window.innerWidth / fontSize);
      drops = Array(cols).fill(0);
    }
    function draw() {
      if (!state.bgRunning) return;
      ctx.fillStyle = 'rgba(7,11,9,0.08)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = '#14f195';
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > window.innerHeight && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      rafId = requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', () => {
      cancelAnimationFrame(rafId);
      resize();
      if (state.bgRunning) draw();
    });
    draw();
    return () => cancelAnimationFrame(rafId);
  }

  // ------- Initialize -------
  async function initialize() {
    initTheme();
    updateClock();
    setInterval(updateClock, 1000);

    setupTimer();
    setupTabsAndNav();
    setupKeyboard();

    // Search binding
    $('#playlistSearch').addEventListener('input', (e) => buildPlaylist(e.target.value));
    $('#globalSearch').addEventListener('input', (e) => {
      $('#playlistSearch').value = e.target.value;
      $('.nav-item[data-tab="curriculum"]').click();
      buildPlaylist(e.target.value);
    });

    // Controls
    $('#prevBtn').addEventListener('click', () => state.player?.previousVideo());
    $('#nextBtn').addEventListener('click', () => state.player?.nextVideo());
    $('#resumeBtn').addEventListener('click', resumeVideoProgress);
    $('#resetVideoProgress').addEventListener('click', () => resetVideoProgress());

    $('#jumpBtn').addEventListener('click', () => {
      const num = parseInt($('#jumpInput').value, 10);
      if (num >= 1 && num <= state.ids.length) { state.player?.playVideoAt(num - 1); $('#jumpInput').value = ''; }
      else { toast(`enter number between 1..${state.ids.length}`, 'error'); }
    });
    $('#jumpInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') $('#jumpBtn').click(); });

    // Mini player controls
    $('#miniPrev').addEventListener('click', () => state.player?.previousVideo());
    $('#miniNext').addEventListener('click', () => state.player?.nextVideo());
    $('#miniPlayPause').addEventListener('click', () => {
      const st = state.player?.getPlayerState();
      if (st === YT.PlayerState.PLAYING) state.player.pauseVideo();
      else state.player?.playVideo();
    });

    // Playback rate
    $('#playbackRate').addEventListener('change', (e) => setPlaybackRate(e.target.value));

    // Topbar actions
    $('#themeToggle').addEventListener('click', toggleTheme);
    $('#openSettings').addEventListener('click', () => { loadSettingsUI(); $('#settingsModal').showModal(); });
    $('#closeSettings').addEventListener('click', () => $('#settingsModal').close());
    $('#settingsCancel').addEventListener('click', () => $('#settingsModal').close());
    $('#settingsSave').addEventListener('click', () => {
      const pid = $('#mPlaylistId').value.trim();
      const key = $('#mApiKey').value.trim();
      const spd = parseFloat($('#mDefaultSpeed').value || '1');
      const theme = $('#mTheme').value;
      persistSettings({ playlistId: pid || state.playlistId, apiKey: key, defaultSpeed: spd, theme });
      $('#playlistId').value = pid || state.playlistId;
      $('#apiKey').value = key;
      applyTheme(theme);
      setPlaybackRate(spd);
      if (pid && pid !== state.playlistId) {
        state.isInitialPlay = true;
        state.playlistId = pid;
        createPlayer(pid);
        loadTodos();
      }
      $('#settingsModal').close();
      toast('settings saved', 'success');
    });

    $('#keyboardHelp').addEventListener('click', () => $('#kbdModal').showModal());
    $('#closeKbd').addEventListener('click', () => $('#kbdModal').close());
    $('#kbdOk').addEventListener('click', () => $('#kbdModal').close());
    $('#viewKeyboardShortcuts').addEventListener('click', () => $('#kbdModal').showModal());

    // BG toggle
    let stopMatrix = startMatrix();
    $('#bgToggle').addEventListener('click', () => {
      state.bgRunning = !state.bgRunning;
      if (state.bgRunning) stopMatrix = startMatrix();
      toast(state.bgRunning ? 'background: on' : 'background: off', 'info');
    });

    // Load playlist
    $('#loadPl').addEventListener('click', () => {
      const pid = $('#playlistId').value.trim();
      if (pid) {
        state.isInitialPlay = true;
        state.playlistId = pid;
        persistSettings({ playlistId: pid, apiKey: $('#apiKey').value.trim() });
        createPlayer(pid);
        loadTodos();
        toast('loading playlist…', 'info');
      }
    });

    // Notes
    $('#todoAdd').addEventListener('click', addTodo);
    $('#todoInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') addTodo(); });

    // Reset course
    $('#resetCourseProgress').addEventListener('click', () => {
      if (!confirm('Reset progress for all lectures?')) return;
      state.videoProgress = {};
      saveJSON(STORAGE_KEYS.progress(state.playlistId), {});
      updateVideoProgressDisplay(); updatePlaylistProgress(); updateStats();
      toast('course progress reset', 'warning');
    });
    $('#resetAllData').addEventListener('click', () => {
      if (!confirm('This will reset progress, notes, and last watched. Continue?')) return;
      localStorage.removeItem(STORAGE_KEYS.progress(state.playlistId));
      localStorage.removeItem(STORAGE_KEYS.todos(state.playlistId));
      localStorage.removeItem(STORAGE_KEYS.lastVideoIndex(state.playlistId));
      state.videoProgress = {};
      loadTodos(); updatePlaylistProgress(); updateStats();
      toast('cleared course data', 'warning');
    });

    // Export / Import
    $('#exportData').addEventListener('click', exportData);
    $('#importData').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) importData(file);
      e.target.value = '';
    });

    // Autosave
    setInterval(() => {
      try {
        const st = state.player?.getPlayerState();
        if (st === YT.PlayerState.PLAYING) saveVideoProgress();
      } catch {}
    }, 30000);

    window.addEventListener('beforeunload', () => {
      try {
        const st = state.player?.getPlayerState();
        if (st === YT.PlayerState.PLAYING || st === YT.PlayerState.PAUSED) saveVideoProgress();
      } catch {}
    });

    // Persisted settings
    const s = loadJSON(STORAGE_KEYS.settings, {});
    if (s.apiKey) $('#apiKey').value = s.apiKey;
    if (s.playlistId) { state.playlistId = s.playlistId; $('#playlistId').value = s.playlistId; }
    if (s.defaultSpeed) state.playbackRate = parseFloat(s.defaultSpeed);

    // Start
    await injectYouTubeAPI();
    createPlayer(state.playlistId);
    loadTodos();
    updateStats();
    toast('welcome back — StudyTube Pro', 'success');
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
