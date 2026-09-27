import assert from 'node:assert/strict';
import {blendPose,sampleClip,validateClip,FloorNavigator,LOWER_BODY} from '../avatar-validation/web/motion-library.mjs';
const pose=y=>new Float32Array([0,1,0,0,Math.sin(y/2),0,Math.cos(y/2)]);
const mid=blendPose(pose(170*Math.PI/180),pose(-170*Math.PI/180),.5);
assert(Math.abs(Math.abs(mid[4])-1)<1e-5,'Quaternion blend must take short path across 180 degrees');
const frames=Array.from({length:61},(_,i)=>pose(Math.sin(i/60*2*Math.PI)*.4));
const clip={version:1,id:'test',name:'test',avatar:'vrm',bones:['hips'],frames,fps:30,start:0,end:2,blend:.2,stride:1.2};
validateClip(clip,'vrm');assert.throws(()=>validateClip(clip,'other'));
assert.throws(()=>validateClip({...clip,blend:1.1},'vrm'));assert.throws(()=>validateClip({...clip,frames:[pose(0),Float32Array.from([NaN,1,0,0,0,0,1])]},'vrm'));
const before=sampleClip(clip,1.8-1e-6),after=sampleClip(clip,1.8+1e-6);
assert(Math.max(...before.map((v,i)=>Math.abs(v-after[i])))<1e-4,'Loop seam is discontinuous');
assert(LOWER_BODY.has('hips')&&LOWER_BODY.has('leftFoot')&&!LOWER_BODY.has('chest')&&!LOWER_BODY.has('leftUpperArm'));
const nav=new FloorNavigator();nav.move(0,-1,.6);let previous={...nav.root};
for(let i=0;i<1000;i++){nav.update(1/60);assert(Math.hypot(nav.root.x-previous.x,nav.root.z-previous.z)<=.6/60+1e-5);assert(Math.abs(nav.root.heading-previous.heading)<=150/60+1e-5);previous={...nav.root};}
assert(Math.abs(nav.root.z+1)<.015&&!nav.active,'Walk target did not settle');
const pacing=new FloorNavigator();pacing.pace(1.5,.8);let min=0,max=0;
for(let i=0;i<2400;i++){pacing.update(1/60);min=Math.min(min,pacing.root.z);max=Math.max(max,pacing.root.z);assert(Math.abs(pacing.root.z)<=.751);}
assert(min<-.7&&max>.7,'Pace did not reverse both ways');pacing.stop();const paused={...pacing.root};pacing.update(1);assert.deepEqual(pacing.root,paused);
assert.throws(()=>pacing.move(4,0));assert.throws(()=>pacing.pace(NaN));
console.log(JSON.stringify({passed:true,phoneTest:false,checks:['shortest quaternion blend','continuous loop seam','avatar identity and corrupt clip rejection','lower body mask','bounded acceleration and turning','pacing reversal','pause holds floor position']}));
