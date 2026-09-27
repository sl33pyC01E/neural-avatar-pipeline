import * as THREE from 'three';
import {LOWER_BODY,blendPose,sampleClip,FloorNavigator,openMotionLibrary,validateClip} from './motion-library.mjs';
const $=id=>document.getElementById(id);
export async function createMotionStage(vrm,avatarKey,hooks){
  const bones=Object.keys(vrm.humanoid.normalizedHumanBones).filter(name=>!['leftEye','rightEye','jaw'].includes(name));
  const nodes=bones.map(name=>vrm.humanoid.getNormalizedBoneNode(name));
  const neutralHips=vrm.humanoid.getNormalizedBoneNode('hips').position.clone();
  const hips=bones.indexOf('hips'),heading=q=>Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));
  const capture=()=>Float32Array.from(nodes.flatMap(node=>[...node.position.toArray(),...node.quaternion.toArray()]));
  let library,clips=[],clip=null,recording=null,phase=0,playing=false,layer='full',source='ardy',entry=null,entryTime=0,selected='';
  const nav=new FloorNavigator(),notice=text=>{$('stage-status').textContent=text;};
  try{library=await openMotionLibrary(avatarKey);clips=await library.list();}catch(e){notice('Motion storage unavailable: '+e.message);}
  function changed(){hooks.source(source);window.dispatchEvent(new CustomEvent('motion-library-change'));hooks.invalidate();}
  function available(){if(!['body','debug'].includes(hooks.frame()))throw new Error('Open Body framing to move around the stage.');}
  const safe=fn=>async()=>{try{await fn();}catch(e){notice(e.message);}};
  function list(){
    const select=$('stage-clips');select.replaceChildren(new Option('Choose a saved motion',''));
    for(const c of clips)select.add(new Option(c.name,c.id));select.value=selected;form();changed();
  }
  function form(){const value=clips.find(c=>c.id===$('stage-clips').value);selected=value?.id||'';if(!value)return;
    $('stage-name').value=value.name;$('stage-trim-start').value=value.start.toFixed(2);$('stage-trim-end').value=value.end.toFixed(2);$('stage-blend').value=value.blend;$('stage-stride').value=value.stride;
    notice(`${value.frames.length} poses · ${((value.frames.length-1)/value.fps).toFixed(1)} s · ${value.bones.length} bones · saved on this device`);
  }
  function configured(){const c=clips.find(c=>c.id===selected);if(!c)throw new Error('Save or choose a motion first.');return {...c,name:$('stage-name').value.trim()||c.name,start:Number($('stage-trim-start').value),end:Number($('stage-trim-end').value),blend:Number($('stage-blend').value),stride:Number($('stage-stride').value)};}
  function play(id=selected,wanted=$('stage-layer').value){
    available();const c=clips.find(c=>c.id===id);if(!c)throw new Error('Choose a saved motion first.');
    entry=capture();entryTime=0;phase=0;clip=c;playing=true;layer=wanted;source=wanted==='lower'?'layered':'cached';
    nav.root={...hooks.root()};nav.stop();
    changed();if(source==='cached')hooks.pauseMotion();else hooks.startMotion();
    notice(source==='cached'?'Playing cached poses · Ardy is not generating':'Cached legs and pelvis · live Ardy upper body');
  }
  function stop(){playing=false;nav.stop();recording=null;$('stage-record').disabled=false;notice('Movement paused at its current position.');hooks.pauseMotion();hooks.invalidate();}
  async function saveRecording(){
    const r=recording;recording=null;$('stage-record').disabled=false;
    if(!r||r.frames.length<4){notice('No motion captured yet. Start Ardy, then record.');return;}
    if(!r.agent)hooks.pauseMotion();const end=(r.frames.length-1)/30;
    const c={version:1,id:crypto.randomUUID(),name:r.name||$('stage-name').value.trim()||'Ardy take',avatar:avatarKey,bones,frames:r.frames,fps:30,start:0,end,blend:Math.min(r.blend??.2,end/4),stride:r.stride??Math.max(.1,Math.min(6,r.distance||1.2))};
    if(!library)throw new Error('Local motion storage unavailable');await library.save(c);clips=await library.list();selected=c.id;list();notice('Take saved. Trim one complete gait cycle and preview its seam before pacing.');
  }
  $('stage-clips').onchange=form;
  $('stage-record').onclick=safe(()=>{available();stop();clip=null;source='ardy';changed();hooks.startMotion();recording={frames:[],seconds:0,next:0,previous:null,first:null,distance:0,lastRoot:null};$('stage-record').disabled=true;notice('Recording up to 12 seconds of generated body poses…');});
  $('stage-save-take').onclick=safe(saveRecording);
  $('stage-save-trim').onclick=safe(async()=>{const c=configured();if(!library)throw new Error('Local motion storage unavailable');await library.save(c);clips=await library.list();if(clip?.id===c.id){clip=c;phase=0;}list();notice('Trim and loop settings saved.');});
  $('stage-delete').onclick=safe(async()=>{if(!selected)return;if(clip?.id===selected){stop();clip=null;}await library.remove(selected);clips=await library.list();selected='';list();notice('Selected motion deleted.');});
  $('stage-play').onclick=safe(()=>play());$('stage-stop').onclick=stop;
  $('stage-live').onclick=safe(()=>{available();stop();clip=null;source='ardy';changed();hooks.startMotion();notice('Live Ardy controls the whole body.');});
  $('stage-pace').onclick=safe(()=>{if(!playing)play();nav.pace(Number($('stage-width').value),Number($('stage-speed').value));hooks.invalidate();notice('Pacing · adjust stride to match the saved gait.');});
  for(const button of document.querySelectorAll('[data-stage-step]'))button.onclick=safe(()=>{available();if(!playing)play();const [right,forward]=button.dataset.stageStep.split(',').map(Number),rad=nav.root.heading*Math.PI/180;
    nav.move(nav.root.x+(Math.cos(rad)*right+Math.sin(rad)*forward)*.5,nav.root.z+(-Math.sin(rad)*right+Math.cos(rad)*forward)*.5,Number($('stage-speed').value));hooks.invalidate();});
  $('stage-home').onclick=safe(()=>{available();if(!playing)play();nav.move(0,0,Number($('stage-speed').value));hooks.invalidate();});
  $('stage-strategy').onchange=()=>{document.querySelector('#profile').value=$('stage-strategy').value==='batch'?'core8':'core40';};
  for(const key of ['body','torso','head'])$(`stage-${key}-yaw`).oninput=()=>{const value=Number($(`stage-${key}-yaw`).value);$(`stage-${key}-yaw-value`).textContent=value+'°';if(key==='body'){nav.root={...hooks.root(),heading:value};hooks.place(nav.root);}else hooks.steer({[key+'_yaw']:value});hooks.invalidate();};
  $('stage-head-reference').onchange=()=>{hooks.steer({head_reference:$('stage-head-reference').value});hooks.invalidate();};
  $('stage-camera').onchange=()=>{hooks.camera.tracking($('stage-camera').value);hooks.invalidate();};
  for(const button of document.querySelectorAll('[data-stage-camera]'))button.onclick=()=>{hooks.camera.preset(button.dataset.stageCamera);hooks.invalidate();};
  for(const [id,key] of [['stage-distance','distance'],['stage-height','height']])$(id).oninput=()=>{hooks.camera.manualDirection({[key]:Number($(id).value)});hooks.invalidate();};
  const normalPose=(pose,first)=>{
    const result=new Float32Array(pose),i=hips*7,q=new THREE.Quaternion().fromArray(result,i+3),base=new THREE.Quaternion().fromArray(first,i+3);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading(base)-heading(q))).normalize().toArray(result,i+3);
    result[i]=neutralHips.x;result[i+2]=neutralHips.z;return result;
  };
  list();
  return {
    capture,nav,beginCapture(options){available();recording={agent:true,frames:[],seconds:0,next:0,previous:null,first:null,distance:0,lastRoot:null,...options,limit:options.seconds??12,seconds:0};notice('Agent scheduled track capture: '+options.name);hooks.invalidate();},finishCapture(completed){if(!recording)return;if(completed)saveRecording().catch(e=>notice(e.message));else {recording=null;notice('Track capture cancelled.');}},source:()=>source,catalog:()=>clips.map(c=>({id:c.id,name:c.name,duration:(c.frames.length-1)/c.fps,start:c.start,end:c.end,blend:c.blend,stride:c.stride})),stop,
    reset(){stop();clip=null;source='ardy';changed();},
    command(value){if(!value)return;if(value.action==='stop'){stop();return;}if(value.track){const original=clips.find(c=>c.id===value.track);if(!original)throw new Error('Unknown saved track');const edited={...original};for(const [input,key] of [['trim_start','start'],['trim_end','end'],['blend','blend'],['stride','stride']])if(value[input]!==undefined)edited[key]=value[input];validateClip(edited,avatarKey);clips=clips.map(c=>c.id===edited.id?edited:c);library?.save(edited).then(()=>{window.dispatchEvent(new CustomEvent('motion-library-change'));}).catch(e=>notice(e.message));play(value.track,value.layer||'full');}if(!playing)throw new Error('Locomotion requires a saved track');if(value.action==='pace')nav.pace(value.width??1.5,value.speed??.65);else if(value.action==='walk_to')nav.move(value.x,value.z,value.speed??.65);},
    active:()=>playing||Boolean(recording),
    update(dt,bodyApplied,root){
      if(recording&&bodyApplied){
        const pose=capture(),r=recording;r.first??=pose;r.previous??=pose;
        const before=r.seconds;r.seconds+=dt;
        while(r.next<=r.seconds){r.frames.push(normalPose(blendPose(r.previous,pose,Math.min(1,(r.next-before)/Math.max(dt,.001))),r.first));r.next+=1/30;}
        if(r.lastRoot)r.distance+=Math.hypot(root[0]-r.lastRoot[0],root[2]-r.lastRoot[2]);r.lastRoot=[...root];r.previous=pose;
        if(r.seconds>=(r.limit??12))saveRecording().catch(e=>notice(e.message));
      }
      if(!clip)return false;
      if(playing){const distance=nav.update(dt),period=clip.end-clip.start-clip.blend;phase+=nav.active?distance/clip.stride*period:dt;}
      const pose=sampleClip(clip,phase);entryTime+=dt;
      const mixed=entry&&entryTime<.3?blendPose(entry,pose,entryTime/.3):pose;
      for(let j=0;j<clip.bones.length;j++)if(layer==='full'||LOWER_BODY.has(clip.bones[j])){const node=vrm.humanoid.getNormalizedBoneNode(clip.bones[j]);if(node){node.position.fromArray(mixed,j*7);node.quaternion.fromArray(mixed,j*7+3);}}
      // The cached hips are in place; floor navigation owns world travel.
      hooks.place(nav.root);vrm.humanoid.update();return true;
    }
  };
}
