const $=selector=>document.querySelector(selector);

/** Each module has one vertical scroll owner; subviews share that owner. */
export function createDebugWorkspace(){
  const modules=new Map(),positions=new Map();let current='launch';
  function segment(id,groups){
    const panel=$(id);panel.dataset.scrollOwner='';panel.classList.add('module-panel');
    const tabs=document.createElement('div');tabs.className='module-segments';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Module sections');
    const original=[...panel.children],used=new Set(),views=[];
    for(const [key,label,selectors] of groups){
      const pane=document.createElement('section');pane.id=`${panel.id}-${key}`;pane.dataset.modulePane=key;pane.setAttribute('role','tabpanel');
      const nodes=selectors===null?original.filter(n=>!used.has(n)):selectors.flatMap(selector=>[...panel.querySelectorAll(selector)]);
      for(const node of nodes){used.add(node);pane.append(node);if(node.tagName==='DETAILS')node.open=true;}
      const button=document.createElement('button');button.type='button';button.id=pane.id+'-tab';button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-controls',pane.id);pane.setAttribute('aria-labelledby',button.id);
      button.onclick=()=>select(key);tabs.append(button);views.push({key,pane,button});
    }
    // The first group is the everyday workspace. Explicitly grouped settings and
    // diagnostics are removed first, then any remaining nodes join that workspace.
    for(const node of original)if(!used.has(node))views[0].pane.append(node);
    panel.replaceChildren(tabs,...views.map(v=>v.pane));let active=groups[0][0];
    function select(key){
      if(!views.some(v=>v.key===key))return;
      positions.set(panel.id+':'+active,panel.scrollTop);active=key;
      for(const view of views){view.pane.hidden=view.key!==key;view.button.setAttribute('aria-selected',String(view.key===key));view.button.tabIndex=view.key===key?0:-1;}
      panel.scrollTop=positions.get(panel.id+':'+key)||0;
      try{sessionStorage.setItem(panel.id+'-section',key);}catch{}
    }
    tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let index=views.findIndex(v=>v.key===active);index=event.key==='Home'?0:event.key==='End'?views.length-1:(index+(event.key==='ArrowRight'?1:views.length-1))%views.length;select(views[index].key);views[index].button.focus();};
    let saved;try{saved=sessionStorage.getItem(panel.id+'-section');}catch{}select(views.some(v=>v.key===saved)?saved:active);
    modules.set(panel.id,{select,panel});
  }
  segment('#pocket-panel', [['run','Speak',[]],['settings','Settings',['#pocket-settings']],['metrics','Diagnostics',['.metrics','.metrics + p']]]);
  segment('#panel',[['run','Motion',['#motion-controls']],['appearance','Appearance',['#vrm-settings']],['inspect','Inspect',['#controls',':scope > .hint']]]);
  segment('#chat-panel',[['run','Chat',[]],['settings','Model',['#model-settings']],['cache','Prompts & cache',['#chat-cache-panel']],['metrics','Resources',['.resource-strip']]]);
  // Move setup controls out of the conversation. Keep Load/New/Unload reachable
  // in every model subview, rather than burying them inside a settings scroller.
  const actions=$('#chat-load').parentElement;actions.classList.add('module-actions');$('#chat-panel').insertBefore(actions,$('#chat-panel').children[1]);
  actions.after($('#chat-status'));
  for(const id of ['#face-panel','#talk-panel','#full-panel','#cleopatra-panel']){
    segment(id,[['run','Run',[]],['settings',id==='#face-panel'?'Face controls':'Settings & timing',[':scope > details']]]);
  }
  $('#welcome-panel').dataset.scrollOwner='';$('#welcome-panel').classList.add('module-panel');
  return {remember(){
    const previous=$(`[data-module="${current}"]`);if(previous)positions.set('module:'+current,previous.scrollTop);
  },select(tab){
    current=tab;const next=$(`[data-module="${tab}"]`);if(next)next.scrollTop=positions.get('module:'+tab)||0;
    const picker=$('#debug-module');if([...picker.options].some(o=>o.value===tab))picker.value=tab;
  },section(panel,key){modules.get(panel)?.select(key);},settingsParent:()=>$('#chat-panel-settings')};
}
