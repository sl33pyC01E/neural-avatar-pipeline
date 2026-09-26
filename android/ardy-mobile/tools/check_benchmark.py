"""Host-only protocol/scoring checks. Does not connect to a device or load models."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from benchmark_score import score_image,score_audio,image_prompt
from run_phone_benchmark import summarize,workload_intervals,NativeServer,LiteRT,ROOT

case=dict(width=1080,height=2400,targetBox=[400,1000,600,1300],expectedAction='tap')
pixel=json.dumps(dict(action='tap',point=[500,1150],box=case['targetBox']))
norm=json.dumps(dict(action='tap',point=[500/1080*1000,1150/2400*1000],box=[400/1080*1000,1000/2400*1000,600/1080*1000,1300/2400*1000]))
assert score_image(pixel,case,'pixels')['correct']
assert score_image(norm,case,'norm1000')['correct']
assert abs(score_image(norm,case,'norm1000')['boxIou']-1)<1e-10
assert not score_image(pixel,case,'norm1000')['correct']
for value in ['{}','not json','{"action":"tap","point":[NaN,0],"box":[0,0,1,1]}',
              '{"action":"tap","point":[500,1150],"box":[600,1300,400,1000]}']:
    assert not score_image(value,case,'pixels')['valid']
assert not score_image('{"action":"none"}',case,'pixels')['correct']
assert score_image('{"action":"none"}',dict(case,expectedAction='none',targetBox=None),'norm1000')['correct']
assert score_audio('ONE TWO',dict(reference='One, two.'))['wer']==0
assert score_audio('one three',dict(reference='one two'))['wer']==.5
assert score_audio('hallucination',dict(reference=''))['silenceHallucination']
assert score_audio('',dict(reference=''))['wer'] is None
report=summarize([dict(modality='image',coordinates='pixels',result=dict(wallMs=10),score=dict(correct=True)),dict(modality='image',coordinates='pixels',error='failure')])
assert report['image-pixels']['actionAccuracy']==.5
assert workload_intervals([dict(type='speechStart',elapsedRealtimeMs=10),dict(type='traceStop',elapsedRealtimeMs=20)])==[(10,20)]
assert workload_intervals([dict(type='speechStart',elapsedRealtimeMs=10),dict(type='motion',elapsedRealtimeMs=15)])==[(10,15)]
# Exercise the actual response adapters without HTTP, ADB or any inference.
fixture=next(c for c in json.loads((ROOT/'benchmark/fixtures.json').read_text())['cases'] if c['modality']=='image')
class Response:
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def raise_for_status(self):pass
    def iter_lines(self,**kwargs):
        for value in [dict(cleoBenchmark=dict(elapsedMs=40,complete=False)),
            dict(choices=[dict(delta=dict(content='answer'))]),
            dict(cleoBenchmark=dict(elapsedMs=100,complete=True))]:
            yield b'data: '+json.dumps(value).encode()
        yield b'data: [DONE]'
    def json(self):return dict(text='one two',deviceRequestMs=120)
with tempfile.TemporaryDirectory() as directory:
    server=NativeServer.__new__(NativeServer);server.logpath=Path(directory)/'mock.log';server.logpath.write_bytes(b'')
    server.url='mock://no-network'
    with patch('run_phone_benchmark.requests.post',return_value=Response()):
        answer=server.chat('test',fixture,False,0)
        assert answer['text']=='answer' and answer['deviceRequestMs']==100 and answer['deviceFirstTokenMs']==40
        audio=next(c for c in json.loads((ROOT/'benchmark/fixtures.json').read_text())['cases'] if c['modality']=='audio')
        assert server.transcribe(audio)['deviceRequestMs']==120
adapter=LiteRT.__new__(LiteRT);adapter.request=lambda value:dict(text='answer',inferMs=90,firstTokenMs=30)
answer=adapter.chat('test',fixture,False,0)
assert answer['deviceRequestMs']==90 and answer['deviceFirstTokenMs']==30 and 'firstTokenMs' not in answer
report=summarize([dict(modality='image',coordinates='pixels',result=answer,score=dict(correct=True))])
assert report['image-pixels']['deviceP50Ms']==90 and report['image-pixels']['deviceTimingCoverage']==1
print(json.dumps(dict(passed=True,phoneExecution=False,coordinateScaling=True,malformedOutputsFail=True,silenceScoredSeparately=True,failuresRemainInAccuracyDenominator=True,mockedNativeAndLiteRTTimingAdapters=True)))
