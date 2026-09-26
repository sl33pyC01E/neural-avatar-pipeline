"""Native CPU numerical/operation gate for the final vision graphs; no phone access."""
import argparse
import json
import hashlib
from pathlib import Path
import numpy as np
from ai_edge_litert.interpreter import Interpreter


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('vision',type=Path);a=p.parse_args()
    cached=np.load(a.vision/'native-reference.npz');reference=cached['reference'].astype(np.float64).reshape(-1)
    def run(name,value):
        it=Interpreter(model_path=str(a.vision/name),num_threads=2);it.allocate_tensors()
        forbidden=[op['op_name'] for op in it._get_ops_details() if op['op_name'].upper().startswith(('FLEX','CUSTOM','GATHER'))]
        if forbidden:raise ValueError('Unsupported mobile vision operations: '+str(forbidden))
        tensor=it.get_input_details()[0];it.set_tensor(tensor['index'],value.astype(tensor['dtype']));it.invoke()
        return it.get_tensor(it.get_output_details()[0]['index'])
    rows=[]
    for encoder,adapter,minimum in [('vision_encoder.tflite','vision_adapter.tflite',.9999),('vision_encoder_fp16.tflite','vision_adapter_int8.tflite',.999)]:
        actual=run(adapter,run(encoder,cached['image'])).astype(np.float64).reshape(-1)
        correlation=float(np.corrcoef(actual,reference)[0,1]);passed=bool(np.isfinite(actual).all() and correlation>=minimum)
        hashes={}
        for name in (encoder,adapter):
            with (a.vision/name).open('rb') as stream:hashes[name]=hashlib.file_digest(stream,'sha256').hexdigest()
        rows.append(dict(encoder=encoder,adapter=adapter,sha256=hashes,correlation=correlation,minimum=minimum,maxAbsoluteError=float(np.max(np.abs(actual-reference))),passed=passed))
    receipt=dict(passed=all(row['passed'] for row in rows),checks=rows,scope='768-pixel source vision parity on deterministic noise; no phone performance claim',phoneExecuted=False)
    (a.vision/'parity.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
    if not receipt['passed']:raise SystemExit(1)


if __name__=='__main__':main()
