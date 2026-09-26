const $=selector=>document.querySelector(selector);
export function createModelChat(){
  let loaded=false,busy=false,recording=false,attachment=null,selection=null,pendingAnswer=null,lastError='',metrics={};
  const ids=['chat-model','chat-backend','chat-whisper','image-min-tokens','image-max-tokens','image-batch-tokens','chat-reasoning','reasoning-budget'];
  try{const saved=JSON.parse(localStorage.getItem('cleo-model-settings')||'{}');for(const id of ids){const e=$(`#${id}`);if(id in saved){if(e.type==='checkbox')e.checked=Boolean(saved[id]);else if(e.tagName!=='SELECT'||[...e.options].some(o=>o.value===String(saved[id])))e.value=saved[id];}}}catch{}
  function settings(){return {model:$('#chat-model').value,backend:$('#chat-backend').value,whisper:$('#chat-whisper').value,imageMinTokens:Number($('#image-min-tokens').value),imageTokens:Number($('#image-max-tokens').value),imageBatchTokens:Number($('#image-batch-tokens').value),reasoning:$('#chat-reasoning').checked?Number($('#reasoning-budget').value):0};}
  function dirty(){const value=settings();return !selection||Object.keys(value).some(k=>value[k]!==selection[k]);}
  function request(value){if(!window.Cleo?.chat){$('#chat-status').textContent='Models run in the Android app.';return false;}window.Cleo.chat(JSON.stringify(value));return true;}
  function save(){try{localStorage.setItem('cleo-model-settings',JSON.stringify(Object.fromEntries(ids.map(id=>[id,$(`#${id}`).type==='checkbox'?$(`#${id}`).checked:$(`#${id}`).value]))));}catch{}}
  function controls(){
    const qwen=$('#chat-model').value==='qwen',lite=$('#chat-backend').value.startsWith('litert');
    for(const option of $('#chat-backend').options)option.disabled=false;
    $('#chat-whisper').disabled=!qwen||busy;$('#image-min-tokens').disabled=lite||busy;$('#image-max-tokens').disabled=lite||busy;$('#image-batch-tokens').disabled=lite||busy;
    $('#asr-note').hidden=!qwen;
    $('#reasoning-budget').disabled=!$('#chat-reasoning').checked||busy;
    for(const id of ['chat-model','chat-backend','chat-reasoning'])$(`#${id}`).disabled=busy;
    $('#chat-reasoning').disabled=busy;
    $('#image-token-note').textContent=lite?(qwen?'Premade Qwen LiteRT: 512 × 512 images, 256 visual tokens, 4,096-token context. Reasoning and its budget apply on load. Image size is fixed by this model.':'Gemma LiteRT uses the full audio/vision package on CPU and GPU. Image allocation is fixed by that artifact; reasoning remains adjustable.'):'Minimum 0 uses the model default. Maximum bounds each image’s token allocation; screenshots keep their aspect ratio. Encoder batch tokens limits image work per batch. Applies on load.';
    $('#chat-load').disabled=busy||recording;$('#chat-load').textContent=loaded&&!dirty()?'Reload model':`Load ${qwen?'Qwen + Whisper':'Gemma'}`;
    $('#chat-send').disabled=!loaded||busy||recording||dirty();$('#chat-new').disabled=busy||!loaded;$('#chat-unload').disabled=!loaded&&!busy;
    $('#chat-record').textContent=recording?'Finish recording':'Record';
    for(const id of ['chat-image','chat-audio'])$(`#${id}`).disabled=busy||recording;
    $('#chat-record').disabled=busy;$('#chat-attachment').textContent=attachment?attachment.label:'';$('#chat-clear-attachment').hidden=!attachment;
    $('#browser-model').textContent=loaded?`${selection.model==='qwen'?'Qwen + Whisper':'Gemma'} · ${selection.backend} · reasoning ${selection.reasoning?selection.reasoning+' tokens':'off'}${dirty()?' · apply settings in tab 7':''}`:'Load a model in tab 7 first.';
    $('#browser-start').disabled=!loaded||busy||dirty();
  }
  function load(){if(busy)return;const s=settings();if(!Number.isFinite(s.imageTokens)||s.imageTokens<70||s.imageTokens>2048||s.imageMinTokens<0||s.imageMinTokens>s.imageTokens||!Number.isInteger(s.imageBatchTokens)||s.imageBatchTokens<32||s.imageBatchTokens>2048){$('#chat-status').textContent='Use a maximum of 70–2048 image tokens and a minimum no larger than the maximum; encoder batch size 32–2048.';return;}
    save();if(request({action:'load',...s})){busy=true;loaded=false;lastError='';$('#chat-status').textContent='Loading selected model…';$('#chat-log').replaceChildren();metrics={};paintMetrics();controls();}}
  $('#chat-load').onclick=load;
  $('#chat-text').onfocus=()=>{$('#model-settings').open=false;};
  for(const id of ids)$(`#${id}`).onchange=()=>{save();controls();if(id==='chat-model')load();};
  function message(role,text,media=''){const article=document.createElement('article');article.className='chat-message '+role;const name=document.createElement('strong');name.textContent=role==='user'?'You':selection?.model==='qwen'?'Qwen':'Gemma';const content=document.createElement('div');content.textContent=(media?`[${media}]\n`:'')+text;article.append(name,content);$('#chat-log').append(article);$('#chat-log').scrollTop=$('#chat-log').scrollHeight;return content;}
  $('#chat-form').onsubmit=event=>{event.preventDefault();if(!loaded||busy||recording||dirty())return;const text=$('#chat-text').value.trim();if(!text&&!attachment)return;
    if(request({action:'send',text,...(attachment?{file:attachment.file,kind:attachment.kind}:{})})){lastError='';message('user',text,attachment?.kind||'');pendingAnswer=message('assistant','…');$('#chat-text').value='';$('#chat-text').blur();attachment=null;busy=true;$('#chat-status').textContent='Preparing response…';controls();}}
  $('#chat-new').onclick=()=>{lastError='';if(request({action:'newChat'})){busy=true;controls();}};
  $('#chat-unload').onclick=()=>request({action:'unload'});
  $('#chat-image').onclick=()=>window.Cleo?.chatAttach?.('image');$('#chat-audio').onclick=()=>window.Cleo?.chatAttach?.('audio');
  $('#chat-record').onclick=()=>window.Cleo?.chatRecord?.(!recording);$('#chat-clear-attachment').onclick=()=>{attachment=null;controls();};
  const ms=v=>Number.isFinite(v)&&v>=0?`${Math.round(v)} ms`:'—';const memory=v=>Number.isFinite(v)&&v>=0?`${Math.round(v/1024)} MiB`:'—';
  function paintMetrics(){
    const m=metrics.memory||{},t=metrics.timings||{},cached=t.cache_n??t.prompt_n_cached??t.prompt_cached_n;
    const detail=metrics.asrDetails||{};
    const values={load:ms(metrics.loadMs),first:ms(metrics.firstTokenMs),total:ms(metrics.totalMs),asr:ms(metrics.asrMs)+(detail.alignmentMs!==undefined?` · VAD ${ms(detail.vadMs)} · align ${ms(detail.alignmentMs)}`:''),cpu:ms(metrics.cpuMs),
      memory:memory(m.pssKb)+(m.complete===false?' (partial)':''),peak:memory(m.peakPssKb),cache:cached!==undefined?`${cached} tokens`:metrics.prefixCache?'Retained · count unavailable':'—',
      decode:Number.isFinite(t.predicted_per_second)?`${t.predicted_per_second.toFixed(1)} tok/s`:'—'};
    for(const [key,value] of Object.entries(values))document.querySelectorAll(`[data-model-metric="${key}"]`).forEach(e=>e.textContent=value);
  }
  function event(value){
    if(value.attachment)attachment=value.attachment;if('recording' in value)recording=value.recording;
    if(value.inputError)$('#chat-status').textContent=value.inputError;
    if(value.memory){metrics.memory=value.memory;paintMetrics();}
    if(value.result){metrics={...metrics,...value.result};paintMetrics();}
    if(value.state){busy=value.busy;loaded=value.loaded;if(loaded)selection=value.selection;metrics={...metrics,...value.metrics};paintMetrics();
      if(!busy){$('#chat-log').replaceChildren();for(const item of value.history||[])message(item.role,item.text,item.attachment);pendingAnswer=null;$('#chat-status').textContent=lastError||(loaded?`Ready · ${value.turns||0} turns · conversation retained`:'Choose a model and load it.');}}
    if(value.channel!=='browser'){
      if(value.phase){lastError='';$('#chat-status').textContent=value.phase;}
      if(value.partial!==undefined&&pendingAnswer){pendingAnswer.textContent=value.partial||'…';$('#chat-log').scrollTop=$('#chat-log').scrollHeight;}
      if(value.transcript)$('#chat-status').textContent=`Whisper: ${value.transcript}`;
    }
    if(value.error){lastError=value.error;$('#chat-status').textContent=value.error;busy=false;if(value.disconnected)loaded=false;}
    if(value.unloaded){lastError='';loaded=false;busy=false;selection=null;$('#chat-status').textContent='Models unloaded';}
    controls();
  }
  controls();return {event,settings,select(tab){if(['chat','browser'].includes(tab))request({action:'status'});},ready:()=>loaded&&!busy&&!dirty()};
}
