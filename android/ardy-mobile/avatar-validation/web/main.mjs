// Debug shell: Pocket is usable before any avatar module, geometry, or WebGL context loads.
let currentTab='pocket',pageVisible=!document.hidden,avatar,avatarLoading,lastState,speechBusy=false;
const pocketStatus=document.querySelector('#pocket-status');
const speak=document.querySelector('#speak');
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
  document.querySelector('#subtitle').textContent=tab==='pocket'?'Anna · isolated speech runtime':tab==='avatar'?'Drag to orbit · pinch to zoom':'LAM · next integration step';
  avatar?.setVisible(false);
  if(tab!=='pocket'){
    avatarLoading??=import('./avatar-view.mjs').then(module=>module.createAvatarView());
    avatar=await avatarLoading;
    if(lastState)avatar.event(lastState);
    if(currentTab==='face')avatar.setMode('rest');
    avatar.setVisible(pageVisible&&currentTab!=='pocket');
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
    window.Cleo?.tab(currentTab);
  }
  if(event.type==='speechStart'){
    speechBusy=true;speak.disabled=true;pocketStatus.textContent=event.message;
    document.querySelectorAll('#pocket-settings select').forEach(control=>control.disabled=true);
  }
  if(['pocketStage','speechBusy','speechEnd'].includes(event.type))pocketStatus.textContent=event.message;
  if(event.type==='speechEnd'){
    speechBusy=false;speak.disabled=false;document.querySelectorAll('#pocket-settings select').forEach(control=>control.disabled=false);
  }
  if(event.type==='pocketMetrics'){
    document.querySelector('#first-audio').textContent=ms(event.firstChunkMs);
    document.querySelector('#model-load').textContent=ms(event.loadMs)+(event.warm?' · warm':' · cold');
    document.querySelector('#synthesis-speed').textContent=event.computeRtf>=0?`${event.computeRtf.toFixed(2)} RTF`:'—';
    document.querySelector('#audio-duration').textContent=`${event.audioSeconds.toFixed(2)} s${event.cancelled?' · stopped':''}`;
    window.validationState.pocketMetrics=event;
  }
  if(!['pocketStage','pocketMetrics','speechStart','speechEnd','speechBusy'].includes(event.type)||event.withFace)avatar?.event(event);
};
speak.onclick=()=>{
  const text=document.querySelector('#speech-text').value.trim();
  if(!text){pocketStatus.textContent='Enter something for Anna to say.';return;}
  if(!window.Cleo){pocketStatus.textContent='Speech runs in the Android app.';return;}
  pocketStatus.textContent='Starting PocketTTS…';
  window.Cleo.speak(text,Number(document.querySelector('#threads').value),Number(document.querySelector('#steps').value),Number(document.querySelector('#chunk-size').value));
};
document.querySelector('#quiet').onclick=()=>{window.Cleo?.quiet();pocketStatus.textContent='Stopping at the next audio callback…';};
window.debugTabs={select:selectTab,current:()=>currentTab};
selectTab('pocket').catch(fail);window.Cleo?.state();
