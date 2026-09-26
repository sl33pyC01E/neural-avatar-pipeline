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
const server=http.createServer(async(req,res)=>{
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
    const file=path.resolve(assets,name);assert(file.startsWith(assets+path.sep));
    const mime=/\.(mjs|js)$/.test(name)?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'application/octet-stream';
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
    window.bridgeRequests=0;window.testClock=0;
    const emit=value=>setTimeout(()=>window.cleoEvent?.(value),10);
    window.Cleo={state(){emit({type:'state',pocketClip:true,lastProfile:'core40',bank:[{id:'bank:check',text:'Recorded Ardy generation'}],llmNative:true,llmModel:true,core8:true,core40:true,memoryBudgetMiB:6144});},
      start(profile,embedding,stream){if(stream!==currentStream)cursor=0;currentProfile=profile;currentStream=stream;window.lastStartedStream=stream;run=true;paused=false;emit({type:'configured'});},stop(){run=false;},pause(){paused=true;},
      startPerformance(profile,embedding,stream){window.performanceStarts=(window.performanceStarts||0)+1;window.Cleo.start(profile,embedding,stream);},
      next(){if(!run||paused)return false;window.bridgeRequests++;const start=cursor,count=currentProfile==='core40'?40:8;if(start+count>source.joints.length)return false;cursor+=count;
        const batch={type:'motion',streamId:currentStream,profile:currentProfile,startFrame:start,frames:count,jointCount:27,fps:20,generationMs:20,joints:source.joints.slice(start,start+count).flat(2),roots:source.rootPositions.slice(start,start+count).flat(),rotations:source.rotations.slice(start,start+count).flat(3)};window.lastBatch=batch;emit(batch);return true;},
      tab(value){window.nativeTab=value;},playbackSeconds(){return window.testClock;},embed(){},
      speak(...args){window.speechArguments=args;emit({type:'speechStart',message:'Pocket only'});setTimeout(()=>{
        emit({type:'pocketMetrics',warm:true,loadMs:1,firstChunkMs:120,computeRtf:.4,audioSeconds:2});emit({type:'speechEnd',message:'Anna ready'});},50);},
      speakWithFace(...args){window.talkArguments=args;window.testClock=-1;emit({type:'speechStart',tab:window.nativeTab,withFace:true,streamId:'pipe-check',cueSeconds:args[6],tailSeconds:args[7],message:'Pipeline check'});},
      animateLastClip(){window.faceRequested=true;},faceReady(run){window.faceReadyRun=run;},quiet(){},memoryBudget(){},importModels(){}};`});
  await call('Page.navigate',{url});
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.debugTabs)'))break;await sleep(100);}
  assert.equal(await evaluate('window.debugTabs.current()'),'welcome');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-tab]")].map(b=>b.dataset.tab)'),['welcome','pocket','face','talk','avatar','full']);
  assert(await evaluate('!window.avatarValidation&&!performance.getEntriesByType("resource").some(r=>r.name.endsWith("cleopatra.vrm"))'),'Pocket startup loaded the avatar');
  const welcomeImage=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'welcome-tab.png'),Buffer.from(welcomeImage.data,'base64'));
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
  const graphics=await evaluate('(()=>{const gl=window.avatarValidation.renderer.getContext(),ext=gl.getExtension("WEBGL_debug_renderer_info");return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):"unknown"})()');
  assert(/swiftshader/i.test(graphics),'CPU renderer not selected: '+graphics);
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
  await evaluate('document.querySelector("#face-settings").open=true');await sleep(120);
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
  await evaluate(`window.cleoEvent({type:'performanceTail',tab:'full',withFace:true,streamId:'pipe-check',runId:'tail-window',audioSeconds:1,requiredMotionSeconds:2.5})`);await sleep(150);
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
  const report={passed:true,phoneTest:false,bridge:'stub',renderer:graphics,faceFollowsPlaybackClock:true,
    sixTabsAndWelcome:true,combinedUsesPocketAndFaceSettings:true,rollingFaceClock:true,staleFacialWindowsRejected:true,togetherStartsSelectedArdy:true,headOverlayPreservesBodyPose:true,scheduledCue:true,preparationHoldsMotion:true,audioClockDrivesBody:true,motionCoverageBeforeAudio:true,smoothTailAndIdle:true,repeatedTakesStartAtZero:true,talkBounds,
    realGeneratedMotionFrames:motion.joints.length,finiteTransforms:true,hiddenStopsRenderAndRequests:true,staticRestStopsRendering:true,
    staleProfileResultsIgnored:true,pauseResumeKeepsStream:true,pocketStartupLoadsNoAvatar:true,pocketTabStopsAvatarAndMotion:true,pocketSettingsAndMetrics:true,pocketSettingsPersist:true,approvedSpeechBaselineAvailable:true,independentFaceGains:true,zeroGainDisablesGroup:true,declaredEyeBoneDriver:true,faceTimelineAcknowledged:true,bounds,
    limitations:['Native Android service/JNI/audio path is not exercised by this browser check.','No phone timing or thermal claim.']};
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
  if(socket?.readyState===WebSocket.OPEN){await call('Browser.close').catch(()=>{});socket.close();}
  browser.kill();server.close();
}
