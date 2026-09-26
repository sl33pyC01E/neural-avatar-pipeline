/** Bounded contiguous horizons. Playback time freezes on starvation instead of skipping poses. */
export class MotionBuffer {
  constructor(capacity=128) { this.capacity=capacity; this.clear(); }
  clear() { this.frames=[]; this.cursor=0; this.expected=null; this.fps=20;this.origin=null;this.consumed=0; }
  append(batch) {
    const {frames, jointCount, joints, roots, rotations, startFrame, fps}=batch;
    if(!Number.isInteger(frames)||frames<1||!Number.isInteger(jointCount)||jointCount!==27||fps!==20
      ||!Number.isInteger(startFrame)||startFrame<0
      ||joints.length!==frames*jointCount*3||roots.length!==frames*3||rotations.length!==frames*jointCount*9)
      throw new Error('Invalid Ardy horizon');
    if(this.expected!==null&&startFrame!==this.expected)throw new Error(`Ardy horizon gap: ${this.expected} → ${startFrame}`);
    if(this.frames.length+frames>this.capacity)throw new Error('Ardy playback buffer is full');
    for(const values of [joints,roots,rotations])for(const v of values)if(!Number.isFinite(v))throw new Error('Invalid motion value');
    for(let f=0;f<frames;f++) {
      const points=[], matrices=[];
      for(let j=0;j<jointCount;j++) {
        const base=(f*jointCount+j);points.push(joints.slice(base*3,base*3+3));
        const r=rotations.slice(base*9,base*9+9);matrices.push([r.slice(0,3),r.slice(3,6),r.slice(6,9)]);
      }
      this.frames.push({joints:points,root:roots.slice(f*3,f*3+3),rotations:matrices});
    }
    this.origin??=startFrame;this.expected=startFrame+frames;this.fps=fps;
  }
  sample(dt) {
    if(!this.frames.length)return null;
    // At most a fraction of one frame is carried through a depleted buffer.
    this.cursor=Math.min(this.cursor+Math.max(0,dt)*this.fps,this.frames.length-1);
    const consumed=Math.floor(this.cursor);
    if(consumed){this.frames.splice(0,consumed);this.cursor-=consumed;this.consumed+=consumed;}
    return {a:this.frames[0],b:this.frames[Math.min(1,this.frames.length-1)],alpha:this.cursor};
  }
  get remaining(){return this.frames.length-this.cursor;}
  get seconds(){return (this.consumed+this.cursor)/this.fps;}
  get endSeconds(){return this.origin===null?-1:(this.expected-this.origin-1)/this.fps;}
  covers(seconds){return this.endSeconds+1e-6>=seconds;}
  sampleAt(seconds){return this.sample(Math.max(0,seconds-this.seconds));}
}
