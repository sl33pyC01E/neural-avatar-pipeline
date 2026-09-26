// Module shell. Welcome and isolated speech load no avatar or WebGL context.
let currentTab='welcome',pageVisible=!document.hidden,avatar,avatarLoading,lastState,speechBusy=false,pipelineTab='talk',performanceCue=.5;
const $=selector=>document.querySelector(selector);
const panels={welcome:'#welcome-panel',pocket:'#pocket-panel',face:'#face-panel',talk:'#talk-panel',avatar:'#panel',full:'#full-panel'};
const usesAvatar=tab=>['face','talk','avatar','full'].includes(tab);
const pocketStatus=$('#pocket-status'),speak=$('#speak'),faceStatus=$('#face-status'),animateFace=$('#animate-face');
const runtimeControls=[...document.querySelectorAll('#pocket-settings select')];
const timingControls=[$('#full-cue'),$('#full-tail')];
const benchmarkRepeat=$('#benchmark-repeat');let repeatTimer;
function stopRepeat(){clearTimeout(repeatTimer);benchmarkRepeat.checked=false;window.Cleo?.benchmarkTrace?.(false);}
benchmarkRepeat.onchange=()=>{clearTimeout(repeatTimer);window.Cleo?.benchmarkTrace?.(benchmarkRepeat.checked);};
try{const saved=JSON.parse(localStorage.getItem('cleo-performance-timing')||'{}');for(const input of timingControls)if(Number.isFinite(saved[input.id])&&saved[input.id]>=Number(input.min)&&saved[input.id]<=Number(input.max))input.value=saved[input.id];}catch{}
for(const input of timingControls)input.onchange=()=>{try{localStorage.setItem('cleo-performance-timing',JSON.stringify(Object.fromEntries(timingControls.map(item=>[item.id,Number(item.value)]))));}catch{}};
try {
  const saved=JSON.parse(localStorage.getItem('cleo-pocket-settings')||'{}');
  for(const control of runtimeControls)if([...control.options].some(option=>option.value===saved[control.id]))control.value=saved[control.id];
} catch {}
for(const control of runtimeControls)control.addEventListener('change',()=>{
  try{localStorage.setItem('cleo-pocket-settings',JSON.stringify(Object.fromEntries(runtimeControls.map(item=>[item.id,item.value]))));}catch{}
});
function settings(){return [Number($('#threads').value),Number($('#steps').value),Number($('#chunk-size').value),$('#precision').value,$('#playback-mode').value==='buffered'];}
function buttons(){
  speak.disabled=speechBusy||!lastState;
  animateFace.disabled=speechBusy||!avatar||!lastState?.pocketClip||currentTab!=='face';
  for(const tab of ['talk','full'])$(`#${tab}-send`).disabled=speechBusy||!avatar||!lastState||currentTab!==tab;
  for(const control of runtimeControls)control.disabled=speechBusy;
  for(const control of timingControls)control.disabled=speechBusy;
}
function describeSettings(tab){
  const [threads,steps,chunk,precision,buffered]=settings(),face=avatar?.faceSettings();
  $(`#${tab}-settings`).textContent=`${precision} · ${threads} CPU threads · ${steps} steps · chunk ${chunk}\n${buffered?'Prepared speech with shortened pauses':'Raw streaming with untrimmed pauses'} · rolling LAM\n`+
    (face?`Eyes ${face.eyes}× · mouth ${face.mouth}× · head ${face.head}× · natural motion ${face.naturalMotion?'on':'off'}`:'');
  if(tab==='full')$('#full-body').textContent=`${$('#profile').value} · ${$('#bank').selectedOptions[0]?.textContent||'Choose a cached motion in tab 5'}`;
}
window.validationState={ready:false,errors:[],tab:currentTab};
function fail(error){const message=String(error?.stack||error);window.validationState.errors.push(message);pocketStatus.textContent=message;if(['talk','full'].includes(currentTab))$(`#${currentTab}-status`).textContent=message;console.error(message);}
window.addEventListener('error',event=>fail(event.error||event.message));
window.addEventListener('unhandledrejection',event=>fail(event.reason));

async function selectTab(tab){
  if(!panels[tab])return;
  if(tab!==currentTab){stopRepeat();window.Cleo?.quiet();avatar?.pause();avatar?.stopFace();}
  currentTab=tab;window.validationState.tab=tab;window.Cleo?.tab(tab);
  document.querySelectorAll('[data-tab]').forEach(button=>{
    const active=button.dataset.tab===tab;button.setAttribute('aria-selected',active);button.tabIndex=active?0:-1;
  });
  for(const [key,panel] of Object.entries(panels))$(panel).hidden=key!==tab;
  $('canvas').hidden=!usesAvatar(tab);
  $('#subtitle').textContent={welcome:'Local module lab',pocket:'Anna · isolated speech runtime',face:'LAM · last Anna clip',talk:'Anna + LAM · speech to face',avatar:'Ardy · motion and embeddings',full:'Anna + LAM + Ardy'}[tab];
  buttons();avatar?.setVisible(false);
  if(usesAvatar(tab)){
    avatarLoading??=import('./avatar-view.mjs').then(module=>module.createAvatarView());
    avatar=await avatarLoading;
    if(lastState)avatar.event(lastState);
    if(['face','talk','full'].includes(currentTab))avatar.setMode('rest');
    avatar.setFaceView(['face','talk'].includes(currentTab));
    avatar.setVisible(pageVisible&&usesAvatar(currentTab));
    if(['talk','full'].includes(currentTab))describeSettings(currentTab);
    buttons();
  }
}
document.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>selectTab(button.dataset.open).catch(fail));
document.querySelectorAll('[data-tab]').forEach(button=>{
  button.onclick=()=>selectTab(button.dataset.tab).catch(fail);
  button.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...document.querySelectorAll('[data-tab]')],index=tabs.indexOf(button);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
    event.preventDefault();tabs[next].focus();tabs[next].click();
  };
});
window.cleoVisible=value=>{pageVisible=Boolean(value)&&!document.hidden;if(!pageVisible)stopRepeat();avatar?.setVisible(pageVisible&&usesAvatar(currentTab));};
document.addEventListener('visibilitychange',()=>window.cleoVisible(!document.hidden));
const ms=value=>value>=0?`${Math.round(value)} ms`:'—';
const eventTab=event=>event.tab||((event.withFace||event.type==='face')?'face':'pocket');
window.cleoEvent=event=>{
  const tab=eventTab(event),status=tab==='pocket'?pocketStatus:tab==='face'?faceStatus:$(`#${tab}-status`);
  if(event.type==='state'){
    lastState=event;
    if(!speechBusy){pocketStatus.textContent=event.pocketStage?`Ready · last stage: ${event.pocketStage}`:'Ready for your speech test';faceStatus.textContent=event.pocketClip?'Anna clip ready for facial animation.':'Generate an Anna clip in tab 2 first.';}
    buttons();window.Cleo?.tab(currentTab);
  }
  if(event.type==='speechStart'){
    speechBusy=true;status.textContent=event.message;buttons();
    if(['talk','full'].includes(tab))pipelineTab=tab;
    if(tab==='full')performanceCue=event.cueSeconds;
  }
  if(['pocketStage','speechBusy','speechEnd'].includes(event.type))status.textContent=event.message;
  if(event.type==='faceStage')faceStatus.textContent=event.message;
  if(event.type==='talkStage')$(`#${pipelineTab}-status`).textContent=event.message;
  if(event.type==='talkRejected'){speechBusy=false;$(`#${pipelineTab}-status`).textContent=event.message;buttons();}
  if(event.type==='talkPlayback'){
    $(`#${tab}-status`).textContent=tab==='full'?`Playing take · speech cue ${performanceCue.toFixed(2)} s`:'Speaking';
    $(`#${tab}-latency`).textContent=tab==='full'?`Send → track: ${ms(event.playbackStartMs)} · speech scheduled +${ms(performanceCue*1000)}`:`Send → playback: ${ms(event.playbackStartMs)}`;
  }
  if(event.type==='talkMetrics'){
    const p=event.pocket;$(`#${tab}-latency`).textContent=`Send → playback: ${ms(event.playbackStartMs)} · ${event.underruns} underruns`;
    $(`#${tab}-metrics`).textContent=`Pocket ${p.warm?'warm':'cold'} · load ${ms(p.loadMs)} · synthesis ${ms(p.computeMs)}\nLAM ${event.lamWarm?'warm':'cold'} · load ${ms(event.lamLoadMs)} · compute ${ms(event.lamComputeMs)}\nFirst face ${ms(event.firstFaceMs)} · ${event.faceFrames} frames · ${event.audioSeconds.toFixed(2)} s audio\nComplete ${ms(event.totalMs)} (includes playback)`;
    if(tab==='full'){
      $('#full-latency').textContent=`Send → track: ${ms(event.playbackStartMs)} · speech cue ${event.cueSeconds.toFixed(2)} s · ${event.underruns} underruns`;
      $('#full-metrics').textContent+=`\nMotion/renderer wait ${ms(event.motionGateWaitMs)} · tail ${event.tailSeconds.toFixed(2)} s\nSpeech scheduled ${ms(event.speechStartMs)} after Send · track ${event.trackSeconds.toFixed(2)} s`;
    }
    window.validationState.talkMetrics=event;
  }
  if(event.type==='faceMetrics')$('#face-metrics').textContent=`${event.cached?'Cached face':event.warm?'Warm LAM':'Cold LAM'} · ${event.frames} frames · ${ms(event.prepareMs)} preparation · ${ms(event.playbackStartMs)} to playback · ${event.audioSeconds.toFixed(2)} s audio · ${event.underruns} underruns`;
  if(event.type==='speechEnd'){
    speechBusy=false;
    if(event.clipReady||(!event.withFace&&event.message==='Anna ready'))lastState={...lastState,pocketClip:true};
    if(tab==='full')avatar?.pause();buttons();
    if(tab==='full'&&event.completed&&benchmarkRepeat.checked)repeatTimer=setTimeout(()=>{if(currentTab==='full'&&pageVisible&&benchmarkRepeat.checked&&!speechBusy)$('#full-form').requestSubmit();},150);
    else if(tab==='full'&&!event.completed)stopRepeat();
  }
  if(event.type==='pocketMetrics'){
    $('#first-audio').textContent=ms(event.firstChunkMs);$('#model-load').textContent=ms(event.loadMs)+(event.warm?' · warm':' · cold');
    $('#synthesis-speed').textContent=event.computeRtf>=0?`${event.computeRtf.toFixed(2)} RTF`:'—';$('#audio-duration').textContent=`${event.audioSeconds.toFixed(2)} s${event.cancelled?' · stopped':''}`;
    $('#playback-start').textContent=ms(event.playbackStartMs);$('#underruns').textContent=event.underruns??'—';window.validationState.pocketMetrics=event;
  }
  if(currentTab==='full'&&event.type==='motion')$('#full-body').textContent=`${event.profile} · ${ms(event.generationMs)} per motion batch`;
  if(currentTab==='full'&&event.type==='motionError')$('#full-body').textContent=`Ardy: ${event.message}`;
  const facial=event.withFace||event.type==='face';
  if(facial&&tab!==currentTab)return;
  let accepted;
  if(!['pocketStage','pocketMetrics','speechStart','speechEnd','speechBusy'].includes(event.type)||facial)accepted=avatar?.event(event);
  if(event.type==='face'&&event.prepared&&accepted===true)window.Cleo?.faceReady(event.runId);
};
speak.onclick=()=>{
  const text=$('#speech-text').value.trim();if(!text){pocketStatus.textContent='Enter something for Anna to say.';return;}
  if(!window.Cleo){pocketStatus.textContent='Speech runs in the Android app.';return;}
  pocketStatus.textContent='Starting PocketTTS…';window.Cleo.speak(text,...settings());
};
$('#quiet').onclick=()=>{window.Cleo?.quiet();pocketStatus.textContent='Stopping at the next audio callback…';};
animateFace.onclick=()=>{if(!animateFace.disabled){faceStatus.textContent='Preparing LAM…';window.Cleo?.animateLastClip();}};
$('#stop-face').onclick=()=>{window.Cleo?.quiet();};
for(const tab of ['talk','full']){
  $(`#${tab}-form`).onsubmit=event=>{
    event.preventDefault();if(speechBusy||!avatar||currentTab!==tab)return;
    const text=$(`#${tab}-text`).value.trim();if(!text){$(`#${tab}-status`).textContent='Enter something for Cleopatra to say.';return;}
    if(!window.Cleo){$(`#${tab}-status`).textContent='Speech runs in the Android app.';return;}
    if(tab==='full'&&!$('#bank').value){$('#full-status').textContent='Select a cached motion in tab 5 first.';return;}
    $(`#${tab}-text`).blur();pipelineTab=tab;speechBusy=true;buttons();describeSettings(tab);
    $(`#${tab}-status`).textContent='Starting…';$(`#${tab}-latency`).textContent='Send → playback: measuring…';
    window.Cleo.speakWithFace(text,...settings(),tab==='full'?Number($('#full-cue').value):0,tab==='full'?Number($('#full-tail').value):0);
  };
  $(`#${tab}-stop`).onclick=()=>{stopRepeat();window.Cleo?.quiet();avatar?.pause();avatar?.stopFace();$(`#${tab}-status`).textContent='Stopping…';};
}
window.debugTabs={select:selectTab,current:()=>currentTab};
selectTab('welcome').catch(fail);window.Cleo?.state();
