import * as THREE from 'three';
// Additive, reversible display animation. No native engines and no inference.
export function createIdleAnimation(vrm){
  const bones=['spine','chest','upperChest','neck','head'].map(name=>({name,node:vrm.humanoid.getNormalizedBoneNode(name)})).filter(b=>b.node);
  let saved=[],blinkSaved=null,bodyWeight=0,faceWeight=0;
  function restore(){for(const {node,q} of saved)node.quaternion.copy(q);saved=[];if(blinkSaved!==null){vrm.expressionManager?.setValue('blink',blinkSaved);blinkSaved=null;}}
  return {restore,apply(time,dt,bodyActive,faceActive){
    const speed=Math.min(1,dt/0.2);bodyWeight+=(Number(!bodyActive)-bodyWeight)*speed;faceWeight+=(Number(!faceActive)-faceWeight)*speed;
    for(const {name,node} of bones){
      const isHead=name==='head'||name==='neck';if(isHead&&faceActive)continue;
      const gain=isHead?bodyWeight*faceWeight*.55:bodyWeight;
      saved.push({node,q:node.quaternion.clone()});
      const breath=Math.sin(time*1.45)*.007*gain,sway=Math.sin(time*.63+.4)*.007*gain;
      node.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath,isHead?Math.sin(time*.43)*.012*gain:0,sway)));
    }
    if(!faceActive&&vrm.expressionManager?.getExpression('blink')){
      blinkSaved=vrm.expressionManager.getValue('blink')||0;
      const phase=time%4.7,blink=Math.max(0,1-Math.abs(phase-4.25)/.12)*faceWeight;
      vrm.expressionManager.setValue('blink',Math.max(blinkSaved,blink));
    }
    vrm.humanoid.update();
  }};
}
