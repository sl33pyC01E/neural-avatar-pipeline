import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PerformanceTrack} from '../avatar-validation/web/performance-track.mjs';
import {MotionBuffer} from '../avatar-validation/web/motion-buffer.mjs';
const motion=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const batch=(start,frames)=>({startFrame:start,frames,jointCount:27,fps:20,joints:motion.joints.slice(start,start+frames).flat(2),roots:motion.rootPositions.slice(start,start+frames).flat(),rotations:motion.rotations.slice(start,start+frames).flat(3)});
for(const cue of [0,.5,3]){
  const track=new PerformanceTrack(cue,1),buffer=new MotionBuffer();buffer.append(batch(0,40));
  for(let i=0;i<100;i++){assert.equal(track.sample(-1).bodySeconds,0);assert.equal(track.sample(-1).faceSeconds,-1);}
  assert.equal(buffer.seconds,0,'Preparing consumed the motion lead-in');
  assert(buffer.covers(1.5));assert(!buffer.covers(2),'Missing interpolation frame was counted as ready');
  buffer.append(batch(40,40));buffer.append(batch(80,40));
  track.setSpeechDuration(1.7);
  assert.equal(track.sample(Math.max(0,cue-.01)).faceWeight,cue===0?1:0);
  const start=track.sample(cue);assert.equal(start.faceSeconds,0);assert.equal(start.bodySeconds,cue);
  const pose=buffer.sampleAt(start.bodySeconds);const held=buffer.sampleAt(start.bodySeconds);
  assert.deepEqual(held,pose,'A render tick advanced a stationary audio clock');
  assert.equal(track.sample(Math.max(0,cue-.1)).bodySeconds,cue,'Clock moved backward');
  for(let t=cue;t<=cue+2.7;t+=.017){const value=track.sample(t);assert(buffer.covers(value.bodySeconds));buffer.sampleAt(value.bodySeconds);}
  const before=track.sample(track.end-.001),end=track.finish();
  assert(end.bodySeconds-before.bodySeconds<.000001,'Motion did not ease to zero velocity');
  assert.equal(end.faceWeight,0);assert.equal(end.bodySeconds,track.end-.25);
  assert.deepEqual(track.sample(10000),track.sample(-1),'Finished take kept advancing');
}
assert.throws(()=>new PerformanceTrack(4,1));assert.throws(()=>new PerformanceTrack(.5,.1));
console.log(JSON.stringify({passed:true,preparationConsumesNoMotion:true,exactCue:true,oneClock:true,interpolationCoverage:true,smoothTailStop:true,faceFades:true,finishedTakeHolds:true,phoneTest:false}));
