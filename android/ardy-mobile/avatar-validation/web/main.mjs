import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.js';
import { createRetargeter } from './retarget.mjs';
import { MotionBuffer } from './motion-buffer.mjs';
import { createFaceDriver } from './face.mjs';

const status = document.querySelector('#status');
const canvas = document.querySelector('canvas');
window.validationState = { ready: false, errors: [] };
function fail(error) {
  const message = String(error?.stack || error);
  status.textContent = message;
  window.validationState.errors.push(message);
  console.error(message);
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

async function start() {
  let visible=!document.hidden,frameId=0,initialized=false;
  function invalidate(){if(initialized&&visible&&!frameId)frameId=requestAnimationFrame(frame);}
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  function fitViewport() {
    const top = document.querySelector('header').getBoundingClientRect().bottom + 12;
    const bottom = document.querySelector('#panel').getBoundingClientRect().top - 10;
    canvas.style.top = `${top}px`;
    canvas.style.height = `${Math.max(100, bottom-top)}px`;
  }
  fitViewport(); window.addEventListener('resize',()=>{fitViewport();invalidate();});
  document.querySelector('details').addEventListener('toggle',()=>{fitViewport();invalidate();});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101b19');
  scene.add(new THREE.HemisphereLight(0xd7eee5, 0x49435b, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(1.5, 3.5, 2); scene.add(light);
  const grid = new THREE.GridHelper(12, 60, 0x537c6a, 0x243d32); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 30);
  let yaw = 0.18, pitch = 1.4, radius = 3.4;
  const target = new THREE.Vector3(0, 0.78, 0);
  const points = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); points.set(e.pointerId, [e.clientX, e.clientY]); });
  canvas.addEventListener('pointerup', e => { points.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointercancel', e => { points.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointermove', e => {
    const old = points.get(e.pointerId); if (!old) return;
    points.set(e.pointerId, [e.clientX, e.clientY]);
    if (points.size === 1) { yaw -= (e.clientX - old[0]) * .008; pitch = THREE.MathUtils.clamp(pitch - (e.clientY - old[1]) * .008, .3, 2.6); }
    else { const [a,b] = [...points.values()]; const d = Math.hypot(a[0]-b[0], a[1]-b[1]); if (pinch && d) radius = THREE.MathUtils.clamp(radius * pinch / d, 1, 7); pinch = d; }
    invalidate();
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); radius = THREE.MathUtils.clamp(radius * Math.exp(e.deltaY * .001), 1, 7); invalidate(); }, { passive: false });

  const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser));
  const [gltf, bind, motion, provenance] = await Promise.all([
    loader.loadAsync('./cleopatra.vrm'), fetch('./bind.json').then(r => r.json()),
    fetch('./motion.json').then(r => r.json()), fetch('./provenance.json').then(r => r.json()),
  ]);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM loader did not produce an avatar');
  VRMUtils.rotateVRM0(vrm);
  vrm.humanoid.autoUpdateHumanBones = true;
  const geometryStats = () => {
    const geometries = new Set(); vrm.scene.traverse(o => { if (o.isMesh) geometries.add(o.geometry); });
    return { geometries: geometries.size, vertices: [...geometries].reduce((sum, g) => sum + g.attributes.position.count, 0) };
  };
  const before = geometryStats();
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  const after = geometryStats();
  vrm.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  scene.add(vrm.scene); vrm.scene.updateMatrixWorld(true);
  const faceDriver=createFaceDriver(vrm);let speaking=false;const faceSegments=[];
  const position = name => vrm.humanoid.getRawBoneNode(name)?.getWorldPosition(new THREE.Vector3());
  const feet = ['leftFoot','leftToes','rightFoot','rightToes'].map(position).filter(Boolean);
  const alignment = { hipsHeightM: position('hips').y, floorOffsetM: Math.min(...feet.map(p => p.y)) };
  const retarget = createRetargeter(vrm, bind, alignment);
  retarget.reset();
  const skeleton = new THREE.SkeletonHelper(vrm.scene); skeleton.visible = false; scene.add(skeleton);
  document.querySelector('#skeleton').onclick = e => { skeleton.visible = !skeleton.visible; e.target.setAttribute('aria-pressed', skeleton.visible); invalidate(); };
  let physics = false;
  document.querySelector('#physics').onclick = e => { physics = !physics; vrm.springBoneManager?.setInitState(); e.target.setAttribute('aria-pressed', physics); invalidate(); };
  let mode = 'replay', started = performance.now();
  const liveBuffer=new MotionBuffer();let pending=false,liveProfile='core40',liveError=false,livePaused=false,liveStream='';
  function setMode(value) {
    if (!['rest', 'replay', 'turn','live'].includes(value)) throw new Error('Unknown mode');
    if(value!=='live'){window.Cleo?.stop();liveBuffer.clear();pending=false;liveStream='';}
    mode = value; started = performance.now(); retarget.reset(); vrm.springBoneManager?.setInitState();
    if(value==='rest')status.textContent=`Rest pose · display sleeps until input\n${after.vertices.toLocaleString()} vertices`;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    invalidate();
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  // Local replay/renderer inspection hook. Native engines are exposed only on the offline asset origin.
  window.avatarValidation = { setMode, retarget, vrm, renderer, motion, bind, alignment };
  const matrixQuaternion = values => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(
    ...values[0], 0, ...values[1], 0, ...values[2], 0, 0, 0, 0, 1)).normalize();
  const rotations = motion.rotations.map(frame => frame.map(matrixQuaternion));
  const toMatrix = q => { const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; return [[e[0],e[4],e[8]], [e[1],e[5],e[9]], [e[2],e[6],e[10]]]; };
  const engineStatus=document.querySelector('#engine-status'), bank=document.querySelector('#bank');
  function requestMotion() {
    const horizon=liveProfile==='core40'?40:8;
    if(mode==='live'&&visible&&!pending&&!liveError&&!livePaused&&liveBuffer.remaining<=horizon+1&&window.Cleo) {
      pending=true;window.Cleo.next(); // Ready events retry rejected requests; no idle polling.
    }
  }
  window.cleoEvent=event=>{
    // A queued native result may arrive after a profile switch or a recreated WebView.
    if((event.type==='motion'||event.type==='motionError')&&event.streamId!==liveStream)return;
    if(event.type==='state') {
      const selected=bank.value||event.lastEmbedding;bank.replaceChildren();
      for(const item of event.bank) { const option=document.createElement('option');option.value=item.id;option.textContent=item.nickname||item.text;bank.append(option); }
      if([...bank.options].some(o=>o.value===selected))bank.value=selected;
      if(mode!=='live'&&event.lastProfile)document.querySelector('#profile').value=event.lastProfile;
      document.querySelector('#memory').value=String(event.memoryBudgetMiB);
      document.querySelector('#embed').disabled=!event.llmNative||!event.llmModel;
      engineStatus.textContent=`Ardy: ${event.core40?'Core-40 ready':'Core-40 needs models'} · ${event.core8?'Core-8 ready':'Core-8 needs models'}\nLLM2Vec: ${!event.llmNative?'native backend unavailable':event.llmModel?'model ready':'import compatible GGUF'} · Anna available`;
    } else if(event.type==='motion') {
      if(mode!=='live'||event.profile!==liveProfile)return;
      try{liveBuffer.append(event);engineStatus.textContent=`${liveProfile} · ${(event.generationMs/1000).toFixed(2)} s generation · ${(liveBuffer.remaining/20).toFixed(1)} s buffered`;}
      catch(error){liveError=true;window.Cleo?.stop();engineStatus.textContent=error.message;}
      pending=false;requestMotion();invalidate();
    } else if(event.type==='ready'||event.type==='configured') {pending=false;requestMotion();}
    else if(event.type==='face') {
      if(event.names?.length!==52||event.fps!==30||!Number.isFinite(event.startSeconds))throw new Error('Invalid LAM timeline');
      for(const frame of event.frames)if(frame.length!==52||frame.some(v=>!Number.isFinite(v)))throw new Error('Invalid LAM expression');
      faceSegments.push(event);if(faceSegments.length>8)faceSegments.shift();invalidate();
    }
    else if(event.type==='speechStart'){speaking=true;faceSegments.length=0;faceDriver.clear();engineStatus.textContent=event.message;invalidate();}
    else if(event.type==='speechEnd'){speaking=false;faceSegments.length=0;faceDriver.clear();engineStatus.textContent=event.message;invalidate();}
    else if(event.type==='embedding') {engineStatus.textContent='Embedding cached';}
    else if(event.message) {
      engineStatus.textContent=event.message;
      if(event.type==='motionError'||event.type==='stopped'){liveError=true;pending=false;window.Cleo?.stop();invalidate();}
    }
    fitViewport();
  };
  document.querySelector('#live').onclick=()=>{
    const selected=document.querySelector('#profile').value;
    if(mode!=='live'||selected!==liveProfile||liveError){liveBuffer.clear();pending=false;liveStream=crypto.randomUUID();setMode('live');}
    liveProfile=selected;liveError=false;livePaused=false;window.Cleo?.start(selected,bank.value,liveStream);requestMotion();invalidate();
  };
  document.querySelector('#stop-motion').onclick=()=>{window.Cleo?.pause();livePaused=true;engineStatus.textContent='Motion paused';};
  document.querySelector('#embed').onclick=()=>{engineStatus.textContent='Creating a compatible embedding…';window.Cleo?.embed(document.querySelector('#motion-text').value);};
  document.querySelector('#speak').onclick=()=>window.Cleo?.speak(document.querySelector('#speech-text').value);
  document.querySelector('#quiet').onclick=()=>window.Cleo?.quiet();
  document.querySelector('#import').onclick=()=>window.Cleo?.importModels();
  document.querySelector('#memory').onchange=e=>window.Cleo?.memoryBudget(Number(e.target.value));
  if(window.Cleo)window.Cleo.state();else engineStatus.textContent='Native engines are available in the Android app.';
  const standing = bind.restJoints[0][1] - Math.min(...bind.restJoints.map(p => p[1]));
  let last = performance.now(), reportAt = last, ticks = 0, samples = [];
  window.validationState = { ready: true, errors: [], before, after, provenance, alignment };
  console.log('CLEO_READY ' + JSON.stringify(window.validationState));
  function frame(now) {
    frameId=0;if(!visible)return;
    const workStarted = performance.now();
    const dt = Math.min((now-last)/1000, .05); last = now;
    const elapsed = (now - started)/1000;
    const currentRoot = [0, standing, 0];
    if(mode==='live') {
      const sample=liveBuffer.sample(liveError||livePaused?0:dt);
      if(sample) {
        const {a,b,alpha}=sample;
        const joints=a.joints.map((p,j)=>p.map((v,k)=>THREE.MathUtils.lerp(v,b.joints[j][k],alpha)));
        for(let k=0;k<3;k++)currentRoot[k]=THREE.MathUtils.lerp(a.root[k],b.root[k],alpha);
        a.quaternions??=a.rotations.map(matrixQuaternion);b.quaternions??=b.rotations.map(matrixQuaternion);
        const local=a.quaternions.map((q,j)=>toMatrix(q.clone().slerp(b.quaternions[j],alpha)));
        retarget.apply(joints,currentRoot,local);
      }
      requestMotion();
    } else if (mode === 'replay') {
      const p = elapsed * motion.fps % motion.joints.length;
      const a = Math.floor(p), b = Math.min(a+1, motion.joints.length-1), alpha = p-a;
      const joints = motion.joints[a].map((p, j) => p.map((v,k) => THREE.MathUtils.lerp(v, motion.joints[b][j][k], alpha)));
      for (let k=0;k<3;k++) currentRoot[k] = THREE.MathUtils.lerp(motion.rootPositions[a][k], motion.rootPositions[b][k], alpha);
      const local = rotations[a].map((q,j) => toMatrix(q.clone().slerp(rotations[b][j], alpha)));
      retarget.apply(joints, currentRoot, local);
    } else if (mode === 'turn') {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), elapsed * Math.PI / 3);
      const joints = bind.restJoints.map(p => new THREE.Vector3(...p).applyQuaternion(q).toArray());
      const local = bind.restJoints.map(() => [[1,0,0],[0,1,0],[0,0,1]]); local[0] = toMatrix(q);
      retarget.apply(joints, currentRoot, local);
    }
    // Dynamics are opt-in so geometry/retargeting can first be checked deterministically.
    if(speaking&&faceSegments.length) {
      const time=window.Cleo?.playbackSeconds()??-1;
      if(time>=0) {
        while(faceSegments.length>1&&faceSegments[1].startSeconds<=time)faceSegments.shift();
        const segment=faceSegments[0];
        const position=THREE.MathUtils.clamp((time-segment.startSeconds)*30,0,segment.frames.length-1);
        const a=Math.floor(position),b=Math.min(a+1,segment.frames.length-1),alpha=position-a;
        faceDriver.apply(segment,segment.frames[a].map((v,j)=>THREE.MathUtils.lerp(v,segment.frames[b][j],alpha)),time);
      }
    }
    vrm.expressionManager?.update();
    if (physics) vrm.springBoneManager?.update(dt);
    vrm.scene.updateMatrixWorld(true);
    target.x = currentRoot[0]; target.z = currentRoot[2];
    camera.position.set(target.x + radius*Math.sin(pitch)*Math.sin(yaw), target.y + radius*Math.cos(pitch), target.z + radius*Math.sin(pitch)*Math.cos(yaw));
    camera.lookAt(target);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width*renderer.getPixelRatio()) || canvas.height !== Math.round(height*renderer.getPixelRatio())) {
      renderer.setSize(width,height,false); camera.aspect=width/height; camera.updateProjectionMatrix();
    }
    renderer.render(scene,camera);
    samples.push(performance.now()-workStarted); ticks++;
    if (now-reportAt >= 3000) {
      samples.sort((a,b) => a-b);
      const metrics = { mode, displayFps: ticks*1000/(now-reportAt), cpuFrameP50Ms:samples[Math.floor(samples.length*.5)],
        cpuFrameP95Ms:samples[Math.floor(samples.length*.95)], calls:renderer.info.render.calls, triangles:renderer.info.render.triangles };
      window.validationState.metrics=metrics;
      status.textContent=`${mode} · ${metrics.displayFps.toFixed(1)} display fps\n${after.vertices.toLocaleString()} vertices · ${metrics.calls} draws\nCPU frame p95 ${metrics.cpuFrameP95Ms.toFixed(1)} ms`;
      fitViewport();
      console.log('CLEO_METRICS '+JSON.stringify(metrics)); samples=[];ticks=0;reportAt=now;
    }
    if(speaking||mode==='replay'||mode==='turn'||physics||(mode==='live'&&!liveError&&!livePaused&&liveBuffer.remaining>1.01))frameId=requestAnimationFrame(frame);
  }
  window.cleoVisible=value=>{
    visible=Boolean(value)&&!document.hidden;
    if(!visible){if(frameId)cancelAnimationFrame(frameId);frameId=0;}
    else if(!frameId){last=performance.now();reportAt=last;samples=[];ticks=0;pending=false;requestMotion();frameId=requestAnimationFrame(frame);}
  };
  document.addEventListener('visibilitychange',()=>window.cleoVisible(!document.hidden));
  initialized=true;window.cleoVisible(visible);
}
start().catch(fail);
