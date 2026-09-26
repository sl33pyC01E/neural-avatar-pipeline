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
  const gaze=vrm.lookAt?.applier,usesEyeBones=gaze?.constructor.type==='bone';
  function resetBones(){head?.quaternion.copy(headRest);neck?.quaternion.copy(neckRest);if(usesEyeBones)gaze.applyYawPitch(0,0);vrm.humanoid.update();}
  function apply(track,values,time) {
    driver.apply({...track,scales:settings,naturalMotion:settings.naturalMotion},values,time);
    if(settings.naturalMotion) {
      const h=new THREE.Euler(Math.sin(time*.77+.5)*.025*settings.head,Math.sin(time*.49)*.055*settings.head,Math.sin(time*.31+1.7)*.018*settings.head,'YXZ');
      const n=new THREE.Euler(h.x*.35,h.y*.3,h.z*.4,'YXZ');
      head?.quaternion.copy(headRest).multiply(new THREE.Quaternion().setFromEuler(h));
      neck?.quaternion.copy(neckRest).multiply(new THREE.Quaternion().setFromEuler(n));
    } else {head?.quaternion.copy(headRest);neck?.quaternion.copy(neckRest);}
    if(usesEyeBones) {
      // Cleopatra declares Bone look-at. Use its VRM inner/outer/up/down range maps,
      // then clear the alternative gaze morphs so a look direction is not applied twice.
      const manager=vrm.expressionManager,get=name=>Number(manager?.getValue(name))||0;
      const yaw=(get('lookLeft')-get('lookRight'))*90,pitch=(get('lookUp')-get('lookDown'))*90;
      for(const name of ['lookLeft','lookRight','lookUp','lookDown'])manager?.setValue(name,0);
      gaze.applyYawPitch(yaw,pitch);
    }
    vrm.humanoid.update();vrm.expressionManager?.update();
  }
  return {settings,apply,clear(){driver.clear();resetBones();},set(key,value){
    if(key==='naturalMotion')settings[key]=Boolean(value);
    else if(['eyes','mouth','head'].includes(key)&&Number.isFinite(Number(value)))settings[key]=THREE.MathUtils.clamp(Number(value),0,key==='mouth'?2.5:2);
    try{localStorage.setItem('cleo-face-controls',JSON.stringify(settings));}catch{}
  },drivers:{expressions:'LAM → shared ARKit-to-VRM mapper',gaze:usesEyeBones?'VRM eye bones and declared range maps':'VRM gaze expressions',head:'Face Lab procedural head/neck overlay'}};
}
