const $=selector=>document.querySelector(selector);

// The native bridge reads/writes app-private prompt files without loading models.
export function createPromptTree(){
  const dialog=$('#prompt-dialog'),tree=$('#prompt-tree'),editor=$('#prompt-text'),status=$('#prompt-status');
  let snapshot,selected,dirty=false;
  const request=value=>{
    if(!window.Cleo?.promptTree)throw new Error('Prompt storage is available in the Android app.');
    const result=JSON.parse(window.Cleo.promptTree(JSON.stringify(value)));
    if(!result.ok)throw new Error(result.error||'Prompt operation failed');return result.tree;
  };
  const node=()=>snapshot?.nodes.find(n=>n.id===selected);
  function sizeEditor(){editor.style.height='auto';editor.style.height=`${Math.max(200,editor.scrollHeight)}px`;}
  function catalog(){if(dirty){status.textContent='Save or discard this edit before browsing prompts.';return;}$('#prompt-catalog').hidden=false;$('#prompt-editor').hidden=true;dialog.scrollTop=0;}
  function modified(){sizeEditor();dirty=editor.value!==(node()?.text??'');$('#prompt-save').disabled=!dirty;$('#prompt-discard').disabled=!dirty;$('#prompt-count').textContent=`${editor.value.length.toLocaleString()} / 16,384 characters${dirty?' · unsaved':''}`;}
  function select(id,reveal=true){
    if(dirty){status.textContent='Save or discard this edit before selecting another prompt.';return;}
    selected=id;const value=node();editor.value=value.text;$('#prompt-name').textContent=value.title;$('#prompt-id').textContent=value.id;
    $('#prompt-trigger').textContent=value.trigger;$('#prompt-variables').textContent=value.variables.length?`Keep these variables: ${value.variables.map(v=>`{{${v}}}`).join(', ')}`:'No template variables.';
    $('#prompt-reset').disabled=!value.modified;if(reveal){$('#prompt-editor').hidden=false;$('#prompt-catalog').hidden=true;dialog.scrollTop=0;}modified();
    for(const button of tree.querySelectorAll('button'))button.setAttribute('aria-current',String(button.dataset.id===id));
  }
  function render(next){
    snapshot=next;tree.replaceChildren();const groups=new Map();
    for(const value of snapshot.nodes){
      let list=groups.get(value.group);if(!list){const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=value.group;group.open=!value.group.includes('tool descriptions');list=document.createElement('div');group.append(summary,list);tree.append(group);groups.set(value.group,list);}
      const button=document.createElement('button');button.type='button';button.dataset.id=value.id;button.textContent=value.title+(value.modified?' · edited':'');button.onclick=()=>select(value.id);list.append(button);
    }
    $('#prompt-cache').textContent=snapshot.cacheStatus;$('#prompt-apply').textContent=snapshot.applyNote;$('#prompt-contract').textContent=snapshot.contractNote;
    $('#prompt-revision').textContent=`Saved revision ${snapshot.revision.slice(0,12)}`;
    dirty=false;select(snapshot.nodes.some(n=>n.id===selected)?selected:'browser.system',!$('#prompt-editor').hidden);
  }
  function load(){try{render(request({action:'load'}));status.textContent='Loaded saved prompts.';}catch(error){status.textContent=error.message;}}
  function save(action){try{const next=request({action,id:selected,revision:snapshot.revision,...(action==='save'?{text:editor.value}:{})});render(next);status.textContent=action==='reset'?'Default restored and saved.':'Saved. Applies on the next request.';}catch(error){status.textContent=error.message;}}
  editor.addEventListener('input',modified);
  $('#prompt-browse').onclick=catalog;
  $('#prompt-save').onclick=()=>save('save');
  $('#prompt-reset').onclick=()=>{if(dirty){status.textContent='Save or discard this edit before resetting.';return;}save('reset');};
  $('#prompt-discard').onclick=()=>{dirty=false;select(selected);status.textContent='Unsaved edit discarded.';};
  $('#prompt-reload').onclick=()=>{if(dirty){status.textContent='Save or discard this edit before reloading.';return;}load();};
  function close(){if(dirty){status.textContent='Save or discard this edit before closing.';return;}dialog.close();window.Cleo?.settingsVisible?.(false);}
  $('#prompt-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#prompt-search').oninput=event=>{const query=event.target.value.toLowerCase();for(const button of tree.querySelectorAll('button')){const value=snapshot.nodes.find(n=>n.id===button.dataset.id);button.hidden=![value.id,value.title,value.trigger,value.text].join(' ').toLowerCase().includes(query);}for(const group of tree.querySelectorAll('details')){group.hidden=![...group.querySelectorAll('button')].some(b=>!b.hidden);if(query&&!group.hidden)group.open=true;}};
  return {open(){window.Cleo?.settingsVisible?.(true);dialog.showModal();if(!dirty){catalog();load();}}};
}
