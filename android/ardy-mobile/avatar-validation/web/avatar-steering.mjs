import * as THREE from 'three';
/** Reversible local offsets applied after animation; no accumulating joint rotations. */
export function createAvatarSteering(vrm){
  const torso=vrm.humanoid.getNormalizedBoneNode('chest')||vrm.humanoid.getNormalizedBoneNode('spine'),head=vrm.humanoid.getNormalizedBoneNode('head');
  const up=new THREE.Vector3(0,1,0);let saved=null,headYaw=0;
  return {restore(){if(!saved)return;torso?.quaternion.copy(saved.torso);head?.quaternion.copy(saved.head);saved=null;},
    apply(value,camera,dt){
      saved={torso:torso?.quaternion.clone(),head:head?.quaternion.clone()};
      torso?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up,(value.torso_yaw||0)*Math.PI/180));
      let target=(value.head_yaw||0)*Math.PI/180;
      if(head&&value.head_reference==='camera'){
        vrm.humanoid.update();head.updateWorldMatrix(true,false);
        // VRM's declared forward/look-at offset handles VRM0 and VRM1 orientation.
        if(vrm.lookAt){vrm.lookAt.lookAt(camera);target+=vrm.lookAt.yaw*Math.PI/180;}
      }
      target=THREE.MathUtils.clamp(target,-70*Math.PI/180,70*Math.PI/180);
      headYaw+=(target-headYaw)*(1-Math.exp(-dt*7));
      head?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up,headYaw));vrm.humanoid.update();
    }
  };
}
