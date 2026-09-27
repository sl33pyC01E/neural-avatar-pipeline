// Avatar-specific normalized bone poses, stored locally; no inference during replay.
export const LOWER_BODY=new Set(['hips','spine','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot','leftToes','rightToes']);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const angle=(a,b)=>((b-a+540)%360+360)%360-180;
export function blendPose(a,b,t){
  const out=new Float32Array(a.length);
  for(let i=0;i<a.length;i+=7){
    for(let k=0;k<3;k++)out[i+k]=a[i+k]+(b[i+k]-a[i+k])*t;
    let dot=0;for(let k=3;k<7;k++)dot+=a[i+k]*b[i+k];
    const sign=dot<0?-1:1;dot=clamp(Math.abs(dot),0,1);
    const theta=Math.acos(dot),sin=Math.sin(theta),u=dot>.9995?1-t:Math.sin((1-t)*theta)/sin,v=dot>.9995?t:Math.sin(t*theta)/sin;
    let norm=0;for(let k=3;k<7;k++){out[i+k]=a[i+k]*u+b[i+k]*v*sign;norm+=out[i+k]**2;}
    norm=Math.sqrt(norm);for(let k=3;k<7;k++)out[i+k]/=norm||1;
  }return out;
}
export function validateClip(clip,avatar){
  if(clip?.version!==1||clip.avatar!==avatar||typeof clip.id!=='string'||!clip.id||clip.id.length>80||typeof clip.name!=='string'||clip.name.length>80)throw new Error('This motion belongs to a different avatar or format.');
  if(!Array.isArray(clip.bones)||!clip.bones.includes('hips')||clip.bones.length>80||new Set(clip.bones).size!==clip.bones.length||clip.bones.some(v=>typeof v!=='string'||v.length>40))throw new Error('Invalid bone list');
  if(!Number.isFinite(clip.fps)||clip.fps<10||clip.fps>60||!Array.isArray(clip.frames)||clip.frames.length<2||clip.frames.length>clip.fps*30)throw new Error('Motion must last from two frames to 30 seconds.');
  for(const f of clip.frames){if(f.length!==clip.bones.length*7||Array.from(f).some(v=>!Number.isFinite(v)||Math.abs(v)>50))throw new Error('Invalid pose');for(let i=0;i<f.length;i+=7){const norm=Math.hypot(...f.slice(i+3,i+7));if(Math.abs(norm-1)>.02)throw new Error('Invalid joint rotation');}}
  const duration=(clip.frames.length-1)/clip.fps;
  if(![clip.start,clip.end,clip.blend,clip.stride].every(Number.isFinite)||clip.start<0||clip.end>duration+.00001||clip.end-clip.start<.1||clip.blend<0||clip.blend>(clip.end-clip.start)/2||clip.stride<.1||clip.stride>6)throw new Error('Invalid trim, blend or stride');
  return clip;
}
export function sampleClip(clip,seconds){
  const sample=t=>{const p=clamp(t*clip.fps,0,clip.frames.length-1),a=Math.floor(p);return blendPose(clip.frames[a],clip.frames[Math.min(a+1,clip.frames.length-1)],p-a);};
  const period=clip.end-clip.start-clip.blend;
  const t=clip.start+clip.blend+((seconds%period)+period)%period;
  const pose=sample(t);
  return clip.blend>0&&t>clip.end-clip.blend?blendPose(pose,sample(clip.start+t-(clip.end-clip.blend)),(t-(clip.end-clip.blend))/clip.blend):pose;
}
export class FloorNavigator{
  constructor(root={x:0,z:0,heading:0}){this.root={...root};this.speed=0;this.active=false;this.travel=0;}
  move(x,z,speed=.65){if(![x,z,speed].every(Number.isFinite)||Math.abs(x)>3||Math.abs(z)>3||speed<.1||speed>2)throw new Error('Floor target out of range');this.target={x,z};this.limit=speed;this.active=true;this.pacing=null;}
  pace(width=1.5,speed=.65){if(!Number.isFinite(width)||width<.5||width>4)throw new Error('Pace width must be 0.5–4 m');const r=this.root,rad=r.heading*Math.PI/180,dx=Math.sin(rad)*width/2,dz=Math.cos(rad)*width/2;
    const ends=[{x:r.x+dx,z:r.z+dz},{x:r.x-dx,z:r.z-dz}];if(ends.some(p=>Math.abs(p.x)>3||Math.abs(p.z)>3))throw new Error('Pacing would leave the 6 m stage');this.move(ends[0].x,ends[0].z,speed);this.pacing=ends;this.index=0;}
  stop(){this.active=false;this.speed=0;}
  update(dt){
    if(!this.active||!Number.isFinite(dt)||dt<=0)return 0;dt=Math.min(dt,.05);
    const dx=this.target.x-this.root.x,dz=this.target.z-this.root.z,distance=Math.hypot(dx,dz);
    if(distance<.01){if(this.pacing){this.index=1-this.index;this.target=this.pacing[this.index];this.speed=0;}else this.stop();return 0;}
    const desired=Math.atan2(dx,dz)*180/Math.PI,delta=angle(this.root.heading,desired);
    this.root.heading+=clamp(delta,-150*dt,150*dt);
    const facing=Math.max(0,Math.cos(angle(this.root.heading,desired)*Math.PI/180));
    const targetSpeed=Math.min(this.limit,Math.sqrt(2*1.2*distance))*facing**4;
    this.speed+=clamp(targetSpeed-this.speed,-2*dt,1.2*dt);
    const step=Math.min(distance,this.speed*dt);this.root.x+=dx/distance*step;this.root.z+=dz/distance*step;this.travel+=step;return step;
  }
}
export async function openMotionLibrary(avatar){
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('cleo-motion-library',1);request.onupgradeneeded=()=>request.result.createObjectStore('clips',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transact=(mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction('clips',mode),store=tx.objectStore('clips');let value;try{fn(store,v=>value=v);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Motion storage cancelled'));});
  const list=()=>transact('readonly',(store,done)=>{store.getAll().onsuccess=e=>done(e.target.result.filter(c=>c.avatar===avatar).map(c=>validateClip(c,avatar)));});
  return {list,async save(clip){validateClip(clip,avatar);await transact('readwrite',(store,done)=>{store.getAll().onsuccess=e=>{const items=e.target.result.filter(c=>c.id!==clip.id);const bytes=[...items,clip].reduce((n,c)=>n+c.frames.length*c.bones.length*28,0);if(items.length>=32||bytes>32*1024*1024){store.transaction.abort();return;}store.put(clip);done(clip);};});},remove:id=>transact('readwrite',(store)=>store.delete(id)),close:()=>db.close()};
}
