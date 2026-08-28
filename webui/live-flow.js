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
    cueSequence: 0,
    speechSchedule: [],
    embeddingSchedule: [],
    pathSchedule: [],
    firedSpeech: new Set(),
    firedEmbeddings: new Set(),
    sessionStartedAt: 0,
    scheduleTimer: 0,
    elapsed: 0,
    livePosition: { x: 0, z: 0 },
    lastPathVelocity: null,
    lastPathSentAt: 0,
    speechLoop: false,
    embeddingLoop: false,
    pathLoop: false,
    speechCycleStartedAt: 0,
    embeddingCycleStartedAt: 0,
    pathCycleStartedAt: 0,
    speechElapsed: 0,
    embeddingElapsed: 0,
    pathElapsed: 0,
    plannerCenter: { x: 0, z: 0 },
    plannerScale: 90,
    camera: { target: 'torso', follow: true, orbit: false, orbitSpeed: 12, smoothing: 5, targetOffsetY: 0, yaw: 41, pitch: 68, distance: 4.15 },
    cameraStatusAt: 0,
    controlAfter: 0,
    controlPolling: false,
    apiKeyTimer: 0,
  };

  const $ = (selector) => document.querySelector(selector);
  const entryFor = (key) => state.entries.find((entry) => entry.key === key);
  const labelFor = (entry) => entry ? (entry.nickname?.trim() || entry.text) : 'missing embedding';
  const effectiveKey = () => state.activeKey || state.idleKey;
  const playerPost = (message) => player.contentWindow?.postMessage(message, MOTION_API);
  const cueId = () => `cue-${Date.now().toString(36)}-${++state.cueSequence}`;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const pathCanvas = $('#live-path-canvas');
  const pathContext = pathCanvas.getContext('2d');

  function setManagerStatus(message, error = false) {
    const element = $('#embedding-manager-status');
    element.textContent = message;
    element.style.color = error ? '#ff9c9c' : '';
  }

  function saveWorkspace() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 5,
        stack: state.stack,
        idleKey: state.idleKey,
        activeKey: state.activeKey,
        highlighted: state.highlighted,
        speed: Number($('#live-speed').value),
        speechSchedule: state.speechSchedule.map(({ id, time, text }) => ({ id, time, text })),
        embeddingSchedule: state.embeddingSchedule.map(({ id, time, cacheKey }) => ({ id, time, cacheKey })),
        pathSchedule: state.pathSchedule.map(({ id, time, x, z }) => ({ id, time, x, z })),
        speechLoop: state.speechLoop,
        embeddingLoop: state.embeddingLoop,
        pathLoop: state.pathLoop,
        camera: state.camera,
      }));
    } catch {}
  }

  function restoreWorkspace() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || ![1, 2, 3, 4, 5].includes(saved.version)) {
        state.speechSchedule.push({ id: cueId(), time: 0, text: '' });
        state.embeddingSchedule.push({ id: cueId(), time: 0, cacheKey: '' });
        state.pathSchedule.push({ id: cueId(), time: 0, x: 0, z: 0 });
        return;
      }
      state.stack = Array.isArray(saved.stack) ? saved.stack.map(String) : [];
      state.idleKey = String(saved.idleKey || '');
      state.activeKey = String(saved.activeKey || '');
      state.highlighted = Math.max(0, Number(saved.highlighted) || 0);
      if (Number.isFinite(Number(saved.speed))) $('#live-speed').value = String(saved.speed);
      if (saved.version >= 2) {
        state.speechSchedule = Array.isArray(saved.speechSchedule) ? saved.speechSchedule.map((cue) => ({ id: String(cue.id || cueId()), time: Math.max(0, finite(cue.time)), text: String(cue.text || '') })) : [];
        state.embeddingSchedule = Array.isArray(saved.embeddingSchedule) ? saved.embeddingSchedule.map((cue) => ({ id: String(cue.id || cueId()), time: Math.max(0, finite(cue.time)), cacheKey: String(cue.cacheKey || '') })) : [];
        state.pathSchedule = Array.isArray(saved.pathSchedule) ? saved.pathSchedule.map((cue) => ({ id: String(cue.id || cueId()), time: Math.max(0, finite(cue.time)), x: finite(cue.x), z: finite(cue.z) })) : [];
      }
      if (saved.version >= 3) state.pathLoop = Boolean(saved.pathLoop);
      if (saved.version >= 4) {
        state.speechLoop = Boolean(saved.speechLoop);
        state.embeddingLoop = Boolean(saved.embeddingLoop);
      }
      if (saved.version >= 5 && saved.camera && typeof saved.camera === 'object') state.camera = { ...state.camera, ...saved.camera };
    } catch {}
    if (!state.speechSchedule.length) state.speechSchedule.push({ id: cueId(), time: 0, text: '' });
    if (!state.embeddingSchedule.length) state.embeddingSchedule.push({ id: cueId(), time: 0, cacheKey: '' });
    if (!state.pathSchedule.length) state.pathSchedule.push({ id: cueId(), time: 0, x: 0, z: 0 });
  }

  function installEntries(entries) {
    state.entries = Array.isArray(entries) ? entries.filter((entry) => entry?.key && entry?.text) : [];
    const valid = new Set(state.entries.map((entry) => entry.key));
    state.stack = [...new Set(state.stack.filter((key) => valid.has(key)))];
    state.embeddingSchedule.forEach((cue) => { if (cue.cacheKey && cue.cacheKey !== '__idle__' && !valid.has(cue.cacheKey)) cue.cacheKey = ''; });
    if (!valid.has(state.idleKey)) {
      const namedIdle = state.entries.find((entry) => /^(idle|neutral|rest)$/i.test(entry.nickname?.trim() || entry.text.trim()));
      state.idleKey = namedIdle?.key || '';
    }
    if (!state.stack.includes(state.activeKey)) state.activeKey = '';
    state.highlighted = Math.max(0, Math.min(state.highlighted, Math.max(0, state.stack.length - 1)));
    renderEmbeddingControls();
    renderEmbeddingSchedule();
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

  function cueTimeInput(cue, render) {
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = '0.1'; input.value = String(cue.time);
    input.setAttribute('aria-label', 'Seconds after live session start');
    input.addEventListener('change', () => {
      cue.time = Math.max(0, finite(input.value)); input.value = String(cue.time);
      state.firedSpeech.delete(cue.id); state.firedEmbeddings.delete(cue.id);
      saveWorkspace(); render();
    });
    return input;
  }

  function cueRemoveButton(list, cue, render) {
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove cue';
    remove.addEventListener('click', () => {
      const index = list.indexOf(cue); if (index >= 0) list.splice(index, 1);
      state.firedSpeech.delete(cue.id); state.firedEmbeddings.delete(cue.id);
      saveWorkspace(); render();
    });
    return remove;
  }

  function renderSpeechSchedule() {
    const container = $('#live-speech-schedule');
    container.replaceChildren();
    for (const cue of state.speechSchedule) {
      const row = document.createElement('div');
      row.className = `cue-row speech-cue${state.firedSpeech.has(cue.id) ? ' fired' : ''}`;
      const text = document.createElement('input');
      text.type = 'text'; text.maxLength = 800; text.value = cue.text; text.placeholder = 'Line to synthesize live';
      text.dataset.cueId = cue.id;
      text.setAttribute('aria-label', 'Scheduled spoken line');
      text.addEventListener('input', () => { cue.text = text.value; saveWorkspace(); });
      text.addEventListener('change', () => { state.firedSpeech.delete(cue.id); renderSpeechSchedule(); });
      row.append(cueTimeInput(cue, renderSpeechSchedule), text, cueRemoveButton(state.speechSchedule, cue, renderSpeechSchedule));
      container.appendChild(row);
    }
    $('#live-speech-loop-detail').textContent = state.speechLoop
      ? `Repeats independently after scheduled speech finishes · ${speechLoopDuration().toFixed(1)}s minimum cycle.`
      : 'Each line runs once per session.';
  }

  function renderEmbeddingSchedule() {
    const container = $('#live-embedding-schedule');
    container.replaceChildren();
    for (const cue of state.embeddingSchedule) {
      const row = document.createElement('div');
      row.className = `cue-row embedding-cue${state.firedEmbeddings.has(cue.id) ? ' fired' : ''}`;
      const select = document.createElement('select');
      select.add(new Option('Choose cue…', ''));
      select.add(new Option('Return to idle', '__idle__'));
      for (const entry of state.entries) select.add(new Option(labelFor(entry), entry.key));
      select.value = cue.cacheKey;
      select.setAttribute('aria-label', 'Scheduled cached embedding');
      select.addEventListener('change', () => { cue.cacheKey = select.value; state.firedEmbeddings.delete(cue.id); saveWorkspace(); renderEmbeddingSchedule(); });
      row.append(cueTimeInput(cue, renderEmbeddingSchedule), select, cueRemoveButton(state.embeddingSchedule, cue, renderEmbeddingSchedule));
      container.appendChild(row);
    }
    $('#live-embedding-loop-detail').textContent = state.embeddingLoop
      ? `Repeats independently every ${embeddingLoopDuration().toFixed(1)}s.`
      : 'Each selection runs once per session.';
  }

  function speechLoopDuration() {
    return Math.max(1, ...state.speechSchedule.filter((cue) => cue.text.trim()).map((cue) => cue.time));
  }

  function embeddingLoopDuration() {
    return Math.max(1, ...state.embeddingSchedule.filter((cue) => cue.cacheKey).map((cue) => cue.time));
  }

  function rawPathEndpoints() {
    return state.pathSchedule
      .filter((cue) => Number.isFinite(cue.time) && Number.isFinite(cue.x) && Number.isFinite(cue.z))
      .sort((a, b) => a.time - b.time);
  }

  function pathLoopDuration() {
    const endpoints = rawPathEndpoints();
    const last = endpoints[endpoints.length - 1];
    const speed = Math.max(0.1, finite($('#live-speed').value, 0.8));
    const returnEnd = last ? last.time + Math.hypot(last.x, last.z) / speed : 0;
    return Math.max(1, returnEnd);
  }

  function effectivePathEndpoints() {
    const endpoints = rawPathEndpoints();
    if (!state.pathLoop || !endpoints.length) return endpoints;
    const last = endpoints[endpoints.length - 1];
    if (Math.hypot(last.x, last.z) < 0.001) return endpoints;
    return [...endpoints, { id: '__loop-origin__', time: pathLoopDuration(), x: 0, z: 0, loopOrigin: true }];
  }

  function plannerPoint(point) {
    return {
      x: pathCanvas.width / 2 + (point.x - state.plannerCenter.x) * state.plannerScale,
      y: pathCanvas.height / 2 - (point.z - state.plannerCenter.z) * state.plannerScale,
    };
  }

  function plannerWorld(x, y) {
    return {
      x: state.plannerCenter.x + (x - pathCanvas.width / 2) / state.plannerScale,
      z: state.plannerCenter.z - (y - pathCanvas.height / 2) / state.plannerScale,
    };
  }

  function plannerRoutePoints() {
    const points = effectivePathEndpoints();
    if (!points.length || points[0].time > 0 || Math.hypot(points[0].x, points[0].z) > 0.001) {
      return [{ id: '__origin__', time: 0, x: 0, z: 0, origin: true }, ...points];
    }
    return points.map((point, index) => index === 0 ? { ...point, origin: true } : point);
  }

  function pathDistance() {
    const points = plannerRoutePoints();
    let total = 0;
    for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
    return total;
  }

  function drawPathPlanner() {
    if (!pathCanvas.width || !pathCanvas.height) return;
    const ctx = pathContext;
    ctx.fillStyle = '#090d12'; ctx.fillRect(0, 0, pathCanvas.width, pathCanvas.height);
    const spacing = Math.max(12, state.plannerScale * 0.25);
    const origin = plannerPoint({ x: 0, z: 0 });
    ctx.lineWidth = 1;
    for (let x = ((origin.x % spacing) + spacing) % spacing; x < pathCanvas.width; x += spacing) {
      ctx.strokeStyle = Math.abs(x - origin.x) < 1 ? '#3b4654' : '#1a222d';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, pathCanvas.height); ctx.stroke();
    }
    for (let y = ((origin.y % spacing) + spacing) % spacing; y < pathCanvas.height; y += spacing) {
      ctx.strokeStyle = Math.abs(y - origin.y) < 1 ? '#3b4654' : '#1a222d';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pathCanvas.width, y); ctx.stroke();
    }
    const route = plannerRoutePoints();
    for (let index = 1; index < route.length; index += 1) {
      const from = plannerPoint(route[index - 1]); const to = plannerPoint(route[index]);
      ctx.save();
      if (route[index].loopOrigin) ctx.setLineDash([7, 5]);
      ctx.lineCap = 'round'; ctx.strokeStyle = '#67e3b599'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.restore();
    }
    route.forEach((point, index) => {
      const screen = plannerPoint(point);
      ctx.fillStyle = point.origin || point.loopOrigin ? '#67e3b5' : '#111821';
      ctx.strokeStyle = '#67e3b5'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(screen.x, screen.y, point.origin || point.loopOrigin ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b8c5d1'; ctx.font = `${Math.max(9, Math.round(pathCanvas.width / Math.max(1, pathCanvas.clientWidth) * 9))}px ui-monospace, monospace`;
      ctx.fillText(point.loopOrigin ? `loop ${point.time.toFixed(1)}s` : `${index} · ${point.time.toFixed(1)}s`, screen.x + 7, screen.y - 7);
    });
    if (state.sessionActive) {
      const live = plannerPoint(state.livePosition);
      ctx.fillStyle = '#72b7ff'; ctx.beginPath(); ctx.arc(live.x, live.y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    const userEndpoints = rawPathEndpoints().filter((point) => point.time > 0 || Math.hypot(point.x, point.z) > 0.001);
    $('#live-path-empty').style.display = userEndpoints.length ? 'none' : 'grid';
    $('#live-path-stats').textContent = `${pathDistance().toFixed(2)} m · ${userEndpoints.length} endpoint${userEndpoints.length === 1 ? '' : 's'}`;
    $('#live-loop-detail').textContent = state.pathLoop
      ? `Origin is final · path cycle ${pathLoopDuration().toFixed(1)}s.`
      : 'Return to origin, then restart only the path.';
  }

  function resizePathPlanner() {
    const rect = pathCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pathCanvas.width = Math.round(rect.width * dpr);
    pathCanvas.height = Math.round(rect.height * dpr);
    state.plannerScale = 90 * dpr;
    drawPathPlanner();
  }

  function fitPathPlanner() {
    const points = plannerRoutePoints();
    const xs = points.map((point) => point.x); const zs = points.map((point) => point.z);
    state.plannerCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1);
    state.plannerScale = Math.min(pathCanvas.width, pathCanvas.height) * 0.68 / span;
    drawPathPlanner();
  }

  function appendPathEndpoint(point) {
    const endpoints = rawPathEndpoints();
    const last = endpoints[endpoints.length - 1] || { time: 0, x: 0, z: 0 };
    const travel = Math.hypot(point.x - last.x, point.z - last.z) / Math.max(0.1, finite($('#live-speed').value, 0.8));
    const time = Math.round((last.time + Math.max(0.5, travel)) * 10) / 10;
    state.pathSchedule.push({ id: cueId(), time, x: point.x, z: point.z });
    saveWorkspace(); renderPathSchedule(); pathCanvas.focus();
  }

  function renderPathSchedule() {
    const container = $('#live-path-schedule');
    container.replaceChildren();
    for (const cue of state.pathSchedule) {
      const row = document.createElement('div'); row.className = 'cue-row path-cue';
      const x = document.createElement('input'); x.type = 'number'; x.step = '0.1'; x.value = String(cue.x); x.setAttribute('aria-label', 'Path endpoint X in metres');
      const z = document.createElement('input'); z.type = 'number'; z.step = '0.1'; z.value = String(cue.z); z.setAttribute('aria-label', 'Path endpoint Z in metres');
      x.addEventListener('change', () => { cue.x = finite(x.value); x.value = String(cue.x); saveWorkspace(); renderPathSchedule(); });
      z.addEventListener('change', () => { cue.z = finite(z.value); z.value = String(cue.z); saveWorkspace(); renderPathSchedule(); });
      row.append(cueTimeInput(cue, renderPathSchedule), x, z, cueRemoveButton(state.pathSchedule, cue, renderPathSchedule));
      container.appendChild(row);
    }
    drawPathPlanner();
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

  function renderCameraControls(syncInputs = true) {
    const camera = state.camera;
    if (syncInputs) {
      $('#live-camera-target').value = camera.target;
      $('#live-camera-follow').checked = camera.follow;
      $('#live-camera-orbit').checked = camera.orbit;
      $('#live-camera-distance').value = String(camera.distance);
      $('#live-camera-yaw').value = String(camera.yaw);
      $('#live-camera-pitch').value = String(camera.pitch);
      $('#live-camera-orbit-speed').value = String(camera.orbitSpeed);
      $('#live-camera-smoothing').value = String(camera.smoothing);
    }
    $('#live-camera-distance-out').textContent = `${finite(camera.distance, 4.15).toFixed(2)} m`;
    $('#live-camera-yaw-out').textContent = `${Math.round(finite(camera.yaw, 41))}°`;
    $('#live-camera-pitch-out').textContent = `${Math.round(finite(camera.pitch, 68))}°`;
    $('#live-camera-orbit-speed-out').textContent = `${Math.round(finite(camera.orbitSpeed, 12))}°/s`;
    $('#live-camera-smoothing-out').textContent = `${finite(camera.smoothing, 5).toFixed(1)}×`;
    $('#live-camera-status').textContent = `${camera.target} · ${camera.follow ? 'following' : 'fixed'}${camera.orbit ? ' · orbiting' : ''}`;
  }

  function sendCameraSettings() {
    playerPost({ type: 'live-flow:camera', camera: { ...state.camera } });
  }

  function setCamera(patch, send = true) {
    const target = ['face', 'torso', 'hips', 'full'].includes(patch.target) ? patch.target : state.camera.target;
    state.camera = {
      ...state.camera,
      ...patch,
      target,
      follow: patch.follow == null ? state.camera.follow : Boolean(patch.follow),
      orbit: patch.orbit == null ? state.camera.orbit : Boolean(patch.orbit),
      distance: Math.max(0.45, Math.min(12, finite(patch.distance, state.camera.distance))),
      yaw: Math.max(-180, Math.min(180, finite(patch.yaw, state.camera.yaw))),
      pitch: Math.max(10, Math.min(170, finite(patch.pitch, state.camera.pitch))),
      orbitSpeed: Math.max(-90, Math.min(90, finite(patch.orbitSpeed, state.camera.orbitSpeed))),
      smoothing: Math.max(0.5, Math.min(20, finite(patch.smoothing, state.camera.smoothing))),
      targetOffsetY: Math.max(-1, Math.min(1, finite(patch.targetOffsetY, state.camera.targetOffsetY))),
    };
    renderCameraControls(); saveWorkspace();
    if (send) sendCameraSettings();
  }

  function resetCamera() {
    state.camera = { target: 'torso', follow: true, orbit: false, orbitSpeed: 12, smoothing: 5, targetOffsetY: 0, yaw: 41, pitch: 68, distance: 4.15 };
    renderCameraControls(); saveWorkspace();
    playerPost({ type: 'live-flow:camera-reset' });
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

  function stopTimeline(resetClock = true) {
    if (state.scheduleTimer) window.clearInterval(state.scheduleTimer);
    state.scheduleTimer = 0;
    state.sessionStartedAt = 0;
    state.speechCycleStartedAt = 0;
    state.embeddingCycleStartedAt = 0;
    state.pathCycleStartedAt = 0;
    state.lastPathVelocity = null;
    state.lastPathSentAt = 0;
    playerPost({ type: 'live-flow:velocity', velocity: null });
    if (resetClock) {
      state.elapsed = 0;
      state.speechElapsed = 0;
      state.embeddingElapsed = 0;
      state.pathElapsed = 0;
      $('#live-clock-hud').textContent = '0.0s';
      $('#live-path-hud').textContent = 'path idle';
    }
  }

  function sendPathVelocity(velocity, force = false) {
    const previous = state.lastPathVelocity;
    const changed = !previous !== !velocity || (previous && velocity && Math.hypot(previous.x - velocity.x, previous.z - velocity.z) > 0.04);
    const overdue = Boolean(velocity) && performance.now() - state.lastPathSentAt > 900;
    if (!force && !changed && !overdue) return;
    state.lastPathVelocity = velocity ? { ...velocity } : null;
    state.lastPathSentAt = performance.now();
    playerPost({ type: 'live-flow:velocity', velocity });
  }

  function steerScheduledPath() {
    const endpoints = effectivePathEndpoints();
    if (!endpoints.length) {
      sendPathVelocity(null);
      $('#live-path-hud').textContent = 'path idle';
      return;
    }
    const target = endpoints.find((cue) => cue.time > state.pathElapsed + 0.03) || endpoints[endpoints.length - 1];
    const dx = target.x - state.livePosition.x;
    const dz = target.z - state.livePosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.06) {
      sendPathVelocity(null);
      $('#live-path-hud').textContent = `path · ${target.x.toFixed(1)}, ${target.z.toFixed(1)}`;
      return;
    }
    const limit = Math.max(0.1, finite($('#live-speed').value, 0.8));
    const remaining = Math.max(0.08, target.time - state.pathElapsed);
    const speed = Math.min(limit, distance / remaining);
    const velocity = { x: dx / distance * speed, z: dz / distance * speed };
    sendPathVelocity(velocity);
    const manual = state.keys.size ? ' · WASD override' : '';
    $('#live-path-hud').textContent = `to ${target.x.toFixed(1)}, ${target.z.toFixed(1)} @ ${target.time.toFixed(1)}s${manual}`;
  }

  function tickTimeline() {
    if (!state.sessionActive || !state.motionReady || !state.sessionStartedAt) return;
    const now = performance.now();
    state.elapsed = Math.max(0, (now - state.sessionStartedAt) / 1000);
    state.speechElapsed = Math.max(0, (now - state.speechCycleStartedAt) / 1000);
    state.embeddingElapsed = Math.max(0, (now - state.embeddingCycleStartedAt) / 1000);
    state.pathElapsed = Math.max(0, (now - state.pathCycleStartedAt) / 1000);
    $('#live-clock-hud').textContent = `${state.elapsed.toFixed(1)}s`;
    let speechChanged = false;
    let embeddingChanged = false;
    for (const cue of [...state.speechSchedule].sort((a, b) => a.time - b.time)) {
      if (!state.firedSpeech.has(cue.id) && cue.time <= state.speechElapsed && cue.text.trim() && document.activeElement?.dataset?.cueId !== cue.id) {
        state.firedSpeech.add(cue.id);
        speechChanged = true;
        enqueueSpeech(cue.text, 'schedule');
      }
    }
    for (const cue of [...state.embeddingSchedule].sort((a, b) => a.time - b.time)) {
      if (!state.firedEmbeddings.has(cue.id) && cue.time <= state.embeddingElapsed && cue.cacheKey) {
        state.firedEmbeddings.add(cue.id);
        embeddingChanged = true;
        state.activeKey = cue.cacheKey === '__idle__' || !entryFor(cue.cacheKey) ? '' : cue.cacheKey;
        renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding();
      }
    }
    steerScheduledPath();
    if (speechChanged) renderSpeechSchedule();
    if (embeddingChanged) renderEmbeddingSchedule();
    drawPathPlanner();
    if (state.speechLoop && state.speechElapsed >= speechLoopDuration()) {
      const scheduledSpeechBusy = state.speech.some((item) => item.source === 'schedule' && ['queued', 'PocketTTS', 'LAM', 'ready', 'speaking'].includes(item.status));
      if (!scheduledSpeechBusy) {
        state.speechCycleStartedAt = now;
        state.speechElapsed = 0;
        state.firedSpeech.clear();
        renderSpeechSchedule();
      }
    }
    if (state.embeddingLoop && state.embeddingElapsed >= embeddingLoopDuration()) {
      state.embeddingCycleStartedAt = now;
      state.embeddingElapsed = 0;
      state.firedEmbeddings.clear();
      renderEmbeddingSchedule();
    }
    if (state.pathLoop && state.pathElapsed >= pathLoopDuration()) {
      const hasRoute = rawPathEndpoints().length > 0;
      const routeComplete = !hasRoute || Math.hypot(state.livePosition.x, state.livePosition.z) < 0.2;
      if (!state.keys.size && routeComplete) {
        state.pathCycleStartedAt = now;
        state.pathElapsed = 0;
        sendPathVelocity(null, true);
        steerScheduledPath();
      }
    }
  }

  function startTimeline(preservePosition = false) {
    stopTimeline(false);
    state.firedSpeech.clear();
    state.firedEmbeddings.clear();
    state.elapsed = 0;
    state.speechElapsed = 0;
    state.embeddingElapsed = 0;
    state.pathElapsed = 0;
    if (!preservePosition) state.livePosition = { x: 0, z: 0 };
    state.sessionStartedAt = performance.now();
    state.speechCycleStartedAt = state.sessionStartedAt;
    state.embeddingCycleStartedAt = state.sessionStartedAt;
    state.pathCycleStartedAt = state.sessionStartedAt;
    state.scheduleTimer = window.setInterval(tickTimeline, 100);
    renderSpeechSchedule();
    renderEmbeddingSchedule();
    tickTimeline();
  }

  async function setSession(active) {
    if (active) {
      if (!state.idleKey) { setManagerStatus('Choose an idle fallback embedding before starting.', true); $('#embedding-manager').open = true; return; }
      state.audioContext ||= new AudioContext();
      await state.audioContext.resume().catch(() => {});
      state.sessionActive = true;
      state.motionReady = false;
      stopTimeline(false);
      state.firedSpeech.clear();
      state.firedEmbeddings.clear();
      state.elapsed = 0;
      $('#live-clock-hud').textContent = 'waiting';
      $('#live-path-hud').textContent = 'path waiting';
      renderSpeechSchedule();
      renderEmbeddingSchedule();
      playerPost({
        type: 'live-flow:start',
        cacheKey: effectiveKey(),
        speed: Number($('#live-speed').value),
        smoothing: 1,
        keys: [...state.keys],
      });
      sendCameraSettings();
      updateSessionUi('Core-40 is preparing its first horizon…');
      return;
    }
    state.sessionActive = false;
    state.motionReady = false;
    stopTimeline();
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

  async function enqueueSpeech(textOverride = '', source = 'manual') {
    const scheduled = typeof textOverride === 'string' && textOverride.trim();
    const text = (scheduled ? textOverride : $('#live-speech-text').value).trim();
    if (!text) return;
    if (!scheduled) $('#live-speech-text').value = '';
    state.speech.push({ id: ++state.sequence, text, source, status: 'queued', track: null, audio: null, ttsMs: 0, lamMs: 0 });
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

  function resolveEmbedding(selector, allowIdle = false) {
    const value = String(selector || '').trim();
    if (allowIdle && /^(idle|__idle__)$/i.test(value)) return '__idle__';
    const lower = value.toLowerCase();
    const entry = state.entries.find((item) => item.key === value)
      || state.entries.find((item) => item.nickname?.trim().toLowerCase() === lower)
      || state.entries.find((item) => item.text.trim().toLowerCase() === lower);
    if (!entry) throw new Error(`Cached embedding “${value}” was not found. Inspect /api/control/state for valid keys and nicknames.`);
    return entry.key;
  }

  function controlSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      view: state.view,
      session: { active: state.sessionActive, motionReady: state.motionReady, elapsed: Number(state.elapsed.toFixed(2)) },
      speech: {
        queue: state.speech.map(({ id, text, source, status }) => ({ id, text, source, status })),
        schedule: state.speechSchedule.map(({ time, text }) => ({ time, text })),
        loop: state.speechLoop,
      },
      embeddings: {
        available: state.entries.map(({ key, nickname, text }) => ({ key, nickname: nickname || '', text })),
        idleKey: state.idleKey,
        activeKey: state.activeKey,
        effectiveKey: effectiveKey(),
        stack: [...state.stack],
        schedule: state.embeddingSchedule.map(({ time, cacheKey }) => ({ time, cacheKey })),
        loop: state.embeddingLoop,
      },
      path: {
        position: { ...state.livePosition },
        endpoints: state.pathSchedule.map(({ time, x, z }) => ({ time, x, z })),
        loop: state.pathLoop,
        cycleElapsed: Number(state.pathElapsed.toFixed(2)),
        manualKeys: [...state.keys],
      },
      camera: { ...state.camera },
    };
  }

  async function applyControlCommand(command) {
    const args = command.args || {};
    switch (command.action) {
      case 'session.start':
        if (state.view !== 'live') document.querySelector('button[data-view="live"]')?.click();
        if (!state.sessionActive) await setSession(true);
        if (!state.sessionActive) throw new Error('Live session could not start. Confirm that an idle embedding is selected and local services are available.');
        return { sessionActive: state.sessionActive };
      case 'session.stop':
        if (state.sessionActive) await setSession(false);
        return { sessionActive: false };
      case 'speech.say': {
        const speechText = String(args.text || '').trim();
        if (!speechText) throw new Error('speech.say requires non-empty args.text.');
        enqueueSpeech(speechText, 'api');
        return { queued: speechText };
      }
      case 'speech.queue.clear':
        clearSpeechQueue(); return { cleared: true };
      case 'speech.schedule.set': {
        if (!Array.isArray(args.cues) || args.cues.length > 200) throw new Error('speech.schedule.set requires args.cues with at most 200 entries.');
        state.speechSchedule = args.cues.map((cue) => ({ id: cueId(), time: Math.max(0, finite(cue.time)), text: String(cue.text || '').trim().slice(0, 800) }));
        if (typeof args.loop === 'boolean') state.speechLoop = args.loop;
        state.firedSpeech.clear(); state.speechCycleStartedAt = performance.now(); state.speechElapsed = 0;
        $('#live-speech-loop').checked = state.speechLoop; renderSpeechSchedule(); saveWorkspace();
        return { cues: state.speechSchedule.length, loop: state.speechLoop };
      }
      case 'embedding.activate': {
        const key = resolveEmbedding(args.selector ?? args.cacheKey);
        state.activeKey = key; renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding();
        return { activeKey: key, label: labelFor(entryFor(key)) };
      }
      case 'embedding.release':
        state.activeKey = ''; renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding(); return { activeKey: '', idleKey: state.idleKey };
      case 'embedding.idle.set': {
        state.idleKey = resolveEmbedding(args.selector ?? args.cacheKey);
        renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding(); updateSessionUi();
        return { idleKey: state.idleKey, label: labelFor(entryFor(state.idleKey)) };
      }
      case 'embedding.stack.set': {
        if (!Array.isArray(args.selectors) || args.selectors.length > 100) throw new Error('embedding.stack.set requires args.selectors with at most 100 entries.');
        state.stack = [...new Set(args.selectors.map((selector) => resolveEmbedding(selector)))];
        state.highlighted = Math.min(state.highlighted, Math.max(0, state.stack.length - 1));
        if (state.activeKey && !state.stack.includes(state.activeKey)) state.activeKey = '';
        renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding();
        return { stack: [...state.stack] };
      }
      case 'embedding.schedule.set': {
        if (!Array.isArray(args.cues) || args.cues.length > 200) throw new Error('embedding.schedule.set requires args.cues with at most 200 entries.');
        state.embeddingSchedule = args.cues.map((cue) => ({ id: cueId(), time: Math.max(0, finite(cue.time)), cacheKey: resolveEmbedding(cue.selector ?? cue.cacheKey, true) }));
        if (typeof args.loop === 'boolean') state.embeddingLoop = args.loop;
        state.firedEmbeddings.clear(); state.embeddingCycleStartedAt = performance.now(); state.embeddingElapsed = 0;
        $('#live-embedding-loop').checked = state.embeddingLoop; renderEmbeddingSchedule(); saveWorkspace();
        return { cues: state.embeddingSchedule.length, loop: state.embeddingLoop };
      }
      case 'embedding.create': {
        if (state.sessionActive) throw new Error('Stop the live session before creating an embedding.');
        const embeddingText = String(args.text || '').trim();
        if (!embeddingText) throw new Error('embedding.create requires non-empty args.text.');
        const result = await postMotion('/api/live/cache-text', { text: embeddingText, nickname: String(args.nickname || '').trim() });
        installEntries(result.entries);
        return { created: result.created, entry: result.entry };
      }
      case 'path.schedule.set': {
        const endpoints = args.endpoints ?? args.cues;
        if (!Array.isArray(endpoints) || endpoints.length > 500) throw new Error('path.schedule.set requires args.endpoints with at most 500 entries.');
        state.pathSchedule = endpoints.map((point) => ({ id: cueId(), time: Math.max(0, finite(point.time)), x: finite(point.x), z: finite(point.z) }));
        if (typeof args.loop === 'boolean') state.pathLoop = args.loop;
        state.pathCycleStartedAt = performance.now(); state.pathElapsed = 0;
        $('#live-path-loop').checked = state.pathLoop; renderPathSchedule(); saveWorkspace();
        return { endpoints: state.pathSchedule.length, loop: state.pathLoop };
      }
      case 'path.clear':
        state.pathSchedule = []; renderPathSchedule(); saveWorkspace(); return { endpoints: 0 };
      case 'loops.set': {
        const now = performance.now();
        if (typeof args.speech === 'boolean') { state.speechLoop = args.speech; if (args.speech) { state.speechCycleStartedAt = now; state.speechElapsed = 0; state.firedSpeech.clear(); } }
        if (typeof args.embeddings === 'boolean') { state.embeddingLoop = args.embeddings; if (args.embeddings) { state.embeddingCycleStartedAt = now; state.embeddingElapsed = 0; state.firedEmbeddings.clear(); } }
        if (typeof args.path === 'boolean') { state.pathLoop = args.path; if (args.path) { state.pathCycleStartedAt = now; state.pathElapsed = 0; } }
        $('#live-speech-loop').checked = state.speechLoop; $('#live-embedding-loop').checked = state.embeddingLoop; $('#live-path-loop').checked = state.pathLoop;
        renderSpeechSchedule(); renderEmbeddingSchedule(); drawPathPlanner(); saveWorkspace();
        return { speech: state.speechLoop, embeddings: state.embeddingLoop, path: state.pathLoop };
      }
      case 'locomotion.keys': {
        if (!state.sessionActive) throw new Error('Start the live session before sending locomotion keys.');
        const keys = Array.isArray(args.keys) ? args.keys.map((key) => String(key).toLowerCase()).filter((key) => ['w', 'a', 's', 'd'].includes(key)) : [];
        state.keys = new Set(keys); updateKeyUi();
        if (state.apiKeyTimer) window.clearTimeout(state.apiKeyTimer);
        const duration = Math.max(0, Math.min(60000, finite(args.durationMs)));
        if (duration) state.apiKeyTimer = window.setTimeout(() => { state.keys.clear(); updateKeyUi(); }, duration);
        return { keys, durationMs: duration };
      }
      case 'locomotion.stop':
        if (state.apiKeyTimer) window.clearTimeout(state.apiKeyTimer);
        state.apiKeyTimer = 0; state.keys.clear(); updateKeyUi(); return { keys: [] };
      case 'camera.set':
        setCamera(args); return { camera: { ...state.camera } };
      case 'camera.preset': {
        const preset = String(args.preset || '');
        if (preset === 'face') setCamera({ target: 'face', follow: true, distance: 1.25, pitch: 82 });
        else if (preset === 'torso') setCamera({ target: 'torso', follow: true, distance: 2.25, pitch: 76 });
        else if (preset === 'full') setCamera({ target: 'full', follow: true, distance: 4.15, pitch: 68 });
        else throw new Error('camera.preset requires face, torso, or full.');
        return { camera: { ...state.camera } };
      }
      case 'camera.nudge':
        setCamera({ yaw: state.camera.yaw + finite(args.yaw), pitch: state.camera.pitch + finite(args.pitch), distance: state.camera.distance + finite(args.distance) });
        return { camera: { ...state.camera } };
      case 'camera.reset':
        resetCamera(); return { camera: { ...state.camera } };
      default:
        throw new Error(`Unsupported control action “${command.action}”.`);
    }
  }

  async function reportControlResult(id, ok, result = null, error = null) {
    await fetch('/api/control/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ok, result, error }) }).catch(() => {});
  }

  async function claimControlCommand(id) {
    try {
      const response = await fetch('/api/control/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status: 'running' }) });
      return response.ok;
    } catch { return false; }
  }

  async function pollControlCommands() {
    if (state.controlPolling) return;
    state.controlPolling = true;
    try {
      const response = await fetch(`/api/control/commands?after=${state.controlAfter}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return;
      for (const command of payload.commands || []) {
        if (!await claimControlCommand(command.id)) break;
        state.controlAfter = Math.max(state.controlAfter, Number(command.id) || 0);
        try { const result = await applyControlCommand(command); publishControlState(); await reportControlResult(command.id, true, result); }
        catch (error) { await reportControlResult(command.id, false, null, error.message || String(error)); }
      }
    } catch {}
    finally { state.controlPolling = false; }
  }

  function publishControlState() {
    fetch('/api/control/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(controlSnapshot()) }).catch(() => {});
  }

  $('#create-embedding').addEventListener('click', createEmbedding);
  $('#live-stack-add').addEventListener('click', () => {
    const key = $('#live-stack-source').value;
    if (!key || state.stack.includes(key)) return;
    state.stack.push(key); state.highlighted = state.stack.length - 1; renderEmbeddingControls(); saveWorkspace();
  });
  $('#live-idle-embedding').addEventListener('change', (event) => { state.idleKey = event.target.value; renderEmbeddingControls(); saveWorkspace(); sendEffectiveEmbedding(); updateSessionUi(); });
  $('#live-session-toggle').addEventListener('click', () => setSession(!state.sessionActive));
  $('#live-speak').addEventListener('click', () => enqueueSpeech());
  $('#live-clear-speech').addEventListener('click', clearSpeechQueue);
  $('#live-speech-text').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); enqueueSpeech(); } });
  $('#add-live-speech-cue').addEventListener('click', () => {
    const last = state.speechSchedule[state.speechSchedule.length - 1];
    state.speechSchedule.push({ id: cueId(), time: last ? last.time + 1 : 0, text: '' });
    saveWorkspace(); renderSpeechSchedule();
  });
  $('#add-live-embedding-cue').addEventListener('click', () => {
    const last = state.embeddingSchedule[state.embeddingSchedule.length - 1];
    state.embeddingSchedule.push({ id: cueId(), time: last ? last.time + 1 : 0, cacheKey: '' });
    saveWorkspace(); renderEmbeddingSchedule();
  });
  $('#add-live-path-cue').addEventListener('click', () => {
    const last = rawPathEndpoints().at(-1);
    state.pathSchedule.push({ id: cueId(), time: last ? last.time + 5 : 0, x: last?.x || 0, z: last?.z || 0 });
    saveWorkspace(); renderPathSchedule();
  });
  pathCanvas.addEventListener('pointerdown', (event) => {
    const rect = pathCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const world = plannerWorld((event.clientX - rect.left) * pathCanvas.width / rect.width, (event.clientY - rect.top) * pathCanvas.height / rect.height);
    const point = { x: Math.round(world.x * 20) / 20, z: Math.round(world.z * 20) / 20 };
    appendPathEndpoint(point);
  });
  $('#live-path-undo').addEventListener('click', () => {
    const last = rawPathEndpoints().at(-1);
    if (!last) return;
    const index = state.pathSchedule.indexOf(last);
    if (index >= 0) state.pathSchedule.splice(index, 1);
    saveWorkspace(); renderPathSchedule();
  });
  $('#live-path-clear').addEventListener('click', () => { state.pathSchedule = []; saveWorkspace(); renderPathSchedule(); });
  $('#live-path-fit').addEventListener('click', fitPathPlanner);
  $('#live-speech-loop').addEventListener('change', (event) => {
    state.speechLoop = event.target.checked;
    if (state.speechLoop && state.sessionActive) { state.speechCycleStartedAt = performance.now(); state.speechElapsed = 0; state.firedSpeech.clear(); }
    saveWorkspace(); renderSpeechSchedule();
  });
  $('#live-embedding-loop').addEventListener('change', (event) => {
    state.embeddingLoop = event.target.checked;
    if (state.embeddingLoop && state.sessionActive) { state.embeddingCycleStartedAt = performance.now(); state.embeddingElapsed = 0; state.firedEmbeddings.clear(); }
    saveWorkspace(); renderEmbeddingSchedule();
  });
  $('#live-path-loop').addEventListener('change', (event) => {
    state.pathLoop = event.target.checked;
    if (state.pathLoop && state.sessionActive) { state.pathCycleStartedAt = performance.now(); state.pathElapsed = 0; }
    saveWorkspace(); drawPathPlanner();
  });
  $('#live-camera-target').addEventListener('change', (event) => setCamera({ target: event.target.value }));
  $('#live-camera-follow').addEventListener('change', (event) => setCamera({ follow: event.target.checked }));
  $('#live-camera-orbit').addEventListener('change', (event) => setCamera({ orbit: event.target.checked }));
  for (const [id, key] of [
    ['live-camera-distance', 'distance'], ['live-camera-yaw', 'yaw'], ['live-camera-pitch', 'pitch'],
    ['live-camera-orbit-speed', 'orbitSpeed'], ['live-camera-smoothing', 'smoothing'],
  ]) {
    $(`#${id}`).addEventListener('input', (event) => setCamera({ [key]: Number(event.target.value) }));
  }
  for (const button of document.querySelectorAll('[data-camera-preset]')) {
    button.addEventListener('click', () => {
      const preset = button.dataset.cameraPreset;
      if (preset === 'face') setCamera({ target: 'face', follow: true, distance: 1.25, pitch: 82 });
      if (preset === 'torso') setCamera({ target: 'torso', follow: true, distance: 2.25, pitch: 76 });
      if (preset === 'full') setCamera({ target: 'full', follow: true, distance: 4.15, pitch: 68 });
    });
  }
  $('#live-camera-reset').addEventListener('click', resetCamera);
  $('#live-speed').addEventListener('input', (event) => {
    $('#live-speed-out').textContent = `${Number(event.target.value).toFixed(2)} m/s`;
    saveWorkspace();
    drawPathPlanner();
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
    if (['w', 'a', 's', 'd'].includes(key)) {
      event.preventDefault();
      if (!state.sessionActive && event.target === pathCanvas && !event.repeat) {
        const last = rawPathEndpoints().at(-1) || { x: 0, z: 0 };
        const step = 0.25 * (event.shiftKey ? 4 : 1);
        appendPathEndpoint({ x: last.x + (key === 'd' ? step : key === 'a' ? -step : 0), z: last.z + (key === 'w' ? step : key === 's' ? -step : 0) });
      } else setKey(key, true);
    }
  });
  window.addEventListener('keyup', (event) => {
    if (state.view !== 'live') return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); setKey(key, false); }
  });
  window.addEventListener('blur', () => { if (state.keys.size) { state.keys.clear(); updateKeyUi(); } });
  window.addEventListener('unified:view-change', (event) => {
    state.view = event.detail?.view || '';
    if (state.view === 'live') window.setTimeout(() => { resizePathPlanner(); sendCameraSettings(); }, 0);
    if (state.view !== 'live' && state.sessionActive) setSession(false);
  });
  window.addEventListener('message', (event) => {
    if (event.source !== player.contentWindow || event.origin !== MOTION_API || !event.data?.type) return;
    if (event.data.type === 'live-flow:arrow') handleArrow(event.data.key);
    if (event.data.type === 'live-flow:player-status') {
      if (event.data.position && Number.isFinite(Number(event.data.position.x)) && Number.isFinite(Number(event.data.position.z))) {
        state.livePosition = { x: Number(event.data.position.x), z: Number(event.data.position.z) };
      }
      if (event.data.camera && typeof event.data.camera === 'object') {
        const source = event.data.camera;
        state.camera = {
          ...state.camera,
          target: ['face', 'torso', 'hips', 'full'].includes(source.target) ? source.target : state.camera.target,
          follow: Boolean(source.follow), orbit: Boolean(source.orbit),
          orbitSpeed: finite(source.orbitSpeed, state.camera.orbitSpeed), smoothing: finite(source.smoothing, state.camera.smoothing),
          targetOffsetY: finite(source.targetOffsetY, state.camera.targetOffsetY), yaw: finite(source.yaw, state.camera.yaw),
          pitch: finite(source.pitch, state.camera.pitch), distance: finite(source.distance, state.camera.distance),
        };
        if (performance.now() - state.cameraStatusAt > 250) { state.cameraStatusAt = performance.now(); renderCameraControls(); }
      }
      if (event.data.error) {
        state.sessionActive = false;
        state.motionReady = false;
        stopTimeline();
        updateSessionUi(event.data.error);
        return;
      }
      if (state.sessionActive && Number.isFinite(Number(event.data.generationSeconds))) {
        const firstReady = !state.motionReady;
        state.motionReady = true;
        $('#live-latency').textContent = `${Number(event.data.generationSeconds).toFixed(2)}s replan · ${Number(event.data.realtimeFactor || 0).toFixed(1)}× realtime`;
        if (firstReady) startTimeline();
        pumpSpeech();
      }
      document.querySelectorAll('[data-live-key]').forEach((button) => button.classList.toggle('down', (event.data.keys || []).includes(button.dataset.liveKey)));
    }
    if (event.data.type === 'unified:player-ready') {
      sendCameraSettings();
      if (state.sessionActive) playerPost({ type: 'live-flow:start', cacheKey: effectiveKey(), speed: Number($('#live-speed').value), smoothing: 1, keys: [...state.keys] });
    }
  });

  restoreWorkspace();
  $('#live-speech-loop').checked = state.speechLoop;
  $('#live-embedding-loop').checked = state.embeddingLoop;
  $('#live-path-loop').checked = state.pathLoop;
  setCamera(state.camera, false);
  $('#live-speed').dispatchEvent(new Event('input'));
  renderEmbeddingControls();
  renderSpeechQueue();
  renderSpeechSchedule();
  renderEmbeddingSchedule();
  renderPathSchedule();
  updateSessionUi();
  new ResizeObserver(resizePathPlanner).observe(pathCanvas);
  refreshEmbeddings().finally(() => {
    pollControlCommands();
    publishControlState();
    window.setInterval(pollControlCommands, 250);
    window.setInterval(publishControlState, 1000);
  });
})();
