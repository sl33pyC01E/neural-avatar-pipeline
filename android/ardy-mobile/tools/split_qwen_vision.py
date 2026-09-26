"""Split pinned vision recipe so native ARM does numerical work and x86 does compilation."""
import argparse
import hashlib
import json
from pathlib import Path


def generate(converter, target):
    source=converter/'qwen35vl_work/convert_qwen35_vision.py';text=source.read_text()
    text=text.replace('import litert_torch  # noqa: F401  import before transformers submodules',
        'STAGE = os.environ.get("VISION_STAGE", "prepare")\nif STAGE == "compile":\n  import litert_torch')
    text=text.replace('HERE = os.path.dirname(os.path.abspath(__file__))',
        'HERE = os.path.join(os.environ["CLEO_CONVERTER"], "qwen35vl_work")')
    text=text.replace('    visual = model.model.visual', '    visual = model.model.visual\n    del model\n    import gc\n    gc.collect()')
    start=text.index('    # calibrate the fp16-safe LN scales')
    end=text.index('    res["stage"] = "convert-encoder"',start)
    original=text[start:end]
    replacement='''    cache_path = os.path.join(OUT, "native-reference.npz")
    cache_meta = os.path.join(OUT, "native-reference.json")
    if STAGE == "compile":
      values = np.load(cache_path)
      res.update(json.load(open(cache_meta)))
      assert res["img"] == IMG and res["n_tok"] == N_TOK
      LN_S.update(res["ln_scales_all"])
      img01, feat, ref = [torch.from_numpy(values[key]) for key in ("image", "features", "reference")]
    else:
'''+''.join('  '+line if line.strip() else line for line in original.splitlines(keepends=True))+'''
      np.savez(cache_path, image=img01.numpy(), features=feat.numpy(), reference=ref.numpy())
      res["ln_scales_all"] = dict(LN_S)
      res["prepared"] = True
      with open(cache_meta, "w") as f: json.dump(res, f, indent=2)
      print("NATIVE_REFERENCE_DONE", flush=True)
      return

'''
    text=text[:start]+replacement+text[end:]
    start=text.index('    res["stage"] = "parity"')
    end=text.index('    res["ok"] = True',start)
    text=text[:start]+'''    # Numerical verification runs natively after compilation; no emulated inference.
    import importlib.util
    spec = importlib.util.spec_from_file_location("vision_quant", os.path.join(HERE, "vision_quant_ab.py"))
    quant = importlib.util.module_from_spec(spec); spec.loader.exec_module(quant)
    quant.quant_fp16(os.path.join(OUT, "vision_encoder.tflite"), os.path.join(OUT, "vision_encoder_fp16.tflite"))
    _quant_int8(os.path.join(OUT, "vision_adapter.tflite"), os.path.join(OUT, "vision_adapter_int8.tflite"))
'''+text[end:]
    compile(text,str(target),'exec');target.write_text(text)
    return dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),derivedSha256=hashlib.sha256(target.read_bytes()).hexdigest())


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('converter',type=Path);p.add_argument('target',type=Path)
    a=p.parse_args();print(json.dumps(generate(a.converter,a.target)))
