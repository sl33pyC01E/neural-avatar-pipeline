// Deterministic cues, driven only by the shared AudioTrack/body clock.
const mix=(a,b,t)=>a+(b-a)*t;
const mixAngle=(a,b,t)=>t===1?b:a+(((b-a+180)%360+360)%360-180)*t;
const smooth=t=>t*t*(3-2*t);
export class AvatarDirection {
  constructor(camera,root){this.camera=camera;this.root=root;this.active=false;this.state={camera:null,root:{x:0,z:0,heading:0},face:{eyes:1,mouth:1,head:1},expressions:{}};}
  stage(plan){
    this.state.camera=this.camera.direction();this.state.face={eyes:1,mouth:1,head:1};this.state.expressions={};
    this.initial=structuredClone(this.state);this.events=[{at_seconds:0,transition_seconds:.35,...plan},...(plan.schedule||[])];
    this.transitions=[];this.next=0;this.active=true;this.last=-1;this.cameraEnabled=true;
  }
  advance(time){
    if(!this.active||!Number.isFinite(time)||time<0)return;
    // A playback stall or duplicate timestamp cannot advance the scene.
    if(time<this.last)return;this.last=time;
    const evaluate=at=>{
      for(const t of this.transitions){const weight=t.duration===0?1:smooth(Math.min(1,Math.max(0,(at-t.at)/t.duration)));
        for(const [key,value] of Object.entries(t.to))this.state[t.group][key]=(key==='yaw'||key==='heading'?mixAngle:mix)(t.from[key]??0,value,weight);
      }
    };
    while(this.next<this.events.length&&this.events[this.next].at_seconds<=time){
      const cue=this.events[this.next++];evaluate(cue.at_seconds);
      for(const group of ['camera','root','face','expressions']){
        let target=cue[group];
        if(group==='expressions'&&cue.expression!==undefined)target=Object.fromEntries([...new Set([...Object.keys(this.state.expressions),cue.expression])].map(name=>[name,name===cue.expression&&name!=='neutral'?cue.strength:0]));
        if(!target)continue;
        // A new cue replaces only the keys it explicitly controls.
        for(const t of this.transitions)if(t.group===group)for(const key of Object.keys(target))delete t.to[key];
        this.transitions.push({group,at:cue.at_seconds,duration:cue.transition_seconds??.4,from:{...this.state[group]},to:{...target}});
      }
    }
    evaluate(time);this.apply();
  }
  apply(){
    if(this.active&&this.cameraEnabled)this.camera.applyDirection(this.state.camera);
    this.root.position.set(this.state.root.x,0,this.state.root.z);this.root.rotation.y=this.state.root.heading*Math.PI/180;
  }
  clear(){this.active=false;this.transitions=[];this.state.face={eyes:1,mouth:1,head:1};this.state.expressions={};}
  reset(){this.clear();this.state.root={x:0,z:0,heading:0};this.root.position.set(0,0,0);this.root.rotation.y=0;}
  snapshot(){return structuredClone({...this.state,active:this.active,time:this.last});}
}
