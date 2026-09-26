// Attachments carry their originating tab through picker/permission/recording callbacks.
export function mediaInput(scope,{changed=()=>{},beforeInput=()=>{},error=()=>{}}={}){
  const $=id=>document.querySelector(`#${scope}-${id}`);
  let attachment=null,recording=false,anyRecording=false,blocked=false;
  function paint(){
    $('attachment').textContent=attachment?.label||'';$('clear-attachment').hidden=!attachment;
    $('record').textContent=recording?'Finish recording':'Record';
    $('record').disabled=!recording&&(blocked||anyRecording);
    for(const kind of ['audio','image'])if($(kind))$(kind).disabled=blocked||anyRecording;
  }
  for(const kind of ['audio','image'])if($(kind))$(kind).onclick=()=>{beforeInput();window.Cleo?.inputAttach?.(kind,scope);};
  $('record').onclick=()=>{if(!recording)beforeInput();window.Cleo?.inputRecord?.(!recording,scope);};
  $('clear-attachment').onclick=()=>{attachment=null;paint();changed();};
  return {event(value){
    if('recording' in value){anyRecording=value.recording;if(value.inputScope===scope)recording=value.recording;}
    if(value.inputScope===scope){if(value.attachment)attachment=value.attachment;if(value.inputError)error(value.inputError);}
    paint();changed();
  },get:()=>attachment,take(){const value=attachment;attachment=null;paint();return value;},recording:()=>anyRecording,
  block(value){blocked=Boolean(value);paint();},stop(){if(recording)window.Cleo?.inputRecord?.(false,scope);},clear(){attachment=null;paint();}};
}
