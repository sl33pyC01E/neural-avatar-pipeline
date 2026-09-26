"""Promote the checked metadata-only premade Qwen bundle. No conversion or inference."""
import json
import os
from pathlib import Path
import shutil
from prepare_benchmark import ROOT,OUT,QWEN_LITERT,sha,load_qwen_litert


def main():
    repack=json.loads((ROOT/'validation/qwen-metadata-repack-2026-09-26.json').read_text())
    quality=json.loads((ROOT/'validation/qwen-template-runtime-2026-09-26.json').read_text())
    source=next(row for row in json.loads((ROOT/'benchmark/models.json').read_text())['models'] if row['file']=='Qwen3.5-2B-VL_int8.litertlm')
    if (repack['sourceSha256']!=source['sha256'] or repack['graphExported'] is not False
        or repack['imageSize']!=512 or repack['contextTokens']!=4096
        or not quality['passed'] or quality['sha256']!=repack['sha256']
        or quality['imageSize']!=512 or quality['contextTokens']!=4096):
        raise ValueError('Premade source, metadata report and native quality report must agree')
    if sha(OUT/source['file'])!=source['sha256']:raise ValueError('Premade source checksum mismatch')
    if sha(ROOT/'benchmark/qwen-litert/chat.jinja')!=repack['templateSha256']:raise ValueError('Template changed after verification')
    checked=OUT/repack['file'];target=OUT/QWEN_LITERT
    if checked.stat().st_size!=repack['bytes'] or sha(checked)!=repack['sha256']:raise ValueError('Checked bundle checksum mismatch')
    if not target.exists():
        try:os.link(checked,target)
        except OSError:shutil.copyfile(checked,target)
    if target.stat().st_size!=repack['bytes'] or sha(target)!=repack['sha256']:raise ValueError('Delivery bundle checksum mismatch')
    receipt=dict(repack,file=target.name,usesPrebuiltGraphs=True,visualTokens=256,
        verifiedUnderFileName=repack['file'],sourceArtifact=source,generationQuality=quality,
        metadataChanges='Chat template and thought channel only; weights and compiled graph sections are unchanged',
        phoneQualified=False)
    (ROOT/'benchmark/qwen-litert/prebuilt-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    load_qwen_litert()
    print(json.dumps({key:receipt[key] for key in ('file','bytes','sha256','imageSize','visualTokens','contextTokens','graphExported','usesPrebuiltGraphs')}))


if __name__=='__main__':main()
