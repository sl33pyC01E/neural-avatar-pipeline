import * as THREE from 'three';

export function createCameraControls(canvas,camera,invalidate,onManual=()=>{}) {
  const bodyDefault={yaw:.18,pitch:1.4,radius:3.4,height:.78,pan:[0,0,0]};
  let state=structuredClone(bodyDefault),body,face,faceDefault,isFace=false;
  const points=new Map(),target=new THREE.Vector3();
  const snapshot=()=>({...state,pan:[...state.pan]});
  const release=event=>points.delete(event.pointerId);
  canvas.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    onManual();canvas.setPointerCapture(event.pointerId);points.set(event.pointerId,[event.clientX,event.clientY]);
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,release);
  window.addEventListener('blur',()=>points.clear());
  const zoom=ratio=>{state.radius=THREE.MathUtils.clamp(state.radius*ratio,.3,7);};
  canvas.addEventListener('pointermove',event=>{
    const old=points.get(event.pointerId);if(!old)return;
    const before=[...points.values()].slice(0,2);
    points.set(event.pointerId,[event.clientX,event.clientY]);
    if(points.size===1){
      state.yaw-=(event.clientX-old[0])*.008;
      state.pitch=THREE.MathUtils.clamp(state.pitch-(event.clientY-old[1])*.008,.3,2.6);
    }else{
      const after=[...points.values()].slice(0,2);
      const dx=(after[0][0]+after[1][0]-before[0][0]-before[1][0])/2;
      const dy=(after[0][1]+after[1][1]-before[0][1]-before[1][1])/2;
      const scale=2*state.radius*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(1,canvas.clientHeight);
      const {yaw,pitch}=state;
      const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
      const up=new THREE.Vector3(-Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),-Math.cos(pitch)*Math.cos(yaw));
      const pan=new THREE.Vector3(...state.pan).addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);
      state.pan=pan.clampLength(0,8).toArray();
      const distance=p=>Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);
      const previous=distance(before),next=distance(after);
      if(previous>1&&next>1)zoom(previous/next);
    }
    invalidate();
  });
  canvas.addEventListener('wheel',event=>{event.preventDefault();onManual();zoom(Math.exp(event.deltaY*.001));invalidate();},{passive:false});
  return {
    snapshot,
    direction:()=>({yaw:THREE.MathUtils.radToDeg(state.yaw),elevation:90-THREE.MathUtils.radToDeg(state.pitch),distance:state.radius,height:state.height+state.pan[1],pan_x:state.pan[0],pan_z:state.pan[2]}),
    applyDirection(value){if(!value)return;state={yaw:THREE.MathUtils.degToRad(value.yaw),pitch:THREE.MathUtils.degToRad(90-value.elevation),radius:value.distance,height:value.height,pan:[value.pan_x,0,value.pan_z]};},
    clearPointers(){points.clear();},
    reset(){onManual();state=structuredClone(isFace?faceDefault:bodyDefault);points.clear();invalidate();},
    setFaceView(value,height){
      if(isFace===value)return;
      points.clear();
      if(value){body=snapshot();faceDefault??={yaw:.05,pitch:1.5,radius:.62,height,pan:[0,0,0]};face??=structuredClone(faceDefault);}
      else face=snapshot();
      state=structuredClone(value?face:body);isFace=value;invalidate();
    },
    update(root){
      const {yaw,pitch,radius,height,pan}=state;
      target.set(root[0]+pan[0],height+pan[1],root[2]+pan[2]);
      camera.position.set(target.x+radius*Math.sin(pitch)*Math.sin(yaw),target.y+radius*Math.cos(pitch),target.z+radius*Math.sin(pitch)*Math.cos(yaw));
      camera.lookAt(target);
    },
  };
}
