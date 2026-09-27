import {streamMessage} from './stream-message.mjs';
const $=selector=>document.querySelector(selector);
export function createModelChat(){
  let loaded=false,busy=false,recording=false,attachment=null,selection=null,pending=null,lastError='',metrics={},historyKey='';
  const ids=['chat-model','chat-backend','chat-reasoning','reasoning-budget','image-budget','chat-context','chat-disk-cache','chat-llama-memory'];
  try{const saved=JSON.parse(localStorage.getItem('cleo-model-settings')||'{}');
    if(saved['chat-backend']==='cpu')saved['chat-backend']='litert-cpu';
    if(saved['chat-backend']==='opencl')saved['chat-backend']='litert-gpu';
    for(const id of ids){const e=$(`#${id}`);if(id in saved){if(e.type==='checkbox')e.checked=Boolean(saved[id]);else if([...e.options].some(o=>o.value===String(saved[id])))e.value=saved[id];}}
  }catch{}
  // One-time migration from the previous default-on release; later user choices persist.
  try{if(!localStorage.getItem('cleo-reasoning-off-default-v1')){$('#chat-reasoning').checked=false;save();localStorage.setItem('cleo-reasoning-off-default-v1','1');}}catch{}
  function settings(){return {model:$('#chat-model').value,contextTokens:Number($('#chat-context').value),visualTokens:Number($('#image-budget').value),backend:$('#chat-backend').value,reasoning:$('#chat-reasoning').checked?Number($('#reasoning-budget').value):0,diskCache:$('#chat-disk-cache').checked,llamaMemory:$('#chat-llama-memory').value};}
  function dirty(){const value=settings();return !selection||Object.keys(value).some(k=>value[k]!==selection[k]);}
  function request(value){if(!window.Cleo?.chat){$('#chat-status').textContent='Models run in the Android app.';return null;}const requestId=value.requestId||crypto.randomUUID();window.Cleo.chat(JSON.stringify({...value,requestId}));return requestId;}
  function save(){try{localStorage.setItem('cleo-model-settings',JSON.stringify(Object.fromEntries(ids.map(id=>[id,$(`#${id}`).type==='checkbox'?$(`#${id}`).checked:$(`#${id}`).value]))));}catch{}}
  function controls(){
    for(const id of ids)$(`#${id}`).disabled=busy||recording;
    $('#reasoning-budget').disabled=busy||!$('#chat-reasoning').checked;
    $('#chat-load').disabled=busy||recording;$('#chat-load').textContent=loaded&&!dirty()?'Reload Gemma':'Load / apply Gemma';
    $('#chat-send').disabled=!loaded||busy||recording||dirty();$('#chat-new').disabled=busy||!loaded;$('#chat-unload').disabled=!loaded&&!busy;
    $('#chat-record').textContent=recording?'Finish recording':'Record';
    const qat=settings().backend.startsWith('llama-');$('#chat-disk-cache').disabled=busy||recording||!qat;$('#chat-llama-memory').disabled=busy||recording||!qat;$('#llama-memory-note').hidden=!qat;
    const budget=settings().visualTokens,side=48*Math.floor(Math.sqrt(budget));$('#image-token-note').textContent=`Context: ${settings().contextTokens.toLocaleString()} tokens shared by prompt, media, tools and response. Visual budget: ${budget} tokens/image; ${qat?'llama.cpp applies the projector’s image budget; actual dimensions/tokens depend on the image and are reported by the runtime.':`a square image resizes to ${side} × ${side} (${(side/48)**2} actual visual tokens). Other aspect ratios vary.`} Larger contexts use more RAM; the largest sizes may not fit alongside the avatar models. Load/apply reallocates the context and starts fresh conversations.`;
    $('#runtime-note').textContent=qat?`Official Google QAT Q4_0 · ${settings().model==='gemma-e4b'?'5.15 GB weights + 0.99 GB vision/audio':'3.35 GB weights + 0.99 GB vision/audio'} · llama.cpp b11200. ${settings().backend==='llama-hexagon'?'Hexagon NPU is experimental; encoder runs on CPU. Device support must be tested.':settings().backend==='llama-opencl'?'OpenCL requests GPU offload for weights and encoder; CPU remains available for unsupported operations.':'CPU runs the model and vision/audio encoder.'}`:'LiteRT-LM 0.17.1 · E2B 2.59 GB / E4B 3.66 GB. GPU or CPU; vision and audio included. Persistent disk KV is unavailable in this runtime.';
    for(const id of ['chat-cache-prepare','chat-cache-rebuild','chat-cache-clear','chat-cache-scope'])$(`#${id}`).disabled=!loaded||!selection?.backend?.startsWith('llama-')||busy||recording||dirty();
    for(const id of ['chat-image','chat-audio'])$(`#${id}`).disabled=busy||recording;
    $('#chat-record').disabled=busy;$('#chat-attachment').textContent=attachment?attachment.label:'';$('#chat-clear-attachment').hidden=!attachment;
    $('#browser-model').textContent=loaded?`Gemma ${selection.model==='gemma-e4b'?'E4B':'E2B'} · ${selection.backend} · ${(selection.contextTokens??4096)/1024}K context · reasoning ${selection.reasoning?selection.reasoning+' tokens':'off'}${dirty()?' · apply settings in tab 7':''}`:'Load Gemma in tab 7 first.';
    $('#browser-start').disabled=!loaded||busy||recording||dirty();
  }
  function load(){if(busy||recording)return null;save();const id=request({action:'load',...settings()});if(id){busy=true;loaded=false;lastError='';$('#chat-status').textContent='Loading Gemma…';$('#chat-log').replaceChildren();pending=null;historyKey='';metrics={};paintMetrics();controls();}return id;}
  $('#chat-cache-panel').addEventListener('toggle',()=>{if($('#chat-cache-panel').open)$('#model-settings').open=false;});
  $('#model-settings').addEventListener('toggle',()=>{if($('#model-settings').open)$('#chat-cache-panel').open=false;});
  $('#chat-load').onclick=load;$('#chat-text').onfocus=()=>{$('#model-settings').open=false;};
  for(const id of ids)$(`#${id}`).onchange=()=>{save();controls();};
  function message(role,text,reasoning='',media=''){return streamMessage($('#chat-log'),role,(media?`[${media}]\n`:'')+text,reasoning);}
  $('#chat-form').onsubmit=event=>{event.preventDefault();if(!loaded||busy||recording||dirty())return;const text=$('#chat-text').value.trim();if(!text&&!attachment)return;
    const id=request({action:'send',text,...(attachment?{file:attachment.file,kind:attachment.kind}:{})});if(id){lastError='';message('user',text,'',attachment?.kind||'');pending={id,view:message('assistant'),done:false};$('#chat-text').value='';$('#chat-text').blur();attachment=null;busy=true;$('#chat-status').textContent='Preparing response…';controls();}};
  $('#chat-new').onclick=()=>{lastError='';pending=null;historyKey='';if(request({action:'newChat'})){busy=true;controls();}};
  $('#chat-unload').onclick=()=>request({action:'unload'});
  for(const [id,action,rebuild] of [['chat-cache-prepare','cachePrepare',false],['chat-cache-rebuild','cachePrepare',true],['chat-cache-clear','cacheClear',false]])$(`#${id}`).onclick=()=>{if(request({action,scope:$('#chat-cache-scope').value,rebuild})){busy=true;lastError='';controls();}};
  $('#chat-image').onclick=()=>window.Cleo?.chatAttach?.('image');$('#chat-audio').onclick=()=>window.Cleo?.chatAttach?.('audio');
  $('#chat-record').onclick=()=>window.Cleo?.chatRecord?.(!recording);$('#chat-clear-attachment').onclick=()=>{attachment=null;controls();};
  const ms=v=>Number.isFinite(v)&&v>=0?`${Math.round(v)} ms`:'—',memory=v=>Number.isFinite(v)&&v>=0?`${Math.round(v/1024)} MiB`:'—';
  function paintMetrics(){const m=metrics.memory||{};
    const values={load:ms(metrics.loadMs),first:ms(metrics.firstTokenMs),total:ms(metrics.totalMs),cpu:ms(metrics.cpuMs),memory:memory(m.pssKb)+(m.complete===false?' (partial)':''),peak:memory(m.peakPssKb),cache:metrics.prefixCache||'—',prefill:ms(metrics.timings?.prompt_ms),decode:Number.isFinite(metrics.timings?.predicted_per_second)?`${metrics.timings.predicted_per_second.toFixed(1)} tok/s`:'—'};
    for(const [key,value] of Object.entries(values))document.querySelectorAll(`[data-model-metric="${key}"]`).forEach(e=>e.textContent=value);
  }
  function event(value){
    const disk=value.diskCache||value.result?.diskCache;
    if(disk)$('#chat-cache-status').textContent=disk.supported?[disk.operation||'Disk cache ready',`${disk.files||0} prefixes · ${Math.round((disk.bytes||0)/1048576)} MiB`,disk.savedTokens!=null?`${disk.savedTokens} tokens saved`:null,disk.restoredTokens!=null?`${disk.restoredTokens} tokens restored`:null,disk.prefillMs!=null?`prefill ${ms(disk.prefillMs)}`:null,disk.saveMs!=null?`save ${ms(disk.saveMs)}`:null,disk.restoreMs!=null?`restore ${ms(disk.restoreMs)}`:null,disk.backendEvidence,disk.warning].filter(Boolean).join(' · '):disk.operation||'LiteRT keeps KV in RAM only.';
    if(!value.inputScope||value.inputScope==='chat'){if(value.attachment)attachment=value.attachment;if(value.inputError)$('#chat-status').textContent=value.inputError;}
    if('recording' in value)recording=value.recording;
    if(value.memory){metrics.memory=value.memory;paintMetrics();}
    if(value.result){metrics={...metrics,...value.result};paintMetrics();}
    if(value.state){busy=value.busy;loaded=value.loaded;if(loaded)selection=value.selection;metrics={...metrics,...value.metrics};paintMetrics();
      if(!busy){const key=JSON.stringify(value.history||[]);if(!pending&&key!==historyKey){$('#chat-log').replaceChildren();for(const item of value.history||[])message(item.role,item.text,item.reasoning,item.attachment);}if(!pending||pending.done){pending=null;historyKey=key;}
        $('#chat-status').textContent=lastError||(loaded?`Ready · ${(selection.contextTokens??4096).toLocaleString()}-token context · ${value.turns||0} turns · conversation retained`:'Load Gemma to begin.');}}
    if(value.channel==='chat'){
      if(value.phase){lastError='';$('#chat-status').textContent=value.phase;}
      if(pending?.id===value.requestId){if(value.partial!==undefined)pending.view.update(value.partial,value.reasoning);if(value.result){pending.view.update(value.result.text,value.result.reasoning);pending.done=true;}if(value.error)pending.done=true;}
      if(value.error){lastError=value.error;$('#chat-status').textContent=value.error;busy=false;}
    }
    if(value.disconnected){loaded=false;busy=false;lastError=value.error;$('#chat-status').textContent=value.error;}
    if(value.unloaded){lastError='';loaded=false;busy=false;selection=null;pending=null;$('#chat-status').textContent='Gemma unloaded';}
    controls();
  }
  controls();return {event,settings,load,request,select(tab){if(['chat','browser','cleopatra','main'].includes(tab))request({action:'status'});},ready:()=>loaded&&!busy&&!recording&&!dirty(),status:()=>({loaded,busy,recording,dirty:dirty(),selection})};
}
