"""Compare actual C++ frontend output with the faster-whisper NumPy frontend."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import numpy as np


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    spec=importlib.util.spec_from_file_location('reference',a.reference);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    reference=module.FeatureExtractor();rows=[]
    for name,audio in [('silence',np.zeros(16000,np.float32)),('tones',(.2*np.sin(np.arange(32000)*2*np.pi*440/16000)+.1*np.sin(np.arange(32000)*2*np.pi*1700/16000)).astype(np.float32)),('noise',np.random.default_rng(47).normal(0,.05,480000).astype(np.float32))]:
        source=a.out/(name+'.f32');target=a.out/(name+'-mel.f32');audio.tofile(source)
        subprocess.run([str(a.binary.resolve()),str(source),str(target)],check=True)
        actual=np.fromfile(target,np.float32).reshape(80,3000)
        padded=np.pad(audio,(0,480000-len(audio)))
        expected=reference(padded,padding=0)[:,:3000]
        error=float(np.max(np.abs(actual-expected)));rows.append(dict(case=name,maxAbsoluteError=error,passed=error<1e-4))
    result=dict(passed=all(row['passed'] for row in rows),cases=rows,referenceSha256=hashlib.sha256(a.reference.read_bytes()).hexdigest(),phoneExecuted=False)
    (a.out/'report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
    if not result['passed']:raise SystemExit(1)


if __name__=='__main__':main()
