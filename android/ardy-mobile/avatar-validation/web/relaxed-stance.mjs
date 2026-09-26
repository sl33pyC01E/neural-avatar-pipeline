import * as THREE from 'three';
// A static display pose. The retargeter's calibration and Ardy history stay untouched.
// Work in world space so VRM0/VRM1 orientation and local bone axes do not swap arm signs.
export function relaxedStance(vrm){
  const node=name=>vrm.humanoid.getNormalizedBoneNode(name);
  const point=bone=>bone.getWorldPosition(new THREE.Vector3());
  const chest=node('chest')||node('spine');
  if(!chest)return;
  vrm.scene.updateMatrixWorld(true);
  const up=new THREE.Vector3(0,1,0),right=point(node('leftUpperArm')).sub(point(node('rightUpperArm'))).normalize();
  const forward=new THREE.Vector3().crossVectors(right,up).normalize();
  function aim(name,childName,direction){
    const bone=node(name),child=node(childName);if(!bone||!child)return;
    const current=point(child).sub(point(bone)).normalize();
    const delta=new THREE.Quaternion().setFromUnitVectors(current,direction.normalize());
    const world=bone.getWorldQuaternion(new THREE.Quaternion());
    const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(delta.multiply(world)));bone.updateMatrixWorld(true);
  }
  for(const [side,sign] of [['left',1],['right',-1]]){
    aim(`${side}UpperArm`,`${side}LowerArm`,up.clone().negate().addScaledVector(right,.22*sign));
    aim(`${side}LowerArm`,`${side}Hand`,up.clone().negate().addScaledVector(right,.13*sign).addScaledVector(forward,.18));
  }
  vrm.humanoid.update();vrm.scene.updateMatrixWorld(true);
}
