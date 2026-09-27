import {mediaInput} from './media-input.mjs';
import {streamMessage} from './stream-message.mjs';
const $=selector=>document.querySelector(selector);
export function createBrowserUI(){
  let active=false,pending=null;
  const command=value=>window.Cleo?.browserCommand?.(JSON.stringify(value));
  const media=mediaInput('browser',{beforeInput:()=>command({action:'pause'}),error:text=>{$('#browser-status').textContent=text;}});
  function bounds(){if(!active)return;const r=$('#browser-viewport').getBoundingClientRect();window.Cleo?.browserBounds?.(JSON.stringify({x:r.x/innerWidth,y:r.y/innerHeight,width:r.width/innerWidth,height:r.height/innerHeight}));}
  const resize=new ResizeObserver(bounds);resize.observe($('#browser-viewport'));window.addEventListener('resize',bounds);visualViewport?.addEventListener('resize',bounds);
  $('#browser-form').onsubmit=event=>{event.preventDefault();const goal=$('#browser-goal').value.trim();if(media.recording()||(!goal&&!media.get()))return;$('#browser-goal').blur();$('#browser-followup').hidden=true;const audio=media.take();command({action:'start',goal,...(audio?{audioFile:audio.file}:{})});};
  for(const action of ['pause','resume','stop','back','home','approve','reject','inspect'])$(`#browser-${action}`).onclick=()=>{if(['approve','reject'].includes(action))$('#browser-followup').hidden=true;command({action});};
  $('#browser-followup-form').onsubmit=event=>{event.preventDefault();if(media.recording())return;const audio=media.take();command({action:'followup',text:$('#browser-answer').value.trim(),...(audio?{audioFile:audio.file}:{})});$('#browser-answer').value='';$('#browser-followup').hidden=true;};
  return {modelEvent(value){
    media.event(value);
    if(value.channel!=='browser')return;
    if(value.partial!==undefined){
      if(pending?.id!==value.requestId){$('#browser-stream').replaceChildren();pending={id:value.requestId,view:streamMessage($('#browser-stream'),'assistant')};}
      pending.view.update(value.partial,value.reasoning);bounds();
    }
    if(value.result&&pending?.id===value.requestId)pending.view.update(value.result.text,value.result.reasoning);
  },select(tab){if(active&&tab!=='browser')media.stop();active=tab==='browser';if(active)requestAnimationFrame(bounds);},event(value){
    $('#browser-status').textContent=value.status||'';$('#browser-url').textContent=value.url||'Google';
    $('#browser-pause').disabled=!value.running;$('#browser-resume').disabled=value.running||value.waiting;
    if(!value.waiting)$('#browser-followup').hidden=true;
    if(value.question){$('#browser-followup').hidden=false;$('#browser-question').textContent=value.question;$('#browser-confirm').hidden=!value.confirmation;$('#browser-followup-form').hidden=Boolean(value.confirmation);}
    bounds();
  }};
}
