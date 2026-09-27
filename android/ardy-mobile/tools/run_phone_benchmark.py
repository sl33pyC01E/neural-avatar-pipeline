"""HISTORICAL (pre-v25), USER-RUN ONLY. Measures Gemma LiteRT CPU/GPU alongside Cleopatra.

The coding agent must not invoke --run. Preparation/installation is a separate tool.
No UI taps or messages are sent: predictions on fixtures are scored offline.
"""
import argparse
import base64
import contextlib
import hashlib
import json
import math
from pathlib import Path
import random
import re
import shlex
import subprocess
import threading
import time
import uuid
import requests
from benchmark_score import image_prompt,score_image,score_audio

ROOT=Path(__file__).resolve().parents[1]
PAYLOAD=ROOT/'payloads/benchmark'
REMOTE='/data/local/tmp/cleopatra-bench'
PACKAGE='ai.cleo.ardyavatarvalidation'
SERVICE=PACKAGE+'/ai.cleo.ardyavatarvalidation.BenchmarkService'
ASR_PROMPT='Transcribe this English speech exactly. Return only the spoken words. Return an empty answer for silence.'
ENGINES=['gemma-litert-cpu','gemma-litert-gpu']

class Device:
    def __init__(self,adb,transport):self.prefix=[adb,'-t',str(transport)]
    def run(self,*args,check=True):
        r=subprocess.run([*self.prefix,*args],capture_output=True,text=True,timeout=30,encoding='utf-8',errors='replace')
        if check and r.returncode:raise RuntimeError(r.stderr or r.stdout)
        return r.stdout.strip()
    def shell(self,command,check=True):return self.run('shell',command,check=check)
    def private_write(self,path,data):
        subprocess.run([*self.prefix,'shell',f'run-as {PACKAGE} sh -c '+shlex.quote('cat > '+shlex.quote(path))],input=data,check=True,stdout=subprocess.DEVNULL,timeout=30)
    def clock(self):return float(self.shell('cat /proc/uptime').split()[0])*1000
    def trace(self):
        raw=self.shell(f'run-as {PACKAGE} cat cache/benchmark-load.jsonl',check=False)
        return [json.loads(x) for x in raw.splitlines() if x.startswith('{')]
    def environment(self):
        return dict(model=self.shell('getprop ro.product.model'),soc=self.shell('getprop ro.soc.model'),
            android=self.shell('getprop ro.build.version.release'),battery=self.shell('dumpsys battery'),
            thermal=self.shell('dumpsys thermalservice'),meminfo=self.shell('cat /proc/meminfo'))

class Monitor:
    """One-second sampled PSS/RSS, with raw dumps retained. Peaks are sampled lower bounds."""
    def __init__(self,device,pids):
        self.device=device;self.pids=pids;self.samples=[];self.stop=threading.Event()
    def __enter__(self):
        self.thread=threading.Thread(target=self.collect,daemon=True);self.thread.start();return self
    def collect(self):
        while not self.stop.is_set():
            try:
                raw=self.device.shell(f'dumpsys meminfo --package {PACKAGE}',check=False)
                for pid in self.pids:raw+='\n'+self.device.shell(f'dumpsys meminfo {int(pid)}',check=False)
                pss=[int(x) for x in re.findall(r'TOTAL PSS:\s*(\d+)',raw)]
                rss=[int(x) for x in re.findall(r'TOTAL RSS:\s*(\d+)',raw)]
                self.samples.append(dict(hostTime=time.time(),pssKb=sum(pss) if pss else None,
                    rssKb=sum(rss) if rss else None,processes=len(pss),raw=raw))
            except Exception as e:self.samples.append(dict(error=str(e)))
            self.stop.wait(1)
    def __exit__(self,*args):self.stop.set();self.thread.join(timeout=35)

class LiteRT:
    def __init__(self,device,backend):
        self.device=device;self.backend=backend;self.pid=None
        self.model='gemma-4-E2B-it.litertlm'
        result=self.request(dict(action='load',model=self.model,backend=backend,threads=2))
        self.loadMs=result['loadMs'];self.pid=result['pid']
    def request(self,value):
        identity=uuid.uuid4().hex
        self.device.private_write(f'cache/benchmark-{identity}.request.json',json.dumps(value).encode())
        self.device.shell(f'am start-foreground-service -n {SERVICE} --es request {identity}')
        deadline=time.monotonic()+200
        while time.monotonic()<deadline:
            raw=self.device.shell(f'run-as {PACKAGE} cat cache/benchmark-{identity}.json',check=False)
            if raw.startswith('{'):
                result=json.loads(raw)
                if not result['ok']:raise RuntimeError(result['error'])
                return result
            time.sleep(.25)
        raise TimeoutError('LiteRT response timed out; inspect benchmark process logcat')
    def chat(self,prompt,case,thinking,budget):
        kind=case['modality'];start=time.perf_counter()
        result=self.request(dict(action='infer',prompt=prompt,**{kind:case['file']},maxTokens=256+budget,thinking=thinking,reasoningBudget=budget))
        result['wallMs']=(time.perf_counter()-start)*1000
        result['deviceRequestMs']=result['inferMs'];result['deviceFirstTokenMs']=result.pop('firstTokenMs',None)
        result['timingScope']='device engine: media bytes in memory through conversation close'
        return result
    def close(self):self.device.shell('am stopservice -n '+SERVICE,check=False)

def workload_intervals(trace):
    intervals=[];speech=None
    for event in trace:
        if event['type']=='speechStart':speech=event['elapsedRealtimeMs']
        if event['type'] in ['speechEnd','traceStop'] and speech is not None:
            intervals.append((speech,event['elapsedRealtimeMs']));speech=None
    # Never extrapolate a truncated or disabled trace indefinitely.
    if speech is not None and trace:intervals.append((speech,trace[-1]['elapsedRealtimeMs']))
    return intervals

def summarize(rows):
    result={}
    for modality in ['image','audio']:
        subsets=['norm1000','pixels'] if modality=='image' else ['asr']
        for space in subsets:
            allrows=[x for x in rows if x['modality']==modality and x['coordinates']==space]
            values=[x for x in allrows if 'result' in x];times=sorted(x['result']['wallMs'] for x in values)
            entry=dict(requests=len(allrows),completed=len(values),failures=len(allrows)-len(values))
            if times:entry.update(wallP50Ms=times[len(times)//2],wallP95Ms=times[min(len(times)-1,math.ceil(.95*len(times))-1)])
            native=sorted(x['result']['deviceRequestMs'] for x in values if x['result'].get('deviceRequestMs') is not None)
            entry['deviceTimingCoverage']=len(native)
            if native:entry.update(deviceP50Ms=native[len(native)//2],deviceP95Ms=native[min(len(native)-1,math.ceil(.95*len(native))-1)])
            if modality=='image' and allrows:
                entry['actionAccuracy']=sum(x.get('score',{}).get('correct',False) for x in allrows)/len(allrows)
                entry['validActionRate']=sum(x.get('score',{}).get('valid',False) for x in allrows)/len(allrows)
                ious=[x['score']['boxIou'] for x in values if x.get('score',{}).get('boxIou') is not None]
                entry['meanBoxIouWhenValid']=sum(ious)/len(ious) if ious else None
            if modality=='audio':
                words=sum(x.get('score',{}).get('referenceWords',0) for x in values)
                entry['wer']=sum(x.get('score',{}).get('wordErrors',0) for x in values)/words if words else None
                chars=sum(x.get('score',{}).get('referenceCharacters',0) for x in values)
                entry['cer']=sum(x.get('score',{}).get('characterErrors',0) for x in values)/chars if chars else None
                entry['silenceHallucinations']=sum(x.get('score',{}).get('silenceHallucination') is True for x in values)
            result[modality+'-'+space]=entry
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run',action='store_true',help='Explicitly start phone inference. User invokes this, never the coding agent.')
    p.add_argument('--engine',choices=ENGINES,required=True)
    p.add_argument('--load',choices=['idle','full'],required=True)
    p.add_argument('--thinking',action='store_true')
    p.add_argument('--reasoning-budget',type=int,default=0)
    p.add_argument('--limit',type=int,default=3,help='Cases per modality, 0 for all (small runs are smoke checks, not rankings)')
    p.add_argument('--repeats',type=int,default=3);p.add_argument('--seed',type=int,default=42)
    p.add_argument('--adb',default='adb');p.add_argument('--transport',type=int,default=1)
    a=p.parse_args()
    if not a.run:
        print(json.dumps(dict(configuration=vars(a),phoneExecution=False,message='Prepared plan only. The user adds --run.'),indent=2));return
    if a.reasoning_budget<0 or a.reasoning_budget>512 or a.repeats<1 or a.limit<0:p.error('Invalid budget/repetition limit')
    if a.thinking!=(a.reasoning_budget>0):p.error('Use --thinking together with a positive --reasoning-budget, or leave both disabled')
    d=Device(a.adb,a.transport);out=PAYLOAD/'results'/(time.strftime('%Y%m%d-%H%M%S')+'-'+a.engine+'-'+a.load);out.mkdir(parents=True)
    manifest=json.loads((ROOT/'benchmark/fixtures.json').read_text());cases=[]
    for modality in ['image','audio']:
        group=[c for c in manifest['cases'] if c['modality']==modality]
        selected=group if a.limit==0 else group[:a.limit]
        if modality=='audio' and a.limit>0:selected=group[:max(0,a.limit-1)]+[group[-1]]
        cases+=selected
    for c in cases:
        file=PAYLOAD/'fixtures'/c['file']
        if hashlib.sha256(file.read_bytes()).hexdigest()!=c['sha256']:raise ValueError('Fixture hash mismatch')
        if 'litert' in a.engine:d.private_write('files/benchmark/'+c['file'],file.read_bytes())
    before=d.environment();initial=d.trace()
    if not initial or not all(initial[-1].get(x) for x in ['pocketWarm','lamWarm','ardyResident']):
        raise RuntimeError('Warm Together once with Benchmark workload enabled. For idle, press Stop all afterward. All three base engines must have a warm trace.')
    if a.load=='full' and not any(x['type']=='motion' and x.get('visible') and d.clock()-x['elapsedRealtimeMs']<15000 for x in initial[-20:]):
        raise RuntimeError('Start the user-controlled Repeat Together workload in tab 6 before this run.')
    rows=[];servers=[];report=dict(config=vars(a),environmentBefore=before,fixtures=manifest,models=json.loads((ROOT/'benchmark/archive/models-before-llama-only.json').read_text()),
        runtimes={'Gemma':'LiteRT-LM 0.17.1'},phoneExecution=True,baseLoadRequested=a.load,
        limits=['Process-cold, filesystem cache uncontrolled; no cache eviction.',
        'Rank deviceRequestMs, not unequal HTTP versus ADB file/intent wall transport. Per-request timingScope is retained.',
        'Sampled PSS sums package-loaded processes and native servers; shared GPU/driver memory may be unattributed.',
        'RSS sums can double-count shared pages. PSS is the ranking metric.',
        'No real taps or sends. Controlled targets/read speech do not establish production accuracy.'])
    report['contextTokens']=4096
    try:
        with Monitor(d,[]) as loading:
            engine=LiteRT(d,a.engine.rsplit('-',1)[1]);servers.append(engine)
        report['loadMs']=dict(llm=engine.loadMs)
        report['loadingMemory']=loading.samples
        def infer(case,space):
            return engine.chat(image_prompt(case,space) if case['modality']=='image' else ASR_PROMPT,case,a.thinking,a.reasoning_budget)
        # Warm both modalities with independent requests; exclude these answers/times from scores.
        report['warmup']=[]
        for modality in ['image','audio']:
            case=next(c for c in cases if c['modality']==modality)
            report['warmup'].append(infer(case,'norm1000'))
        pids=[]
        with Monitor(d,pids) as resident:time.sleep(5)
        report['residentMemory']=resident.samples
        jobs=[(c,space,r) for c in cases for space in (['norm1000','pixels'] if c['modality']=='image' else ['asr']) for r in range(a.repeats)]
        random.Random(a.seed).shuffle(jobs)
        with Monitor(d,pids) as monitor:
            for case,space,repetition in jobs:
                row=dict(case=case['id'],modality=case['modality'],coordinates=space,repetition=repetition,beginDeviceMs=d.clock())
                try:
                    result=infer(case,space);row['result']=result
                    row['score']=score_image(result['text'],case,space) if case['modality']=='image' else score_audio(result['text'],case)
                    if case['modality']=='audio':
                        row['result']['wallRtf']=result['wallMs']/1000/case['seconds']
                        if result.get('deviceRequestMs') is not None:row['result']['deviceRtf']=result['deviceRequestMs']/1000/case['seconds']
                except Exception as failure:row['error']=str(failure)
                row['endDeviceMs']=d.clock();rows.append(row)
                with (out/'requests.jsonl').open('a',encoding='utf-8') as stream:stream.write(json.dumps(row)+'\n')
                print(case['id'],space,'failed' if 'error' in row else round(row['result']['wallMs']),flush=True)
        report['activeMemory']=monitor.samples
    except BaseException as failure:
        report['error']=repr(failure)
        raise
    finally:
        for server in reversed(servers):
            with contextlib.suppress(Exception):server.close()
        # Also stop a LiteRT service whose initialization failed before constructor return.
        if 'litert' in a.engine:d.shell('am stopservice -n '+SERVICE,check=False)
        trace=d.trace();report['baseTrace']=trace
        intervals=workload_intervals(trace)
        for row in rows:
            events=[x for x in trace if row['beginDeviceMs']<=x['elapsedRealtimeMs']<=row['endDeviceMs']]
            row['baseEventsDuringRequest']=events
            row['motionObservedDuringRequest']=any(x['type']=='motion' for x in events)
            row['renderObservedDuringRequest']=any(x['type']=='renderMetrics' for x in events)
            overlap=sum(max(0,min(b,row['endDeviceMs'])-max(a,row['beginDeviceMs'])) for a,b in intervals)
            row['togetherOverlapFraction']=overlap/max(1,row['endDeviceMs']-row['beginDeviceMs'])
        report['loadVerified']=bool(rows) and (all(x['togetherOverlapFraction']>=.8 for x in rows) if a.load=='full' else all(x['togetherOverlapFraction']==0 for x in rows))
        report['memorySummary']={}
        for phase in ['loadingMemory','residentMemory','activeMemory']:
            values=sorted(x['pssKb'] for x in report.get(phase,[]) if x.get('pssKb') is not None)
            report['memorySummary'][phase]=dict(samples=len(values),peakPssKb=max(values) if values else None,medianPssKb=values[len(values)//2] if values else None)
        report['requests']=rows;report['summary']=summarize(rows);report['environmentAfter']=d.environment()
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print('Saved',out/'report.json')

if __name__=='__main__':main()
