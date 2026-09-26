"""CPU graph export for Cleopatra Qwen; phone inference is deliberately separate."""
import argparse
import json
import mmap
import os
from pathlib import Path
import subprocess
import sys
import time
import hashlib


def graph_contract(path):
    from ai_edge_litert import schema_py_generated as schema
    result=[]
    with path.open('rb') as stream, mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ) as data:
        model=schema.Model.GetRootAsModel(data,0)
        for index in range(model.SignatureDefsLength()):
            signature=model.SignatureDefs(index);graph=model.Subgraphs(signature.SubgraphIndex());inputs={};outputs={}
            for count,item,collection in [(signature.InputsLength(),signature.Inputs,inputs),(signature.OutputsLength(),signature.Outputs,outputs)]:
                for number in range(count):
                    entry=item(number);tensor=graph.Tensors(entry.TensorIndex())
                    collection[entry.Name().decode()]=[tensor.Shape(i) for i in range(tensor.ShapeLength())]
            result.append(dict(signature=signature.SignatureKey().decode(),inputs=inputs,outputs=outputs))
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--work-dir',type=Path,required=True);p.add_argument('--profile',type=Path,required=True)
    p.add_argument('--template',type=Path,required=True);p.add_argument('--stage',choices=['download','vision','decoder','package'],required=True)
    a=p.parse_args();work=a.work_dir.resolve();config=json.loads(a.profile.read_text(encoding='utf-8'))
    size=config['imageSize'];context=config['contextTokens']
    if size%32 or size<256 or size>1024 or context not in (4096,8192,16384):raise ValueError('Unsupported build profile')
    if config['visualTokens']!=(size//32)**2:raise ValueError('Visual token count does not match image graph')
    converter=work/'converter';torch_source=work/'litert-torch'
    for source,key in [(converter,'converterRevision'),(torch_source,'torchRevision')]:
        actual=subprocess.check_output(['git','-c','safe.directory='+str(source),'-C',str(source),'rev-parse','HEAD'],text=True).strip()
        if actual!=config[key]:raise ValueError('Unexpected converter revision: '+actual)
    out=work/'out'/config['name'];out.mkdir(parents=True,exist_ok=True)
    env=dict(os.environ,CUDA_VISIBLE_DEVICES='-1',JAX_PLATFORMS='cpu',OMP_NUM_THREADS='2',MKL_NUM_THREADS='2',OPENBLAS_NUM_THREADS='2',TOKENIZERS_PARALLELISM='false',PYTHONUNBUFFERED='1',PYTHONPATH=str(torch_source))
    source=work/'source'/config['sourceRevision'];vision=out/'vision';decoder=out/'decoder'
    def run(script,*args,**extra):
        log=out/(Path(script).stem+'.log');print('Starting',Path(script).name,flush=True)
        with log.open('w',encoding='utf-8') as stream:
            result=subprocess.run([sys.executable,str(script),*map(str,args)],cwd=converter,env=dict(env,**extra),stdout=stream,stderr=subprocess.STDOUT)
        if result.returncode:raise RuntimeError(str(script)+' failed; see '+str(log))
    if a.stage in ('download','all'):
        from huggingface_hub import snapshot_download
        snapshot_download(config['sourceModel'],revision=config['sourceRevision'],local_dir=source,
                          allow_patterns=['*.json','*.safetensors','*.jinja','*.txt'],max_workers=2)
    if a.stage in ('vision','decoder','package','all') and not (source/'config.json').is_file():raise ValueError('Download the pinned source model first')
    started=time.time()
    if a.stage in ('vision','all'):
        if not (vision/'native-reference.npz').is_file():raise ValueError('Run the native vision preparation first; see benchmark/qwen-litert/README.md')
        from split_qwen_vision import generate
        derived=work/'vision_split.py';split_receipt=generate(converter,derived)
        (out/'vision-recipe.json').write_text(json.dumps(split_receipt,indent=2)+'\n')
        run(derived,vision,MODEL=str(source),IMG=str(size),VISION_STAGE='compile',CLEO_CONVERTER=str(converter))
        result=json.loads((vision/'result.json').read_text())
        if not result.get('ok'):raise ValueError('Vision export failed: '+json.dumps(result))
    if a.stage in ('decoder','all'):
        run(converter/'qwen35vl_work/export_qwen35vl_decoder.py',source,decoder,CACHE=str(context),PREFILL=','.join(map(str,config['prefillLengths'])))
    if a.stage in ('package','all'):
        from split_qwen_vision import generate
        derived=work/'vision_split.audit.py';recipe=generate(converter,derived)
        if hashlib.sha256((work/'vision_split.py').read_bytes()).hexdigest()!=recipe['derivedSha256']:
            raise ValueError('The vision compiler recipe differs from the pinned derivation')
        (out/'vision-recipe.json').write_text(json.dumps(recipe,indent=2)+'\n')
        parity=json.loads((vision/'parity.json').read_text())
        if not parity.get('passed'):raise ValueError('Native vision parity gate did not pass')
        for row in parity['checks']:
            for name,expected in row['sha256'].items():
                with (vision/name).open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
                if actual!=expected:raise ValueError('Vision graph changed after parity: '+name)
        contracts={name:graph_contract(path) for name,path in {
            'encoder':vision/'vision_encoder_fp16.tflite','adapter':vision/'vision_adapter_int8.tflite',
            'decoder':decoder/'prefill_decode_wi8.tflite','embedder':decoder/'embedder_wi8.tflite'}.items()}
        encoder_shapes=[shape for row in contracts['encoder'] for shape in row['inputs'].values()]
        if [1,size,size,3] not in encoder_shapes:raise ValueError('Vision graph does not match requested size')
        adapter_shapes=[shape for row in contracts['adapter'] for shape in row['outputs'].values()]
        if [1,config['visualTokens'],2048] not in adapter_shapes:raise ValueError('Visual token graph mismatch')
        for signature in contracts['decoder']:
            caches=[shape for name,shape in signature['inputs'].items() if 'kv_cache' in name and context in shape]
            if len(caches)!=12:raise ValueError('Expected 12 attention key/value caches at requested capacity: '+str(signature))
        (out/'graph-contracts.json').write_text(json.dumps(contracts,indent=2)+'\n',encoding='utf-8')
        run(converter/'qwen35vl_work/build_qwen35vl_bundle.py',DEC=str(decoder),VIS=str(vision),OUT_DIR=str(out),
            OUT_NAME='unbound.litertlm',TOK=str(source/'tokenizer.json'),IMAGE_SIZE=str(size),CACHE=str(context),
            VENC='vision_encoder_fp16.tflite',VADP='vision_adapter_int8.tflite',DEC_ACT='fp32')
        run(converter/'scripts/add_executor_metadata.py',out/'unbound.litertlm',out/'bound.litertlm')
        from repack_qwen_litert import repack
        receipt=repack(out/'bound.litertlm',out/(config['name']+'.litertlm'),a.template.read_text(encoding='utf-8'))
        receipt.update(graphExported=True,profile=config,graphContracts=contracts,visionParity=parity,packagingWallSeconds=time.time()-started,
                       phoneQualified=False,qualification='Pending user runs on Android; CPU conversion checks are not phone benchmarks.')
        receipt['visionRecipe']=recipe
        receipt['toolchainSha256']={name:hashlib.sha256((work/name).read_bytes()).hexdigest() for name in
            ('build-requirements.lock','build_qwen_litert.py','split_qwen_vision.py','repack_qwen_litert.py','check_qwen_template.py','inspect_litert.py')}
        receipt['torchPatchSha256']=hashlib.sha256(subprocess.check_output(['git','-c','safe.directory='+str(torch_source),'-C',str(torch_source),'diff','--binary'])).hexdigest()
        receipt['sourceWeights']={}
        for path in source.glob('*.safetensors'):
            with path.open('rb') as stream:receipt['sourceWeights'][path.name]=hashlib.file_digest(stream,'sha256').hexdigest()
        (out/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(receipt),flush=True)


if __name__=='__main__':main()
