// Attachments carry their originating tab through picker/permission/recording callbacks.
export function mediaInput(scope,{changed=()=>{},beforeInput=()=>{},error=()=>{},pushToTalk=false,send=()=>{}}={}){
  const $=id=>document.querySelector(`#${scope}-${id}`);
  let attachment=null,recording=false,anyRecording=false,blocked=false,held=false,sendRecording=false,recorded=false;
  function paint(){
    $('attachment').textContent=attachment?.label||'';$('clear-attachment').hidden=!attachment;
    if(pushToTalk){$('record').setAttribute('aria-pressed',String(held||recording));$('record').title=recording?'Release to send':'Hold to talk; release to send';}
    else $('record').textContent=recording?'Finish recording':'Record';
    $('record').disabled=!recording&&(blocked||anyRecording);
    for(const kind of ['audio','image'])if($(kind))$(kind).disabled=blocked||anyRecording;
    if($('camera'))$('camera').disabled=blocked||anyRecording||held;
  }
  for(const kind of ['audio','image'])if($(kind))$(kind).onclick=()=>{$('media')?.close();beforeInput();window.Cleo?.inputAttach?.(kind,scope);};
  if($('camera')){
    $('camera').onclick=()=>{beforeInput();window.Cleo?.inputCamera?.(scope);};$('media-close').onclick=()=>$('media').close();
    $('capture').onclick=()=>{$('media').close();beforeInput();window.Cleo?.inputCamera?.(scope);};
  }
  function begin(){if(held||recording||blocked||anyRecording)return;beforeInput();held=true;recorded=false;sendRecording=false;window.Cleo?.inputRecord?.(true,scope);paint();}
  function release(cancel=false){if(!held&&!recording)return;held=false;sendRecording=!cancel;window.Cleo?.inputRecord?.(false,scope);paint();}
  if(pushToTalk){
    $('record').onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();$('record').setPointerCapture(e.pointerId);begin();};
    $('record').onpointerup=e=>{e.preventDefault();release();};
    $('record').onpointercancel=()=>release(true);
    $('record').onlostpointercapture=()=>{if(held)release(true);};
    $('record').onkeydown=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)begin();}};
    $('record').onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();release();}};
    $('record').onblur=()=>{if(held)release(true);};
    $('record').oncontextmenu=e=>e.preventDefault();
  }else $('record').onclick=()=>{if(!recording)beforeInput();window.Cleo?.inputRecord?.(!recording,scope);};
  $('clear-attachment').onclick=()=>{attachment=null;paint();changed();};
  return {event(value){
    if('recording' in value){anyRecording=value.recording;if(value.inputScope===scope)recording=value.recording;}
    if(value.inputScope===scope){if(value.attachment){attachment=value.attachment;if(attachment.recorded)recorded=true;}if(value.inputError){held=false;sendRecording=false;error(value.inputError);}}
    paint();changed();
    if(pushToTalk&&value.inputScope===scope&&value.recording===false&&recorded){held=false;recorded=false;if(sendRecording){sendRecording=false;queueMicrotask(send);}paint();}
  },get:()=>attachment,take(){const value=attachment;attachment=null;paint();return value;},recording:()=>anyRecording,
  block(value){blocked=Boolean(value);paint();},stop(){sendRecording=false;if(pushToTalk)release(true);else if(recording)window.Cleo?.inputRecord?.(false,scope);$('media')?.close();},clear(){attachment=null;paint();}};
}
