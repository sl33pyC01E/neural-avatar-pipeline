// Inspect only the local validation WebView, after adb forward to its debug socket.
// Usage: node check_device.mjs http://127.0.0.1:9229 OUTPUT_DIRECTORY
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const [endpoint, output] = process.argv.slice(2);
if (!output || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Expected localhost CDP endpoint and output directory');
const targets = await fetch(`${endpoint}/json`).then(r => r.json());
const target = targets.find(t => t.url === 'https://appassets.androidplatform.net/assets/index.html' && t.title === 'Cleopatra · Avatar Check');
assert(target, 'Validation WebView is not open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
let id = 0;
const pending = new Map();
socket.onmessage = event => {
  const result = JSON.parse(event.data), waiter = pending.get(result.id);
  if (waiter) { pending.delete(result.id); clearTimeout(waiter.timer); result.error ? waiter.reject(new Error(JSON.stringify(result.error))) : waiter.resolve(result.result); }
};
function call(method,params={}) {
  const next=++id;
  return new Promise((resolve,reject) => {
    const timer=setTimeout(() => { pending.delete(next); reject(new Error(`Timed out: ${method}`)); },10000);
    pending.set(next,{resolve,reject,timer}); socket.send(JSON.stringify({id:next,method,params}));
  });
}
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails)); return result.result.value;
}
await fs.mkdir(output,{recursive:true});
try {
  const ready=await evaluate('window.validationState'); assert(ready.ready,'Avatar has not loaded');
  assert.equal(await evaluate('document.visibilityState'),'visible','Leave Avatar Check visible on the phone before running this check.');
  const modes=[];
  for(const mode of ['rest','turn','replay']) {
    await evaluate(`window.avatarValidation.setMode(${JSON.stringify(mode)})`);
    await new Promise(resolve=>setTimeout(resolve,3400));
    const state=await evaluate('window.validationState');
    assert.equal(state.errors.length,0,JSON.stringify(state.errors)); assert.equal(state.metrics.mode,mode);
    assert(state.metrics.displayFps>20,`Replay display is below motion rate: ${state.metrics.displayFps}`);
    const finite=await evaluate(`(() => { let valid=true; window.avatarValidation.vrm.scene.traverse(n=>{ if(!n.matrixWorld.elements.every(Number.isFinite))valid=false; }); return valid; })()`);
    assert(finite,'Non-finite scene transform');
    const screenshot=await call('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(path.join(output,`${mode}.png`),Buffer.from(screenshot.data,'base64'));
    modes.push(state.metrics);
  }
  const report={recordedAt:new Date().toISOString(),passed:true,purpose:'Offline replay renderer validation; Ardy inference is not connected.',
    provenance:ready.provenance,geometry:ready.after,modes,errors:[],userAgent:await evaluate('navigator.userAgent')};
  await fs.writeFile(path.join(output,'device-check.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { socket.close(); }
