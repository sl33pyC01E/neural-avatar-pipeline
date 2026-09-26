import {mediaInput} from './media-input.mjs';
import {streamMessage} from './stream-message.mjs';
const $=selector=>document.querySelector(selector);
// A bounded catalog of TEXT EMBEDDINGS. Ardy still generates every body frame live.
export function embeddingCatalog(bank=[]){
  const choices=[['neutral','Relaxed speaking idle'],['explain','Natural explaining'],['wave','Right hand wave'],['welcome','Welcome audience'],['shrug','Unsure shrug'],['think','Thinking pose'],['reassure','Reassuring gesture'],['emphasis','Gentle emphasis']];
  const result=choices.flatMap(([key,label])=>{const item=bank.find(item=>item.nickname===label);return item?[{key,label,id:item.id}]:[];});
  if(!result.length&&bank.length)result.push({key:'neutral',label:(bank[0].nickname||bank[0].text).slice(0,100),id:bank[0].id});
  return result;
}
export function createAvatarAgent(chat,hooks){
  let active=false,warmId=null,loading=false,nativeReady=false,run=null,nativeConfig='',awaitingReady=false,historyKey='';
  const media=mediaInput('cleopatra',{changed:controls,error:text=>status(text)});
  const components={ardy:'unloaded',pocket:'unloaded',lam:'unloaded'};
  const runtimeKey=()=>JSON.stringify(hooks.runtime());
  const status=text=>{$('#cleopatra-status').textContent=text;};
  function ready(){return active&&Boolean(hooks.avatar())&&nativeReady&&nativeConfig===runtimeKey()&&chat.ready();}
  function controls(){
    const model=chat.status();
    $('#cleopatra-models').textContent=`VRM ${hooks.avatar()?'ready':'loading'} · Gemma ${model.selection?.model==='gemma-e4b'?'E4B':'E2B'} ${model.loaded?(model.dirty?'settings changed':'resident'):model.busy?'loading':'unloaded'} · Ardy ${components.ardy} · Pocket ${components.pocket} · LAM ${components.lam}`;
    $('#cleopatra-load').disabled=loading||Boolean(run)||model.busy||model.recording||!hooks.avatar();
    media.block(Boolean(run)||loading||model.busy);
    $('#cleopatra-send').disabled=!ready()||Boolean(run)||loading;
    $('#cleopatra-new').disabled=Boolean(run)||model.busy||!model.loaded;
    if(ready()&&!run&&!loading&&awaitingReady){status('All five ready · live Ardy uses cached text embeddings');awaitingReady=false;}
  }
  function stop(message='Stopped'){
    if(run?.phase==='generating')chat.request({action:'cancel'});
    if(loading&&chat.status().busy)chat.request({action:'cancel'});
    media.stop();run=null;loading=false;awaitingReady=false;warmId=null;window.Cleo?.cancelWarmAll?.();hooks.stopTake();status(message);controls();
  }
  $('#cleopatra-load').onclick=()=>{
    if(!active||run||chat.status().busy||chat.status().recording||!hooks.avatar()||!window.Cleo?.warmAll)return;
    nativeReady=false;loading=true;awaitingReady=true;nativeConfig=runtimeKey();warmId=crypto.randomUUID();
    for(const key of Object.keys(components))components[key]='queued';
    const [profile,threads,precision]=hooks.runtime();
    window.Cleo.warmAll(profile,threads,precision,warmId);
    if(!chat.ready())chat.load();status('Loading Gemma, live Ardy, Pocket and LAM…');controls();
  };
  $('#cleopatra-stop').onclick=()=>stop();
  $('#cleopatra-unload').onclick=()=>{stop('Unloading models…');nativeReady=false;for(const key of Object.keys(components))components[key]='unloaded';window.Cleo?.unloadAvatarModels?.();chat.request({action:'unload'});controls();};
  $('#cleopatra-new').onclick=()=>{if(run||chat.status().busy)return;chat.request({action:'avatarNew'});$('#cleopatra-log').replaceChildren();$('#cleopatra-tools').textContent='';status('New Cleopatra conversation');};
  $('#cleopatra-form').onsubmit=event=>{
    event.preventDefault();if(!ready()||run||loading)return;
    const text=$('#cleopatra-text').value.trim();if(!text&&!media.get())return;
    const motions=embeddingCatalog(hooks.state()?.bank);if(!motions.length){status('No cached embeddings available; prepare one in tab 5.');return;}
    const attachment=media.take(),id=crypto.randomUUID(),log=$('#cleopatra-log');streamMessage(log,'user',(attachment?`[${attachment.kind}]\n`:'')+text,'','Cleopatra');
    run={id,phase:'generating',started:performance.now(),view:streamMessage(log,'assistant','','','Cleopatra')};
    $('#cleopatra-tools').textContent='';$('#cleopatra-text').value='';$('#cleopatra-text').blur();
    chat.request({action:'avatarSend',requestId:id,text,...(attachment?{file:attachment.file,kind:attachment.kind}:{}),motions,expressions:hooks.avatar().expressions()});
    status('Gemma is responding…');$('#cleopatra-latency').textContent='Send → voice: measuring…';controls();
  };
  function event(value){
    if(value.type==='ensemble'&&value.requestId===warmId){
      if(value.component in components)components[value.component]=value.state==='ready'?'resident':value.state;
      if(value.component==='all'){loading=false;nativeReady=value.state==='ready';chat.request({action:'status'});}
      status(value.message);
    }
    if(value.type==='ensembleReleased'){nativeReady=false;for(const key of Object.keys(components))components[key]='unloaded';if(run)stop(value.message);else status(value.message);}
    if(value.type==='chat'){
      media.event(value);
      if(value.state&&!value.busy){
        const history=value.avatarHistory||[],key=JSON.stringify(history);
        if(!run&&key!==historyKey){const log=$('#cleopatra-log');log.replaceChildren();for(const item of history)streamMessage(log,item.role,item.text,item.reasoning,'Cleopatra');}
        historyKey=key;
      }
      if(value.disconnected||value.unloaded){if(run)stop(value.error||'Gemma unloaded');loading=false;}
      if(value.error&&loading){loading=false;status(value.error);}
      if(run&&value.channel==='avatar'&&value.requestId===run.id&&run.phase==='generating'){
        if(value.partial!==undefined)run.view.update(value.partial,value.reasoning);
        if(value.avatarTool)$('#cleopatra-tools').textContent+=JSON.stringify(value.avatarTool,null,2)+'\n';
        if(value.error)stop(value.error);
        else if(value.result){
          run.view.update(value.result.text,value.result.reasoning);
          const text=value.result.text.trim();
          if(!text||text.length>2000){stop('Reply displayed; speech requires 1–2,000 characters. Ask for a shorter reply.');return;}
          if(!active||!nativeReady){stop('Reply ready; avatar models are unavailable.');return;}
          run.phase='performing';
          status('Scheduling live Ardy, voice and face…');
          hooks.startTake(text,value.result.avatarPlan);
        }
      }
    }
    if(run&&value.tab==='cleopatra'){
      if(value.type==='talkPlayback')$('#cleopatra-latency').textContent=`Send → track: ${Math.round(performance.now()-run.started)} ms · voice cue +${Math.round(hooks.cue()*1000)} ms`;
      if(value.type==='talkMetrics')$('#cleopatra-latency').textContent=`Send → voice: ${Math.round(run.preparationMs+value.speechStartMs)} ms · ${value.underruns} underruns`;
      if(value.type==='speechStart')run.preparationMs=performance.now()-run.started;
      if(value.type==='speechEnd'){run=null;chat.request({action:'status'});}
    }
    if(value.type==='talkRejected'&&run?.phase==='performing')run=null;
    controls();
  }
  return {event,refresh:controls,stop,select(tab){if(active&&tab!=='cleopatra'){stop();nativeReady=false;}active=tab==='cleopatra';controls();},hidden(){if(active)stop('Paused while hidden');}};
}
