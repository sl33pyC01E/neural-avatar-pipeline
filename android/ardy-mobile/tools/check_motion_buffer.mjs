// Uses actual generated Ardy horizons to check ordering, starvation, and bounded playback.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {MotionBuffer} from '../avatar-validation/web/motion-buffer.mjs';
const motion=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const buffer=new MotionBuffer();
const batch=(start,frames)=>({startFrame:start,frames,jointCount:27,fps:20,
  joints:motion.joints.slice(start,start+frames).flat(2),roots:motion.rootPositions.slice(start,start+frames).flat(),
  rotations:motion.rotations.slice(start,start+frames).flat(3)});
buffer.append(batch(0,40));
for(let i=0;i<100;i++)buffer.sample(.05);
assert.equal(buffer.remaining,1,'A starved buffer holds its last pose');
assert.deepEqual(buffer.sample(100).a.root,motion.rootPositions[39]);
buffer.append(batch(40,40));
const seam=buffer.sample(.025);
assert.equal(seam.alpha,.5);assert.deepEqual(seam.a.root,motion.rootPositions[39]);assert.deepEqual(seam.b.root,motion.rootPositions[40]);
assert.throws(()=>buffer.append(batch(120,40)),/gap/);
buffer.append(batch(80,40));buffer.append(batch(120,40));
assert.throws(()=>buffer.append(batch(160,40)),/full/);
buffer.clear();buffer.append(batch(0,8));
assert.equal(buffer.expected,8);
console.log(JSON.stringify({passed:true,realMotionFrames:motion.joints.length,seamInterpolation:true,starvationHolds:true,rejectsGaps:true,bounded:true}));
