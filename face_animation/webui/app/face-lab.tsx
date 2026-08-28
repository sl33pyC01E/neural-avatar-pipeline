'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

const API = 'http://127.0.0.1:8794';
const TTS_API = 'http://127.0.0.1:8796';
const LAM_API = 'http://127.0.0.1:8797';
const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'];

type Driver = { id: string; name: string; detail: string; state: string; runnable: boolean; note: string };
type PreviewModel = { id: string; name: string; detail: string; ready: boolean; sizeMb: number; url: string };
type LabStatus = { driver: Driver; avatar: PreviewModel };
type TTSStatus = { ok: boolean; voice: string; device: string; ready: boolean; loading: boolean; loadMs: number | null; error: string | null };
type Inference = { fps: number; duration: number; latencyMs: number; names: string[]; frames: number[][] };
type ScaleKey = 'eyes' | 'head' | 'mouth';
type ScaleSetting = { min: number; max: number; value: number };
type RetargetScales = Record<ScaleKey, ScaleSetting>;

const FALLBACK_DRIVER: Driver = { id: 'lam', name: 'LAM Audio2Expression', detail: 'Streaming Wav2Vec · 52 ARKit controls · CUDA', state: 'checking', runnable: false, note: 'Checking the LAM worker…' };

function clamp(value: number) { return Math.max(0, Math.min(1, value || 0)); }

function FaceViewer({ model, names, frame, manualViseme, motionTime, playing, naturalMotion, scales, onLoaded }: {
  model?: PreviewModel;
  names: string[];
  frame?: number[];
  manualViseme: string | null;
  motionTime: number;
  playing: boolean;
  naturalMotion: boolean;
  scales: RetargetScales;
  onLoaded: (detail: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<{ vrm: VRM; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; target: THREE.Vector3; morphs: Array<{ mesh: THREE.Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }; lookup: Map<string, number> }>; head: THREE.Object3D | null; neck: THREE.Object3D | null; headRest: THREE.Quaternion; neckRest: THREE.Quaternion; raf: number } | null>(null);

  const applyMorphs = useCallback((values?: number[], manual?: string | null, time = 0, isPlaying = false) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const expression = runtime.vrm.expressionManager;
    const mouthWeight = (value: number) => clamp(value * scales.mouth.value);
    const eyeWeight = (value: number) => clamp(value * scales.eyes.value);
    expression?.resetValues();
    for (const { mesh } of runtime.morphs) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
    const set = (name: string, weight: number) => {
      const key = name.toLowerCase();
      for (const { mesh, lookup } of runtime.morphs) {
        const index = lookup.get(key);
        if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = Math.max(mesh.morphTargetInfluences[index] || 0, clamp(weight));
      }
    };
    const setExpression = (name: string, weight: number) => expression?.setValue(name, clamp(weight));
    const setVowels = (vowels: { aa: number; ih: number; ou: number; E: number; oh: number }) => {
      if (model?.id === 'zome') for (const [viseme, weight] of Object.entries(vowels)) set(`VRC_v_${viseme}`, mouthWeight(weight));
      setExpression('aa', mouthWeight(vowels.aa)); setExpression('ih', mouthWeight(vowels.ih)); setExpression('ou', mouthWeight(vowels.ou)); setExpression('ee', mouthWeight(vowels.E)); setExpression('oh', mouthWeight(vowels.oh));
    };
    const resetBones = () => {
      if (runtime.head) runtime.head.quaternion.copy(runtime.headRest);
      if (runtime.neck) runtime.neck.quaternion.copy(runtime.neckRest);
    };
    if (manual) {
      const zomeTarget = manual === 'sil' ? 'VRC_v_sil' : `VRC_v_${manual}`;
      set(zomeTarget, mouthWeight(1));
      const manualExpression: Record<string, string> = { aa: 'aa', E: 'ee', ih: 'ih', oh: 'oh', ou: 'ou' };
      if (manualExpression[manual]) setExpression(manualExpression[manual], mouthWeight(1));
      resetBones();
      return;
    }
    const index = new Map(names.map((name, i) => [name, i]));
    const get = (name: string) => clamp(values?.[index.get(name) ?? -1] || 0);
    let engineBlinkLeft = 0, engineBlinkRight = 0;
    if (values?.length && names.length === values.length) {
      const pair = (left: string, right: string) => (get(left) + get(right)) * 0.5;
      const jaw = get('jawOpen'), funnel = get('mouthFunnel'), pucker = get('mouthPucker');
      const stretch = pair('mouthStretchLeft', 'mouthStretchRight'), smile = pair('mouthSmileLeft', 'mouthSmileRight');
      const press = pair('mouthPressLeft', 'mouthPressRight'), lower = pair('mouthLowerDownLeft', 'mouthLowerDownRight');
      const weights: Record<string, number> = {
        PP: Math.max(press, get('mouthClose') * .75), FF: lower * .58, TH: get('tongueOut'), DD: Math.min(jaw, .42) * .45,
        kk: get('mouthShrugLower') * .42, CH: funnel * .5, SS: stretch * .48, nn: get('mouthRollUpper') * .48,
        RR: get('mouthShrugUpper') * .45, aa: jaw * (1 - Math.max(funnel, pucker) * .7), E: Math.max(stretch * .68, lower * .28),
        ih: Math.max(smile * .58, stretch * .45), oh: Math.max(funnel * .82, jaw * funnel), ou: pucker,
      };
      setVowels({ aa: weights.aa, ih: weights.ih, ou: weights.ou, E: weights.E, oh: weights.oh });
      if (model?.id === 'zome') for (const [viseme, weight] of Object.entries(weights)) set(`VRC_v_${viseme}`, mouthWeight(weight));
      engineBlinkLeft = get('eyeBlinkLeft'); engineBlinkRight = get('eyeBlinkRight');
      set('EyeWideLeft', eyeWeight(get('eyeWideLeft'))); set('EyeWideRight', eyeWeight(get('eyeWideRight')));
      set('EyeShrinkLeft', eyeWeight(get('eyeSquintLeft'))); set('EyeShrinkRight', eyeWeight(get('eyeSquintRight')));
      set('BrowDownLeft', get('browDownLeft')); set('BrowDownRight', get('browDownRight'));
      set('BrowRiseLeft', get('browOuterUpLeft')); set('BrowRiseRight', get('browOuterUpRight'));
      set('BrowInnerLeft', get('browInnerUp')); set('BrowInnerRight', get('browInnerUp'));
      set('MouthSmile', smile); set('MouthTrouble', pair('mouthFrownLeft', 'mouthFrownRight'));
      const lookLeft = pair('eyeLookOutLeft', 'eyeLookInRight');
      const lookRight = pair('eyeLookInLeft', 'eyeLookOutRight');
      setExpression('lookLeft', eyeWeight(lookLeft)); setExpression('lookRight', eyeWeight(lookRight));
      setExpression('lookUp', eyeWeight(pair('eyeLookUpLeft', 'eyeLookUpRight'))); setExpression('lookDown', eyeWeight(pair('eyeLookDownLeft', 'eyeLookDownRight')));
    }
    let proceduralBlink = 0;
    if (naturalMotion && isPlaying) {
      const cycle = time % 7.4;
      const blinkPulse = (center: number) => Math.exp(-Math.pow((cycle - center) / .085, 2));
      proceduralBlink = Math.max(blinkPulse(2.15), blinkPulse(5.85));
      const gazeX = Math.sin(time * .53) * .32 + Math.sin(time * 1.37 + .8) * .08;
      const gazeY = Math.sin(time * .37 + 1.2) * .18;
      setExpression(gazeX < 0 ? 'lookLeft' : 'lookRight', eyeWeight(Math.abs(gazeX)));
      setExpression(gazeY < 0 ? 'lookDown' : 'lookUp', eyeWeight(Math.abs(gazeY)));
      const headEuler = new THREE.Euler(Math.sin(time * .77 + .5) * .025 * scales.head.value, Math.sin(time * .49) * .055 * scales.head.value, Math.sin(time * .31 + 1.7) * .018 * scales.head.value, 'YXZ');
      const neckEuler = new THREE.Euler(headEuler.x * .35, headEuler.y * .3, headEuler.z * .4, 'YXZ');
      if (runtime.head) runtime.head.quaternion.copy(runtime.headRest).multiply(new THREE.Quaternion().setFromEuler(headEuler));
      if (runtime.neck) runtime.neck.quaternion.copy(runtime.neckRest).multiply(new THREE.Quaternion().setFromEuler(neckEuler));
    } else resetBones();
    setExpression('blinkLeft', eyeWeight(Math.max(engineBlinkLeft, proceduralBlink)));
    setExpression('blinkRight', eyeWeight(Math.max(engineBlinkRight, proceduralBlink)));
    expression?.update();
  }, [model?.id, names, naturalMotion, scales.eyes.value, scales.head.value, scales.mouth.value]);

  useEffect(() => { applyMorphs(frame, manualViseme, motionTime, playing); }, [applyMorphs, frame, manualViseme, motionTime, playing]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !model?.ready) return;
    let disposed = false;
    host.replaceChildren();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, .01, 20);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x0b1117, 1); host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x26342f, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-1.5, 2.7, -2.5); scene.add(key);
    const loader = new GLTFLoader(); loader.register((parser) => new VRMLoaderPlugin(parser));
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let yaw = 0, pitch = 0, radius = .72;
    const target = new THREE.Vector3(0, 1.45, 0);
    const updateCamera = () => { camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * radius, target.y + Math.sin(pitch) * radius, target.z + Math.cos(yaw) * Math.cos(pitch) * radius); camera.lookAt(target); };
    const resize = () => { const rect = host.getBoundingClientRect(); renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height); camera.updateProjectionMatrix(); };
    const pointerDown = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY, yaw, pitch }; renderer.domElement.setPointerCapture(event.pointerId); };
    const pointerMove = (event: PointerEvent) => { if (!drag) return; yaw = drag.yaw - (event.clientX - drag.x) * .008; pitch = Math.max(-.55, Math.min(.55, drag.pitch + (event.clientY - drag.y) * .006)); updateCamera(); };
    const pointerUp = () => { drag = null; };
    const wheel = (event: WheelEvent) => { event.preventDefault(); radius = Math.max(.38, Math.min(1.35, radius * Math.exp(event.deltaY * .001))); updateCamera(); };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointermove', pointerMove); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    const observer = new ResizeObserver(resize); observer.observe(host); resize(); updateCamera();

    loader.load(model.url, (gltf) => {
      if (disposed) return;
      const vrm = gltf.userData.vrm as VRM;
      if (!vrm) { onLoaded('The selected file did not load as a VRM.'); return; }
      VRMUtils.rotateVRM0(vrm); vrm.scene.traverse((object) => { object.frustumCulled = false; }); scene.add(vrm.scene); vrm.scene.updateMatrixWorld(true);
      const head = vrm.humanoid?.getNormalizedBoneNode('head');
      if (head) head.getWorldPosition(target); else { const box = new THREE.Box3().setFromObject(vrm.scene); target.set(0, box.max.y * .82, 0); }
      radius = model.id === 'zome' ? .66 : .7; updateCamera();
      const morphs: Array<{ mesh: THREE.Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }; lookup: Map<string, number> }> = [];
      vrm.scene.traverse((object) => { const mesh = object as THREE.Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }; if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) morphs.push({ mesh, lookup: new Map(Object.entries(mesh.morphTargetDictionary).map(([name, idx]) => [name.toLowerCase(), idx])) }); });
      const neck = vrm.humanoid?.getNormalizedBoneNode('neck') || null;
      const runtime = { vrm, renderer, camera, target, morphs, head: head || null, neck, headRest: head?.quaternion.clone() || new THREE.Quaternion(), neckRest: neck?.quaternion.clone() || new THREE.Quaternion(), raf: 0 }; runtimeRef.current = runtime;
      let previous = performance.now();
      const animate = (now: number) => { const delta = Math.min(.05, (now - previous) / 1000); previous = now; vrm.update(delta); renderer.render(scene, camera); runtime.raf = requestAnimationFrame(animate); };
      runtime.raf = requestAnimationFrame(animate); onLoaded(`${model.name} loaded · ${morphs.reduce((total, item) => total + item.lookup.size, 0)} morph bindings`); applyMorphs(frame, manualViseme, motionTime, playing);
    }, undefined, (error) => onLoaded(`Could not load ${model.name}: ${String(error)}`));

    return () => {
      disposed = true; observer.disconnect(); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('wheel', wheel);
      if (runtimeRef.current) { cancelAnimationFrame(runtimeRef.current.raf); VRMUtils.deepDispose(runtimeRef.current.vrm.scene); runtimeRef.current = null; }
      renderer.dispose(); host.replaceChildren();
    };
  // Loading is intentionally keyed only to the model; frame updates are handled by the separate morph effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, model?.ready, model?.url, onLoaded]);

  return <div className="three-host" ref={hostRef} />;
}

export default function FaceLab() {
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [backendError, setBackendError] = useState('Connecting to the local face-animation backend…');
  const [ttsStatus, setTtsStatus] = useState<TTSStatus | null>(null);
  const [viewerKey, setViewerKey] = useState(0);
  const [viewerStatus, setViewerStatus] = useState('Loading VRM renderer…');
  const [fileName, setFileName] = useState('');
  const [audioFileUrl, setAudioFileUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [inference, setInference] = useState<Inference | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [manualViseme, setManualViseme] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ttsText, setTtsText] = useState("Hi, I'm Anna. This is a low-latency facial animation test.");
  const [message, setMessage] = useState('Generate or choose an audio clip, then run LAM facial animation.');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [naturalMotion, setNaturalMotion] = useState(true);
  const [scales, setScales] = useState<RetargetScales>({ eyes: { min: 0, max: 2, value: 1.55 }, head: { min: 0, max: 2, value: 1 }, mouth: { min: 0, max: 2.5, value: 0.57 } });
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef(0);

  const updateScale = (key: ScaleKey, field: keyof ScaleSetting, raw: string) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return;
    setScales((current) => {
      const next = { ...current[key], [field]: numeric };
      if (field === 'min' && next.min >= next.max) next.max = next.min + .05;
      if (field === 'max' && next.max <= next.min) next.min = next.max - .05;
      next.value = Math.max(next.min, Math.min(next.max, next.value));
      return { ...current, [key]: next };
    });
  };

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/status`, { cache: 'no-store' }); const result = await response.json() as LabStatus & { ok: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || 'Backend unavailable');
      setStatus(result); setBackendError('Local backend connected.');
    } catch { setBackendError('Backend offline — use the repository-root launch.bat to start the complete pipeline.'); }
    try {
      const response = await fetch(`${TTS_API}/api/status`, { cache: 'no-store' }); const result = await response.json() as TTSStatus & { error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || 'PocketTTS unavailable');
      setTtsStatus(result);
    } catch { setTtsStatus(null); }
  }, []);
  useEffect(() => { const initial = window.setTimeout(refreshStatus, 0); const timer = window.setInterval(refreshStatus, 5000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [refreshStatus]);

  const selectedDriver = status?.driver || FALLBACK_DRIVER;
  const selectedModel = status?.avatar;
  useEffect(() => {
    if (!inference || !audioBlob || window.parent === window) return;
    let cancelled = false;
    void audioBlob.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      window.parent.postMessage({
        type: 'unified:face-track',
        track: {
          id: `face-${Date.now()}`,
          name: `${fileName || 'Audio'} · LAM`,
          driver: 'lam',
          driverName: selectedDriver.name,
          fps: inference.fps,
          duration: inference.duration || audioBuffer?.duration || inference.frames.length / inference.fps,
          names: inference.names,
          frames: inference.frames,
          naturalMotion,
          scales: { eyes: scales.eyes.value, head: scales.head.value, mouth: scales.mouth.value },
          audio: { buffer, type: audioBlob.type || 'audio/wav' },
        },
      }, '*');
    });
    return () => { cancelled = true; };
  }, [audioBlob, audioBuffer?.duration, fileName, inference, naturalMotion, scales.eyes.value, scales.head.value, scales.mouth.value, selectedDriver.name]);
  const frame = inference?.frames[Math.min(frameIndex, inference.frames.length - 1)];
  const duration = audioBuffer?.duration || 0;
  const progress = duration ? Math.min(100, currentTime / duration * 100) : 0;
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const stopAnimationClock = () => { cancelAnimationFrame(animationRef.current); };
  const tick = useCallback(function updateClock() { const audio = audioRef.current; if (!audio) return; setCurrentTime(audio.currentTime); if (inference) setFrameIndex(Math.min(inference.frames.length - 1, Math.floor(audio.currentTime * inference.fps))); if (!audio.paused && !audio.ended) animationRef.current = requestAnimationFrame(updateClock); }, [inference]);
  useEffect(() => () => stopAnimationClock(), []);

  const loadAudioBlob = async (blob: Blob, name: string) => {
    setBusy(true); setInference(null); setFrameIndex(0); setMessage('Decoding audio locally…');
    try {
      if (audioFileUrl) URL.revokeObjectURL(audioFileUrl);
      const url = URL.createObjectURL(blob); setAudioFileUrl(url); setAudioBlob(blob); setFileName(name);
      const context = new AudioContext(); const decoded = await context.decodeAudioData(await blob.arrayBuffer()); await context.close();
      setAudioBuffer(decoded); setMessage(`${name} ready · ${decoded.duration.toFixed(2)} seconds at ${decoded.sampleRate.toLocaleString()} Hz.`);
    } catch (error) { setMessage(`Could not decode audio: ${String(error)}`); } finally { setBusy(false); }
  };

  const synthesizeAnna = async () => {
    const text = ttsText.trim();
    if (!text) { setMessage('Enter something for Anna to say.'); return; }
    setBusy(true); setMessage(ttsStatus?.ready ? 'Anna is speaking locally…' : 'Loading PocketTTS and Anna for the first line…');
    try {
      const response = await fetch(`${TTS_API}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error || 'PocketTTS generation failed.'); }
      const latency = Number(response.headers.get('X-TTS-Latency-Ms') || 0);
      await loadAudioBlob(await response.blob(), `Anna · ${text.slice(0, 32)}${text.length > 32 ? '…' : ''}.wav`);
      setMessage(`Anna voice ready${latency ? ` · generated in ${(latency / 1000).toFixed(2)} seconds` : ''}. Run LAM to animate it.`);
      await refreshStatus();
    } catch (error) { setMessage(`PocketTTS error: ${String(error)}`); } finally { setBusy(false); }
  };

  const runDriver = async () => {
    if (!selectedDriver.runnable) { setMessage(selectedDriver.note); return; }
    if (!audioBuffer) { setMessage('Choose or record an audio clip first.'); fileInputRef.current?.click(); return; }
    setBusy(true); setMessage('Running LAM Audio2Expression…');
    try {
      const mono = audioBuffer.getChannelData(0); const payload = mono.buffer.slice(mono.byteOffset, mono.byteOffset + mono.byteLength);
      const response = await fetch(`${LAM_API}/api/infer/lam`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': String(audioBuffer.sampleRate) }, body: payload });
      const result = await response.json() as Inference & { ok: boolean; error?: string }; if (!response.ok || !result.ok) throw new Error(result.error || 'Inference failed.');
      setInference(result); setFrameIndex(0); setCurrentTime(0); setMessage(`Generated ${result.frames.length} frames in ${result.latencyMs.toFixed(1)} ms. Captured for Unified Character.`); await refreshStatus();
    } catch (error) { setMessage(`Driver error: ${String(error)}`); } finally { setBusy(false); }
  };

  const togglePlayback = async () => {
    const audio = audioRef.current; if (!audio || !audioFileUrl) { setMessage('Choose an audio clip first.'); return; }
    if (audio.paused) { if (audio.ended) audio.currentTime = 0; await audio.play(); setPlaying(true); stopAnimationClock(); animationRef.current = requestAnimationFrame(tick); }
    else { audio.pause(); setPlaying(false); stopAnimationClock(); setCurrentTime(audio.currentTime); }
  };

  const exportMp4 = async () => {
    const audio = audioRef.current;
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    if (!audio || !audioFileUrl || !inference) { setMessage('Run a driver on an audio clip before exporting.'); return; }
    if (!canvas) { setMessage('The local VRM preview is not ready for export.'); return; }
    const captureCanvas = canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream };
    const captureAudio = audio as HTMLAudioElement & { captureStream?: () => MediaStream };
    if (!captureCanvas.captureStream || !window.MediaRecorder) { setMessage('Video capture is not supported by this browser.'); return; }
    setExporting(true); setMessage('Recording the active face preview, then encoding MP4…');
    const streams: MediaStream[] = [];
    try {
      audio.pause(); audio.currentTime = 0; setCurrentTime(0); setFrameIndex(0);
      const videoStream = captureCanvas.captureStream(Math.min(60, Math.max(24, inference.fps || 30))); streams.push(videoStream);
      const audioStream = captureAudio.captureStream?.(); if (audioStream) streams.push(audioStream);
      const combined = new MediaStream([...videoStream.getVideoTracks(), ...(audioStream?.getAudioTracks() || [])]);
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
      const recorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 });
      const chunks: BlobPart[] = [];
      const capture = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error('The preview recorder stopped unexpectedly.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
      });
      audio.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); }, { once: true });
      recorder.start(500); await audio.play(); setPlaying(true); stopAnimationClock(); animationRef.current = requestAnimationFrame(tick);
      const recording = await capture;
      const response = await fetch(`${API}/api/export/mp4`, {
        method: 'POST',
        headers: {
          'Content-Type': recording.type || 'application/octet-stream',
          'X-Export-Duration': String(inference.duration || audio.duration),
        },
        body: recording,
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error || 'MP4 encoding failed.'); }
      const mp4 = await response.blob(); const url = URL.createObjectURL(mp4); const link = document.createElement('a');
      link.href = url; link.download = 'lam-vrm-facial-animation.mp4'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage(`MP4 exported · ${(mp4.size / 1048576).toFixed(1)} MB with voice audio.`);
    } catch (error) { setMessage(`MP4 export error: ${String(error)}`); }
    finally { streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop())); setPlaying(false); setExporting(false); }
  };

  const toggleRecording = async () => {
    if (recording && recorderRef.current) { recorderRef.current.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const recorder = new MediaRecorder(stream); chunksRef.current = []; recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); await loadAudioBlob(new Blob(chunksRef.current, { type: recorder.mimeType }), `microphone-${new Date().toISOString().slice(11, 19).replaceAll(':', '-')}.webm`); };
      recorder.start(); setRecording(true); setMessage('Recording microphone… click again to stop.');
    } catch (error) { setMessage(`Microphone unavailable: ${String(error)}`); }
  };

  const activeViseme = useMemo(() => {
    if (manualViseme) return manualViseme; if (!frame || !inference) return 'sil';
    const nameIndex = new Map(inference.names.map((name, index) => [name, index])); const value = (name: string) => frame[nameIndex.get(name) ?? -1] || 0;
    const candidates: Array<[string, number]> = [['aa', value('jawOpen')], ['oh', value('mouthFunnel')], ['ou', value('mouthPucker')], ['E', (value('mouthStretchLeft') + value('mouthStretchRight')) / 2], ['PP', (value('mouthPressLeft') + value('mouthPressRight')) / 2]];
    candidates.sort((a, b) => b[1] - a[1]); return candidates[0][1] > .08 ? candidates[0][0] : 'sil';
  }, [frame, inference, manualViseme]);

  return (
    <main className="lab-shell">
      <header className="topbar"><div className="brand-lockup"><div className="brand-mark">NA</div><div><h1>Neural Avatar Face</h1><p>PocketTTS voice · LAM facial animation</p></div></div><div className="top-status"><span className={`status-dot${status ? ' ready' : ''}`} />{backendError}</div></header>
      <div className="workspace-grid">
        <aside className="panel runtime-panel">
          <div className="panel-heading"><span>Face runtime</span><strong>Default pipeline</strong></div>
          <div className="driver-list"><div className="driver-card active"><span><b>{selectedDriver.name}</b><small>{selectedDriver.detail}</small></span><em className={selectedDriver.runnable ? 'ready-label' : ''}>{selectedDriver.state}</em></div></div>
          <div className="panel-section"><span className="section-label">Retarget profile</span><div className="select-like">{selectedModel?.name || 'Finding local avatar…'}</div><p className="helper">{selectedModel?.detail || 'Place an appropriately licensed VRM at vnyan/Zome.vrm.'}</p><div className="scale-controls">{(['eyes', 'head', 'mouth'] as ScaleKey[]).map((key) => <label className="scale-control" key={key}><span><b>{key}</b><output>{scales[key].value.toFixed(2)}×</output></span><div><input type="number" step="0.05" value={scales[key].min} aria-label={`${key} scale minimum`} onChange={(event) => updateScale(key, 'min', event.target.value)} /><input type="range" step="0.01" min={scales[key].min} max={scales[key].max} value={scales[key].value} aria-label={`${key} scale`} onChange={(event) => updateScale(key, 'value', event.target.value)} /><input type="number" step="0.05" value={scales[key].max} aria-label={`${key} scale maximum`} onChange={(event) => updateScale(key, 'max', event.target.value)} /></div></label>)}</div><button className={`motion-toggle${naturalMotion ? ' active' : ''}`} onClick={() => setNaturalMotion((value) => !value)}>Natural head + eyes · {naturalMotion ? 'on' : 'off'}</button></div>
          <div className="driver-note"><b>LAM only</b><span>{selectedDriver.note}</span></div>
        </aside>
        <section className="panel stage-panel">
          <div className="stage-head"><div><span>Live preview</span><strong>{selectedModel?.name || 'Local VRM'} · LAM</strong></div></div>
          <div className="viewport"><FaceViewer key={`avatar-${viewerKey}`} model={selectedModel} names={inference?.names || []} frame={frame} manualViseme={manualViseme} motionTime={currentTime} playing={playing} naturalMotion={naturalMotion} scales={scales} onLoaded={setViewerStatus} /><div className="viewport-chip"><span className={`status-dot${selectedModel?.ready ? ' ready' : ''}`} />{viewerStatus}</div><button className="reset-view" onClick={() => { setViewerKey((value) => value + 1); setViewerStatus('Resetting view…'); }}>Reload view</button></div>
          <div className="transport"><button className="play" onClick={togglePlayback}>{playing ? 'Ⅱ' : '▶'}</button><button className="timeline" aria-label="Audio timeline" onClick={(event) => { const audio = audioRef.current; if (!audio || !duration) return; const rect = event.currentTarget.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration)); tick(); }}><i style={{ width: `${progress}%` }} /></button><span>{formatTime(currentTime)} / {formatTime(duration)}</span><button className="export-button" disabled={exporting} onClick={exportMp4}>{exporting ? 'Encoding…' : 'Export MP4'}</button><audio ref={audioRef} src={audioFileUrl || undefined} onEnded={() => { stopAnimationClock(); setPlaying(false); setCurrentTime(duration); }} /></div>
        </section>
        <aside className="panel test-panel">
          <div className="panel-heading"><span>Session</span><strong>Audio test</strong></div>
          <div className="tts-box"><div className="voice-row"><span><i className={`status-dot${ttsStatus?.ready ? ' ready' : ''}`} />PocketTTS</span><b>anna · {ttsStatus?.device || 'checking'}</b></div><textarea value={ttsText} maxLength={800} aria-label="Text for Anna to speak" onChange={(event) => setTtsText(event.target.value)} /><button disabled={busy || !ttsStatus} onClick={synthesizeAnna}>{ttsStatus?.ready ? 'Generate Anna voice' : ttsStatus?.loading ? 'Anna is warming up…' : 'Anna voice offline'}</button></div>
          <input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) loadAudioBlob(file, file.name); }} />
          <button className="drop-zone" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) loadAudioBlob(file, file.name); }}><b>{fileName || 'Choose an audio clip'}</b><small>{fileName ? 'Click to replace · WAV, MP3, M4A, or WebM' : 'WAV, MP3, M4A, or WebM'}</small></button>
          <button className={`record-button${recording ? ' recording' : ''}`} onClick={toggleRecording}><span>●</span>{recording ? ' Stop recording' : ' Record microphone'}</button>
          <div className="metrics"><div><span>LAM</span><b>{selectedDriver.runnable ? 'Ready' : selectedDriver.state}</b></div><div><span>Avatar</span><b>{selectedModel?.ready ? 'Local VRM' : 'Missing'}</b></div><div><span>Rate</span><b>{inference?.fps || 30} fps</b></div><div><span>Latency</span><b>{inference ? `${inference.latencyMs.toFixed(1)} ms` : '—'}</b></div></div>
          <div className="panel-section grow"><span className="section-label">Viseme monitor · press to pose</span><div className="visemes">{VISEMES.map((viseme) => <button className={activeViseme === viseme ? 'active' : ''} key={viseme} onPointerDown={() => setManualViseme(viseme)} onPointerUp={() => setManualViseme(null)} onPointerLeave={() => setManualViseme(null)}>{viseme}</button>)}</div></div>
          <div className="session-message">{message}</div><button className="primary-action" disabled={busy} onClick={runDriver}>{busy ? 'Working…' : selectedDriver.runnable ? 'Generate LAM animation' : 'Show LAM status'}</button>
        </aside>
      </div>
    </main>
  );
}
