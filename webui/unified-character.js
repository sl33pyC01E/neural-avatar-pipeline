(() => {
  const faceFrame = document.querySelector('#face');
  const motionFrame = document.querySelector('#motion');
  const unifiedPlayer = document.querySelector('#unified-player');
  const faceHome = document.querySelector('#face-view');
  const motionHome = document.querySelector('#motion-view');
  const unifiedView = document.querySelector('#unified-view');
  const liveView = document.querySelector('#live-view');
  const unifiedStage = document.querySelector('#unified-stage');
  const liveStage = document.querySelector('#live-stage');
  const audio = document.querySelector('#unified-audio');
  const state = { view: 'face', face: null, motion: null, audioContext: null, audioDecode: null, audioSource: null, timer: 0, stopTimer: 0, startedAt: 0, total: 0, exporting: false };
  const motionOrigin = `${window.location.protocol}//${window.location.hostname}:8793`;

  const clampOffset = (value) => Math.max(0, Number(value) || 0);
  const seconds = (value) => `${Math.max(0, Number(value) || 0).toFixed(1)}s`;
  const postMotion = (message) => motionFrame.contentWindow?.postMessage(message, motionOrigin);
  const postPlayer = (message) => unifiedPlayer.contentWindow?.postMessage(message, motionOrigin);

  function setView(name) {
    state.view = name;
    document.querySelectorAll('button[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    for (const [viewName, element] of [['face', faceHome], ['motion', motionHome], ['unified', unifiedView], ['live', liveView]]) element.classList.toggle('active', viewName === name);
    if (name === 'unified') {
      unifiedStage.prepend(unifiedPlayer);
      postPlayer({ type: 'unified:preview-mode', enabled: true });
      if (state.face) postPlayer({ type: 'unified:set-face-track', track: state.face.motionPayload });
      if (state.motion) postPlayer({ type: 'unified:set-motion-track', track: state.motion.motionPayload });
    }
    if (name === 'live') {
      liveStage.prepend(unifiedPlayer);
      postPlayer({ type: 'unified:preview-mode', enabled: true });
      postPlayer({ type: 'live-flow:status-query' });
    }
    window.setTimeout(() => postPlayer({ type: 'unified:resize' }), 50);
    window.dispatchEvent(new CustomEvent('unified:view-change', { detail: { view: name } }));
  }

  document.querySelectorAll('button[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  motionFrame.addEventListener('load', () => {
    postMotion({ type: 'unified:track-query' });
  });
  unifiedPlayer.addEventListener('load', () => {
    postPlayer({ type: 'unified:preview-mode', enabled: true });
  });

  function updateSchedule() {
    const faceStart = clampOffset(document.querySelector('#face-start').value);
    const motionStart = clampOffset(document.querySelector('#motion-start').value);
    const faceEnd = state.face ? faceStart + state.face.duration : 0;
    const motionEnd = state.motion ? motionStart + state.motion.duration : 0;
    const total = Math.max(faceEnd, motionEnd, 0.1);
    state.total = total;
    document.querySelector('#schedule-end').textContent = seconds(total);
    const place = (id, start, duration, present) => {
      const block = document.querySelector(id);
      block.style.display = present ? 'block' : 'none';
      block.style.left = `${start / total * 100}%`;
      block.style.width = `${Math.max(0, duration) / total * 100}%`;
    };
    place('#face-block', faceStart, state.face?.duration || 0, Boolean(state.face));
    place('#motion-block', motionStart, state.motion?.duration || 0, Boolean(state.motion));
    document.querySelector('#play-unified').disabled = !(state.face && state.motion);
    document.querySelector('#export-unified').disabled = !(state.face && state.motion) || state.exporting;
    document.querySelector('#unified-status').textContent = state.face && state.motion
      ? `Ready · ${seconds(total)} sequence on the local VRM.`
      : 'Waiting for a face track and an ARDY track.';
  }

  function installFaceTrack(track) {
    if (!track?.frames?.length || !track?.audio?.buffer) return;
    const audioBlob = new Blob([track.audio.buffer], { type: track.audio.type || 'audio/wav' });
    audio.src = URL.createObjectURL(audioBlob);
    state.audioContext ||= new AudioContext();
    state.audioDecode = state.audioContext.decodeAudioData(track.audio.buffer.slice(0));
    state.face = { ...track, duration: Number(track.duration) || track.frames.length / track.fps, motionPayload: track };
    document.querySelector('#face-track-card').classList.add('ready');
    document.querySelector('#face-track-state').textContent = 'captured';
    document.querySelector('#face-track-name').textContent = track.name || `${track.driverName || track.driver} face track`;
    document.querySelector('#face-track-meta').textContent = `${track.driverName || track.driver} · ${track.frames.length} frames · ${seconds(state.face.duration)} · Anna audio`;
    postPlayer({ type: 'unified:set-face-track', track });
    updateSchedule();
  }

  function installMotionTrack(track) {
    if (!track?.frames) return;
    state.motion = { ...track, duration: Number(track.duration) || track.frames / track.fps, motionPayload: track.playback };
    document.querySelector('#motion-track-card').classList.add('ready');
    document.querySelector('#motion-track-state').textContent = 'captured';
    document.querySelector('#motion-track-name').textContent = track.name || 'ARDY motion track';
    document.querySelector('#motion-track-meta').textContent = `ARDY · ${track.frames} frames · ${seconds(state.motion.duration)}`;
    postPlayer({ type: 'unified:set-motion-track', track: track.playback });
    updateSchedule();
  }

  window.addEventListener('message', (event) => {
    if (event.source === faceFrame.contentWindow && event.data?.type === 'unified:face-track') installFaceTrack(event.data.track);
    if (event.source === motionFrame.contentWindow && event.data?.type === 'unified:motion-track') installMotionTrack(event.data.track);
    if (event.source === unifiedPlayer.contentWindow && event.data?.type === 'unified:player-ready') {
      postPlayer({ type: 'unified:preview-mode', enabled: true });
      if (state.face) postPlayer({ type: 'unified:set-face-track', track: state.face.motionPayload });
      if (state.motion) postPlayer({ type: 'unified:set-motion-track', track: state.motion.motionPayload });
    }
    if (event.source === unifiedPlayer.contentWindow && event.data?.type === 'unified:playback-ended' && !state.exporting) {
      document.querySelector('#unified-status').textContent = 'Sequence complete.';
    }
    if (event.source === unifiedPlayer.contentWindow && event.data?.type === 'unified:export-status') {
      document.querySelector('#unified-status').textContent = event.data.message || 'Exporting…';
    }
    if (event.source === unifiedPlayer.contentWindow && event.data?.type === 'unified:export-ended') {
      state.exporting = false;
      document.querySelector('#export-unified').textContent = 'Export MP4';
      updateSchedule();
      document.querySelector('#unified-status').textContent = event.data.ok
        ? 'Unified MP4 exported.'
        : event.data.error || 'Unified MP4 export failed.';
    }
  });

  function stopPlayback(message = 'Stopped.') {
    window.cancelAnimationFrame(state.timer);
    window.clearTimeout(state.stopTimer);
    audio.pause(); audio.currentTime = 0;
    if (state.audioSource) { try { state.audioSource.stop(); } catch {} state.audioSource = null; }
    postPlayer({ type: 'unified:stop' });
    document.querySelector('#unified-clock').textContent = '0.0s';
    document.querySelector('#unified-status').textContent = message;
  }

  document.querySelector('#play-unified').addEventListener('click', async () => {
    if (!state.face || !state.motion) return;
    stopPlayback('Starting…');
    const faceStart = clampOffset(document.querySelector('#face-start').value);
    const motionStart = clampOffset(document.querySelector('#motion-start').value);
    updateSchedule();
    state.startedAt = performance.now();
    postPlayer({ type: 'unified:play', faceOffset: faceStart, motionOffset: motionStart, totalDuration: state.total });
    try {
      const decodedAudio = await state.audioDecode;
      await state.audioContext.resume();
      const source = state.audioContext.createBufferSource();
      source.buffer = decodedAudio;
      source.connect(state.audioContext.destination);
      source.start(state.audioContext.currentTime + faceStart);
      state.audioSource = source;
    } catch {
      document.querySelector('#unified-status').textContent = 'Playback started, but the face audio could not be scheduled.';
    }
    const tick = (now) => {
      const elapsed = Math.min(state.total, (now - state.startedAt) / 1000);
      document.querySelector('#unified-clock').textContent = seconds(elapsed);
      document.querySelector('#unified-status').textContent = `Playing · ${seconds(elapsed)} / ${seconds(state.total)}`;
      if (elapsed < state.total) state.timer = window.requestAnimationFrame(tick);
      else document.querySelector('#unified-status').textContent = 'Sequence complete.';
    };
    state.timer = window.requestAnimationFrame(tick);
    state.stopTimer = window.setTimeout(() => { audio.pause(); }, (state.total + 0.1) * 1000);
  });
  document.querySelector('#stop-unified').addEventListener('click', () => stopPlayback());
  document.querySelector('#export-unified').addEventListener('click', () => {
    if (!state.face || !state.motion || state.exporting) return;
    stopPlayback('Preparing unified MP4 export…');
    updateSchedule();
    state.exporting = true;
    document.querySelector('#export-unified').disabled = true;
    document.querySelector('#export-unified').textContent = 'Exporting…';
    postPlayer({
      type: 'unified:export',
      faceOffset: clampOffset(document.querySelector('#face-start').value),
      motionOffset: clampOffset(document.querySelector('#motion-start').value),
      totalDuration: state.total,
    });
  });
  document.querySelector('#face-start').addEventListener('input', updateSchedule);
  document.querySelector('#motion-start').addEventListener('input', updateSchedule);
  updateSchedule();
})();
