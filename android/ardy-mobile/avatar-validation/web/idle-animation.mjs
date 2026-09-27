import * as THREE from 'three';
// Additive, reversible display animation. No native engines and no inference.
export function createIdleAnimation(vrm){
  const bones=['spine','chest','upperChest'].map(name=>({name,node:vrm.humanoid.getNormalizedBoneNode(name)})).filter(b=>b.node);
  let saved=[],bodyWeight=0;
  function restore(){for(const {node,q} of saved)node.quaternion.copy(q);saved=[];}
  return {restore,apply(time,dt,bodyActive,faceActive){
    const speed=Math.min(1,dt/0.2);bodyWeight+=(Number(!bodyActive)-bodyWeight)*speed;
    for(const {name,node} of bones){
      const gain=bodyWeight;
      saved.push({node,q:node.quaternion.clone()});
      const breath=Math.sin(time*1.45)*.007*gain,sway=Math.sin(time*.63+.4)*.007*gain;
      node.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath,0,sway)));
    }
    vrm.humanoid.update();
  }};
}
