// Debug shell: Pocket is usable before any avatar module, geometry, or WebGL context loads.
let currentTab='pocket',pageVisible=!document.hidden,avatar,avatarLoading,lastState,speechBusy=false;
const pocketStatus=document.querySelector('#pocket-status');
const speak=document.querySelector('#speak');
const faceStatus=document.querySelector('#face-status'),animateFace=document.querySelector('#animate-face');
const runtimeControls=[...document.querySelectorAll('#pocket-settings select')];
try {
  const saved=JSON.parse(localStorage.getItem('cleo-pocket-settings')||'{}');
  for(const control of runtimeControls)if([...control.options].some(option=>option.value===saved[control.id]))control.value=saved[control.id];
} catch { /* Keep valid defaults if Android reclaimed or invalidated stored settings. */ }
for(const control of runtimeControls)control.addEventListener('change',()=>{
  try{localStorage.setItem('cleo-pocket-settings',JSON.stringify(Object.fromEntries(runtimeControls.map(item=>[item.id,item.value]))));}catch{}
});
function faceButton(){animateFace.disabled=speechBusy||!avatar||!lastState?.pocketClip||currentTab!=='face';}
window.validationState={ready:false,errors:[],tab:currentTab};
function fail(error){const message=String(error?.stack||error);window.validationState.errors.push(message);pocketStatus.textContent=message;console.error(message);}
window.addEventListener('error',event=>fail(event.error||event.message));
window.addEventListener('unhandledrejection',event=>fail(event.reason));

async function selectTab(tab){
  if(!['avatar','pocket','face'].includes(tab))return;
  if(tab!==currentTab){window.Cleo?.quiet();avatar?.pause();}
  currentTab=tab;window.validationState.tab=tab;window.Cleo?.tab(tab);
  document.querySelectorAll('[data-tab]').forEach(button=>{
    const active=button.dataset.tab===tab;button.setAttribute('aria-selected',active);button.tabIndex=active?0:-1;
  });
  document.querySelector('#panel').hidden=tab!=='avatar';
  document.querySelector('#pocket-panel').hidden=tab!=='pocket';
  document.querySelector('#face-panel').hidden=tab!=='face';
  document.querySelector('canvas').hidden=tab==='pocket';
  document.querySelector('#subtitle').textContent=tab==='pocket'?'Anna · isolated speech runtime':tab==='avatar'?'Drag to orbit · pinch to zoom':'LAM · last Anna clip';
  faceButton();
  avatar?.setVisible(false);
  if(tab!=='pocket'){
    avatarLoading??=import('./avatar-view.mjs').then(module=>module.createAvatarView());
    avatar=await avatarLoading;
    if(lastState)avatar.event(lastState);
    if(currentTab==='face')avatar.setMode('rest');
    avatar.setFaceView(currentTab==='face');
    avatar.setVisible(pageVisible&&currentTab!=='pocket');
    faceButton();
  }
}
document.querySelectorAll('[data-tab]').forEach(button=>{
  button.onclick=()=>selectTab(button.dataset.tab).catch(fail);
  button.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...document.querySelectorAll('[data-tab]')],index=tabs.indexOf(button);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
    event.preventDefault();tabs[next].focus();tabs[next].click();
  };
});
window.cleoVisible=value=>{pageVisible=Boolean(value)&&!document.hidden;avatar?.setVisible(pageVisible&&currentTab!=='pocket');};
document.addEventListener('visibilitychange',()=>window.cleoVisible(!document.hidden));
const ms=value=>value>=0?`${Math.round(value)} ms`:'—';
window.cleoEvent=event=>{
  if(event.type==='state'){
    lastState=event;
    if(!speechBusy){speak.disabled=false;pocketStatus.textContent=event.pocketStage?`Ready · last stage: ${event.pocketStage}`:'Ready for your speech test';}
    if(!speechBusy)faceStatus.textContent=event.pocketClip?'Anna clip ready for facial animation.':'Generate an Anna clip in tab 2 first.';
    faceButton();
    window.Cleo?.tab(currentTab);
  }
  if(event.type==='speechStart'){
    speechBusy=true;speak.disabled=true;(event.withFace?faceStatus:pocketStatus).textContent=event.message;faceButton();
    document.querySelectorAll('#pocket-settings select').forEach(control=>control.disabled=true);
  }
  if(['pocketStage','speechBusy','speechEnd'].includes(event.type))(event.withFace?faceStatus:pocketStatus).textContent=event.message;
  if(event.type==='faceStage')faceStatus.textContent=event.message;
  if(event.type==='faceMetrics')document.querySelector('#face-metrics').textContent=`${event.cached?'Cached face':event.warm?'Warm LAM':'Cold LAM'} · ${event.frames} frames · ${ms(event.prepareMs)} preparation · ${ms(event.playbackStartMs)} to playback · ${event.audioSeconds.toFixed(2)} s audio · ${event.underruns} underruns`;
  if(event.type==='speechEnd'){
    speechBusy=false;speak.disabled=false;document.querySelectorAll('#pocket-settings select').forEach(control=>control.disabled=false);
    if(!event.withFace){lastState={...lastState,pocketClip:Boolean(lastState?.pocketClip)||event.message==='Anna ready'};}
    faceButton();
  }
  if(event.type==='pocketMetrics'){
    document.querySelector('#first-audio').textContent=ms(event.firstChunkMs);
    document.querySelector('#model-load').textContent=ms(event.loadMs)+(event.warm?' · warm':' · cold');
    document.querySelector('#synthesis-speed').textContent=event.computeRtf>=0?`${event.computeRtf.toFixed(2)} RTF`:'—';
    document.querySelector('#audio-duration').textContent=`${event.audioSeconds.toFixed(2)} s${event.cancelled?' · stopped':''}`;
    document.querySelector('#playback-start').textContent=ms(event.playbackStartMs);
    document.querySelector('#underruns').textContent=event.underruns??'—';
    window.validationState.pocketMetrics=event;
  }
  if(!['pocketStage','pocketMetrics','speechStart','speechEnd','speechBusy'].includes(event.type)||event.withFace)avatar?.event(event);
  if(event.type==='face'&&event.prepared&&currentTab==='face'&&avatar)window.Cleo?.faceReady(event.runId);
};
speak.onclick=()=>{
  const text=document.querySelector('#speech-text').value.trim();
  if(!text){pocketStatus.textContent='Enter something for Anna to say.';return;}
  if(!window.Cleo){pocketStatus.textContent='Speech runs in the Android app.';return;}
  pocketStatus.textContent='Starting PocketTTS…';
  window.Cleo.speak(text,Number(document.querySelector('#threads').value),Number(document.querySelector('#steps').value),Number(document.querySelector('#chunk-size').value),document.querySelector('#precision').value,document.querySelector('#playback-mode').value==='buffered');
};
document.querySelector('#quiet').onclick=()=>{window.Cleo?.quiet();pocketStatus.textContent='Stopping at the next audio callback…';};
animateFace.onclick=()=>{if(!animateFace.disabled){faceStatus.textContent='Preparing LAM…';window.Cleo?.animateLastClip();}};
document.querySelector('#stop-face').onclick=()=>{window.Cleo?.quiet();};
window.debugTabs={select:selectTab,current:()=>currentTab};
selectTab('pocket').catch(fail);window.Cleo?.state();
