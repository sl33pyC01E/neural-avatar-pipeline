(() => {
  const MOTION_API = 'http://127.0.0.1:8793';
  const TTS_API = 'http://127.0.0.1:8796';
  const LAM_API = 'http://127.0.0.1:8797';
  const STORAGE_KEY = 'neural-avatar-pipeline:live-flow:v1';
  const player = document.querySelector('#unified-player');
  const state = {
    entries: [],
    stack: [],
    idleKey: '',
    activeKey: '',
    highlighted: 0,
    sessionActive: false,
    motionReady: false,
    view: 'face',
    keys: new Set(),
    speech: [],
    preparing: false,
    speaking: false,
    currentSpeechId: null,
    currentSource: null,
    audioContext: null,
    sequence: 0,
  };

  const $ = (selector) => document.querySelector(selector);
  const entryFor = (key) => state.entries.find((entry) => entry.key === key);
  const labelFor = (entry) => entry ? (entry.nickname?.trim() || entry.text) : 'missing embedding';
  const effectiveKey = () => state.activeKey || state.idleKey;
  const playerPost = (message) => player.contentWindow?.postMessage(message, MOTION_API);

  function setManagerStatus(message, error = false) {
    const element = $('#embedding-manager-status');
    element.textContent = message;
    element.style.color = error ? '#ff9c9c' : '';
  }

  function saveWorkspace() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        stack: state.stack,
        idleKey: state.idleKey,
        activeKey: state.activeKey,
        highlighted: state.highlighted,
        speed: Number($('#live-speed').value),
      }));
    } catch {}
  }

  function restoreWorkspace() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || saved.version !== 1) return;
      state.stack = Array.isArray(saved.stack) ? saved.stack.map(String) : [];
      state.idleKey = String(saved.idleKey || '');
      state.activeKey = String(saved.activeKey || '');
      state.highlighted = Math.max(0, Number(saved.highlighted) || 0);
      if (Number.isFinite(Number(saved.speed))) $('#live-speed').value = String(saved.speed);
    } catch {}
  }

  function installEntries(entries) {
    state.entries = Array.isArray(entries) ? entries.filter((entry) => entry?.key && entry?.text) : [];
    const valid = new Set(state.entries.map((entry) => entry.key));
    state.stack = [...new Set(state.stack.filter((key) => valid.has(key)))];
    if (!valid.has(state.idleKey)) {
      const namedIdle = state.entries.find((entry) => /^(idle|neutral|rest)$/i.test(entry.nickname?.trim() || entry.text.trim()));
      state.idleKey = namedIdle?.key || '';
    }
    if (!state.stack.includes(state.activeKey)) state.activeKey = '';
    state.highlighted = Math.max(0, Math.min(state.highlighted, Math.max(0, state.stack.length - 1)));
    renderEmbeddingControls();
    saveWorkspace();
    sendEffectiveEmbedding();
  }

  async function refreshEmbeddings() {
    try {
      setManagerStatus('Loading permanent embeddings…');
      const response = await fetch(`${MOTION_API}/api/live/text-cache`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load embeddings.');
      installEntries(result.entries);
      setManagerStatus(`${state.entries.length} permanent embedding${state.entries.length === 1 ? '' : 's'} available.`);
    } catch (error) {
      setManagerStatus(error.message || String(error), true);
    }
  }

  async function postMotion(pathname, body) {
    const response = await fetch(`${MOTION_API}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'The embedding operation failed.');
    return result;
  }

  async function createEmbedding() {
    if (state.sessionActive) { setManagerStatus('Stop the live session before computing a new embedding.', true); return; }
    const text = $('#new-embedding-text').value.trim();
    const nickname = $('#new-embedding-nickname').value.trim();
    if (!text) { setManagerStatus('Enter the exact motion prompt to embed.', true); return; }
    const button = $('#create-embedding');
    button.disabled = true;
    setManagerStatus('Computing once and permanently saving the 4,096-value embedding…');
    try {
      const result = await postMotion('/api/live/cache-text', { text, nickname });
      installEntries(result.entries);
      $('#new-embedding-text').value = '';
      $('#new-embedding-nickname').value = '';
      setManagerStatus(result.created
        ? `Saved “${labelFor(result.entry)}”.`
        : `Reused the existing tensor for “${labelFor(result.entry)}” without recomputing it.`);
    } catch (error) { setManagerStatus(error.message || String(error), true); }
    finally { button.disabled = false; }
  }

  async function renameEmbedding(key, nickname) {
    try {
      setManagerStatus('Saving nickname…');
      const result = await postMotion('/api/live/text-cache/nickname', { key, nickname });
      installEntries(result.entries);
      setManagerStatus(`Nickname ${result.entry.nickname ? `saved as “${result.entry.nickname}”` : 'cleared'}.`);
    } catch (error) { setManagerStatus(error.message || String(error), true); }
  }

  async function deleteEmbedding(key) {
    const entry = entryFor(key);
    if (!entry || !window.confirm(`Permanently delete the cached embedding “${labelFor(entry)}”?`)) return;
    try {
      setManagerStatus('Deleting embedding…');
      const result = await postMotion('/api/live/text-cache/delete', { key });
      const deletedIdle = state.idleKey === key;
      if (deletedIdle) state.idleKey = '';
      if (state.activeKey === key) state.activeKey = '';
      state.stack = state.stack.filter((item) => item !== key);
      installEntries(result.entries);
      if (deletedIdle && state.sessionActive) await setSession(false);
      setManagerStatus(`Deleted “${labelFor(result.deleted)}”.`);
    } catch (error) { setManagerStatus(error.message || String(error), true); }
  }

  function populateSelect(select, placeholder, selected = '') {
    select.replaceChildren(new Option(placeholder, ''));
    for (const entry of state.entries) {
      const suffix = entry.nickname?.trim() ? ` — ${entry.text}` : '';
      select.add(new Option(`${labelFor(entry)}${suffix}`, entry.key));
    }
    if (state.entries.some((entry) => entry.key === selected)) select.value = selected;
  }

  function renderEmbeddingControls() {
    populateSelect($('#live-idle-embedding'), 'Choose idle…', state.idleKey);
    populateSelect($('#live-stack-source'), 'Choose embedding…');
    const stack = $('#live-embedding-stack');
    stack.replaceChildren();
    if (!state.stack.length) {
      const empty = document.createElement('div');
      empty.className = 'stack-empty';
      empty.textContent = 'Add cached embeddings to the control stack.';
      stack.appendChild(empty);
    }
    state.stack.forEach((key, index) => {
      const entry = entryFor(key);
      if (!entry) return;
      const row = document.createElement('div');
      row.className = `stack-item${index === state.highlighted ? ' highlighted' : ''}${key === state.activeKey ? ' active' : ''}`;
      row.addEventListener('click', () => { state.highlighted = index; renderEmbeddingControls(); saveWorkspace(); });
      const toggle = document.createElement('button');
      toggle.className = 'stack-toggle';
      toggle.title = key === state.activeKey ? 'Release to idle' : 'Activate this embedding';
      toggle.addEventListener('click', (event) => { event.stopPropagation(); state.highlighted = index; setActiveEmbedding(key === state.activeKey ? '' : key); });
      const copy = document.createElement('div');
      copy.className = 'stack-copy';
      const name = document.createElement('strong'); name.textContent = labelFor(entry);
      const text = document.createElement('small'); text.textContent = entry.text;
      copy.append(name, text);
      const remove = document.createElement('button');
      remove.className = 'stack-remove'; remove.textContent = '×'; remove.title = 'Remove from stack';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        state.stack.splice(index, 1);
        if (state.activeKey === key) state.activeKey = '';
        state.highlighted = Math.min(state.highlighted, Math.max(0, state.stack.length - 1));
        renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding();
      });
      row.append(toggle, copy, remove);
      stack.appendChild(row);
    });
    const manager = $('#embedding-manager-list');
    manager.replaceChildren();
    for (const entry of state.entries) {
      const item = document.createElement('div'); item.className = 'manager-item';
      const top = document.createElement('div'); top.className = 'manager-item-top';
      const nickname = document.createElement('input'); nickname.value = entry.nickname || ''; nickname.maxLength = 80; nickname.placeholder = 'Nickname'; nickname.setAttribute('aria-label', `Nickname for ${entry.text}`);
      const save = document.createElement('button'); save.textContent = 'Save'; save.addEventListener('click', () => renameEmbedding(entry.key, nickname.value));
      const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = 'Delete'; remove.addEventListener('click', () => deleteEmbedding(entry.key));
      const text = document.createElement('div'); text.className = 'manager-text'; text.textContent = entry.text;
      top.append(nickname, save, remove); item.append(top, text); manager.appendChild(item);
    }
    if (!state.entries.length) {
      const empty = document.createElement('div'); empty.className = 'stack-empty'; empty.textContent = 'No permanent embeddings yet.'; manager.appendChild(empty);
    }
    const effective = entryFor(effectiveKey());
    $('#effective-embedding').textContent = effective ? `${state.activeKey ? 'active' : 'idle'} · ${labelFor(effective)}` : 'idle not set';
    $('#live-embedding-hud').textContent = effective ? labelFor(effective) : 'idle missing';
    $('#live-embedding-hud').classList.toggle('active', Boolean(state.activeKey));
    $('#live-session-toggle').disabled = !state.idleKey;
  }

  function setActiveEmbedding(key) {
    state.activeKey = state.stack.includes(key) ? key : '';
    renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding();
  }

  function sendEffectiveEmbedding() {
    if (!state.sessionActive) return;
    const key = effectiveKey();
    if (key) playerPost({ type: 'live-flow:set-embedding', cacheKey: key });
  }

  function handleArrow(key) {
    if (!state.stack.length) return;
    if (key === 'ArrowUp') state.highlighted = (state.highlighted - 1 + state.stack.length) % state.stack.length;
    if (key === 'ArrowDown') state.highlighted = (state.highlighted + 1) % state.stack.length;
    if (key === 'ArrowRight') state.activeKey = state.stack[state.highlighted];
    if (key === 'ArrowLeft' && state.activeKey === state.stack[state.highlighted]) state.activeKey = '';
    renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding();
  }

  function updateSessionUi(message = '') {
    const badge = $('#live-session-state');
    badge.textContent = state.sessionActive ? 'live' : 'stopped';
    badge.classList.toggle('online', state.sessionActive);
    $('#live-session-toggle').textContent = state.sessionActive ? 'Stop live session' : 'Start live session';
    $('#live-session-toggle').disabled = !state.sessionActive && !state.idleKey;
    $('#create-embedding').disabled = state.sessionActive;
    const hud = $('#live-motion-hud');
    hud.textContent = state.sessionActive ? 'ARDY Core-40 live' : 'ARDY stopped';
    hud.classList.toggle('active', state.sessionActive);
    if (message) $('#live-latency').textContent = message;
  }

  async function setSession(active) {
    if (active) {
      if (!state.idleKey) { setManagerStatus('Choose an idle fallback embedding before starting.', true); $('#embedding-manager').open = true; return; }
      state.audioContext ||= new AudioContext();
      await state.audioContext.resume().catch(() => {});
      state.sessionActive = true;
      state.motionReady = false;
      playerPost({
        type: 'live-flow:start',
        cacheKey: effectiveKey(),
        speed: Number($('#live-speed').value),
        smoothing: 1,
        keys: [...state.keys],
      });
      updateSessionUi('Core-40 is preparing its first horizon…');
      return;
    }
    state.sessionActive = false;
    state.motionReady = false;
    state.keys.clear();
    updateKeyUi();
    playerPost({ type: 'live-flow:stop' });
    if (state.currentSource) { try { state.currentSource.stop(); } catch {} state.currentSource = null; }
    if (state.currentSpeechId != null) {
      const current = state.speech.find((item) => item.id === state.currentSpeechId);
      if (current) current.status = 'stopped';
    }
    state.speaking = false;
    state.currentSpeechId = null;
    clearCompletedSpeech();
    updateSessionUi('Session stopped.');
  }

  function updateKeyUi() {
    document.querySelectorAll('[data-live-key]').forEach((button) => button.classList.toggle('down', state.keys.has(button.dataset.liveKey)));
    if (state.sessionActive) playerPost({ type: 'live-flow:keys', keys: [...state.keys] });
  }

  function setKey(key, down) {
    if (!state.sessionActive || !['w', 'a', 's', 'd'].includes(key)) return;
    const changed = down ? !state.keys.has(key) : state.keys.has(key);
    if (down) state.keys.add(key); else state.keys.delete(key);
    if (changed) updateKeyUi();
  }

  function renderSpeechQueue() {
    const container = $('#live-speech-queue');
    container.replaceChildren();
    if (!state.speech.length) {
      const empty = document.createElement('div'); empty.className = 'stack-empty'; empty.textContent = 'Speech queue is empty.'; container.appendChild(empty); return;
    }
    for (const item of state.speech.slice(-5)) {
      const row = document.createElement('div'); row.className = 'live-queue-item';
      const text = document.createElement('span'); text.textContent = item.text;
      const status = document.createElement('span'); status.textContent = item.status;
      row.append(text, status); container.appendChild(row);
    }
  }

  async function enqueueSpeech() {
    const text = $('#live-speech-text').value.trim();
    if (!text) return;
    $('#live-speech-text').value = '';
    state.speech.push({ id: ++state.sequence, text, status: 'queued', track: null, audio: null, ttsMs: 0, lamMs: 0 });
    renderSpeechQueue();
    prepareSpeech();
  }

  async function prepareSpeech() {
    if (state.preparing) return;
    const item = state.speech.find((candidate) => candidate.status === 'queued');
    if (!item) return;
    state.preparing = true;
    try {
      item.status = 'PocketTTS'; renderSpeechQueue(); $('#live-speech-hud').textContent = 'synthesizing';
      const totalStarted = performance.now();
      const ttsStarted = performance.now();
      const ttsResponse = await fetch(`${TTS_API}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: item.text }) });
      if (!ttsResponse.ok) { const error = await ttsResponse.json().catch(() => ({})); throw new Error(error.error || 'PocketTTS failed.'); }
      item.ttsMs = Number(ttsResponse.headers.get('x-tts-latency-ms')) || performance.now() - ttsStarted;
      const wav = await ttsResponse.arrayBuffer();
      state.audioContext ||= new AudioContext();
      const decoded = await state.audioContext.decodeAudioData(wav.slice(0));
      item.status = 'LAM'; renderSpeechQueue(); $('#live-speech-hud').textContent = 'animating face';
      const mono = decoded.getChannelData(0);
      const payload = mono.buffer.slice(mono.byteOffset, mono.byteOffset + mono.byteLength);
      const lamStarted = performance.now();
      const lamResponse = await fetch(`${LAM_API}/api/infer/lam`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': String(decoded.sampleRate) }, body: payload });
      const inference = await lamResponse.json();
      if (!lamResponse.ok || !inference.ok) throw new Error(inference.error || 'LAM facial animation failed.');
      item.lamMs = performance.now() - lamStarted;
      item.audio = decoded;
      item.track = {
        id: `live-face-${item.id}`,
        name: `Anna live speech ${item.id}`,
        driver: 'lam',
        driverName: 'LAM Audio2Expression',
        fps: inference.fps,
        duration: inference.duration || decoded.duration,
        names: inference.names,
        frames: inference.frames,
        naturalMotion: true,
        scales: { eyes: 1.55, head: 1, mouth: 0.57 },
      };
      item.status = 'ready';
      item.totalMs = performance.now() - totalStarted;
      $('#live-speech-hud').textContent = `ready ${(item.totalMs / 1000).toFixed(2)}s`;
      renderSpeechQueue();
      pumpSpeech();
    } catch (error) {
      item.status = `error · ${error.message || String(error)}`;
      $('#live-speech-hud').textContent = 'speech error';
      renderSpeechQueue();
    } finally {
      state.preparing = false;
      prepareSpeech();
    }
  }

  async function pumpSpeech() {
    if (!state.sessionActive || !state.motionReady || state.speaking) return;
    const item = state.speech.find((candidate) => candidate.status === 'ready');
    if (!item?.audio || !item.track) return;
    state.audioContext ||= new AudioContext();
    await state.audioContext.resume().catch(() => {});
    const delay = 0.08;
    const source = state.audioContext.createBufferSource();
    source.buffer = item.audio;
    source.connect(state.audioContext.destination);
    state.currentSource = source;
    state.currentSpeechId = item.id;
    state.speaking = true;
    item.status = 'speaking';
    renderSpeechQueue();
    $('#live-speech-hud').textContent = 'Anna speaking';
    playerPost({ type: 'live-flow:speak', track: item.track, delay });
    source.onended = () => {
      if (state.currentSpeechId !== item.id) return;
      item.status = 'done';
      state.currentSource = null;
      state.currentSpeechId = null;
      state.speaking = false;
      $('#live-speech-hud').textContent = 'speech ready';
      clearCompletedSpeech();
      pumpSpeech();
    };
    source.start(state.audioContext.currentTime + delay);
  }

  function clearCompletedSpeech() {
    state.speech = state.speech.filter((item) => !['done', 'stopped'].includes(item.status));
    renderSpeechQueue();
  }

  function clearSpeechQueue() {
    state.speech = state.speech.filter((item) => item.id === state.currentSpeechId || item.status === 'PocketTTS' || item.status === 'LAM');
    renderSpeechQueue();
  }

  $('#create-embedding').addEventListener('click', createEmbedding);
  $('#live-stack-add').addEventListener('click', () => {
    const key = $('#live-stack-source').value;
    if (!key || state.stack.includes(key)) return;
    state.stack.push(key); state.highlighted = state.stack.length - 1; renderEmbeddingControls(); saveWorkspace();
  });
  $('#live-idle-embedding').addEventListener('change', (event) => { state.idleKey = event.target.value; renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding(); updateSessionUi(); });
  $('#live-session-toggle').addEventListener('click', () => setSession(!state.sessionActive));
  $('#live-speak').addEventListener('click', enqueueSpeech);
  $('#live-clear-speech').addEventListener('click', clearSpeechQueue);
  $('#live-speech-text').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); enqueueSpeech(); } });
  $('#live-speed').addEventListener('input', (event) => {
    $('#live-speed-out').textContent = `${Number(event.target.value).toFixed(2)} m/s`;
    saveWorkspace();
    if (state.sessionActive) playerPost({ type: 'live-flow:start', cacheKey: effectiveKey(), speed: Number(event.target.value), smoothing: 1, keys: [...state.keys] });
  });
  for (const button of document.querySelectorAll('[data-live-key]')) {
    const key = button.dataset.liveKey;
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); setKey(key, true); });
    button.addEventListener('pointerup', () => setKey(key, false));
    button.addEventListener('pointercancel', () => setKey(key, false));
    button.addEventListener('lostpointercapture', () => setKey(key, false));
  }

  window.addEventListener('keydown', (event) => {
    if (state.view !== 'live' || /textarea|input|select/i.test(event.target.tagName)) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); if (!event.repeat || event.key === 'ArrowUp' || event.key === 'ArrowDown') handleArrow(event.key); return; }
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); setKey(key, true); }
  });
  window.addEventListener('keyup', (event) => {
    if (state.view !== 'live') return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); setKey(key, false); }
  });
  window.addEventListener('blur', () => { if (state.keys.size) { state.keys.clear(); updateKeyUi(); } });
  window.addEventListener('unified:view-change', (event) => {
    state.view = event.detail?.view || '';
    if (state.view !== 'live' && state.sessionActive) setSession(false);
  });
  window.addEventListener('message', (event) => {
    if (event.source !== player.contentWindow || event.origin !== MOTION_API || !event.data?.type) return;
    if (event.data.type === 'live-flow:arrow') handleArrow(event.data.key);
    if (event.data.type === 'live-flow:player-status') {
      if (event.data.error) {
        state.sessionActive = false;
        state.motionReady = false;
        updateSessionUi(event.data.error);
        return;
      }
      if (state.sessionActive && Number.isFinite(Number(event.data.generationSeconds))) {
        state.motionReady = true;
        $('#live-latency').textContent = `${Number(event.data.generationSeconds).toFixed(2)}s replan · ${Number(event.data.realtimeFactor || 0).toFixed(1)}× realtime`;
        pumpSpeech();
      }
      document.querySelectorAll('[data-live-key]').forEach((button) => button.classList.toggle('down', (event.data.keys || []).includes(button.dataset.liveKey)));
    }
    if (event.data.type === 'unified:player-ready' && state.sessionActive) {
      playerPost({ type: 'live-flow:start', cacheKey: effectiveKey(), speed: Number($('#live-speed').value), smoothing: 1, keys: [...state.keys] });
    }
  });

  restoreWorkspace();
  $('#live-speed').dispatchEvent(new Event('input'));
  renderEmbeddingControls();
  renderSpeechQueue();
  updateSessionUi();
  refreshEmbeddings();
})();
