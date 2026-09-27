// Module shell. Welcome and isolated speech load no avatar or WebGL context.
import { createDebugWorkspace } from './debug-workspace.mjs';
import { createModelChat } from './model-chat.mjs';
import { createBrowserUI } from './browser-ui.mjs';
import { createAvatarAgent } from './avatar-agent.mjs';
import { createPromptTree } from './prompt-tree.mjs';
let currentTab='launch',pageVisible=!document.hidden,avatar,avatarLoading,lastState,speechBusy=false,pipelineTab='talk',performanceCue=.5;
const $=selector=>document.querySelector(selector);
const panels={launch:'#launch-panel',main:'#main-panel',welcome:'#welcome-panel',pocket:'#pocket-panel',face:'#face-panel',talk:'#talk-panel',avatar:'#panel',full:'#full-panel',chat:'#chat-panel',browser:'#browser-panel',cleopatra:'#cleopatra-panel'};
const debugWorkspace=createDebugWorkspace();window.debugWorkspace=debugWorkspace;
const modelChat=createModelChat(),browserUI=createBrowserUI();
const promptTree=createPromptTree();
new ResizeObserver(()=>document.documentElement.style.setProperty('--content-top',`${document.querySelector('header').getBoundingClientRect().bottom+12}px`)).observe(document.querySelector('header'));
const usesAvatar=tab=>['face','talk','avatar','full','cleopatra','main'].includes(tab);
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
const avatarAgent=createAvatarAgent(modelChat,{
  avatar:()=>avatar,state:()=>lastState,cue:()=>performanceCue,
  runtime:()=>[$('#profile').value,Number($('#threads').value),$('#precision').value],
  stopTake(){window.Cleo?.quiet();avatar?.pause();avatar?.stopFace();},
  startTake(text,plan){
    if(currentTab!=='cleopatra'||!pageVisible||!avatar)return;
    pipelineTab='cleopatra';speechBusy=true;performanceCue=plan.cue_seconds;avatar.stage(plan);buttons();
    window.Cleo?.speakWithFace(text,...settings(),plan.cue_seconds,plan.tail_seconds);
  }
});
let mainFrame='face';
const mainAgent=createAvatarAgent(modelChat,{
  avatar:()=>avatar,state:()=>lastState,cue:()=>performanceCue,frame:()=>mainFrame,
  runtime:()=>[$('#profile').value,Number($('#threads').value),$('#precision').value],
  stopTake(){window.Cleo?.quiet();avatar?.pause();avatar?.stopFace();},
  startStream(id,text,plan){
    if(currentTab!=='main'||!pageVisible||!avatar)throw new Error('Main is hidden');
    pipelineTab='main';speechBusy=true;performanceCue=mainFrame==='face'?0:plan.cue_seconds;
    avatar.stage({...plan,frame:mainFrame});buttons();
    if(!window.Cleo?.beginSpeech?.(id,text,...settings(),performanceCue,mainFrame==='face'?0:plan.tail_seconds)){
      speechBusy=false;buttons();throw new Error('Speech could not start; wait for the previous take to finish.');
    }
  },
  appendStream(id,text,finished){window.Cleo?.appendSpeech?.(id,text,finished);},
  startTake(text,plan){
    if(currentTab!=='main'||!pageVisible||!avatar)return;
    pipelineTab='main';speechBusy=true;performanceCue=mainFrame==='face'?0:plan.cue_seconds;
    avatar.stage({...plan,frame:mainFrame});buttons();
    window.Cleo?.speakWithFace(text,...settings(),performanceCue,mainFrame==='face'?0:plan.tail_seconds);
  }
},'main');
async function launchMain(){await selectTab('main');if(currentTab==='main')mainAgent.load();}
function frameMain(value){
  mainFrame=value;window.Cleo?.mainFrame?.(value);avatar?.setFrame(value);
  document.querySelectorAll('[data-frame]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.frame===value));
}
const menu=$('#app-menu'),modelSettings=$('#model-settings'),modelParent=modelSettings.parentElement;
for(const id of ['send-on-enter','stream-speech']){
  const control=$('#'+id);try{control.checked=localStorage.getItem('cleo-'+id)!=='false';}catch{}
  control.addEventListener('change',()=>{try{localStorage.setItem('cleo-'+id,String(control.checked));}catch{}$('#main-text').enterKeyHint=$('#send-on-enter').checked?'send':'enter';});
}
$('#main-text').enterKeyHint=$('#send-on-enter').checked?'send':'enter';
$('#main-text').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&$('#send-on-enter').checked){event.preventDefault();if(!$('#main-send').disabled)$('#main-form').requestSubmit();}};
function closeSettings(){modelParent.prepend(modelSettings);menu.close();window.Cleo?.settingsVisible?.(false);avatar?.fitViewport();}
$('#app-settings').onclick=()=>{window.Cleo?.settingsVisible?.(true);$('#settings-model-slot').append(modelSettings);modelSettings.open=true;menu.showModal();window.Cleo?.residencyStatus?.();};
$('#settings-apply').onclick=()=>{closeSettings();launchMain().catch(fail);};
$('#settings-close').onclick=closeSettings;menu.addEventListener('cancel',event=>{event.preventDefault();closeSettings();});
$('#open-prompts').onclick=()=>{closeSettings();promptTree.open();};
$('#chat-prompts').onclick=()=>promptTree.open();
$('#open-debug').onclick=()=>{closeSettings();selectTab('welcome').catch(fail);};
for(const button of document.querySelectorAll('[data-settings-tab]'))button.onclick=()=>{closeSettings();selectTab(button.dataset.settingsTab).catch(fail);};
$('#debug-module').onchange=event=>selectTab(event.target.value).catch(fail);
$('#debug-home').onclick=()=>selectTab('welcome').catch(fail);
$('#app-home').onclick=()=>selectTab('launch').catch(fail);
$('#app-main').onclick=()=>launchMain().catch(fail);$('#launch').onclick=()=>launchMain().catch(fail);
for(const button of document.querySelectorAll('[data-frame]'))button.onclick=()=>frameMain(button.dataset.frame);
$('#resident-enabled').onchange=event=>window.Cleo?.residency?.(event.target.checked);
for(const kind of ['notifications','battery','app'])$(`#resident-${kind}`).onclick=()=>window.Cleo?.residentPermissions?.(kind);
function residency(event){
  $('#resident-enabled').checked=event.enabled;
  $('#resident-status').textContent=`${event.enabled?'Retain loaded sessions':'Release under pressure'} · notifications ${event.notifications?'allowed':'off'} · battery exemption ${event.batteryExempt?'allowed':'off'}${event.backgroundRestricted?' · background restricted':''}`;
}
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
  if(tab==='full')$('#full-body').textContent=`${$('#profile').value} · ${$('#bank').selectedOptions[0]?.textContent||'Choose a cached embedding in tab 5'}`;
}
window.validationState={ready:false,errors:[],tab:currentTab};
function fail(error){const message=String(error?.stack||error);window.validationState.errors.push(message);pocketStatus.textContent=message;if(['talk','full'].includes(currentTab))$(`#${currentTab}-status`).textContent=message;console.error(message);}
window.addEventListener('error',event=>fail(event.error||event.message));
window.addEventListener('unhandledrejection',event=>fail(event.reason));

async function selectTab(tab){
  if(!panels[tab])return;
  debugWorkspace.remember();
  if(tab!==currentTab){stopRepeat();window.Cleo?.quiet();avatar?.pause();avatar?.stopFace();}
  currentTab=tab;window.validationState.tab=tab;window.Cleo?.tab(tab);
  const debug=!['launch','main'].includes(tab);document.body.classList.toggle('debug',debug);$('#debug-nav').hidden=!debug;$('#app-main').hidden=!debug;$('#main-frames').hidden=tab!=='main';
  const model=modelChat.settings();$('#launch-model').textContent=`Gemma ${model.model==='gemma-e4b'?'E4B':'E2B'} · Anna · Cleopatra`;
  document.querySelectorAll('[data-tab]').forEach(button=>{
    const active=button.dataset.tab===tab;button.setAttribute('aria-selected',active);button.tabIndex=active?0:-1;
  });
  for(const [key,panel] of Object.entries(panels))$(panel).hidden=key!==tab;
  $('canvas').hidden=!usesAvatar(tab);$('#avatar-view-controls').hidden=!usesAvatar(tab)||tab==='main';
  $('#subtitle').textContent={launch:'',main:'',welcome:'Local module lab',pocket:'Anna · isolated speech runtime',face:'LAM · last Anna clip',talk:'Anna + LAM · speech to face',avatar:'Ardy · motion and embeddings',full:'Anna + LAM + Ardy',chat:'Gemma · local multimodal chat',browser:'Gemma · browser actions',cleopatra:'Gemma + live Ardy + Anna + LAM'}[tab];
  debugWorkspace.select(tab);modelChat.select(tab);browserUI.select(tab);avatarAgent.select(tab);mainAgent.select(tab);
  buttons();avatar?.setVisible(false);
  if(usesAvatar(tab)){
    avatarLoading??=import('./avatar-view.mjs').then(module=>module.createAvatarView());
    avatar=await avatarLoading;
    if(lastState)avatar.event(lastState);
    if(['face','talk','full','cleopatra','main'].includes(currentTab))avatar.setMode('rest');
    if(currentTab==='main')frameMain(mainFrame);else avatar.setFrame('debug');
    avatar.setVisible(pageVisible&&usesAvatar(currentTab));
    if(['talk','full'].includes(currentTab))describeSettings(currentTab);
    buttons();avatarAgent.refresh();mainAgent.refresh();
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
window.cleoVisible=value=>{pageVisible=Boolean(value)&&!document.hidden;if(!pageVisible){stopRepeat();avatarAgent.hidden();mainAgent.hidden();}avatar?.setVisible(pageVisible&&usesAvatar(currentTab));};
document.addEventListener('visibilitychange',()=>window.cleoVisible(!document.hidden));
const ms=value=>value>=0?`${Math.round(value)} ms`:'—';
const eventTab=event=>event.tab||((event.withFace||event.type==='face')?'face':'pocket');
window.cleoEvent=event=>{
  if(event.type==='chat'){modelChat.event(event);browserUI.modelEvent(event);avatarAgent.event(event);mainAgent.event(event);return;}
  if(event.type==='residency'){residency(event);return;}
  if(event.type==='browser'){browserUI.event(event);return;}
  const tab=eventTab(event),status=tab==='pocket'?pocketStatus:tab==='face'?faceStatus:$(`#${tab}-status`);
  if(event.type==='state'){
    lastState=event;
    if(!speechBusy){pocketStatus.textContent=event.pocketStage?`Ready · last stage: ${event.pocketStage}`:'Ready for your speech test';faceStatus.textContent=event.pocketClip?'Anna clip ready for facial animation.':'Generate an Anna clip in tab 2 first.';}
    buttons();window.Cleo?.tab(currentTab);
  }
  if(event.type==='speechStart'){
    speechBusy=true;status.textContent=event.message;buttons();
    if(['talk','full','cleopatra','main'].includes(tab))pipelineTab=tab;
    if(['full','cleopatra','main'].includes(tab))performanceCue=event.cueSeconds;
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
    if(['full','cleopatra','main'].includes(tab))avatar?.pause();buttons();
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
  avatarAgent.event(event);mainAgent.event(event);
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
    if(tab==='full'&&!$('#bank').value){$('#full-status').textContent='Select a cached embedding in tab 5 first.';return;}
    $(`#${tab}-text`).blur();pipelineTab=tab;speechBusy=true;buttons();describeSettings(tab);
    $(`#${tab}-status`).textContent='Starting…';$(`#${tab}-latency`).textContent='Send → playback: measuring…';
    window.Cleo.speakWithFace(text,...settings(),tab==='full'?Number($('#full-cue').value):0,tab==='full'?Number($('#full-tail').value):0);
  };
  $(`#${tab}-stop`).onclick=()=>{stopRepeat();window.Cleo?.quiet();avatar?.pause();avatar?.stopFace();$(`#${tab}-status`).textContent='Stopping…';};
}
window.debugTabs={select:selectTab,current:()=>currentTab};
selectTab('launch').catch(fail);window.Cleo?.state();
