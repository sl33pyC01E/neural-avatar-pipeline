"""Check delivery orchestration with fake SSH/ADB; no network or phone access."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import finish_qwen_delivery as delivery


profile=json.loads((delivery.ROOT/'benchmark/qwen-litert/profile.json').read_text())
payload=b'fixture model bytes';digest=hashlib.sha256(payload).hexdigest()
receipt=dict(file=profile['name']+'.litertlm',profile=profile,graphExported=True,
    imageSize=768,contextTokens=8192,bytes=len(payload),sha256=digest,
    visionParity=dict(passed=True),generationQuality=dict(passed=True,sha256=digest,imageSize=768,contextTokens=8192))
delivery.validate_receipt(receipt,profile)
for key,value in [('file','reference.litertlm'),('imageSize',512),('contextTokens',4096),('graphExported',False),('sha256','invalid'),('bytes',0)]:
    invalid=copy.deepcopy(receipt);invalid[key]=value
    try:delivery.validate_receipt(invalid,profile)
    except ValueError:pass
    else:raise AssertionError('Accepted invalid '+key)
for field in ('generationQuality','visionParity'):
    invalid=copy.deepcopy(receipt);invalid[field]['passed']=False
    try:delivery.validate_receipt(invalid,profile)
    except ValueError:pass
    else:raise AssertionError('Accepted failed '+field)
invalid=copy.deepcopy(receipt);invalid['generationQuality']['sha256']='0'*64
try:delivery.validate_receipt(invalid,profile)
except ValueError:pass
else:raise AssertionError('Accepted a different artifact quality report')

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);out=root/'payloads/benchmark'
    (root/'benchmark/qwen-litert').mkdir(parents=True);(root/'validation').mkdir()
    (root/'benchmark/qwen-litert/profile.json').write_text(json.dumps(profile))
    calls=[];polls=[]
    def output(command,**kwargs):
        calls.append(command)
        if command[0]=='ssh':
            if command[-1].endswith('finish-status.json'):
                polls.append(1)
                return json.dumps(dict(stage='ready' if len(polls)>1 else 'waiting-for-decoder',profile=profile['name'],sha256=digest))
            if command[-1].endswith('build-receipt.json'):return json.dumps(receipt)
        if command==['fake-adb','devices','-l']:
            return 'List of devices attached\nwrong device model:Other transport_id:1\nright device model:Phone transport_id:2\n'
        if command[0]=='fake-adb' and command[3:]==['shell','getprop','ro.serialno']:
            return 'TEST-PHONE' if command[2]=='2' else 'OTHER-PHONE'
        raise AssertionError('Unexpected command '+repr(command))
    def run(command,**kwargs):
        calls.append(command);assert command[0]=='scp'
        Path(command[-1]).write_bytes(payload)
    with patch.object(delivery,'ROOT',root),patch.object(delivery,'OUT',out),patch.object(delivery.subprocess,'check_output',side_effect=output),patch.object(delivery.subprocess,'run',side_effect=run),patch.object(delivery.time,'sleep'),patch.object(delivery,'install') as install,patch('sys.argv',['finish_qwen_delivery.py','--adb','fake-adb','--serial','TEST-PHONE']),contextlib.redirect_stdout(io.StringIO()):
        delivery.main()
    install.assert_called_once_with('fake-adb','2',[receipt])
    assert (out/receipt['file']).read_bytes()==payload
    assert json.loads((out/'qwen-delivery-status.json').read_text())['stage']=='ready'
    assert len(list((root/'validation').glob('provisioning-qwen-litert-*.json')))==1
    assert len(polls)==2
print(json.dumps(dict(passed=True,phoneExecuted=False,networkAccess=False,invalidProfilesRejected=True,failedQualityRejected=True,artifactHashVerified=True,deviceSerialMatched=True,provisioningAfterBuildOnly=True)))
