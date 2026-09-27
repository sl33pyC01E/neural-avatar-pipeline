import {mediaInput} from './media-input.mjs';
import {streamMessage} from './stream-message.mjs';
import {SpeechPhrases} from './speech-phrases.mjs';
const $=selector=>document.querySelector(selector);
// A bounded catalog of TEXT EMBEDDINGS. Ardy still generates every body frame live.
export function embeddingCatalog(bank=[]){
  const choices=[['neutral','Relaxed speaking idle'],['explain','Natural explaining'],['wave','Right hand wave'],['welcome','Welcome audience'],['shrug','Unsure shrug'],['think','Thinking pose'],['reassure','Reassuring gesture'],['emphasis','Gentle emphasis']];
  const result=choices.flatMap(([key,label])=>{const item=bank.find(item=>item.nickname===label);return item?[{key,label,id:item.id}]:[];});
  if(!result.length&&bank.length)result.push({key:'neutral',label:(bank[0].nickname||bank[0].text).slice(0,100),id:bank[0].id});
  return result;
}
export function createAvatarAgent(chat,hooks,scope='cleopatra'){
  const $=selector=>document.querySelector(selector.replaceAll('cleopatra',scope)),isMain=scope==='main',channel=isMain?'main':'avatar';
  let prepared=!isMain,preparing=false,prepareFailed=false;
  const context=()=>({...isMain?{frame:hooks.frame()}: {},motions:embeddingCatalog(hooks.state()?.bank),expressions:hooks.avatar()?.expressions()||['neutral'],tracks:hooks.avatar()?.motionCatalog?.()||[]});
  let active=false,warmId=null,loading=false,nativeReady=false,run=null,nativeConfig='',awaitingReady=false,historyKey='';
  let loadingStage='',loadRequest=null,loadError='',reloadQueued=false;
  const media=mediaInput(scope,{changed:controls,error:text=>status(text),pushToTalk:isMain,send:()=>$('#cleopatra-form').requestSubmit()});
  const components={ardy:'unloaded',pocket:'unloaded',lam:'unloaded'};
  const runtimeKey=()=>JSON.stringify([...hooks.runtime(),isMain?hooks.frame():'debug',isMain?hooks.avatar()?.bodySource?.():'ardy']);
  const status=text=>{$('#cleopatra-status').textContent=text;};
  function ready(){return active&&Boolean(hooks.avatar())&&nativeReady&&nativeConfig===runtimeKey()&&chat.ready()&&prepared;}
  function controls(){
    const model=chat.status();
    // A tool can switch between live and cached body sources during a turn.
    // Reconcile residency after that turn, without interrupting its speech.
    if(isMain&&active&&!run&&!loading&&!preparing&&!model.busy&&nativeReady&&chat.ready()&&nativeConfig!==runtimeKey()&&!reloadQueued){
      reloadQueued=true;queueMicrotask(()=>{reloadQueued=false;if(active&&!run&&!loading&&!chat.status().busy&&nativeConfig!==runtimeKey()){prepared=false;$('#cleopatra-load').click();}});
    }
    if(isMain&&active&&nativeReady&&!loading&&chat.ready()&&!prepared&&!preparing&&!prepareFailed&&!loadError){
      const value=context();
      if(value.motions.length){preparing=true;chat.request({action:'mainPrepare',...value});status('Preparing Cleopatra’s situation and avatar controls…');}
    }
    $('#cleopatra-models').textContent=`VRM ${hooks.avatar()?'ready':'loading'} · Gemma ${model.selection?.model==='gemma-e4b'?'E4B':'E2B'} ${model.loaded?(model.dirty?'settings changed':'resident'):model.busy?'loading':'unloaded'} · Ardy ${components.ardy} · Pocket ${components.pocket} · LAM ${components.lam}`;
    $('#cleopatra-load').disabled=loading||Boolean(run)||model.busy||model.recording||!hooks.avatar();
    media.block(Boolean(run)||loading||model.busy);
    $('#cleopatra-send').disabled=!ready()||Boolean(run)||loading;
    $('#cleopatra-new').disabled=Boolean(run)||model.busy||!model.loaded;
    if(isMain)$('#cleopatra-stop').hidden=!run&&!loading&&!preparing;
    document.querySelectorAll('[data-frame]').forEach(button=>{if(isMain)button.disabled=Boolean(run)||loading||preparing;});
    if(ready()&&!run&&!loading&&awaitingReady){status(isMain?'Ready':'All five ready · live Ardy uses cached text embeddings');awaitingReady=false;}
    if(loadError)status(loadError);
  }
  function stop(message='Stopped'){
    if(run&&!run.generationDone)chat.request({action:'cancel'});
    if((loading||preparing)&&chat.status().busy)chat.request({action:'cancel'});
    media.stop();if(preparing){preparing=false;prepareFailed=true;}run=null;loading=false;loadingStage='';loadRequest=null;awaitingReady=false;warmId=null;window.Cleo?.cancelWarmAll?.();hooks.stopTake();status(message);controls();
  }
  function failLoad(message){loadError=message;prepareFailed=true;stop(message);}
  function continueLoading(){
    if(!loading)return;
    if(isMain&&!prepared){
      const value=context();
      if(!value.motions.length){failLoad('No cached embeddings available; prepare one in tab 5.');return;}
      loadingStage='prompt';preparing=true;
      loadRequest=chat.request({action:'mainPrepare',...value});status('Preparing Cleopatra’s situation and avatar controls…');
    }else{
      loadingStage='avatar';const [profile,threads,precision]=hooks.runtime();
      status('Gemma ready · loading Ardy, Pocket and LAM…');window.Cleo.warmAll(profile,threads,precision,warmId);
    }
  }
  $('#cleopatra-load').onclick=()=>{
    if(!active||run||chat.status().busy||chat.status().recording||!hooks.avatar()||!window.Cleo?.warmAll)return;
    prepareFailed=false;loadError='';nativeReady=false;loading=true;awaitingReady=true;nativeConfig=runtimeKey();warmId=crypto.randomUUID();
    for(const key of Object.keys(components))components[key]='queued';
    if(chat.ready())continueLoading();
    else{
      prepared=!isMain;loadingStage='release';status('Preparing memory for Gemma…');
      window.Cleo.prepareModelLoad(warmId);
    }
    controls();
  };
  $('#cleopatra-stop').onclick=()=>stop();
  $('#cleopatra-unload').onclick=()=>{loadError='';stop('Unloading models…');nativeReady=false;for(const key of Object.keys(components))components[key]='unloaded';window.Cleo?.unloadAvatarModels?.();chat.request({action:'unload'});controls();};
  $('#cleopatra-new').onclick=()=>{if(run||chat.status().busy)return;loadError='';prepareFailed=false;if(isMain){prepared=false;preparing=true;}chat.request({action:isMain?'mainNew':'avatarNew',...(isMain?context():{})});$('#cleopatra-log').replaceChildren();$('#cleopatra-tools').textContent='';status('New Cleopatra conversation');};
  $('#cleopatra-form').onsubmit=event=>{
    event.preventDefault();if(!ready()||run||loading)return;
    const text=$('#cleopatra-text').value.trim();if(!text&&!media.get())return;
    const motions=embeddingCatalog(hooks.state()?.bank);if(!motions.length){status('No cached embeddings available; prepare one in tab 5.');return;}
    const attachment=media.take(),id=crypto.randomUUID(),log=$('#cleopatra-log');streamMessage(log,'user',(attachment?`[${attachment.kind}]\n`:'')+text,'','Cleopatra');
    run={id,phase:'generating',generationDone:false,streaming:isMain&&document.querySelector('#stream-speech').checked,phrases:new SpeechPhrases(),started:performance.now(),view:streamMessage(log,'assistant','','','Cleopatra')};
    $('#cleopatra-tools').textContent='';$('#cleopatra-text').value='';$('#cleopatra-text').blur();
    chat.request({action:isMain?'mainSend':'avatarSend',...(isMain?{frame:hooks.frame(),scene:hooks.avatar().scene()}:{}),requestId:id,text,...(attachment?{file:attachment.file,kind:attachment.kind}:{}),motions,expressions:hooks.avatar().expressions(),tracks:hooks.avatar().motionCatalog?.()||[]});
    status('Gemma is responding…');$('#cleopatra-latency').textContent='Send → voice: measuring…';controls();
  };
  function feedSpeech(text,plan,final=false){
    if(!run?.streaming)return;
    for(const phrase of run.phrases.append(text,final)){
      if(run.phase==='generating'){
        if(!active||!nativeReady)throw new Error('Reply ready; avatar models are unavailable.');
        if(!plan)throw new Error('Missing avatar plan for streaming speech');
        hooks.startStream(run.id,phrase,plan);run.phase='performing';status('Speaking as Gemma responds…');
      }else hooks.appendStream(run.id,phrase,false);
    }
    if(final&&run.phase==='performing')hooks.appendStream(run.id,'',true);
  }
  function event(value){
    if(value.type==='ensemble'&&value.requestId===warmId){
      if(value.state==='error'){failLoad(value.message);return;}
      if(value.component==='release'){
        if(loadingStage==='release'&&value.state==='ready'){
          for(const key of Object.keys(components))components[key]='queued';
          loadingStage='gemma';loadRequest=chat.load();status('Loading Gemma with vision and audio…');
          if(!loadRequest)failLoad('Gemma could not start loading. Try Launch again.');
        }
        controls();return;
      }
      if(value.component in components)components[value.component]=value.state==='ready'?'resident':value.state;
      if(value.component==='all'){loading=false;loadingStage='';nativeReady=value.state==='ready';chat.request({action:'status'});}
      status(value.message);
    }
    if(value.type==='ensembleReleased'){nativeReady=false;for(const key of Object.keys(components))components[key]='unloaded';if(run)stop(value.message);else status(value.message);}
    if(value.type==='chat'){
      media.event(value);
      if(isMain&&'mainPrepared' in value){prepared=Boolean(value.mainPrepared);if(prepared)preparing=false;const label=$('#main-prefill');if(value.state)label.textContent=prepared?`Gemma ${value.selection?.model==='gemma-e4b'?'E4B':'E2B'} prompt ready · ${Math.round(value.prefillMs||0)} ms preparation${value.prefillTokens>=0?' · '+value.prefillTokens+' tokens':''}`:'Prompt awaits Launch';}
      if(isMain&&(value.unloaded||value.disconnected||value.error)){if(value.unloaded||value.disconnected)$('#main-prefill').textContent='Gemma is unloaded; saved disk prefixes remain available.';prepared=false;preparing=false;prepareFailed=Boolean(value.error);if(value.error&&active)status(value.error);}
      if(value.error&&active&&(loading||value.channel===channel||value.disconnected)){failLoad(value.error);}
      if(loading&&value.state&&!value.busy&&value.requestId===loadRequest){
        if(loadingStage==='gemma'&&chat.ready())continueLoading();
        else if(loadingStage==='prompt'&&prepared)continueLoading();
      }
      if(value.state&&!value.busy){
        const history=(isMain?value.mainHistory:value.avatarHistory)||[],key=JSON.stringify(history);
        if(!run&&key!==historyKey){const log=$('#cleopatra-log');log.replaceChildren();for(const item of history)streamMessage(log,item.role,item.text,item.reasoning,'Cleopatra');}
        historyKey=key;
      }
      if(value.disconnected||value.unloaded){if(run)stop(value.error||'Gemma unloaded');loading=false;}
      if(value.error&&loading){loading=false;status(value.error);}
      if(run&&value.channel===channel&&value.requestId===run.id&&!run.generationDone){
        if(value.partial!==undefined){run.view.update(value.partial,value.reasoning);try{if(value.avatarPlan)feedSpeech(value.partial,value.avatarPlan);}catch(failure){stop(failure.message);return;}}
        if(value.avatarTool)$('#cleopatra-tools').textContent+=JSON.stringify(value.avatarTool,null,2)+'\n';
        if(value.error)stop(value.error);
        else if(value.result){
          run.view.update(value.result.text,value.result.reasoning);
          const text=value.result.text.trim();
          if(!text||text.length>2000){stop('Reply displayed; speech requires 1–2,000 characters. Ask for a shorter reply.');return;}
          if(!active||!nativeReady){stop('Reply ready; avatar models are unavailable.');return;}
          if(run.streaming){
            try{feedSpeech(value.result.text,value.result.avatarPlan,true);run.generationDone=true;}catch(failure){stop(failure.message);}
            controls();return;
          }
          run.generationDone=true;
          run.phase='performing';
          status(isMain&&hooks.frame()==='face'?'Preparing voice and face…':'Scheduling live Ardy, voice and face…');
          hooks.startTake(text,value.result.avatarPlan);
        }
      }
    }
    if(run&&value.tab===scope){
      if(value.type==='talkPlayback')$('#cleopatra-latency').textContent=`Send → track: ${Math.round(performance.now()-run.started)} ms · voice cue +${Math.round(hooks.cue()*1000)} ms`;
      if(value.type==='talkMetrics')$('#cleopatra-latency').textContent=`Send → voice: ${Math.round(run.preparationMs+(value.speechStartMs??value.playbackStartMs))} ms · ${value.underruns} underruns`;
      if(value.type==='speechStart')run.preparationMs=performance.now()-run.started;
      if(value.type==='speechEnd'){if(!run.generationDone)chat.request({action:'cancel'});run=null;chat.request({action:'status'});}
    }
    if(value.type==='talkRejected'&&run?.phase==='performing')stop(value.message);
    controls();
  }
  return {event,refresh:controls,frameChanged(){if(active&&!loading&&!run&&nativeReady&&chat.ready()&&nativeConfig!==runtimeKey()){prepared=!isMain;$('#cleopatra-load').click();}},stop,load(){ $('#cleopatra-load').click(); },select(tab){if(active&&tab!==scope){stop();nativeReady=false;}active=tab===scope;controls();},hidden(){if(active)stop('Paused while hidden');}};
}
