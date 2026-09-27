import * as THREE from 'three';

// Head/neck equations and default gains match face_animation/webui/app/face-lab.tsx.
// LAM predicts 52 expressions, not head rotation. The head overlay is explicit.
export function createFaceControls(vrm,driver) {
  const defaults={eyes:1.55,mouth:.57,head:1,naturalMotion:true};
  let settings={...defaults};
  try{Object.assign(settings,JSON.parse(localStorage.getItem('cleo-face-controls')||'{}'));}catch{}
  for(const key of ['eyes','mouth','head'])settings[key]=Number.isFinite(settings[key])?THREE.MathUtils.clamp(settings[key],0,key==='mouth'?2.5:2):defaults[key];
  settings.naturalMotion=Boolean(settings.naturalMotion);
  const head=vrm.humanoid.getNormalizedBoneNode('head'),neck=vrm.humanoid.getNormalizedBoneNode('neck');
  const headRest=head?.quaternion.clone(),neckRest=neck?.quaternion.clone();
  let bodyHead=headRest?.clone(),bodyNeck=neckRest?.clone();
  const gaze=vrm.lookAt?.applier,usesEyeBones=gaze?.constructor.type==='bone';
  let targetYaw=0,targetPitch=0,displayYaw=0,displayPitch=0,displayHead=headRest?.clone(),displayNeck=neckRest?.clone(),presenceBase=null;
  function restorePresence(){if(presenceBase){head?.quaternion.copy(presenceBase.head);neck?.quaternion.copy(presenceBase.neck);if(presenceBase.blink!==undefined)vrm.expressionManager?.setValue('blink',presenceBase.blink);presenceBase=null;}}
  function present(time,dt,{withBody=false,bodyActive=false,faceActive=false,idle=true,weight=1,gains={head:1},listener=null}={}){
    // A single continuous display clock owns both resting and speaking attention.
    // Smoothing starts at the last displayed pose even when a driver clears itself.
    const headBase=withBody?bodyHead:headRest,neckBase=withBody?bodyNeck:neckRest;
    const gain=settings.naturalMotion?settings.head*(faceActive?weight*gains.head:idle&&!bodyActive?.45:0):0;
    const h=new THREE.Euler(Math.sin(time*.77+.5)*.025*gain,Math.sin(time*.49)*.055*gain,Math.sin(time*.31+1.7)*.018*gain,'YXZ');
    const n=new THREE.Euler(h.x*.35,h.y*.3,h.z*.4,'YXZ');
    const amount=1-Math.exp(-dt/.16);
    presenceBase={head:headBase?.clone(),neck:neckBase?.clone(),blink:vrm.expressionManager?.getValue('blink')??0};
    if(head){displayHead.slerp(headBase.clone().multiply(new THREE.Quaternion().setFromEuler(h)),amount);head.quaternion.copy(displayHead);}
    if(neck){displayNeck.slerp(neckBase.clone().multiply(new THREE.Quaternion().setFromEuler(n)),amount);neck.quaternion.copy(displayNeck);}
    const eyeGain=settings.eyes*(faceActive?weight*(gains.eyes??1):idle?1:0);
    const attention=settings.naturalMotion?eyeGain:0;
    // Keep attention near the listener; compensate small head turns rather than
    // restarting the shared mapper's large audio-time gaze oscillation each reply.
    let listenerYaw=0,listenerPitch=0;
    if(listener&&vrm.lookAt){
      vrm.humanoid.update();vrm.scene.updateMatrixWorld(true);vrm.lookAt.lookAt(listener);
      // Use the VRM's own head orientation and look-at offset, including body/idle motion.
      listenerYaw=THREE.MathUtils.clamp(vrm.lookAt.yaw,-18,18)*Math.min(1,eyeGain);
      listenerPitch=THREE.MathUtils.clamp(vrm.lookAt.pitch,-12,12)*Math.min(1,eyeGain);
    }
    const gazeYaw=listenerYaw+(faceActive?targetYaw:0)+attention*Math.sin(time*.43)*.6;
    const gazePitch=listenerPitch+(faceActive?targetPitch:0)+attention*Math.sin(time*.37)*.3;
    displayYaw+=(gazeYaw-displayYaw)*amount;displayPitch+=(gazePitch-displayPitch)*amount;
    if(vrm.expressionManager?.getExpression('blink')){
      const blink=Math.max(0,1-Math.abs(time%4.7-4.25)/.12)*Math.min(1,eyeGain);
      vrm.expressionManager.setValue('blink',Math.max(presenceBase.blink,blink));
    }
    if(usesEyeBones)gaze.applyYawPitch(displayYaw,displayPitch);
    vrm.humanoid.update();
  }
  function resetBones(){head?.quaternion.copy(headRest);neck?.quaternion.copy(neckRest);if(usesEyeBones)gaze.applyYawPitch(0,0);vrm.humanoid.update();}
  function apply(track,values,time,withBody=false,weight=1,gains={eyes:1,mouth:1,head:1},continuous=false) {
    const headBase=withBody?bodyHead:headRest,neckBase=withBody?bodyNeck:neckRest;
    const scales={...settings,eyes:settings.eyes*weight*gains.eyes,mouth:settings.mouth*weight*gains.mouth,head:settings.head*weight*gains.head};
    driver.apply({...track,scales,naturalMotion:settings.naturalMotion&&!continuous},values,time);
    if(settings.naturalMotion) {
      const h=new THREE.Euler(Math.sin(time*.77+.5)*.025*scales.head,Math.sin(time*.49)*.055*scales.head,Math.sin(time*.31+1.7)*.018*scales.head,'YXZ');
      const n=new THREE.Euler(h.x*.35,h.y*.3,h.z*.4,'YXZ');
      head?.quaternion.copy(headBase).multiply(new THREE.Quaternion().setFromEuler(h));
      neck?.quaternion.copy(neckBase).multiply(new THREE.Quaternion().setFromEuler(n));
    } else {head?.quaternion.copy(headBase);neck?.quaternion.copy(neckBase);}
    if(usesEyeBones) {
      // Cleopatra declares Bone look-at. Use its VRM inner/outer/up/down range maps,
      // then clear the alternative gaze morphs so a look direction is not applied twice.
      const manager=vrm.expressionManager,get=name=>Number(manager?.getValue(name))||0;
      const yaw=(get('lookLeft')-get('lookRight'))*90,pitch=(get('lookUp')-get('lookDown'))*90;
      for(const name of ['lookLeft','lookRight','lookUp','lookDown'])manager?.setValue(name,0);
      targetYaw=yaw;targetPitch=pitch;gaze.applyYawPitch(yaw,pitch);
    }
    vrm.humanoid.update();vrm.expressionManager?.update();
  }
  return {settings,apply,present,restorePresence,captureBodyPose(){bodyHead=head?.quaternion.clone();bodyNeck=neck?.quaternion.clone();},clear(withBody=false){
    targetYaw=0;targetPitch=0;driver.clear();
    if(withBody){head?.quaternion.copy(bodyHead);neck?.quaternion.copy(bodyNeck);if(usesEyeBones)gaze.applyYawPitch(0,0);vrm.humanoid.update();}
    else {resetBones();bodyHead=headRest?.clone();bodyNeck=neckRest?.clone();}
  },set(key,value){
    if(key==='naturalMotion')settings[key]=Boolean(value);
    else if(['eyes','mouth','head'].includes(key)&&Number.isFinite(Number(value)))settings[key]=THREE.MathUtils.clamp(Number(value),0,key==='mouth'?2.5:2);
    try{localStorage.setItem('cleo-face-controls',JSON.stringify(settings));}catch{}
  },drivers:{expressions:'LAM → shared ARKit-to-VRM mapper',gaze:usesEyeBones?'VRM eye bones and declared range maps':'VRM gaze expressions',head:'Face Lab procedural head/neck overlay'}};
}
