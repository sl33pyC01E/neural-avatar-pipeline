"""Create controlled UI targets and human-speech fixtures without phone execution."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'payloads/benchmark/fixtures'
REV='5be91486e11a2d616f4ec5db8d3fd248585ac07a'
URL=f'https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy/resolve/{REV}/clean/validation-00000-of-00001.parquet'

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def images():
    cases=[]
    # Physical raster dimensions remain intact. Coordinate prompts change, images do not.
    for variant,(width,height) in enumerate([(1080,2400),(1440,2560),(1920,1080)]):
        im=Image.new('RGB',(width,height),'#111825');d=ImageDraw.Draw(im)
        font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',int(width/34))
        small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',int(width/46))
        margin=int(width*.035);row=int(height*.075)
        tabs=['Reading','Weather','Notes'] if variant!=1 else ['Notes','Reading','Weather']
        boxes={}
        for i,name in enumerate(tabs):
            box=[margin+i*(width-2*margin)//3,row,margin+(i+1)*(width-2*margin)//3-8,row*2]
            d.rounded_rectangle(box,12,fill='#34475e' if name=='Reading' else '#212e40')
            d.text((box[0]+18,box[1]+row*.27),name,font=font,fill='white');boxes[name]=box
        d.rounded_rectangle([margin,row*2+20,width-margin,row*3+20],18,fill='#26364b')
        d.text((margin+20,row*2+35),'example.local / article',font=small,fill='#ced9e7')
        d.text((margin,row*4),'A day beside the lake',font=font,fill='white')
        for i in range(4):d.rounded_rectangle([margin,row*(5+i*.55),width*(.75+i%2*.12),row*(5+i*.55)+10],5,fill='#465871')
        # Unlabelled three-dot menu and recognizable share glyph.
        menu=[width-margin-80,row*3+45,width-margin,row*3+125]
        for x in [.25,.5,.75]:d.ellipse([menu[0]+80*x-4,menu[1]+36,menu[0]+80*x+4,menu[1]+44],fill='white')
        share=[margin,height-row*1.4,margin+100,height-row*.4]
        cx=share[0]+50;cy=(share[1]+share[3])/2
        d.line([(cx-22,cy),(cx+24,cy-25)],fill='white',width=5);d.line([(cx-22,cy),(cx+24,cy+25)],fill='white',width=5)
        for x,y in [(cx-22,cy),(cx+24,cy-25),(cx+24,cy+25)]:d.ellipse([x-9,y-9,x+9,y+9],fill='white')
        for target,box,prompt in [('tab',boxes['Notes'],'Switch to the Notes tab.'),('menu',menu,'Open the three-dot menu.'),('share',share,'Select the share icon to begin sending this tab.'),('absent',None,'Select the microphone icon. If it is absent, return action none.')]:
            path=OUT/f'ui-{variant}-{target}.png';im.save(path)
            cases.append(dict(id=path.stem,modality='image',file=path.name,width=width,height=height,prompt=prompt,
                              targetBox=box,expectedAction='tap' if box else 'none',sha256=digest(path),source='controlled UI fixture'))
        panel=im.copy();draw=ImageDraw.Draw(panel)
        top=row*4;draw.rounded_rectangle([width*.14,top,width*.86,top+row*5],20,fill='#f2f5fa')
        labels=['Copy link','Send to your devices','Print','Find in page']
        for i,label in enumerate(labels):
            y=top+row*(i+.5);draw.text((width*.2,y),label,font=font,fill='#182536')
            if i==1:send=[width*.16,y-8,width*.84,y+font.size+12]
        path=OUT/f'ui-{variant}-send-tab.png';panel.save(path)
        cases.append(dict(id=path.stem,modality='image',file=path.name,width=width,height=height,
            prompt='Choose the menu item for sending this tab to another device.',targetBox=send,expectedAction='tap',sha256=digest(path),source='controlled UI fixture'))
    return cases

def audio():
    parquet=OUT/'librispeech-dummy.parquet'
    if not parquet.exists():urllib.request.urlretrieve(URL,parquet)
    records=pq.read_table(parquet).to_pylist();cases=[];rng=np.random.default_rng(42)
    for row in records:
        wav,rate=sf.read(io.BytesIO(row['audio']['bytes']),dtype='float32')
        if len(wav)/rate>15:continue
        index=len(cases)//2
        for noise in [False,True]:
            pcm=wav.copy()
            if noise:
                sigma=float(np.sqrt(np.mean(pcm**2)))/np.sqrt(10)
                pcm=np.clip(pcm+rng.normal(0,sigma,len(pcm)),-1,1)
            name=f'asr-{index}-'+('noise10db' if noise else 'clean')+'.wav';path=OUT/name
            sf.write(path,pcm,rate,subtype='PCM_16')
            cases.append(dict(id=path.stem,modality='audio',file=name,reference=row['text'],
                seconds=len(wav)/rate,sampleRate=rate,sourceId=row['id'],noiseSnrDb=10 if noise else None,
                sha256=digest(path),source='LibriSpeech human read speech (not conversational commands)'))
        if len(cases)>=12:break
    path=OUT/'asr-silence.wav';sf.write(path,np.zeros(3*16000),16000,subtype='PCM_16')
    cases.append(dict(id=path.stem,modality='audio',file=path.name,reference='',seconds=3,sampleRate=16000,
        sha256=digest(path),source='generated digital silence'))
    return cases

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    cases=images()+audio()
    manifest=dict(schema=1,cases=cases,audioSource=URL,audioLicense='LibriSpeech CC BY 4.0',
        limitations=['Controlled UI only; add held-out real screenshots before deployment decisions.',
        'Human read English speech and controlled noise; no conversational command accuracy claim.',
        'No model outputs or benchmark results are generated here.'])
    (OUT/'cases.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (ROOT/'benchmark/fixtures.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(len(cases),'fixtures prepared; no phone execution')

if __name__=='__main__':main()
