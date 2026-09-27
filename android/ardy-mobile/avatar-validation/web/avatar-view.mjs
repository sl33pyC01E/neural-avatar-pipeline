import * as THREE from 'three';
import {AvatarDirection} from './avatar-direction.mjs';
import {createIdleAnimation} from './idle-animation.mjs';
import {relaxedStance} from './relaxed-stance.mjs';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.js';
import { createRetargeter } from './retarget.mjs';
import { MotionBuffer } from './motion-buffer.mjs';
import { PerformanceTrack } from './performance-track.mjs';
import { createFaceDriver } from './face.mjs';
import { createFaceControls } from './face-controls.mjs';
import { createCameraControls } from './camera-controls.mjs';
import { createAppearanceControls } from './appearance-controls.mjs';

const status = document.querySelector('#status');
const canvas = document.querySelector('canvas');
export async function createAvatarView() {
  let visible=false,frameId=0,idleTimer=0,initialized=false,idleEnabled=true;
  function invalidate(){if(idleTimer){clearTimeout(idleTimer);idleTimer=0;}if(initialized&&visible&&!frameId)frameId=requestAnimationFrame(frame);}
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  function fitViewport() {
    const top = document.querySelector('header').getBoundingClientRect().bottom + 12;
    const panel=document.querySelector('[role="tabpanel"]:not([hidden])');
    const bottom = panel?panel.getBoundingClientRect().top-10:innerHeight;
    canvas.style.top = `${top}px`;
    canvas.style.height = `${Math.max(100, bottom-top)}px`;
  }
  fitViewport(); window.addEventListener('resize',()=>{fitViewport();invalidate();});
  document.querySelectorAll('[role="tabpanel"] details').forEach(d=>d.addEventListener('toggle',()=>{fitViewport();invalidate();}));
  const resize=new ResizeObserver(()=>{fitViewport();invalidate();});
  document.querySelectorAll('[role="tabpanel"]').forEach(panel=>resize.observe(panel));
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101b19');
  const fill = new THREE.HemisphereLight(0xd7eee5, 0x49435b, 2);scene.add(fill);
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(1.5, 3.5, 2); scene.add(light);
  const grid = new THREE.GridHelper(12, 60, 0x537c6a, 0x243d32); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 30);
  const cameraControls=createCameraControls(canvas,camera,invalidate,()=>{direction.cameraEnabled=false;});
  document.querySelector('#camera-reset').onclick=()=>cameraControls.reset();

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
  const stageRoot=new THREE.Group();stageRoot.add(vrm.scene);scene.add(stageRoot);stageRoot.updateMatrixWorld(true);
  const appearance=createAppearanceControls(vrm,renderer,fill,light,invalidate);
  const faceDriver=createFaceDriver(vrm);let speaking=false,faceStream=null;const faceSegments=[];
  const position = name => vrm.humanoid.getRawBoneNode(name)?.getWorldPosition(new THREE.Vector3());
  const feet = ['leftFoot','leftToes','rightFoot','rightToes'].map(position).filter(Boolean);
  const alignment = { hipsHeightM: position('hips').y, floorOffsetM: Math.min(...feet.map(p => p.y)) };
  const retarget = createRetargeter(vrm, bind, alignment);
  retarget.reset();relaxedStance(vrm);
  const faceControls=createFaceControls(vrm,faceDriver);
  const eyeHeight=()=>((position('leftEye')?.y??position('head').y+.08)+(position('rightEye')?.y??position('head').y+.08))/2;
  const setFaceView=value=>cameraControls.setFaceView(value,eyeHeight());
  setFaceView(true);
  const direction=new AvatarDirection(cameraControls,stageRoot),idle=createIdleAnimation(vrm);
  document.querySelector('#view-face').onclick=()=>{setFaceView(true);cameraControls.reset();};
  document.querySelector('#view-body').onclick=()=>{setFaceView(false);cameraControls.reset();};
  const idleCheckbox=document.querySelector('#idle-enabled');try{idleEnabled=localStorage.getItem('cleo-idle')!=='false';}catch{}idleCheckbox.checked=idleEnabled;
  idleCheckbox.onchange=()=>{idle.restore();idleEnabled=idleCheckbox.checked;try{localStorage.setItem('cleo-idle',String(idleEnabled));}catch{}invalidate();};
  for(const key of ['eyes','mouth','head']) {
    const slider=document.querySelector(`#face-${key}`),output=document.querySelector(`#face-${key}-value`);
    slider.value=faceControls.settings[key];output.textContent=`${Number(slider.value).toFixed(2)}×`;
    slider.oninput=()=>{faceControls.set(key,Number(slider.value));output.textContent=`${Number(slider.value).toFixed(2)}×`;invalidate();};
  }
  const natural=document.querySelector('#face-natural');natural.checked=faceControls.settings.naturalMotion;
  natural.onchange=()=>{faceControls.set('naturalMotion',natural.checked);invalidate();};
  document.querySelector('#face-driver-info').textContent=`Eyes: ${faceControls.drivers.gaze}. Head: continuous idle/speech overlay. Mouth: LAM → VRM visemes.`;
  const skeleton = new THREE.SkeletonHelper(vrm.scene); skeleton.visible = false; scene.add(skeleton);
  document.querySelector('#skeleton').onclick = e => { skeleton.visible = !skeleton.visible; e.target.setAttribute('aria-pressed', skeleton.visible); invalidate(); };
  let physics = false;
  document.querySelector('#physics').onclick = e => { physics = !physics; vrm.springBoneManager?.setInitState(); e.target.setAttribute('aria-pressed', physics); invalidate(); };
  let mode = 'rest', started = performance.now();
  const liveBuffer=new MotionBuffer();let pending=false,liveProfile='core40',liveError=false,livePaused=false,liveStream='';
  let stagedPlan=null,framing='debug';
  let performanceTrack=null,performanceGate=null,entryPose=null,entryRoot=null,heldRoot=[0,0,0];
  function setMode(value) {
    if (!['rest', 'replay', 'turn','live'].includes(value)) throw new Error('Unknown mode');
    if(value!=='live'){window.Cleo?.stop();liveBuffer.clear();pending=false;liveStream='';}
    performanceTrack=null;performanceGate=null;entryPose=null;
    idle.restore();direction.clear();mode = value; started = performance.now();stageRoot.position.set(0,0,0);stageRoot.rotation.y=0;stageRoot.updateMatrixWorld(true);retarget.reset();if(value==='rest'||value==='live')relaxedStance(vrm); vrm.springBoneManager?.setInitState();
    if(value==='rest')status.textContent=`Relaxed stance · ${idleEnabled?'gentle idle':'display sleeps until input'}\n${after.vertices.toLocaleString()} vertices`;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    invalidate();
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  // Local replay/renderer inspection hook. Native engines are exposed only on the offline asset origin.
  window.avatarValidation = { setMode, retarget, vrm, renderer, motion, bind, alignment,faceControls,cameraControls,camera,appearance,direction,stageRoot,idle,framing:()=>framing };
  const matrixQuaternion = values => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(
    ...values[0], 0, ...values[1], 0, ...values[2], 0, 0, 0, 0, 1)).normalize();
  const rotations = motion.rotations.map(frame => frame.map(matrixQuaternion));
  const toMatrix = q => { const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; return [[e[0],e[4],e[8]], [e[1],e[5],e[9]], [e[2],e[6],e[10]]]; };
  const engineStatus=document.querySelector('#engine-status'), bank=document.querySelector('#bank');let restoredSelection=false;
  function requestMotion() {
    const horizon=liveProfile==='core40'?40:8;
    const needed=performanceGate?Math.max(horizon+1,(performanceGate.seconds-liveBuffer.seconds)*20+1):horizon+1;
    if(mode==='live'&&visible&&!pending&&!liveError&&!livePaused&&liveBuffer.remaining<=needed&&liveBuffer.frames.length+horizon<=liveBuffer.capacity&&window.Cleo) {
      pending=true;window.Cleo.next(); // Ready events retry rejected requests; no idle polling.
    }
  }
  function performanceReady(){
    if(!performanceGate||!performanceTrack||liveError||performanceTrack.finished)return;
    if(liveBuffer.origin!==null&&liveBuffer.origin!==0)throw new Error('Scheduled Ardy track must start at frame zero');
    if(liveBuffer.covers(performanceGate.seconds)){
      const ack=performanceGate.ack;performanceGate=null;window.Cleo?.faceReady(ack);
    }else requestMotion();
  }
  function gatePerformance(event){
    if(!Number.isFinite(event.requiredMotionSeconds)||event.requiredMotionSeconds<0)throw new Error('Invalid scheduled motion window');
    performanceGate={ack:event.runId,seconds:event.requiredMotionSeconds};performanceReady();
  }
  function beginPerformance(event){
    // Preserve the displayed pose while generation prepares a new frame-zero take.
    idle.restore();
    entryPose=Object.values(vrm.humanoid.normalizedHumanBones).map(({node})=>({node,position:node.position.clone(),quaternion:node.quaternion.clone()}));
    entryRoot=[...heldRoot];
    liveBuffer.clear();pending=false;liveStream=crypto.randomUUID();liveProfile=document.querySelector('#profile').value;
    mode='live';liveError=false;livePaused=false;performanceGate=null;
    performanceTrack=new PerformanceTrack(event.cueSeconds,event.tailSeconds);
    window.Cleo?.startPerformance(liveProfile,['cleopatra','main'].includes(event.tab)?stagedPlan?.embeddingId:bank.value,liveStream);requestMotion();invalidate();
  }
  const eventHandler=event=>{
    // A queued native result may arrive after a profile switch or a recreated WebView.
    if((event.type==='motion'||event.type==='motionError')&&event.streamId!==liveStream)return;
    if(event.type==='state') {
      const selected=bank.value||event.lastEmbedding;bank.replaceChildren();
      for(const item of event.bank) { const option=document.createElement('option');option.value=item.id;option.textContent=item.nickname||item.text;bank.append(option); }
      if([...bank.options].some(o=>o.value===selected))bank.value=selected;
      if(!restoredSelection&&event.lastProfile)document.querySelector('#profile').value=event.lastProfile;
      restoredSelection=true;
      document.querySelector('#memory').value=String(event.memoryBudgetMiB);
      document.querySelector('#embed').disabled=!event.llmNative||!event.llmModel;
      engineStatus.textContent=`Ardy: ${event.core40?'Core-40 ready':'Core-40 needs models'} · ${event.core8?'Core-8 ready':'Core-8 needs models'}\nLLM2Vec: ${!event.llmNative?'native backend unavailable':event.llmModel?'model ready':'import compatible GGUF'} · Anna available`;
    } else if(event.type==='motion') {
      if(mode!=='live'||event.profile!==liveProfile)return;
      try{liveBuffer.append(event);engineStatus.textContent=`${liveProfile} · ${(event.generationMs/1000).toFixed(2)} s generation · ${(liveBuffer.remaining/20).toFixed(1)} s buffered`;}
      catch(error){liveError=true;window.Cleo?.stop();engineStatus.textContent=error.message;}
      pending=false;performanceReady();requestMotion();invalidate();
    } else if(event.type==='ready'||event.type==='configured') {pending=false;requestMotion();}
    else if(event.type==='face') {
      if(!speaking||(faceStream&&event.streamId!==faceStream))return false;
      if(event.names?.length!==52||event.fps!==30||!Number.isFinite(event.startSeconds))throw new Error('Invalid LAM timeline');
      if(!event.frames?.length)throw new Error('Empty LAM timeline');
      for(const frame of event.frames)if(frame.length!==52||frame.some(v=>!Number.isFinite(v)))throw new Error('Invalid LAM expression');
      const previous=faceSegments.at(-1);
      if(previous&&event.startSeconds<previous.startSeconds+previous.frames.length/30-1e-5)throw new Error('Overlapping LAM windows');
      faceSegments.push(event);if(faceSegments.length>8)throw new Error('LAM playback queue exceeded its bound');invalidate();
      if(['full','cleopatra','main'].includes(event.tab)&&performanceTrack){gatePerformance(event);return false;}
      return true;
    }
    else if(event.type==='speechStart'&&event.withFace){
      if(['full','cleopatra'].includes(event.tab)||(event.tab==='main'&&event.bodyMotion===true))beginPerformance(event);
      speaking=true;faceStream=event.streamId??null;faceSegments.length=0;faceControls.clear(mode==='live');engineStatus.textContent=event.message;invalidate();
    }
    else if(event.type==='performanceTail'){
      if(!performanceTrack||!speaking||event.streamId!==faceStream)return false;
      performanceTrack.setSpeechDuration(event.audioSeconds);gatePerformance(event);invalidate();return false;
    }
    else if(event.type==='talkPlayback')invalidate();
    else if(event.type==='speechEnd'){
      if(performanceTrack&&event.completed){performanceTrack.finish();livePaused=true;performanceGate=null;speaking=false;faceStream=null;faceSegments.length=0;faceControls.clear(true);invalidate();}
      else stopFace();
      engineStatus.textContent=event.message;
    }
    else if(event.type==='embedding') {
      const option=document.createElement('option');option.value=event.record.id;option.textContent=event.record.nickname||event.record.text;
      if(![...bank.options].some(o=>o.value===option.value))bank.append(option);bank.value=option.value;engineStatus.textContent='Embedding cached';
    }
    else if(event.message) {
      engineStatus.textContent=event.message;
      if(event.type==='motionError'||event.type==='stopped'){liveError=true;pending=false;window.Cleo?.stop();if(performanceTrack){window.Cleo?.quiet();stopFace();}invalidate();}
    }
    fitViewport();
  };
  function startMotion(){
    performanceTrack=null;performanceGate=null;entryPose=null;
    const selected=document.querySelector('#profile').value;
    if(mode!=='live'||selected!==liveProfile||liveError){liveBuffer.clear();pending=false;liveStream=crypto.randomUUID();setMode('live');}
    liveProfile=selected;liveError=false;livePaused=false;window.Cleo?.start(selected,bank.value,liveStream);requestMotion();invalidate();
  }
  document.querySelector('#live').onclick=startMotion;
  document.querySelector('#stop-motion').onclick=()=>{window.Cleo?.pause();livePaused=true;engineStatus.textContent='Motion paused';};
  document.querySelector('#embed').onclick=()=>{engineStatus.textContent='Creating a compatible embedding…';window.Cleo?.embed(document.querySelector('#motion-text').value);};
  document.querySelector('#import').onclick=()=>window.Cleo?.importModels();
  document.querySelector('#memory').onchange=e=>window.Cleo?.memoryBudget(Number(e.target.value));
  if(!window.Cleo)engineStatus.textContent='Native engines are available in the Android app.';
  const standing = bind.restJoints[0][1] - Math.min(...bind.restJoints.map(p => p[1]));
  heldRoot=[0,standing,0];
  let last = performance.now(), reportAt = last, ticks = 0, samples = [];
  Object.assign(window.validationState,{ready:true,before,after,provenance,alignment});
  console.log('CLEO_READY ' + JSON.stringify(window.validationState));
  function frame(now) {
    frameId=0;if(!visible)return;
    const workStarted = performance.now();idle.restore();faceControls.restorePresence();
    const dt = Math.min((now-last)/1000, .05); last = now;
    const elapsed = Math.max(0,now - started)/1000;
    const trackClock=performanceTrack?performanceTrack.sample(window.Cleo?.playbackSeconds()??-1):null;
    if(trackClock&&performanceTrack.started)direction.advance(trackClock.trackSeconds);
    else if(speaking&&!performanceTrack)direction.advance(window.Cleo?.playbackSeconds()??-1);
    // Retarget in the calibrated stage coordinate system; apply floor placement after solving.
    stageRoot.position.set(0,0,0);stageRoot.rotation.y=0;stageRoot.updateMatrixWorld(true);
    const currentRoot = performanceTrack?[...heldRoot]:[0, standing, 0];let bodyApplied=false;
    if(mode==='live') {
      const sample=performanceTrack?(performanceTrack.started?liveBuffer.sampleAt(trackClock.bodySeconds):null):liveBuffer.sample(liveError||livePaused?0:dt);
      if(sample) {
        const {a,b,alpha}=sample;
        const joints=a.joints.map((p,j)=>p.map((v,k)=>THREE.MathUtils.lerp(v,b.joints[j][k],alpha)));
        for(let k=0;k<3;k++)currentRoot[k]=THREE.MathUtils.lerp(a.root[k],b.root[k],alpha);
        a.quaternions??=a.rotations.map(matrixQuaternion);b.quaternions??=b.rotations.map(matrixQuaternion);
        const local=a.quaternions.map((q,j)=>toMatrix(q.clone().slerp(b.quaternions[j],alpha)));
        if(framing==='torso'){
          // Renderer backstop: preserve articulation while removing root drift and yaw.
          const inverse=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.atan2(new THREE.Vector3(0,0,1).applyQuaternion(matrixQuaternion(local[0])).x,new THREE.Vector3(0,0,1).applyQuaternion(matrixQuaternion(local[0])).z));
          const origin=new THREE.Vector3(...currentRoot),fixed=new THREE.Vector3(0,standing,0);
          for(let j=0;j<joints.length;j++)joints[j]=new THREE.Vector3(...joints[j]).sub(origin).applyQuaternion(inverse).add(fixed).toArray();
          local[0]=toMatrix(inverse.multiply(matrixQuaternion(local[0])));currentRoot.splice(0,3,...fixed.toArray());
        }
        retarget.apply(joints,currentRoot,local);
        if(entryPose&&trackClock.entryWeight<1){
          for(const saved of entryPose){saved.node.position.lerpVectors(saved.position,saved.node.position,trackClock.entryWeight);saved.node.quaternion.slerpQuaternions(saved.quaternion,saved.node.quaternion.clone(),trackClock.entryWeight);}
          for(let k=0;k<3;k++)currentRoot[k]=THREE.MathUtils.lerp(entryRoot[k],currentRoot[k],trackClock.entryWeight);
          vrm.humanoid.update();
        }
        if(entryPose&&trackClock.entryWeight>=1)entryPose=null;
        bodyApplied=true;
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
    if(bodyApplied||mode==='replay'||mode==='turn')faceControls.captureBodyPose();
    // Dynamics are opt-in so geometry/retargeting can first be checked deterministically.
    if(speaking&&faceSegments.length) {
      const time=trackClock?trackClock.faceSeconds:window.Cleo?.playbackSeconds()??-1;
      if(time>=0) {
        while(faceSegments.length>1&&faceSegments[1].startSeconds<=time)faceSegments.shift();
        const segment=faceSegments[0];
        const position=THREE.MathUtils.clamp((time-segment.startSeconds)*30,0,segment.frames.length-1);
        const a=Math.floor(position),b=Math.min(a+1,segment.frames.length-1),alpha=position-a;
        faceControls.apply(segment,segment.frames[a].map((v,j)=>THREE.MathUtils.lerp(v,segment.frames[b][j],alpha)),time,mode==='live',trackClock?.faceWeight??1,direction.state.face,true);
      }
    }
    if(direction.active&&speaking&&(performanceTrack?performanceTrack.started:(window.Cleo?.playbackSeconds()??-1)>=0)){
      for(const [name,value] of Object.entries(direction.state.expressions))if(vrm.expressionManager?.getExpression(name))vrm.expressionManager.setValue(name,value);
    }
    const bodyActive=mode==='replay'||mode==='turn'||(mode==='live'&&bodyApplied&&!livePaused&&!liveError&&(!performanceTrack||performanceTrack.started&&!performanceTrack.finished));
    const faceActive=speaking&&faceSegments.length>0&&(trackClock?trackClock.faceSeconds>=0:(window.Cleo?.playbackSeconds()??-1)>=0);
    if(idleEnabled)idle.apply(now/1000,dt,bodyActive,faceActive);
    direction.apply();stageRoot.updateMatrixWorld(true);
    cameraControls.update(new THREE.Vector3(...currentRoot).applyMatrix4(stageRoot.matrixWorld).toArray());
    faceControls.present(now/1000,dt,{withBody:mode!=='rest',bodyActive,faceActive,idle:idleEnabled,weight:trackClock?.faceWeight??1,gains:direction.state.face,listener:camera.position});
    vrm.expressionManager?.update();
    if (physics) vrm.springBoneManager?.update(dt);
    heldRoot=[...currentRoot];
    if(trackClock)window.validationState.performance={...trackClock,motionSeconds:liveBuffer.seconds,motionEndSeconds:liveBuffer.endSeconds,origin:liveBuffer.origin,gate:performanceGate?.seconds??null,finished:performanceTrack.finished};
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
      window.Cleo?.benchmarkFrame?.(JSON.stringify(metrics));
    }
    const activePerformance=performanceTrack?.started&&!performanceTrack.finished;
    window.validationState.idle={enabled:idleEnabled,body:!bodyActive,face:!faceActive};window.validationState.direction=direction.snapshot();
    if(activePerformance||(!performanceTrack&&speaking&&faceSegments.length)||mode==='replay'||mode==='turn'||physics||(!performanceTrack&&mode==='live'&&!liveError&&!livePaused&&liveBuffer.remaining>1.01))frameId=requestAnimationFrame(frame);
    else if(idleEnabled)idleTimer=setTimeout(()=>{idleTimer=0;invalidate();},1000/20);
  }
  const setVisible=value=>{
    visible=Boolean(value)&&!document.hidden;
    if(!visible){clearTimeout(idleTimer);idleTimer=0;cameraControls.clearPointers();if(frameId)cancelAnimationFrame(frameId);frameId=0;}
    else if(!frameId){fitViewport();last=performance.now();reportAt=last;samples=[];ticks=0;pending=false;requestMotion();frameId=requestAnimationFrame(frame);}
  };
  function stopFace(){idle.restore();direction.clear();stagedPlan=null;speaking=false;faceStream=null;faceSegments.length=0;faceControls.clear(mode==='live');if(performanceTrack){performanceTrack=null;performanceGate=null;entryPose=null;livePaused=true;}invalidate();}
  function setFrame(value){
    if(!['face','torso','body','debug'].includes(value))throw new Error('Unknown frame');
    if(value===framing)return;framing=value;grid.visible=value==='body'||value==='debug';
    stopFace();setMode('rest');direction.reset();heldRoot=[0,standing,0];
    if(value==='debug')return;
    const face=value==='face',torso=value==='torso';
    cameraControls.applyDirection({yaw:0,elevation:face?0:4,distance:face?.62:torso?1.35:3.4,height:face?eyeHeight():torso?position('head').y-.18:.85,pan_x:0,pan_z:0});
    invalidate();
  }
  initialized=true;
  return {setFrame,scene:()=>({camera:cameraControls.direction(),root:direction.snapshot().root}),stage(plan){stagedPlan={...plan};direction.stage(plan);},expressions:()=>['neutral','happy','relaxed','sad','angry','surprised'].filter(name=>name==='neutral'||vrm.expressionManager?.getExpression(name)),event:eventHandler,setVisible,setMode,setFaceView,startMotion,stopFace,faceSettings:()=>({...faceControls.settings}),pause(){livePaused=true;window.Cleo?.pause();},fitViewport};
}
