"""Create golden streaming postprocessing fixtures from the existing desktop LAM source."""
import argparse
import importlib.util
import json
from pathlib import Path
import numpy as np

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args()
spec=importlib.util.spec_from_file_location('lam_reference',a.source/'models/utils.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
rng=np.random.default_rng(721)
previous=np.empty((0,52),dtype=np.float32);previous_volume=np.empty(0,dtype=np.float32)
fixtures=[]
for count in (20,20,32,20,8,1,30):
    raw=rng.random((count,52),dtype=np.float32)
    volume=rng.uniform(.01,.1,count).astype(np.float32)
    volume[:min(9,count)]=0
    if count>=20:volume[12:]=0
    processed=len(previous)
    values=np.concatenate((previous,raw),axis=0)
    full_volume=np.concatenate((previous_volume,volume))
    values=module.smooth_mouth_movements(values,processed,full_volume)
    values=module.apply_frame_blending(values,processed)
    values,_=module.apply_savitzky_golay_smoothing(values,window_length=5)
    values=module.symmetrize_blendshapes(values)
    fixtures.append({'raw':raw.tolist(),'volume':volume.tolist(),'expected':values[processed:].tolist()})
    previous=values[-64:].copy();previous_volume=full_volume[-64:].copy()
a.output.write_text(json.dumps(fixtures),encoding='utf-8')
print(json.dumps({'chunks':len(fixtures),'frames':sum(len(f['raw']) for f in fixtures),'stochasticBlinks':'excluded from exact comparison'}))
