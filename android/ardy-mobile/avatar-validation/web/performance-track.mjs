const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const x=clamp(value);return x*x*(3-2*x);};

/** A take starts at motion frame zero. AudioTrack is the only running clock. */
export class PerformanceTrack {
  constructor(cueSeconds=.5,tailSeconds=1){
    if(!Number.isFinite(cueSeconds)||cueSeconds<0||cueSeconds>3||!Number.isFinite(tailSeconds)||tailSeconds<.5||tailSeconds>3)throw new Error('Invalid performance timing');
    this.cue=cueSeconds;this.tail=tailSeconds;this.time=0;this.started=false;this.finished=false;
    this.speechEnd=null;this.end=null;
  }
  setSpeechDuration(seconds){
    if(!Number.isFinite(seconds)||seconds<=0)throw new Error('Invalid speech duration');
    this.speechEnd=this.cue+seconds;this.end=this.speechEnd+this.tail;
  }
  sample(clock){
    if(!this.finished&&Number.isFinite(clock)&&clock>=0){this.started=true;this.time=Math.max(this.time,clock);}
    if(this.end!==null)this.time=Math.min(this.time,this.end);
    const t=this.time,ease=.5;
    let bodySeconds=t;
    if(this.end!==null&&t>this.end-ease){
      const u=clamp((t-(this.end-ease))/ease);
      // Integrate 1-smoothstep(u): velocity eases continuously from 1 to 0.
      bodySeconds=this.end-ease+ease*(u-u*u*u+.5*u*u*u*u);
    }
    const faceSeconds=this.started?t-this.cue:-1;
    const faceWeight=faceSeconds<0?0:this.speechEnd===null?1:1-smooth((t-this.speechEnd)/.25);
    return {running:this.started&&!this.finished,bodySeconds,faceSeconds,faceWeight,
      entryWeight:this.started?smooth(t/.35):0,trackSeconds:t};
  }
  finish(){if(this.end!==null)this.sample(this.end);this.finished=true;return this.sample(-1);}
}
