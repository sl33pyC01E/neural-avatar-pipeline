import * as THREE from 'three';

const presets={
  balanced:{tone:'neutral',exposure:1,fill:1.2,key:2,contrast:1,saturation:1.08,skin:1},
  original:{tone:'none',exposure:1,fill:2,key:2.5,contrast:1,saturation:1,skin:0},
};
const ranges={exposure:[.3,2],fill:[0,3],key:[0,4],contrast:[.6,1.6],saturation:[0,2],skin:[0,2]};
const tones={neutral:THREE.NeutralToneMapping,filmic:THREE.ACESFilmicToneMapping,none:THREE.NoToneMapping};

export function createAppearanceControls(vrm,renderer,fill,key,invalidate) {
  const settings={...presets.balanced};
  try{
    const saved=JSON.parse(localStorage.getItem('cleo-vrm-appearance')||'{}');
    if(Object.hasOwn(tones,saved.tone))settings.tone=saved.tone;
    for(const [name,[min,max]] of Object.entries(ranges))if(Number.isFinite(saved[name]))settings[name]=THREE.MathUtils.clamp(saved[name],min,max);
  }catch{}
  const uniforms={cleoContrast:{value:1},cleoSaturation:{value:1},cleoSkin:{value:settings.skin}};
  const materials=new Set();vrm.scene.traverse(node=>{if(node.isMesh)for(const material of [node.material].flat())materials.add(material);});
  for(const material of materials){
    const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey.bind(material);
    const originalKey=cacheKey();
    material.onBeforeCompile=function(shader,engine){
      compile.call(this,shader,engine);
      Object.assign(shader.uniforms,uniforms);
      // Face/body materials only: preserve hair, clothing and eye colors.
      shader.uniforms.cleoSkin=/^M_Zome_(Skin|Face)(_|$)/.test(material.name)?uniforms.cleoSkin:{value:0};
      if(!shader.fragmentShader.includes('#include <colorspace_fragment>'))throw new Error('Avatar material lacks its color output stage');
      shader.fragmentShader='uniform float cleoContrast;\nuniform float cleoSaturation;\nuniform float cleoSkin;\n'+shader.fragmentShader.replace('#include <colorspace_fragment>',`#include <colorspace_fragment>
        gl_FragColor.rgb *= mix(vec3(1.0), vec3(0.97, 0.92, 0.89), cleoSkin);
        float cleoLuma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor.rgb = clamp((mix(vec3(cleoLuma), gl_FragColor.rgb, cleoSaturation) - 0.5) * cleoContrast + 0.5, 0.0, 1.0);`);
    };
    // Keep MToon's dynamic define key (outline/texture variants) intact.
    material.customProgramCacheKey=()=>`${material.isMToonMaterial?cacheKey():originalKey}|cleo-appearance-v2`;
    material.needsUpdate=true;
  }
  function apply(save=true){
    renderer.toneMapping=tones[settings.tone];renderer.toneMappingExposure=settings.exposure;
    fill.intensity=settings.fill;key.intensity=settings.key;
    uniforms.cleoContrast.value=settings.contrast;uniforms.cleoSaturation.value=settings.saturation;
    uniforms.cleoSkin.value=settings.skin;
    for(const name of Object.keys(ranges)){
      document.querySelector(`#vrm-${name}`).value=settings[name];
      document.querySelector(`#vrm-${name}-value`).textContent=`${settings[name].toFixed(2)}×`;
    }
    document.querySelector('#vrm-tone').value=settings.tone;
    document.querySelector('#vrm-exposure').disabled=settings.tone==='none';
    document.querySelector('#vrm-exposure').title=settings.tone==='none'?'Choose Neutral or Filmic to adjust exposure':'';
    if(save)try{localStorage.setItem('cleo-vrm-appearance',JSON.stringify(settings));}catch{}
    invalidate();
  }
  for(const name of Object.keys(ranges))document.querySelector(`#vrm-${name}`).oninput=event=>{
    const value=Number(event.target.value);if(!Number.isFinite(value))return;
    settings[name]=THREE.MathUtils.clamp(value,...ranges[name]);apply();
  };
  document.querySelector('#vrm-tone').onchange=event=>{if(Object.hasOwn(tones,event.target.value)){settings.tone=event.target.value;apply();}};
  for(const name of Object.keys(presets))document.querySelector(`#vrm-${name}`).onclick=()=>{Object.assign(settings,presets[name]);apply();};
  apply(false);
  return {settings,uniforms,materials};
}
