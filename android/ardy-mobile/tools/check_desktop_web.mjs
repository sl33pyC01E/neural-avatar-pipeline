// CPU-rendered local browser check. Stubs the native bridge; never connects to adb or a phone.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const [edge,assetsArg,motionFile,outputArg]=process.argv.slice(2);
const assets=path.resolve(assetsArg),output=path.resolve(outputArg);
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'browser-'));
const motion=JSON.parse(await fs.readFile(motionFile,'utf8'));
const promptDefaults=JSON.parse(await fs.readFile(new URL('../avatar-validation/app/build/prompt-tree-check/defaults.json',import.meta.url),'utf8'));
const server=http.createServer(async(req,res)=>{
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
    const file=path.resolve(assets,name);assert(file.startsWith(assets+path.sep));
    const mime=/\.(mjs|js)$/.test(name)?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'application/octet-stream';
    res.setHeader('Content-Type',mime);res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=spawn(edge,['--headless=new','--no-first-run','--disable-extensions','--mute-audio',
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,id=0;const pending=new Map(),logs=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={}){
  return new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(new Error(method+' timeout'));},30000);
    pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params}));});
}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await sleep(100);}}
  assert(port,'Headless browser did not start');
  const tabs=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());const tab=tabs.find(t=>t.type==='page');assert(tab);
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  socket.onmessage=event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(new Error(JSON.stringify(r.error))):p.resolve(r.result);}else if(r.method==='Runtime.exceptionThrown'||r.method==='Log.entryAdded')logs.push(r.params);};
  await call('Runtime.enable');await call('Log.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    const source=${JSON.stringify(motion)};let cursor=0,run=false,paused=false,currentProfile='core40',currentStream='';
    window.bridgeRequests=0;window.testClock=0;window.chatRequests=[];window.browserRequests=[];window.loadOrder=[];window.warmRequests=[];let modelLoaded=false,modelSelection={},chatHistory=[],mainPrepared=false;
    const emit=value=>setTimeout(()=>window.cleoEvent?.(value),10);
    window.Cleo={
      settingsVisible(value){window.settingsOverlay=value;},
      promptTree(raw){const r=JSON.parse(raw);window.promptRequests=(window.promptRequests||[]).concat(r);let tree=JSON.parse(localStorage.getItem('test-prompt-tree')||${JSON.stringify(JSON.stringify(promptDefaults))});
        if(r.action!=='load'){
          if(window.rejectPromptSave)return JSON.stringify({ok:false,error:'Simulated storage failure'});
          if(r.revision!==tree.revision)return JSON.stringify({ok:false,error:'Prompts changed; reload before saving'});
          const node=tree.nodes.find(n=>n.id===r.id);node.text=r.action==='reset'?node.defaultText:r.text;node.modified=node.text!==node.defaultText;tree.revision='test-saved-'+(window.promptRequests.length);localStorage.setItem('test-prompt-tree',JSON.stringify(tree));
        }return JSON.stringify({ok:true,tree});},
      chat(raw){const r=JSON.parse(raw);window.chatRequests.push(r);
        if(r.action==='load'&&window.holdLoad){window.heldLoad=raw;return;}
        if(r.action==='load'||r.action==='mainPrepare')window.loadOrder.push(r.action);
        if(r.action==='load'&&window.failNextLoad){modelLoaded=false;mainPrepared=false;const error=window.failNextLoad;window.failNextLoad=null;emit({type:'chat',disconnected:true,error});return;}
        if(r.action==='load'){modelSelection=Object.fromEntries(Object.entries(r).filter(([k])=>k!=='action'));modelLoaded=true;chatHistory=[];}
        if(r.action==='newChat')chatHistory=[];if(r.action==='load'||r.action==='unload')mainPrepared=false;if(r.action==='mainPrepare'||r.action==='mainNew')mainPrepared=true;
        if(r.action==='unload'){modelLoaded=false;emit({type:'chat',unloaded:true});}
        if(r.action==='avatarSend'||r.action==='mainSend'){emit({type:'chat',channel:r.action==='mainSend'?'main':'avatar',requestId:r.requestId,state:true,loaded:true,busy:true,selection:modelSelection,history:chatHistory});return;}
        if(r.action==='send'&&window.holdSend){emit({type:'chat',state:true,busy:true,loaded:modelLoaded,selection:modelSelection,history:chatHistory});return;}
        if(r.action==='send'){
          const text='<img src=x onerror=alert(1)> Model response';
          chatHistory.push({role:'user',text:r.text,attachment:r.kind||''},{role:'assistant',text,reasoning:'Model reasoning'});
          emit({type:'chat',channel:'chat',requestId:r.requestId,partial:text,reasoning:'Model reasoning'});
          emit({type:'chat',channel:'chat',requestId:r.requestId,result:{text,reasoning:'Model reasoning'}});
        }
        emit({type:'chat',mainPrepared,channel:r.action.startsWith('avatar')?'avatar':r.action.startsWith('main')?'main':'chat',requestId:r.requestId,state:true,loaded:modelLoaded,busy:false,selection:modelSelection,history:chatHistory,turns:chatHistory.length/2,metrics:{firstTokenMs:125,totalMs:500,prefixCache:'Retained',memory:{pssKb:1048576,peakPssKb:1050000,complete:true}}});
      },browserBounds(raw){window.browserBounds=JSON.parse(raw);},browserCommand(raw){window.browserRequests.push(JSON.parse(raw));},inputAttach(kind,scope){window.attachRequest={kind,scope};},inputRecord(start,scope){emit({type:'chat',recording:start,inputScope:scope});},chatAttach(kind){window.attachKind=kind;},chatRecord(start){emit({type:'chat',recording:start});},
      state(){emit({type:'state',pocketClip:true,lastProfile:'core40',bank:[{id:'bank:check',nickname:'Relaxed speaking idle',text:'Small speaking gestures'},{id:'bank:wave',nickname:'Right hand wave',text:'Wave with the right hand'}],llmNative:true,llmModel:true,core8:true,core40:true,memoryBudgetMiB:6144});},
      start(profile,embedding,stream){if(stream!==currentStream)cursor=0;currentProfile=profile;currentStream=stream;window.lastStartedStream=stream;run=true;paused=false;emit({type:'configured'});},stop(){run=false;},pause(){paused=true;},
      startPerformance(profile,embedding,stream){window.performanceStarts=(window.performanceStarts||0)+1;window.performanceEmbedding=embedding;window.Cleo.start(profile,embedding,stream);},
      next(){if(!run||paused)return false;window.bridgeRequests++;const start=cursor,count=currentProfile==='core40'?40:8;if(start+count>source.joints.length)return false;cursor+=count;
        const batch={type:'motion',streamId:currentStream,profile:currentProfile,startFrame:start,frames:count,jointCount:27,fps:20,generationMs:20,joints:source.joints.slice(start,start+count).flat(2),roots:source.rootPositions.slice(start,start+count).flat(),rotations:source.rotations.slice(start,start+count).flat(3)};window.lastBatch=batch;emit(batch);return true;},
      prepareModelLoad(requestId){window.releaseRequest=requestId;window.loadOrder.push('release');if(!window.holdRelease)emit({type:'ensemble',component:'release',requestId,state:'ready',message:'Released'});},
      warmAll(profile,threads,precision,requestId){window.loadOrder.push('warm');window.warmRequest={profile,threads,precision,requestId};window.warmRequests.push(window.warmRequest);for(const component of ['ardy','pocket','lam','all'])emit({type:'ensemble',component,requestId,state:'ready',message:'Resident'});},cancelWarmAll(){},unloadAvatarModels(){emit({type:'ensembleReleased',message:'Unloaded'});},
      mainFrame(value){window.nativeFrame=value;},residencyStatus(){emit({type:"residency",enabled:true,notifications:true,batteryExempt:true});},residency(value){window.residentEnabled=value;},tab(value){window.nativeTab=value;},playbackSeconds(){return window.testClock;},embed(){},
      speak(...args){window.speechArguments=args;emit({type:'speechStart',message:'Pocket only'});setTimeout(()=>{
        emit({type:'pocketMetrics',warm:true,loadMs:1,firstChunkMs:120,computeRtf:.4,audioSeconds:2});emit({type:'speechEnd',message:'Anna ready'});},50);},
      speakWithFace(...args){window.talkArguments=args;window.testClock=-1;emit({type:'speechStart',tab:window.nativeTab,withFace:true,streamId:'pipe-check',bodyMotion:window.nativeTab==='main'?window.nativeFrame!=='face':undefined,cueSeconds:args[6],tailSeconds:args[7],message:'Pipeline check'});},
      beginSpeech(id,...args){window.speechPhrases=[args[0]];window.speechRequest=id;window.speechFinished=false;window.speechBegins=(window.speechBegins||0)+1;this.speakWithFace(...args);return true;},
      appendSpeech(id,text,finished){if(id!==window.speechRequest)return;if(text)window.speechPhrases.push(text);window.speechFinished=finished;},
      inputCamera(scope){window.cameraRequest=scope;},
      animateLastClip(){window.faceRequested=true;},faceReady(run){window.faceReadyRun=run;},quiet(){},memoryBudget(){},importModels(){}};`});
  await call('Page.navigate',{url});
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.debugTabs)'))break;await sleep(100);}
  assert.equal(await evaluate('window.debugTabs.current()'),'launch');
  assert(await evaluate('document.querySelector("#debug-nav").hidden'),'Debug tabs escaped the menu');
  assert(await evaluate('!window.chatRequests.some(r=>r.action==="load")&&!window.warmRequest'),'Startup loaded models before Launch');
  assert.deepEqual(await evaluate('[...document.querySelector("#debug-module").options].map(b=>b.value)'),['welcome','pocket','face','talk','avatar','full','chat','browser','cleopatra']);
  assert(await evaluate('!window.avatarValidation&&!performance.getEntriesByType("resource").some(r=>r.name.endsWith("cleopatra.vrm"))'),'Pocket startup loaded the avatar');
  const welcomeImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'welcome-tab.png'),Buffer.from(welcomeImage.data,'base64'));
  await evaluate('document.querySelector("#app-settings").click();document.querySelector("#open-prompts").click()');
  assert(await evaluate('document.querySelector("#prompt-dialog").open&&window.settingsOverlay'),'Prompt editor did not hide native browser overlay');
  assert.equal(await evaluate('document.querySelectorAll("#prompt-tree button").length'),promptDefaults.nodes.length);
  await evaluate(`document.querySelector('#prompt-tree button[data-id="browser.system"]').click()`);
  assert(await evaluate('document.querySelector("#prompt-trigger").textContent.includes("screenshot")'),'Prompt trigger missing');
  await evaluate('document.querySelector("#prompt-text").value+="\\nReply carefully.";document.querySelector("#prompt-text").dispatchEvent(new Event("input"));document.querySelector("#prompt-close").click()');
  assert(await evaluate('document.querySelector("#prompt-dialog").open'),'Closing discarded unsaved edit');
  await evaluate('window.rejectPromptSave=true;document.querySelector("#prompt-save").click()');
  assert(await evaluate('document.querySelector("#prompt-status").textContent.includes("storage failure")&&!document.querySelector("#prompt-save").disabled'),'Storage failure lost draft');
  await evaluate('window.rejectPromptSave=false;document.querySelector("#prompt-save").click();document.querySelector("#prompt-close").click()');
  assert(await evaluate('!window.settingsOverlay'),'Closing editor did not restore native browser overlay');
  await call('Page.reload');for(let i=0;i<100;i++){if(await evaluate('Boolean(window.debugTabs)'))break;await sleep(100);}
  await evaluate('document.querySelector("#app-settings").click();document.querySelector("#open-prompts").click()');
  assert(await evaluate('document.querySelector("#prompt-text").value.endsWith("Reply carefully.")'),'Saved prompt lost after reload');
  const promptImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'prompt-tree.png'),Buffer.from(promptImage.data,'base64'));
  await evaluate('document.querySelector("#prompt-search").value="main.tools";document.querySelector("#prompt-search").dispatchEvent(new Event("input"))');
  assert(await evaluate('[...document.querySelectorAll("#prompt-tree button")].filter(b=>!b.hidden).every(b=>b.dataset.id.startsWith("main.tools"))'),'Prompt search incorrect');
  await evaluate('document.querySelector("#prompt-search").value="";document.querySelector("#prompt-search").dispatchEvent(new Event("input"));document.querySelector("#prompt-reset").click()');
  assert(await evaluate('!document.querySelector("#prompt-text").value.includes("Reply carefully.")'),'Prompt reset failed');
  await evaluate('document.querySelector("#prompt-close").click()');
  assert(await evaluate('!window.chatRequests.some(r=>r.action==="load")&&!window.warmRequest'),'Prompt editor loaded model weights');
  await evaluate('document.querySelector("#app-settings").click();document.querySelector("#open-debug").click()');
  assert.equal(await evaluate('window.debugTabs.current()'),'welcome');
  await evaluate('document.querySelector("[data-open=pocket]").click()');await sleep(100);
  await evaluate('document.querySelector("#speak").click()');await sleep(150);
  assert.deepEqual(await evaluate('window.speechArguments.slice(1)'),[2,10,15,'mixed',true],'Pocket speed settings did not reach native bridge');
  await evaluate('document.querySelector("#precision").value="fp32";document.querySelector("#precision").dispatchEvent(new Event("change"));document.querySelector("#speak").click()');await sleep(150);
  assert.deepEqual(await evaluate('window.speechArguments.slice(1)'),[2,10,15,'fp32',true],'Approved quality baseline is not available');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("cleo-pocket-settings")).precision'),'fp32');
  await call('Page.reload');
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.debugTabs)'))break;await sleep(100);}
  assert.equal(await evaluate('document.querySelector("#precision").value'),'fp32','Selected baseline did not persist');
  await evaluate('window.debugTabs.select("pocket")');await sleep(100);
  await evaluate('document.querySelector("#precision").value="mixed";document.querySelector("#precision").dispatchEvent(new Event("change"));document.querySelector("#speak").click()');await sleep(150);
  assert.equal(await evaluate('document.querySelector("#synthesis-speed").textContent'),'0.40 RTF');
  assert(await evaluate('!window.avatarValidation'),'Pocket speech initialized the avatar');
  const pocketImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'pocket-tab.png'),Buffer.from(pocketImage.data,'base64'));
  await evaluate('window.debugTabs.select("avatar")');
  let ready;
  for(let i=0;i<150;i++){ready=await evaluate('window.validationState');if(ready?.ready)break;await sleep(200);}
  assert(ready?.ready,'Avatar did not load: '+JSON.stringify({logs,state:ready,page:await evaluate('({url:location.href,text:document.body?.innerText})')}));assert.deepEqual(ready.errors,[]);
  assert.equal(await evaluate('window.avatarValidation.appearance.settings.skin'),1,'Subtle skin warmth is not the default');
  const graphics=await evaluate('(()=>{const gl=window.avatarValidation.renderer.getContext(),ext=gl.getExtension("WEBGL_debug_renderer_info");return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):"unknown"})()');
  assert(/swiftshader/i.test(graphics),'CPU renderer not selected: '+graphics);
  const relaxed=await evaluate(`(()=>{const v=window.avatarValidation.vrm,n=name=>v.humanoid.getNormalizedBoneNode(name),y=name=>n(name).matrixWorld.elements[13];return ['left','right'].every(side=>y(side+'Hand')<y(side+'UpperArm')-.25&&y(side+'LowerArm')<y(side+'UpperArm')-.15)})()`);
  assert(relaxed,'Default avatar arms are not relaxed below the shoulders');
  assert.equal(await evaluate('window.avatarValidation.cameraControls.snapshot().radius'),.62,'Avatar does not default to face distance');
  const idleFrame=await evaluate('window.avatarValidation.renderer.info.render.frame');await sleep(180);
  assert(await evaluate('window.avatarValidation.renderer.info.render.frame')>idleFrame,'Idle is not animating');
  const idleCheck=await evaluate(`(()=>{const a=window.avatarValidation,head=a.vrm.humanoid.getNormalizedBoneNode('chest'),q=head.quaternion.clone();a.idle.restore();const base=head.quaternion.clone();a.faceControls.restorePresence();a.idle.apply(4.25,.2,false,false);a.faceControls.present(4.25,.2,{idle:true});const blink=a.vrm.expressionManager.getValue('blink');a.idle.restore();a.faceControls.restorePresence();return {blink,restored:head.quaternion.equals(base),changed:!q.equals(base)}})()`);
  assert(idleCheck.blink>.8&&idleCheck.restored&&idleCheck.changed,'Idle animation is not reversible or does not blink');
  await evaluate('document.querySelector("#idle-enabled").checked=false;document.querySelector("#idle-enabled").dispatchEvent(new Event("change"))');


  await evaluate("document.querySelector('#motion-controls').open=true;document.querySelector('#live').click()");await sleep(1800);
  assert(await evaluate('window.bridgeRequests')>0,'Motion requests missing');
  await evaluate(`window.oldBatch=window.lastBatch;window.oldStream=window.lastStartedStream;
    document.querySelector('#profile').value='core8';document.querySelector('#live').click();
    window.cleoEvent(window.oldBatch);window.cleoEvent({type:'motionError',streamId:window.oldStream,message:'STALE FAILURE'});`);
  await sleep(350);
  assert(await evaluate('window.lastStartedStream!==window.oldStream'),'Profile switch reused the old stream');
  assert(!/gap|STALE FAILURE/.test(await evaluate('document.querySelector("#engine-status").textContent')),'Stale profile result corrupted the new stream');
  const resumedStream=await evaluate('window.lastStartedStream');
  await evaluate("document.querySelector('#stop-motion').click();document.querySelector('#live').click()");
  assert.equal(await evaluate('window.lastStartedStream'),resumedStream,'Pause/resume discarded motion context');
  const finite=await evaluate('(()=>{let valid=true;window.avatarValidation.vrm.scene.traverse(n=>{valid&&=n.matrixWorld.elements.every(Number.isFinite)});return valid})()');assert(finite);
  await evaluate('window.cleoVisible(false)');await sleep(100);
  const hidden=await evaluate('[window.avatarValidation.renderer.info.render.frame,window.bridgeRequests]');await sleep(350);
  assert.deepEqual(await evaluate('[window.avatarValidation.renderer.info.render.frame,window.bridgeRequests]'),hidden,'Hidden view kept working');
  await evaluate('window.cleoVisible(true);window.avatarValidation.setMode("rest")');await sleep(150);
  const resting=await evaluate('window.avatarValidation.renderer.info.render.frame');await sleep(300);
  assert.equal(await evaluate('window.avatarValidation.renderer.info.render.frame'),resting,'Static rest kept rendering');
  // Browser touch dispatch exercises pointer capture and two-touch transitions.
  const cameraState=()=>evaluate('window.avatarValidation.cameraControls.snapshot()');
  const cameraBefore=await cameraState();
  const viewport=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {y:r.y,height:r.height}})()');
  const y=viewport.y+viewport.height*.5;
  const touch=(type,points)=>call('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:4,radiusY:4,force:1}))});
  await touch('touchStart',[[1,150,y],[2,250,y]]);
  await touch('touchMove',[[1,170,y+12],[2,270,y+12]]);
  await touch('touchEnd',[]);
  const panned=await cameraState();
  assert.equal(panned.yaw,cameraBefore.yaw);assert.equal(panned.pitch,cameraBefore.pitch);
  assert(Math.abs(panned.radius-cameraBefore.radius)<1e-6,'Two-finger translation changed zoom');
  assert(Math.hypot(...panned.pan)>10*cameraBefore.radius/viewport.height,'Two-finger translation did not pan');
  await evaluate('window.avatarValidation.setMode("replay")');await sleep(250);
  assert.deepEqual((await cameraState()).pan,panned.pan,'Motion following erased the pan offset');
  await evaluate('window.avatarValidation.setMode("rest")');
  await touch('touchStart',[[1,150,y],[2,250,y]]);
  await touch('touchMove',[[1,125,y],[2,275,y]]);
  await touch('touchCancel',[]);
  const zoomed=await cameraState();assert(zoomed.radius<panned.radius*.8,'Pinch did not zoom');
  await touch('touchStart',[[3,180,y]]);await touch('touchMove',[[3,200,y]]);await touch('touchEnd',[]);
  assert(Math.abs((await cameraState()).yaw-zoomed.yaw)>.1,'Cancelled pinch left stale touches');
  const bodyView=await cameraState();
  await evaluate('window.debugTabs.select("face")');await evaluate('window.debugTabs.select("avatar")');
  assert.deepEqual(await cameraState(),bodyView,'Face tab discarded the full body camera offset');
  await evaluate('document.querySelector("#camera-reset").click()');assert.deepEqual(await cameraState(),cameraBefore);
  await evaluate('document.querySelector("#vrm-original").click()');await sleep(200);
  const originalLook=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'appearance-original.png'),Buffer.from(originalLook.data,'base64'));
  const drawCalls=await evaluate('window.avatarValidation.renderer.info.render.calls');
  await evaluate('document.querySelector("#vrm-balanced").click()');await sleep(250);
  const balancedLook=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'appearance-balanced.png'),Buffer.from(balancedLook.data,'base64'));
  assert.notEqual(balancedLook.data,originalLook.data,'Lighting preset did not change the rendered view');
  assert.equal(await evaluate('window.avatarValidation.renderer.info.render.calls'),drawCalls,'Appearance added a render pass');
  await evaluate('document.querySelector("#vrm-saturation").value="0";document.querySelector("#vrm-saturation").dispatchEvent(new Event("input"))');await sleep(150);
  assert.equal(await evaluate('window.avatarValidation.appearance.uniforms.cleoSaturation.value'),0);
  const desaturatedLook=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'appearance-desaturated.png'),Buffer.from(desaturatedLook.data,'base64'));
  assert.notEqual(desaturatedLook.data,balancedLook.data,'Saturation did not change the rendered avatar');
  await evaluate('window.debugWorkspace.section("panel","appearance");document.querySelector("#vrm-balanced").click();document.querySelector("#vrm-settings").open=true');await sleep(150);
  const tuningLook=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'appearance-controls.png'),Buffer.from(tuningLook.data,'base64'));
  await evaluate('window.debugWorkspace.section("panel","run")');
  assert(await evaluate('window.avatarValidation.renderer.info.programs.every(p=>p.diagnostics?.runnable!==false)'),'Avatar shader did not compile');
  assert.equal(await evaluate('window.avatarValidation.renderer.getContext().getError()'),0);
  await evaluate('window.debugTabs.select("face")');
  await evaluate('document.querySelector("#animate-face").click();window.avatarValidation.faceControls.set("mouth",1);');
  assert(await evaluate('window.faceRequested'),'Face control did not reach the native bridge');
  await evaluate(`window.testClock=.5;window.cleoEvent({type:'speechStart',withFace:true,message:'Facial clock check'});
    window.cleoEvent({type:'face',prepared:true,runId:'lam-check',fps:30,startSeconds:0,names:['jawOpen',...Array.from({length:51},(_,i)=>'unused'+i)],frames:Array.from({length:31},(_,f)=>[f/30,...Array(51).fill(0)])})`);
  assert.equal(await evaluate('window.faceReadyRun'),'lam-check','Prepared face timeline was not acknowledged before audio');
  for(let i=0;i<50;i++){if(Math.abs(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")')-.5)<1e-4)break;await sleep(100);}
  assert(Math.abs(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")')-.5)<1e-4,'Face did not follow playback clock');
  await evaluate('window.cleoEvent({type:"speechEnd",withFace:true,message:"Clock check passed"})');await sleep(100);
  const gainCheck=await evaluate(`(()=>{
    const {vrm,faceControls:c}=window.avatarValidation,names=['jawOpen','eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','eyeLookUpLeft','eyeLookUpRight'];
    const values=[.5,.4,.4,.3,.3,.3,.3],track={names};c.set('naturalMotion',true);
    const snapshot=()=>({mouth:vrm.expressionManager.getValue('aa'),blink:vrm.expressionManager.getValue('blinkLeft'),head:vrm.humanoid.getNormalizedBoneNode('head').quaternion.toArray(),eye:vrm.humanoid.getNormalizedBoneNode('leftEye').quaternion.toArray()});
    c.clear();const rest=snapshot();for(const k of ['eyes','mouth','head'])c.set(k,1);c.apply(track,values,.5);const full=snapshot();
    c.set('eyes',0);c.apply(track,values,.5);const noEyes=snapshot();c.set('eyes',1);c.set('mouth',0);c.apply(track,values,.5);const noMouth=snapshot();
    c.set('mouth',1);c.set('head',0);c.apply(track,values,.5);const noHead=snapshot();
    c.clear();const cleared=snapshot();c.set('eyes',1.55);c.set('mouth',.57);c.set('head',1);
    return {rest,full,noEyes,noMouth,noHead,cleared,drivers:c.drivers};
  })()`);
  assert.equal(gainCheck.noEyes.blink,0);assert.deepEqual(gainCheck.noEyes.eye,gainCheck.rest.eye);
  assert.equal(gainCheck.noEyes.mouth,gainCheck.full.mouth);assert.deepEqual(gainCheck.noEyes.head,gainCheck.full.head);
  assert.equal(gainCheck.noMouth.mouth,0);assert.deepEqual(gainCheck.noMouth.eye,gainCheck.full.eye);assert.deepEqual(gainCheck.noMouth.head,gainCheck.full.head);
  assert.deepEqual(gainCheck.noHead.head,gainCheck.rest.head);assert.equal(gainCheck.noHead.mouth,gainCheck.full.mouth);assert.deepEqual(gainCheck.noHead.eye,gainCheck.full.eye);
  assert.notDeepEqual(gainCheck.full.head,gainCheck.rest.head);assert.notDeepEqual(gainCheck.full.eye,gainCheck.rest.eye);
  assert.deepEqual(gainCheck.cleared.head,gainCheck.rest.head);assert.deepEqual(gainCheck.cleared.eye,gainCheck.rest.eye);
  assert.match(gainCheck.drivers.gaze,/eye bones/);
  await evaluate('window.debugWorkspace.section("face-panel","settings");document.querySelector("#face-settings").open=true');await sleep(120);
  const faceImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'face-tab.png'),Buffer.from(faceImage.data,'base64'));
  await evaluate(`document.querySelector('#threads').value='4';document.querySelector('#steps').value='5';document.querySelector('#chunk-size').value='8';document.querySelector('#playback-mode').value='streaming';
    document.querySelector('#face-mouth').value='.8';document.querySelector('#face-mouth').dispatchEvent(new Event('input'));window.debugTabs.select('talk')`);
  const beforeTalk=await evaluate('window.bridgeRequests');
  await evaluate(`document.querySelector('#talk-text').value='One complete pipeline';document.querySelector('#talk-send').click()`);await sleep(100);
  assert.deepEqual(await evaluate('window.talkArguments'),['One complete pipeline',4,5,8,'mixed',false,0,0],'Combined speech ignored tab 2 settings');
  assert.match(await evaluate('document.querySelector("#talk-settings").textContent'),/mouth 0.8×/);
  assert.equal(await evaluate('window.bridgeRequests'),beforeTalk,'Face-only tab ran body inference');
  await evaluate(`window.testClock=.5;window.pipelineFace={type:'face',tab:'talk',withFace:true,prepared:true,streamId:'pipe-check',runId:'window-0',fps:30,startSeconds:0,names:['jawOpen',...Array.from({length:51},(_,i)=>'unused'+i)],frames:Array.from({length:30},()=>[.5,...Array(51).fill(0)])};window.cleoEvent(window.pipelineFace)`);
  await sleep(120);assert.equal(await evaluate('window.faceReadyRun'),'window-0');
  assert(Math.abs(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")')-.4)<1e-4,'Combined face ignored tab 3 amplitude');
  await evaluate(`window.cleoEvent({...window.pipelineFace,runId:'stale',streamId:'old-request'});window.cleoEvent({...window.pipelineFace,startSeconds:1,runId:'window-1',frames:Array.from({length:30},()=>[.8,...Array(51).fill(0)])});window.testClock=1.5;window.cleoEvent({type:'talkPlayback',tab:'talk',playbackStartMs:345})`);
  await sleep(120);assert.equal(await evaluate('window.faceReadyRun'),'window-1');
  assert(Math.abs(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")')-.64)<1e-4,'Rolling face did not advance with audio clock');
  assert.match(await evaluate('document.querySelector("#talk-latency").textContent'),/345 ms/);
  const talkBounds=await evaluate('(()=>{const c=document.querySelector("canvas").getBoundingClientRect(),p=document.querySelector("#talk-panel").getBoundingClientRect();return {height:c.height,bottom:c.bottom,composer:p.top}})()');
  assert(talkBounds.height>=100&&talkBounds.bottom<=talkBounds.composer,'Speech input covers the face');
  const talkImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'talk-tab.png'),Buffer.from(talkImage.data,'base64'));
  await evaluate(`window.debugTabs.select('welcome');window.cleoEvent({...window.pipelineFace,runId:'after-switch',startSeconds:2});window.cleoEvent({type:'speechEnd',tab:'talk',withFace:true,clipReady:true,message:'Ready'})`);
  assert.equal(await evaluate('window.faceReadyRun'),'window-1','Tab switch accepted a stale facial window');
  await evaluate(`window.debugTabs.select('full')`);
  await evaluate(`document.querySelector('#full-text').value='Everything together';document.querySelector('#full-send').click()`);await sleep(350);
  assert(await evaluate('window.bridgeRequests')>beforeTalk,'Together did not start cached Ardy');
  assert.match(await evaluate('document.querySelector("#full-body").textContent'),/core8/,'Together lost selected Ardy profile');
  assert.equal(await evaluate('window.validationState.performance.motionSeconds'),0,'Ardy advanced during speech preparation');
  assert.equal(await evaluate('window.validationState.performance.origin'),0,'Take did not start at frame zero');
  assert.deepEqual(await evaluate('window.talkArguments.slice(6)'),[.5,1]);
  await evaluate(`window.cleoEvent({...window.pipelineFace,tab:'full',runId:'full-window',requiredMotionSeconds:1.5})`);await sleep(200);
  assert.equal(await evaluate('window.faceReadyRun'),'full-window');
  assert.equal(await evaluate('window.validationState.performance.motionSeconds'),0,'Ardy advanced before AudioTrack started');
  await evaluate(`window.testClock=.25;window.cleoEvent({type:'talkPlayback',tab:'full',playbackStartMs:1000})`);await sleep(120);
  assert(Math.abs(await evaluate('window.validationState.performance.motionSeconds')-.25)<1e-5,'Body did not use the audio clock');
  assert.equal(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")'),0,'Face fired before the cue');
  await evaluate(`window.testClock=.75`);await sleep(120);
  assert(Math.abs(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")')-.4)<1e-4,'Face missed the scheduled cue');
  const anchored=await evaluate('window.validationState.performance.motionSeconds');await sleep(200);
  assert.equal(await evaluate('window.validationState.performance.motionSeconds'),anchored,'Body advanced while the playback clock was held');
  await evaluate(`window.cleoEvent({type:'performanceTail',tab:'full',withFace:true,streamId:'pipe-check',runId:'tail-window',audioSeconds:1,requiredMotionSeconds:2.5})`);
  for(let i=0;i<50;i++){if(await evaluate('window.faceReadyRun')==='tail-window')break;await sleep(100);}
  assert.equal(await evaluate('window.faceReadyRun'),'tail-window','Tail ran before body coverage');
  await evaluate(`window.testClock=2.25`);await sleep(120);
  assert.equal(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")'),0,'Face did not release after speech');
  const fullImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'together-tab.png'),Buffer.from(fullImage.data,'base64'));
  await evaluate(`window.cleoEvent({type:'speechEnd',tab:'full',withFace:true,completed:true,message:'Ready'})`);await sleep(120);
  assert.equal(await evaluate('window.validationState.performance.motionSeconds'),2.25,'Scheduled finish skipped or overran the eased endpoint');
  const stoppedFrame=await evaluate('window.avatarValidation.renderer.info.render.frame');await sleep(200);
  assert.equal(await evaluate('window.avatarValidation.renderer.info.render.frame'),stoppedFrame,'Completed take kept rendering');
  await evaluate(`document.querySelector('#full-send').click()`);await sleep(150);
  assert.equal(await evaluate('window.performanceStarts'),2,'Second take did not start a new motion stream');
  assert.equal(await evaluate('window.validationState.performance.motionSeconds'),0,'Second take reused the old cursor');
  await evaluate(`document.querySelector('#benchmark-repeat').checked=true;document.querySelector('#benchmark-repeat').dispatchEvent(new Event('change'));window.cleoEvent({type:'speechEnd',tab:'full',withFace:true,completed:true,message:'Ready'})`);await sleep(300);
  assert.equal(await evaluate('window.performanceStarts'),3,'Opt-in workload did not repeat');
  await evaluate(`window.cleoVisible(false);window.cleoEvent({type:'speechEnd',tab:'full',withFace:true,completed:true,message:'Ready'})`);await sleep(300);
  assert.equal(await evaluate('window.performanceStarts'),3,'Hidden workload kept repeating');
  assert.equal(await evaluate('document.querySelector("#benchmark-repeat").checked'),false);
  await evaluate('window.cleoVisible(true)');
  await evaluate(`document.querySelector('#full-stop').click();window.cleoEvent({type:'speechEnd',tab:'full',withFace:true,completed:false,message:'Stopped'});window.avatarValidation.setMode('rest')`);
  const bodyOverlay=await evaluate(`(()=>{const {vrm,faceControls:c}=window.avatarValidation,head=vrm.humanoid.getNormalizedBoneNode('head');c.clear();head.quaternion.set(0,.1,0,Math.sqrt(.99));const base=head.quaternion.toArray();c.captureBodyPose();c.set('head',0);c.apply({names:['jawOpen']},[.4],.5,true);const zero=head.quaternion.toArray();c.set('head',1);c.apply({names:['jawOpen']},[.4],.5,true);const once=head.quaternion.toArray();c.apply({names:['jawOpen']},[.4],.5,true);const twice=head.quaternion.toArray();c.clear();return {base,zero,once,twice}})()`);
  assert.deepEqual(bodyOverlay.base,bodyOverlay.zero,'Zero facial head gain erased Ardy head pose');
  assert.notDeepEqual(bodyOverlay.base,bodyOverlay.once);assert.deepEqual(bodyOverlay.once,bodyOverlay.twice,'Facial overlay accumulated on the body pose');
  await evaluate('window.debugTabs.select("pocket")');await sleep(100);
  const isolated=await evaluate('[window.avatarValidation.renderer.info.render.frame,window.bridgeRequests]');await sleep(250);
  assert.deepEqual(await evaluate('[window.avatarValidation.renderer.info.render.frame,window.bridgeRequests]'),isolated,'Pocket tab kept avatar/motion work running');
  await evaluate('window.debugTabs.select("avatar")');await sleep(100);
  const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'runtime-panel.png'),Buffer.from(image.data,'base64'));
  const errors=await evaluate('window.validationState.errors');assert.deepEqual(errors,[]);
  const bounds=await evaluate('(()=>{const c=document.querySelector("canvas").getBoundingClientRect(),p=document.querySelector("#panel").getBoundingClientRect();return {canvasHeight:c.height,canvasBottom:c.bottom,panelTop:p.top}})()');
  assert(bounds.canvasHeight>=100&&bounds.canvasBottom<=bounds.panelTop,'Controls cover the viewport');
  // Reload restores appearance without waking any phone runtime.
  await evaluate('document.querySelector("#vrm-contrast").value="1.21";document.querySelector("#vrm-contrast").dispatchEvent(new Event("input"))');
  await call('Page.reload');await sleep(250);
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.debugTabs)'))break;await sleep(100);}
  await evaluate('window.debugTabs.select("avatar")');
  for(let i=0;i<150;i++){if(await evaluate('window.validationState.ready'))break;await sleep(200);}
  assert.equal(await evaluate('window.avatarValidation.appearance.settings.contrast'),1.21,'Appearance did not persist');
  assert.equal(await evaluate('document.querySelector("#vrm-contrast").value'),'1.21');
  assert.deepEqual(await evaluate('window.validationState.errors'),[]);
  await evaluate('window.debugTabs.select("chat")');await sleep(100);
  assert(await evaluate('!document.querySelector("#chat-reasoning").checked'),'Reasoning must default off');
  await evaluate('document.querySelector("#chat-load").click()');await sleep(100);
  const loadedModel=await evaluate('window.chatRequests.find(r=>r.action==="load")');
  assert.deepEqual({...loadedModel,requestId:undefined},{action:'load',requestId:undefined,model:'gemma',pipeline:'gpu-npu',backend:'llama-hexagon',reasoning:0,visualTokens:280,contextTokens:4096,diskCache:true,llamaMemory:'mapped',llamaEncoder:'gpu'});
  await evaluate('document.querySelector("#model-settings").open=false;document.querySelector("#chat-text").value="Hello";document.querySelector("#chat-form").requestSubmit()');await sleep(100);
  assert.equal(await evaluate('document.querySelectorAll("#chat-log article").length'),2);
  assert.equal(await evaluate('document.querySelectorAll("#chat-log img").length'),0,'Model text was interpreted as HTML');
  assert.equal(await evaluate('document.querySelector("[data-model-metric=cache]").textContent'),'Retained');
  await evaluate('window.cleoEvent({type:"chat",attachment:{file:"test.png",kind:"image",label:"Test image"}});document.querySelector("#chat-form").requestSubmit()');await sleep(100);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="send").at(-1).kind'),'image');
  assert.deepEqual(await evaluate('[...document.querySelector("#chat-context").options].map(o=>Number(o.value))'),[4096,8192,16384,32768,65536,131072]);
  await evaluate('document.querySelector("#chat-context").value="8192";document.querySelector("#chat-context").dispatchEvent(new Event("change"))');
  assert(await evaluate('document.querySelector("#chat-send").disabled&&document.querySelector("#browser-start").disabled'),'Context change did not require reload across tabs');
  assert(await evaluate('document.querySelector("#image-token-note").textContent.includes("8,192 tokens")'),'Selected context not displayed');
  await evaluate('document.querySelector("#chat-load").click()');await sleep(100);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="load").at(-1).contextTokens'),8192,'Selected context did not reach native load request');
  assert.equal(await evaluate('document.querySelectorAll("#chat-log article").length'),0,'Context reload retained the old conversation');
  assert(await evaluate('document.querySelector("#browser-model").textContent.includes("8K context")'),'Browser does not show the applied context');
  await evaluate('document.querySelector("#chat-model").value="gemma-e4b";document.querySelector("#chat-model").dispatchEvent(new Event("change"));document.querySelector("#image-budget").value="560";document.querySelector("#image-budget").dispatchEvent(new Event("change"))');
  assert(await evaluate('document.querySelector("#chat-send").disabled'),'Changed runtime settings were silently ignored');
  await evaluate('document.querySelector("#chat-load").click()');await sleep(100);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="load").at(-1).reasoning'),0);
  assert(await evaluate('!document.querySelector("#chat-whisper")&&[...document.querySelector("#chat-model").options].map(o=>o.value).join(",")==="gemma,gemma-e4b"'),'Removed models still advertised');
  assert(await evaluate('document.querySelector("#image-token-note").textContent.includes("560 tokens")'),'Image budget not displayed');
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="load").at(-1).visualTokens'),560);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="load").at(-1).model'),'gemma-e4b');
  await evaluate('document.querySelector("#chat-reasoning").checked=true;document.querySelector("#chat-reasoning").dispatchEvent(new Event("change"));document.querySelector("#chat-load").click()');await sleep(100);
  await evaluate('document.querySelector("#chat-text").value="Stream test";document.querySelector("#chat-form").requestSubmit()');await sleep(100);
  assert(await evaluate('!document.querySelector("#chat-log .assistant .reasoning").open&&!document.querySelector("#chat-log .assistant .reasoning").hidden'),'Reasoning not available collapsed');
  const chatBounds=await evaluate('(()=>{const p=document.querySelector("#chat-panel").getBoundingClientRect(),m=document.querySelector("#chat-panel .resource-strip").getBoundingClientRect();return {panelBottom:p.bottom,metricsBottom:m.bottom,logHeight:document.querySelector("#chat-log").clientHeight}})()');
  assert(chatBounds.metricsBottom<=915&&chatBounds.logHeight>=40,'Chat controls overflow viewport: '+JSON.stringify(chatBounds));
  const chatImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'model-chat-tab.png'),Buffer.from(chatImage.data,'base64'));
  assert.deepEqual(await evaluate('[...document.querySelector("#chat-pipeline").options].map(o=>o.value)'),['gpu-npu','gpu-gpu','gpu-cpu','cpu-cpu']);
  for(const [pipeline,backend,encoder] of [['gpu-gpu','llama-opencl','gpu'],['gpu-cpu','llama-cpu','gpu'],['cpu-cpu','llama-cpu','cpu'],['gpu-npu','llama-hexagon','gpu']]){
    await evaluate(`document.querySelector('#chat-pipeline').value=${JSON.stringify(pipeline)};document.querySelector('#chat-pipeline').dispatchEvent(new Event('change'))`);
    assert(await evaluate('document.querySelector("#chat-send").disabled&&document.querySelector("#browser-start").disabled'),'Pairing change did not require reload');
    await evaluate('document.querySelector("#chat-load").click()');await sleep(60);
    assert.deepEqual(await evaluate('(()=>{const r=window.chatRequests.filter(r=>r.action==="load").at(-1);return [r.backend,r.llamaEncoder];})()'),[backend,encoder]);
    assert(await evaluate('!document.querySelector("#chat-cache-prepare").disabled&&!document.querySelector("#chat-llama-memory").disabled'),'Loaded llama controls disabled');
  }
  await evaluate('window.debugWorkspace.section("chat-panel","settings");document.querySelector("#model-settings").open=true');
  const splitImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'model-split-encoder.png'),Buffer.from(splitImage.data,'base64'));
  await evaluate('document.querySelector("#chat-llama-memory").value="fast";document.querySelector("#chat-llama-memory").dispatchEvent(new Event("change"))');
  assert(await evaluate('document.querySelector("#chat-send").disabled&&document.querySelector("#chat-cache-prepare").disabled'),'Memory change did not require reload');
  await evaluate('document.querySelector("#chat-load").click()');await sleep(60);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="load").at(-1).llamaMemory'),'fast');
  await evaluate('window.debugWorkspace.section("chat-panel","cache");document.querySelector("#chat-cache-panel").open=true;document.querySelector("#chat-cache-scope").value="browser";document.querySelector("#chat-cache-prepare").click()');await sleep(60);
  assert(await evaluate('window.chatRequests.some(r=>r.action==="cachePrepare"&&r.scope==="browser"&&!r.rebuild)'));
  await evaluate('document.querySelector("#chat-cache-rebuild").click()');await sleep(60);
  assert(await evaluate('window.chatRequests.some(r=>r.action==="cachePrepare"&&r.rebuild)'));
  await evaluate('document.querySelector("#chat-cache-clear").click()');await sleep(60);
  assert(await evaluate('window.chatRequests.some(r=>r.action==="cacheClear")'));
  await evaluate('window.cleoEvent({type:"chat",diskCache:{supported:true,files:2,bytes:1048576,restoredTokens:420,restoreMs:25,operation:"Restored disk prefix"}})');
  assert(await evaluate('document.querySelector("#chat-cache-status").textContent.includes("420 tokens restored")'),'Disk metrics lost');
  assert(await evaluate('document.querySelector("#chat-panel .resource-strip").getBoundingClientRect().bottom<=document.querySelector("#chat-panel").getBoundingClientRect().bottom'),'Expanded cache controls push resource metrics offscreen');
  const qatImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'model-qat-cache-tab.png'),Buffer.from(qatImage.data,'base64'));
  await evaluate('window.debugWorkspace.section("chat-panel","run");document.querySelector("#chat-load").click()');await sleep(60);
  await evaluate('window.debugTabs.select("browser")');await sleep(100);
  const browserBounds=await evaluate('window.browserBounds');assert(browserBounds.height>.15&&browserBounds.y+browserBounds.height<=1,'Embedded browser bounds invalid');
  await evaluate('window.cleoEvent({type:"chat",channel:"browser",requestId:"geometry-check",partial:"Inspecting a visible target. ".repeat(60),reasoning:"Checking its position. ".repeat(40)});window.cleoEvent({type:"browser",status:"A very long action description ".repeat(30),running:true,waiting:false});document.querySelector("#browser-stream .reasoning").open=true');await sleep(120);
  const streamedBrowserBounds=await evaluate('window.browserBounds');assert.deepEqual(streamedBrowserBounds,browserBounds,'Streamed answer/reasoning/status resized the captured viewport');
  await evaluate('document.querySelector("#browser-inspect").click()');assert.equal(await evaluate('window.browserRequests.at(-1).action'),'inspect');
  await evaluate('document.querySelector("#browser-goal").value="Find documentation";document.querySelector("#browser-form").requestSubmit()');
  assert.deepEqual(await evaluate('window.browserRequests.at(-1)'),{action:'start',goal:'Find documentation'});
  await evaluate('window.cleoEvent({type:"browser",status:"Inspecting",running:true,waiting:false,url:"https://www.google.com/"});document.querySelector("#browser-pause").click();document.querySelector("#browser-stop").click()');
  assert.deepEqual(await evaluate('window.browserRequests.slice(-2).map(r=>r.action)'),['pause','stop']);
  await evaluate('window.cleoEvent({type:"browser",status:"Input needed",running:false,waiting:true,question:"Which result?",confirmation:false});document.querySelector("#browser-answer").value="The first";document.querySelector("#browser-followup-form").requestSubmit()');
  assert.deepEqual(await evaluate('window.browserRequests.at(-1)'),{action:'followup',text:'The first'});
  await evaluate('window.cleoEvent({type:"browser",status:"Approve?",running:false,waiting:true,question:"Send?",confirmation:true})');
  assert(await evaluate('!document.querySelector("#browser-confirm").hidden&&document.querySelector("#browser-followup-form").hidden'));
  await evaluate('document.querySelector("#browser-reject").click();window.cleoEvent({type:"browser",status:"Paused",running:false,waiting:false})');
  const browserImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'browser-tab.png'),Buffer.from(browserImage.data,'base64'));
  await evaluate('window.cleoEvent({type:"chat",inputScope:"browser",attachment:{file:"goal.wav",kind:"audio",label:"Spoken goal"}});document.querySelector("#browser-goal").value="";document.querySelector("#browser-form").requestSubmit()');
  assert.deepEqual(await evaluate('window.browserRequests.at(-1)'),{action:'start',goal:'',audioFile:'goal.wav'});
  assert.equal(await evaluate('document.querySelector("#chat-attachment").textContent'),'','Browser audio leaked to chat');
  await evaluate('window.cleoEvent({type:"browser",status:"Input needed",waiting:true,question:"Which one?",confirmation:false});window.cleoEvent({type:"chat",inputScope:"browser",attachment:{file:"answer.wav",kind:"audio",label:"Spoken answer"}});document.querySelector("#browser-followup-form").requestSubmit()');
  assert.equal(await evaluate('window.browserRequests.at(-1).audioFile'),'answer.wav');
  // Tab 9 uses the real renderer/track, with model responses and native sessions stubbed.
  await evaluate('window.debugTabs.select("cleopatra")');await sleep(150);
  assert(await evaluate('document.querySelector("#cleopatra-send").disabled'),'Send enabled before all models load');
  await evaluate('document.querySelector("#cleopatra-load").click()');await sleep(150);
  assert.equal(await evaluate('window.warmRequest.profile'),'core40');
  assert.equal(await evaluate('window.warmRequest.precision'),'mixed');
  assert(await evaluate('!document.querySelector("#cleopatra-send").disabled'),'Load all did not enable Send');
  await evaluate('window.cleoEvent({type:"chat",inputScope:"cleopatra",attachment:{file:"hello.wav",kind:"audio",label:"Voice input"}});document.querySelector("#cleopatra-text").value="";document.querySelector("#cleopatra-form").requestSubmit()');await sleep(60);
  const avatarRequest=await evaluate('window.chatRequests.filter(r=>r.action==="avatarSend").at(-1)');
  assert.equal(avatarRequest.kind,'audio');assert.equal(avatarRequest.file,'hello.wav');
  assert.equal(avatarRequest.motions.find(x=>x.key==='wave').id,'bank:wave');
  await evaluate(`window.avatarRequestId=${JSON.stringify(avatarRequest.requestId)};window.cleoEvent({type:'chat',channel:'avatar',requestId:window.avatarRequestId,partial:'Hello',reasoning:'Choose a friendly wave.'})`);
  assert.equal(await evaluate('document.querySelector("#cleopatra-log article:last-child>div").textContent'),'Hello');
  assert(await evaluate('!document.querySelector("#cleopatra-log article:last-child .reasoning").open'),'Reasoning expanded itself');
  await evaluate(`document.querySelector('#cleopatra-log article:last-child .reasoning').open=true;window.cleoEvent({type:'chat',channel:'avatar',requestId:window.avatarRequestId,partial:'Hello there!',reasoning:'Choose a friendly wave. Then speak.'})`);
  assert(await evaluate('document.querySelector("#cleopatra-log article:last-child .reasoning").open'),'Streaming collapsed a user-opened trace');
  const takeCount=await evaluate('window.performanceStarts');
  await evaluate(`window.cleoEvent({type:'chat',channel:'avatar',requestId:window.avatarRequestId,avatarTool:{name:'avatar_stage',arguments:{motion:'wave'},result:{ok:true}}})`);
  assert.equal(await evaluate('window.performanceStarts'),takeCount,'Tool call started playback before the answer completed');
  await evaluate(`window.cleoEvent({type:'chat',channel:'avatar',requestId:window.avatarRequestId,result:{text:'Hello there!',reasoning:'Choose a friendly wave.',avatarPlan:{embeddingId:'bank:wave',expression:'happy',strength:.2,cue_seconds:.25,tail_seconds:.75,camera:{distance:1},root:{x:.5,heading:90},face:{head:.5},schedule:[{at_seconds:1,transition_seconds:.2,camera:{distance:1.5},root:{heading:45}}]}}})`);await sleep(150);
  assert.equal(await evaluate('window.performanceEmbedding'),'bank:wave','Live Ardy did not receive the tool-selected cached embedding');
  assert.equal(await evaluate('document.querySelector("#bank").value'),'bank:check','Tool overwrote manual Ardy selection');
  assert.equal(await evaluate('window.talkArguments[0]'),'Hello there!','Reasoning/tool syntax leaked into speech');
  assert.deepEqual(await evaluate('window.talkArguments.slice(1)'),[2,10,15,'mixed',true,.25,.75]);
  for(let i=0;i<30;i++){if(await evaluate('Boolean(window.validationState.performance)'))break;await sleep(100);}
  assert.deepEqual(await evaluate('window.validationState.errors'),[]);
  assert.equal(await evaluate('window.validationState.performance?.origin'),0,'Avatar take never rendered');
  await evaluate(`window.cleoEvent({type:'face',withFace:true,prepared:true,streamId:'pipe-check',tab:'cleopatra',runId:'agent-window',requiredMotionSeconds:1.25,fps:30,startSeconds:0,names:['jawOpen',...Array.from({length:51},(_,i)=>'unused'+i)],frames:Array.from({length:30},()=>[.5,...Array(51).fill(0)])})`);await sleep(150);
  assert.equal(await evaluate('window.faceReadyRun'),'agent-window');
  await evaluate(`window.testClock=.1;window.cleoEvent({type:'talkPlayback',tab:'cleopatra',playbackStartMs:900})`);await sleep(100);
  assert.equal(await evaluate('window.avatarValidation.vrm.expressionManager.getValue("aa")'),0);
  await evaluate('window.testClock=.6');await sleep(100);
  assert(Math.abs(await evaluate('window.validationState.performance.motionSeconds')-.6)<1e-5);
  assert(Math.abs(await evaluate('window.avatarValidation.stageRoot.rotation.y')-Math.PI/2)<1e-5,'Scheduled body heading not applied');
  assert.equal(await evaluate('window.avatarValidation.cameraControls.snapshot().radius'),1,'Initial camera control not applied');
  const frozen=await evaluate('window.validationState.direction');await sleep(150);
  assert.deepEqual(await evaluate('window.validationState.direction'),frozen,'Controls advanced while audio clock stalled');
  await evaluate('window.testClock=1.3');await sleep(150);
  assert.equal(await evaluate('window.avatarValidation.cameraControls.snapshot().radius'),1.5,'Timed camera cue did not run');
  assert(Math.abs(await evaluate('window.avatarValidation.stageRoot.rotation.y')-Math.PI/4)<1e-5,'Timed heading cue did not run');
  const agentImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'cleopatra-tab.png'),Buffer.from(agentImage.data,'base64'));
  await evaluate(`document.querySelector('#cleopatra-stop').click();window.cleoEvent({type:'speechEnd',tab:'cleopatra',withFace:true,completed:false,message:'Stopped'});window.Cleo.chat(JSON.stringify({action:'status'}))`);await sleep(150);
  await evaluate('document.querySelector("#cleopatra-text").value="Cancel this";document.querySelector("#cleopatra-form").requestSubmit()');await sleep(80);
  const cancelledId=await evaluate('window.chatRequests.filter(r=>r.action==="avatarSend").at(-1).requestId');
  await evaluate('window.debugTabs.select("chat")');await sleep(80);
  assert(await evaluate('window.chatRequests.some(r=>r.action==="cancel")'),'Leaving tab 9 did not cancel pending Gemma');
  const beforeStale=await evaluate('window.performanceStarts');
  await evaluate(`window.cleoEvent({type:'chat',channel:'avatar',requestId:${JSON.stringify(cancelledId)},result:{text:'Stale reply',avatarPlan:{embeddingId:'bank:wave',expression:'neutral',strength:0,cue_seconds:0,tail_seconds:1}}})`);await sleep(100);
  assert.equal(await evaluate('window.performanceStarts'),beforeStale,'Stale result started speech after tab switch');
  assert.deepEqual(await evaluate('window.validationState.errors'),[]);
  await evaluate('document.querySelector("#app-home").click();document.querySelector("#launch").click()');
  for(let i=0;i<50;i++){if(await evaluate('!document.querySelector("#main-send").disabled'))break;await sleep(100);}
  assert.equal(await evaluate('window.debugTabs.current()'),'main');
  assert(await evaluate('document.querySelector("#debug-nav").hidden'),'Main shows debug tabs');
  assert.equal(await evaluate('window.nativeFrame'),'face');
  assert.equal(await evaluate('window.avatarValidation.framing()'),'face');
  assert.equal(await evaluate('window.avatarValidation.cameraControls.snapshot().radius'),.62);
  assert.equal(await evaluate('window.avatarValidation.cameraControls.direction().elevation'),0,'Face camera is elevated');
  const eyeLevel=await evaluate(`(()=>{const a=window.avatarValidation,{vrm,camera}=a;a.idle.restore();a.faceControls.restorePresence();vrm.humanoid.update();vrm.scene.updateMatrixWorld(true);const p=camera.position.clone();return {eye:(vrm.humanoid.getRawBoneNode('leftEye').getWorldPosition(p).y+vrm.humanoid.getRawBoneNode('rightEye').getWorldPosition(p).y)/2,camera:camera.position.y};})()`);
  assert(Math.abs(eyeLevel.eye-eyeLevel.camera)<.015,'Camera did not start at eye level: '+JSON.stringify(eyeLevel));
  assert(await evaluate('window.chatRequests.some(r=>r.action==="mainPrepare")'),'Main did not request system/tool prefill');
  assert(await evaluate('!document.querySelector("#main-send").disabled'),'Main not ready after prefill');
  await evaluate('document.querySelector("#app-settings").click()');
  assert(await evaluate('document.querySelector("#app-menu").contains(document.querySelector("#chat-context"))'),'Settings not shared with the model tab');
  await evaluate('document.querySelector("#resident-enabled").checked=false;document.querySelector("#resident-enabled").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('window.residentEnabled'),false);
  await evaluate('document.querySelector("#settings-close").click()');
  const faceStarts=await evaluate('window.performanceStarts');
  await evaluate('document.querySelector("#main-record").dispatchEvent(new KeyboardEvent("keydown",{key:" "}))');await sleep(30);
  assert.equal(await evaluate('document.querySelector("#main-record").getAttribute("aria-pressed")'),'true');
  await evaluate('document.querySelector("#main-record").dispatchEvent(new KeyboardEvent("keyup",{key:" "}));window.cleoEvent({type:"chat",inputScope:"main",attachment:{file:"main.wav",kind:"audio",recorded:true,label:"Voice input"}})');await sleep(90);
  const mainRequest=await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").at(-1)');
  assert.equal(mainRequest.frame,'face');assert.equal(mainRequest.kind,'audio');assert.equal(mainRequest.file,'main.wav');
  assert.equal(mainRequest.scene.camera.distance,.62);
  await evaluate(`window.mainId=${JSON.stringify(mainRequest.requestId)};window.cleoEvent({type:'chat',channel:'main',requestId:window.mainId,partial:'Hello',reasoning:'A thought'})`);
  assert.equal(await evaluate('document.querySelector("#main-log article:last-child>div").textContent'),'Hello');
  assert(await evaluate('!document.querySelector("#main-log article:last-child .reasoning").open'));
  await evaluate(`window.cleoEvent({type:'chat',channel:'main',requestId:window.mainId,result:{text:'Hello from Main.',reasoning:'A thought',avatarPlan:{frame:'face',embeddingId:'bank:check',expression:'happy',strength:.2,cue_seconds:0,tail_seconds:0,schedule:[{at_seconds:.3,expression:'relaxed',strength:.1}]}}})`);await sleep(100);
  assert.equal(await evaluate('window.performanceStarts'),faceStarts,'Face launched Ardy');
  assert.deepEqual(await evaluate('window.talkArguments.slice(6)'),[0,0]);
  await evaluate(`window.cleoEvent({type:'face',withFace:true,prepared:true,streamId:'pipe-check',tab:'main',runId:'main-face',fps:30,startSeconds:0,names:['jawOpen',...Array.from({length:51},(_,i)=>'unused'+i)],frames:Array.from({length:30},()=>[.5,...Array(51).fill(0)])})`);await sleep(60);
  assert.equal(await evaluate('window.faceReadyRun'),'main-face','Face waited for nonexistent body motion');
  await evaluate('window.testClock=.8;window.cleoEvent({type:"talkPlayback",tab:"main",playbackStartMs:800})');await sleep(120);
  assert.equal(await evaluate('window.validationState.direction.expressions.relaxed'),.1,'Face-only cues did not follow the audio clock');
  const mainImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'main-face.png'),Buffer.from(mainImage.data,'base64'));
  await evaluate('window.cleoEvent({type:"speechEnd",tab:"main",withFace:true,completed:true,message:"Ready"});window.Cleo.chat(JSON.stringify({action:"status"}))');await sleep(80);
  // Voice starts before the final result and subsequent phrases reuse the same take.
  const streamingReply='I can keep speaking as the rest of my reply arrives. Short sentences belong to the same phrase, so Anna has more context for natural pacing and emphasis while we talk. There is still more to say.';
  // Native status is asynchronous. Wait for the preceding take to acknowledge
  // ready before exercising Enter; a fixed sleep can silently skip the send.
  for(let i=0;i<60;i++){if(await evaluate('!document.querySelector("#main-send").disabled'))break;await sleep(50);}
  assert(await evaluate('!document.querySelector("#main-send").disabled'),'Previous take never became ready: '+await evaluate('document.querySelector("#main-status").textContent'));
  const beforeStreamingRequests=await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").length');
  await evaluate('document.querySelector("#main-text").value="Explain streaming";document.querySelector("#main-text").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",cancelable:true}))');await sleep(40);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").length'),beforeStreamingRequests+1,'Enter did not send the streaming turn');
  const streamedId=await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").at(-1).requestId');
  const streamPlan={frame:'face',embeddingId:'bank:check',expression:'neutral',strength:0,cue_seconds:0,tail_seconds:0};
  const beforeStream=await evaluate('window.speechBegins');
  await evaluate(`window.cleoEvent({type:'chat',channel:'main',requestId:${JSON.stringify(streamedId)},partial:${JSON.stringify(streamingReply)},avatarPlan:${JSON.stringify(streamPlan)}})`);await sleep(60);
  assert.equal(await evaluate('window.speechBegins'),beforeStream+1,'Voice waited for the final response');
  assert.equal(await evaluate('window.speechFinished'),false);
  await evaluate(`window.cleoEvent({type:'chat',channel:'main',requestId:${JSON.stringify(streamedId)},result:{text:${JSON.stringify(streamingReply)},avatarPlan:${JSON.stringify(streamPlan)}}})`);await sleep(40);
  assert.equal(await evaluate('window.speechPhrases.join("").trim()'),streamingReply);
  assert.equal(await evaluate('window.speechBegins'),beforeStream+1,'A phrase restarted the take');
  assert.equal(await evaluate('window.speechFinished'),true);
  await evaluate('window.cleoEvent({type:"speechEnd",tab:"main",completed:true,message:"Ready"});window.Cleo.chat(JSON.stringify({action:"status"}))');await sleep(50);
  const beforeInput=await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").length');
  await evaluate('document.querySelector("#send-on-enter").checked=false;document.querySelector("#send-on-enter").dispatchEvent(new Event("change"));document.querySelector("#main-text").value="A draft";document.querySelector("#main-text").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",cancelable:true}))');
  assert.equal(await evaluate('localStorage.getItem("cleo-send-on-enter")'),'false');
  await evaluate('document.querySelector("#send-on-enter").checked=true;document.querySelector("#send-on-enter").dispatchEvent(new Event("change"));for(const option of [{shiftKey:true},{isComposing:true}])document.querySelector("#main-text").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",cancelable:true,...option}));document.querySelector("#main-record").dispatchEvent(new KeyboardEvent("keydown",{key:" "}))');await sleep(30);
  await evaluate('document.querySelector("#main-record").dispatchEvent(new Event("blur"));window.cleoEvent({type:"chat",inputScope:"main",attachment:{file:"cancel.wav",kind:"audio",recorded:true,label:"Cancelled hold"}})');await sleep(50);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").length'),beforeInput,'Cancelled hold or newline sent a message');
  await evaluate('document.querySelector("#main-clear-attachment").click();document.querySelector("#main-text").value="";document.querySelector("#main-camera").click()');
  assert(await evaluate('document.querySelector("#main-media").open'),'Camera did not offer a media menu');
  await evaluate('document.querySelector("#main-capture").click()');assert.equal(await evaluate('window.cameraRequest'),'main');
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:520,deviceScaleFactor:1,mobile:true});await sleep(80);
  const mainBounds=await evaluate(`['main-record','main-camera','main-text','main-send'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom};})`);
  assert(mainBounds.every(r=>r.left>=0&&r.right<=360&&r.bottom<=520&&r.width>=40),JSON.stringify(mainBounds));
  assert(mainBounds[0].right<=mainBounds[1].left&&mainBounds[1].right<=mainBounds[2].left,'Composer order is wrong');
  const compactMain=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'main-compact.png'),Buffer.from(compactMain.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});await sleep(50);
  const prefilled=await evaluate('window.chatRequests.filter(r=>r.action==="mainPrepare").length');
  await evaluate('document.querySelector("[data-frame=torso]").click();document.querySelector("#main-image").click()');
  assert.deepEqual(await evaluate('window.attachRequest'),{kind:'image',scope:'main'});
  await evaluate('window.cleoEvent({type:"chat",inputScope:"main",attachment:{file:"main.png",kind:"image",label:"Image"}});document.querySelector("#main-text").value="Wave";document.querySelector("#main-form").requestSubmit()');await sleep(60);
  const torsoRequest=await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").at(-1)');
  assert.equal(torsoRequest.frame,'torso');assert.equal(torsoRequest.kind,'image');
  assert.equal(await evaluate('window.nativeFrame'),'torso');
  await evaluate(`window.cleoEvent({type:'chat',channel:'main',requestId:${JSON.stringify(torsoRequest.requestId)},result:{text:'A small wave.',avatarPlan:{frame:'torso',embeddingId:'bank:wave',expression:'neutral',strength:0,cue_seconds:0,tail_seconds:.75,camera:{distance:1.4}}}})`);await sleep(150);
  assert.equal(await evaluate('window.performanceStarts'),faceStarts+1,'Torso did not launch live Ardy');
  await evaluate(`window.cleoEvent({type:'face',withFace:true,prepared:true,streamId:'pipe-check',tab:'main',runId:'main-torso',requiredMotionSeconds:1,fps:30,startSeconds:0,names:['jawOpen',...Array.from({length:51},(_,i)=>'unused'+i)],frames:Array.from({length:30},()=>[.5,...Array(51).fill(0)])});window.testClock=.8`);await sleep(150);
  assert.equal(await evaluate('window.faceReadyRun'),'main-torso');
  const locked=await evaluate('(()=>{const h=window.avatarValidation.vrm.scene;return {x:h.position.x,z:h.position.z,camera:window.avatarValidation.cameraControls.snapshot().radius,root:window.validationState.direction.root}})()');
  assert(Math.abs(locked.x)<1e-5&&Math.abs(locked.z)<1e-5,'Torso root drift: '+JSON.stringify(locked));
  assert.equal(locked.camera,1.4);assert.deepEqual(locked.root,{x:0,z:0,heading:0});
  await evaluate('window.cleoEvent({type:"speechEnd",tab:"main",withFace:true,completed:false,message:"Stopped"});window.Cleo.chat(JSON.stringify({action:"status"}))');await sleep(60);
  for(let i=0;i<40;i++){if(await evaluate('!document.querySelector("[data-frame=body]").disabled&&!document.querySelector("#main-send").disabled'))break;await sleep(100);}
  assert(await evaluate('!document.querySelector("[data-frame=body]").disabled&&!document.querySelector("#main-send").disabled'),'Main did not become ready after the torso take');
  await evaluate('document.querySelector("[data-frame=body]").click();document.querySelector("#main-text").value="Move over";document.querySelector("#main-form").requestSubmit()');await sleep(60);
  const bodyRequest=await evaluate('window.chatRequests.filter(r=>r.action==="mainSend").at(-1)');assert.equal(bodyRequest.frame,'body');
  await evaluate(`window.cleoEvent({type:'chat',channel:'main',requestId:${JSON.stringify(bodyRequest.requestId)},result:{text:'Over here.',avatarPlan:{frame:'body',embeddingId:'bank:wave',expression:'neutral',strength:0,cue_seconds:0,tail_seconds:.75,root:{x:2,heading:70},camera:{distance:4}}}})`);await sleep(100);
  await evaluate('window.testClock=.8;window.cleoEvent({type:"talkPlayback",tab:"main",playbackStartMs:850})');await sleep(100);
  assert.equal(await evaluate('window.validationState.direction.root.x'),2);
  assert.equal(await evaluate('window.avatarValidation.cameraControls.snapshot().radius'),4);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="mainPrepare").length'),prefilled,'Frame change unnecessarily discarded the prepared prefix');
  await evaluate('document.querySelector("#main-stop").click();window.cleoEvent({type:"speechEnd",tab:"main",withFace:true,completed:false,message:"Stopped"});window.Cleo.chat(JSON.stringify({action:"status"}))');await sleep(80);
  const continuity=await evaluate(`(()=>{
    const {faceControls:c,vrm}=window.avatarValidation,h=vrm.humanoid.getNormalizedBoneNode('head');
    c.clear();for(let i=0;i<30;i++){c.restorePresence();c.present(10+i*.05,.05,{idle:true});}
    const idle=h.quaternion.clone();c.restorePresence();c.apply({names:['jawOpen']},[.3],0);c.present(11.5,.016,{faceActive:true});const start=h.quaternion.clone();
    c.restorePresence();c.clear();c.present(11.516,.016,{idle:true});const end=h.quaternion.clone();
    return {start:idle.angleTo(start),end:start.angleTo(end)};
  })()`);
  assert(continuity.start<.03&&continuity.end<.03,'Head snapped at ownership handoff: '+JSON.stringify(continuity));
  assert.deepEqual(await evaluate('window.validationState.errors'),[]);
  await evaluate('window.debugTabs.select("browser")');await sleep(100);
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:520,deviceScaleFactor:1,mobile:true});await sleep(200);
  await evaluate('document.querySelector("#browser-stop").scrollIntoView({block:"center"})');
  const compactBounds=await evaluate('(()=>{const b=document.querySelector("#browser-stop").getBoundingClientRect(),v=document.querySelector("#browser-viewport").getBoundingClientRect(),s=document.querySelector("#browser-stream").getBoundingClientRect();return {stopBottom:b.bottom,viewportHeight:v.height,streamBottom:s.bottom}})()');
  assert(compactBounds.stopBottom<=520&&compactBounds.viewportHeight>=90,'Keyboard-sized browser layout hides controls: '+JSON.stringify(compactBounds));
  assert(await evaluate('document.querySelector("#browser-console").scrollHeight>=document.querySelector("#browser-console").clientHeight'),'Browser controls have no scroll owner');
  const browserCompact=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'browser-compact.png'),Buffer.from(browserCompact.data,'base64'));
  await evaluate('window.debugTabs.select("chat");document.querySelector("#model-settings").open=false');await sleep(150);
  await evaluate('window.debugWorkspace.section("chat-panel","run");document.querySelector("#chat-send").scrollIntoView({block:"center"})');
  assert(await evaluate('document.querySelector("#chat-send").getBoundingClientRect().bottom<=520'),'Keyboard-sized chat hides Send');
  await call('Page.reload');
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.debugTabs)'))break;await sleep(100);}
  assert.equal(await evaluate('document.querySelector("#chat-context").value'),'8192','Context choice did not persist');
  assert.equal(await evaluate('document.querySelector("#chat-llama-memory").value'),'fast','Memory preset did not persist');
  assert.equal(await evaluate('document.querySelector("#chat-pipeline").value'),'gpu-npu','Pairing did not persist');
  await evaluate('window.debugTabs.select("cleopatra")');
  for(let i=0;i<150;i++){if(await evaluate('window.validationState.ready'))break;await sleep(200);}
  for(let i=0;i<50;i++){if(await evaluate('!document.querySelector("#cleopatra-load").disabled'))break;await sleep(100);}
  await evaluate('document.querySelector("#cleopatra-load").click()');
  for(let i=0;i<50;i++){if(await evaluate('window.chatRequests.some(r=>r.action==="load")'))break;await sleep(100);}
  const coldLoad=await evaluate('({request:window.chatRequests.filter(r=>r.action==="load").at(-1),order:window.loadOrder,status:document.querySelector("#cleopatra-status").textContent,disabled:document.querySelector("#cleopatra-load").disabled,requests:window.chatRequests})');
  assert.equal(coldLoad.request?.contextTokens,8192,'Cleopatra Load all did not inherit the saved context: '+JSON.stringify(coldLoad));
  assert.equal(coldLoad.request?.llamaEncoder,'gpu','Later tab load did not inherit encoder setting');
  await sleep(100);
  // Exercise cold Main startup, failure retention, retries and cancellation with delayed native replies.
  await evaluate('document.querySelector("#cleopatra-unload").click()');await sleep(60);
  await evaluate('window.holdRelease=true;window.loadOrder=[];document.querySelector("#app-home").click();document.querySelector("#launch").click()');await sleep(80);
  assert.deepEqual(await evaluate('window.loadOrder'),['release'],'Gemma loaded before avatar session release completed');
  const staleRelease=await evaluate('window.releaseRequest');
  await evaluate('document.querySelector("#main-stop").click()');
  await evaluate(`window.cleoEvent({type:'ensemble',component:'release',requestId:${JSON.stringify(staleRelease)},state:'ready',message:'Released'})`);await sleep(40);
  assert.deepEqual(await evaluate('window.loadOrder'),['release'],'Cancelled startup resumed after a late release acknowledgment');
  const beforeFailure=await evaluate('window.warmRequests.length');
  await evaluate('window.holdRelease=false;window.failNextLoad="Android stopped Gemma for low memory";document.querySelector("#main-load").click()');await sleep(120);
  assert.equal(await evaluate('window.warmRequests.length'),beforeFailure,'Avatar models loaded after Gemma failed');
  await evaluate(`window.cleoEvent({type:'ensemble',component:'all',requestId:window.releaseRequest,state:'ready',message:'LATE READY'})`);
  assert.equal(await evaluate('document.querySelector("#main-status").textContent'),'Android stopped Gemma for low memory','Late startup event hid Gemma failure');
  assert(await evaluate('document.querySelector("#main-send").disabled&&!document.querySelector("#main-load").disabled'),'Failed startup cannot be retried');
  await evaluate('window.loadOrder=[];window.holdLoad=true;document.querySelector("#main-load").click()');await sleep(80);
  assert.equal(await evaluate('window.warmRequests.length'),beforeFailure,'Avatar warmed during Gemma initialization');
  await evaluate('window.holdLoad=false;window.Cleo.chat(window.heldLoad)');await sleep(160);
  assert.deepEqual(await evaluate('window.loadOrder'),['release','load','mainPrepare','warm'],'Cold Main startup order is wrong');
  assert(await evaluate('!document.querySelector("#main-send").disabled'),'Retry did not recover after Gemma loaded');
  const beforeNew=await evaluate('({loads:window.chatRequests.filter(r=>r.action==="load").length,warms:window.warmRequests.length})');
  await evaluate('window.cleoEvent({type:"chat",channel:"main",error:"Gemma generated an invalid avatar control",mainPrepared:false});document.querySelector("#main-new").click()');await sleep(100);
  assert(await evaluate('!document.querySelector("#main-send").disabled'),'New chat did not recover a failed response');
  assert(!/invalid avatar control/.test(await evaluate('document.querySelector("#main-status").textContent')),'Old response error remained after New chat');
  assert.deepEqual(await evaluate('({loads:window.chatRequests.filter(r=>r.action==="load").length,warms:window.warmRequests.length})'),beforeNew,'Response recovery reloaded resident engines');
  assert.deepEqual(await evaluate('window.validationState.errors'),[]);
  // Exercise the new module shell at portrait, keyboard and landscape dimensions.
  const layoutChecks=[];
  for(const [width,height] of [[412,915],[360,520],[1024,768]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    for(const tab of ['welcome','pocket','face','talk','avatar','full','chat','browser','cleopatra']){
      await evaluate(`window.debugTabs.select(${JSON.stringify(tab)})`);await sleep(35);
      const panel=await evaluate('document.querySelector("body > [data-module]:not([hidden])").id');
      const panes=await evaluate(`Array.from(document.querySelectorAll('#${panel} [data-module-pane]')).map(e=>e.dataset.modulePane)`);
      for(const pane of panes.length?panes:['run']){
        await evaluate(`window.debugWorkspace.section(${JSON.stringify(panel)},${JSON.stringify(pane)})`);
        const result=await evaluate(`(()=>{const p=document.getElementById(${JSON.stringify(panel)}),r=p.getBoundingClientRect();const nested=[...p.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.tagName!=='TEXTAREA'&&e.id!=='browser-console'&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>e.id||e.className);return {nested,left:r.left,right:r.right,bottom:r.bottom,horizontal:p.scrollWidth-p.clientWidth,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON()}})()`);
        assert.deepEqual(result.nested,[],`Nested scrolling ${tab}/${pane} at ${width}`);
        assert(result.left>=0&&result.right<=width+1&&result.bottom<=height+1&&result.horizontal<=2,`Overflow ${tab}/${pane}: ${JSON.stringify(result)}`);
        if(width>=900&&['face','talk','avatar','full','cleopatra'].includes(tab)){assert(result.canvas.right<=result.left&&result.canvas.height>400,'Wide avatar viewport overlaps controls');assert(await evaluate(`document.querySelector('#avatar-view-controls').getBoundingClientRect().right<=document.getElementById('${panel}').getBoundingClientRect().left`),'View controls overlap module sections');}
        layoutChecks.push({width,height,tab,pane});
      }
    }
    await evaluate('window.debugTabs.select("avatar");window.debugWorkspace.section("panel","appearance")');await sleep(60);
    const picture=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,`module-layout-${width}.png`),Buffer.from(picture.data,'base64'));
  }
  await evaluate('window.debugTabs.select("chat");window.debugWorkspace.section("chat-panel","run");window.holdSend=true;document.querySelector("#chat-text").value="Cancellation check";document.querySelector("#chat-form").requestSubmit()');await sleep(60);
  const cancels=await evaluate('window.chatRequests.filter(r=>r.action==="cancel").length');
  await evaluate('window.debugTabs.select("pocket")');await sleep(60);
  assert.equal(await evaluate('window.chatRequests.filter(r=>r.action==="cancel").length'),cancels+1,'Leaving chat kept its response running');
  await evaluate('window.holdSend=false');
  const migration=await evaluate(`import('./model-settings.mjs').then(({migrateModelSettings:f})=>({old:f({'chat-backend':'litert-cpu','chat-context':'8192'}),saved:f({'chat-pipeline':'cpu-cpu'})}))`);
  assert.equal(migration.old['chat-pipeline'],'gpu-npu');assert.equal(migration.old['chat-context'],'8192');assert(!('chat-backend' in migration.old));assert.equal(migration.saved['chat-pipeline'],'cpu-cpu');
  await evaluate('window.debugTabs.select("chat");window.debugWorkspace.section("chat-panel","run")');
  const scrollCheck=await evaluate(`import('./stream-message.mjs').then(({streamMessage})=>{const p=document.querySelector('#chat-panel'),log=document.querySelector('#chat-log');log.replaceChildren();const message=streamMessage(log,'assistant','Long reply. '.repeat(1200));p.scrollTop=0;message.update('Long reply. '.repeat(1300),'Reasoning. '.repeat(100));const held=p.scrollTop===0;p.scrollTop=p.scrollHeight;message.update('Long reply. '.repeat(1400),'Reasoning. '.repeat(100));return {held,follows:p.scrollHeight-p.clientHeight-p.scrollTop<5}})`);
  await evaluate('document.querySelector("#chat-panel").scrollTop=220');
  const previousScroll=await evaluate('document.querySelector("#chat-panel").scrollTop');
  await evaluate('window.debugTabs.select("pocket");window.debugTabs.select("chat")');
  assert.equal(await evaluate('document.querySelector("#chat-panel").scrollTop'),previousScroll,'Switching modules discarded reading position');
  assert(scrollCheck.held&&scrollCheck.follows,'Streaming scroll did not respect reading position');
  const report={passed:true,phoneTest:false,moduleLayoutsChecked:layoutChecks,oneScrollOwnerPerModule:true,chatLeaveCancelsOwnResponse:true,savedPipelineMigration:true,streamScrollRespectsReader:scrollCheck,qatBackendSelectors:true,splitEncoderForwardedPersistedAndShared:true,llamaMemoryPresetForwardedAndPersisted:true,diskPrefixControls:true,diskPrefixMetrics:true,promptTreeEditsPersist:true,promptTreeResetAndDraftGuard:true,promptStorageErrorsPreserveDraft:true,promptEditorLoadsNoModels:true,browserViewportStableDuringStreaming:true,browserInspectAction:true,eyeLevel,mainBounds,pushToTalkReleaseSends:true,cancelledHoldDoesNotSend:true,enterSettingAndComposition:true,cameraAndMediaMenu:true,voiceStartsBeforeFinalText:true,phraseAppendKeepsOneTake:true,newChatRecoversResponseFailureWithoutReload:true,serialStackStartup:true,gemmaFailureRetained:true,failedStartupRetry:true,cancelledStartupIgnoresLateRelease:true,skinWarmthDefault:true,minimalLaunch:true,mainSeparateFromDebugNine:true,mainMultimodal:true,mainPromptPrefill:true,mainFaceNoArdy:true,mainTorsoRootLocked:true,mainBodyRootAndCamera:true,continuousHeadHandoff:continuity,residentSettingsBridge:true,bridge:'stub',renderer:graphics,faceFollowsPlaybackClock:true,
    twoFingerPan:true,pinchAndRotate:true,cancelledTouchRecovery:true,panSurvivesMotionAndTabSwitch:true,cameraReset:true,appearanceAffectsRenderedAvatar:true,appearancePersists:true,noExtraAppearanceRenderPass:true,
    contextSizeSetting:true,contextPersists:true,contextReloadsConversation:true,contextSharedByLaterTabs:true,faceDistanceDefault:true,idleBreathBlinkSway:true,idleOffSleeps:true,reasoningDefaultOff:true,e4bSelectable:true,visualTokenBudgetForwarded:true,laterTabAudioRouted:true,scheduledCameraAndRoot:true,defaultRelaxedStance:true,nineTabsAndWelcome:true,gemmaOnly:true,modelSettingsForwarded:true,streamedCollapsedReasoning:true,avatarToolSelectsLiveArdyEmbedding:true,avatarToolDoesNotPlayEarly:true,avatarStopAndStaleResults:true,imageAndReasoningControls:true,chatInputAndSafeText:true,chatMetrics:true,browserGoalFollowupAndControls:true,compactBounds,chatBounds,browserBounds,combinedUsesPocketAndFaceSettings:true,rollingFaceClock:true,staleFacialWindowsRejected:true,togetherStartsSelectedArdy:true,headOverlayPreservesBodyPose:true,scheduledCue:true,preparationHoldsMotion:true,audioClockDrivesBody:true,motionCoverageBeforeAudio:true,smoothTailAndIdle:true,repeatedTakesStartAtZero:true,talkBounds,
    realGeneratedMotionFrames:motion.joints.length,finiteTransforms:true,hiddenStopsRenderAndRequests:true,staticRestStopsRendering:true,benchmarkRepeatOptInAndStopsWhenHidden:true,
    staleProfileResultsIgnored:true,pauseResumeKeepsStream:true,pocketStartupLoadsNoAvatar:true,pocketTabStopsAvatarAndMotion:true,pocketSettingsAndMetrics:true,pocketSettingsPersist:true,approvedSpeechBaselineAvailable:true,independentFaceGains:true,zeroGainDisablesGroup:true,declaredEyeBoneDriver:true,faceTimelineAcknowledged:true,bounds,
    limitations:['Native Android service/JNI/audio path is not exercised by this browser check.','No phone timing or thermal claim.']};
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} catch(error) {
  if(socket?.readyState===WebSocket.OPEN){
    const shot=await call('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)await fs.writeFile(path.join(output,'failure.png'),Buffer.from(shot.data,'base64'));
    console.error(await evaluate('({tab:window.debugTabs?.current(),errors:window.validationState?.errors,width:innerWidth,height:innerHeight})').catch(()=>null));
  }
  throw error;
} finally {
  if(socket?.readyState===WebSocket.OPEN){await call('Browser.close').catch(()=>{});socket.close();}
  browser.kill();server.close();
}
