"""Repair the January export's traced 24,960-sample reference padding target.

The original ONNX Pad receives 24960 - audio_length: references longer than
1.04 seconds are cropped, silently discarding most of Anna. Replace only that
traced scalar with ceil(audio_length / 1920) * 1920, Pocket's frame alignment.
Weights and subsequent encoder nodes are unchanged. CPU-only regression checks.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper
import onnxruntime as ort

SOURCE_SHA='e8f2f6d301ffb96e398b138a7dc6d3038622d236044636b73d920bab85890260'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def repair(source,destination):
    if sha(source)!=SOURCE_SHA:
        raise ValueError('Unknown Pocket encoder; inspect its graph before patching')
    model=onnx.load(source)
    nodes=list(model.graph.node)
    index=next(i for i,n in enumerate(nodes) if n.name=='/Constant_2')
    traced=nodes[index]
    assert traced.op_type=='Constant' and int(numpy_helper.to_array(traced.attribute[0].t))==24960
    assert nodes[index+1].op_type=='Sub' and list(nodes[index+1].input)==['/Constant_2_output_0','/Gather_output_0']
    additions=[
        helper.make_node('Constant',[],['cleo_frame'],value=numpy_helper.from_array(np.array(1920,np.int64)),name='CleoFrameSamples'),
        helper.make_node('Constant',[],['cleo_frame_minus_one'],value=numpy_helper.from_array(np.array(1919,np.int64)),name='CleoCeilOffset'),
        helper.make_node('Add',['/Gather_output_0','cleo_frame_minus_one'],['cleo_rounded_numerator'],name='CleoCeilNumerator'),
        helper.make_node('Div',['cleo_rounded_numerator','cleo_frame'],['cleo_frames'],name='CleoFrameCount'),
        helper.make_node('Mul',['cleo_frames','cleo_frame'],list(traced.output),name='CleoDynamicPaddedLength'),
    ]
    del model.graph.node[:]
    model.graph.node.extend(nodes[:index]+additions+nodes[index+1:])
    onnx.checker.check_model(model)
    destination.parent.mkdir(parents=True,exist_ok=True)
    onnx.save(model,destination)
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    original=ort.InferenceSession(str(source),options,providers=['CPUExecutionProvider'])
    fixed=ort.InferenceSession(str(destination),options,providers=['CPUExecutionProvider'])
    rng=np.random.default_rng(17)
    lengths=[24000,48000,240000,301720]
    rows=[]
    for length in lengths:
        audio=rng.normal(0,.04,(1,1,length)).astype(np.float32)
        before=original.run(None,{'audio':audio})[0]
        after=fixed.run(None,{'audio':audio})[0]
        assert before.shape==(1,13,1024)
        assert after.shape==(1,(length+1919)//1920,1024)
        assert np.isfinite(after).all()
        if length==24000:np.testing.assert_array_equal(before,after)
        rows.append({'samples':length,'oldFrames':before.shape[1],'fixedFrames':after.shape[1]})
    audio=rng.normal(0,.04,(1,1,48000)).astype(np.float32)
    altered=audio.copy();altered[:,:,24960:]*=-1
    old_a=original.run(None,{'audio':audio})[0];old_b=original.run(None,{'audio':altered})[0]
    new_a=fixed.run(None,{'audio':audio})[0];new_b=fixed.run(None,{'audio':altered})[0]
    np.testing.assert_array_equal(old_a,old_b)
    tail_change=float(np.max(np.abs(new_a-new_b)));assert tail_change>1e-3
    return {'passed':True,'device':'Windows CPU','sourceSha256':SOURCE_SHA,'repairedSha256':sha(destination),
            'repair':'Dynamic ceil(length / 1920) * 1920 padding target; weights unchanged',
            'lengthChecks':rows,'originalDiscardsReferenceAfterSamples':24960,
            'repairedReferenceTailChangesConditioning':tail_change,'oneSecondOutputBitExact':True,
            'phoneTest':False,'perceptualQualityVerified':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path);p.add_argument('--report',type=Path,required=True)
    args=p.parse_args();result=repair(args.source,args.destination)
    args.report.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
