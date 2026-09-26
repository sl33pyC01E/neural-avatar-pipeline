"""Offline scoring. Coordinates are explicit; malformed answers never become successful taps."""
import json
import math
import re
import unicodedata

def normalize(text):
    text=unicodedata.normalize('NFKC',text).casefold().replace("’","'")
    return ' '.join(re.sub(r"[^\w\s']",' ',text).split())

def edit_distance(a,b):
    previous=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        row=[i]
        for j,y in enumerate(b,1):row.append(min(row[-1]+1,previous[j]+1,previous[j-1]+(x!=y)))
        previous=row
    return previous[-1]

def score_audio(text,case):
    ref=normalize(case['reference']);hyp=normalize(text)
    words=ref.split();chars=ref.replace(' ','')
    return dict(wordErrors=edit_distance(words,hyp.split()),referenceWords=len(words),
        characterErrors=edit_distance(chars,hyp.replace(' ','')),referenceCharacters=len(chars),
        wer=edit_distance(words,hyp.split())/len(words) if words else None,
        cer=edit_distance(chars,hyp.replace(' ',''))/len(chars) if chars else None,
        silenceHallucination=bool(hyp) if not words else None)

def parse_action(text):
    text=text.strip()
    if text.startswith('```'):
        text=re.sub(r'^```(?:json)?\s*|\s*```$','',text).strip()
    value=json.loads(text)
    if not isinstance(value,dict):raise ValueError('Expected one action object')
    return value

def score_image(text,case,space):
    result=dict(valid=False,correct=False,pointHit=False,boxIou=None)
    try:
        value=parse_action(text)
        if value.get('action')=='none':
            result.update(valid=True,correct=case['expectedAction']=='none');return result
        if value.get('action')!='tap':return result
        w,h=case['width'],case['height'];scale=[w/1000,h/1000] if space=='norm1000' else [1,1]
        def coords(key,count):
            v=value[key]
            if not isinstance(v,list) or len(v)!=count:raise ValueError('Bad dimensions')
            if any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) for n in v):raise ValueError('Invalid numbers')
            return [n*scale[i%2] for i,n in enumerate(v)]
        point=coords('point',2);box=coords('box',4)
        if not (0<=point[0]<w and 0<=point[1]<h and 0<=box[0]<box[2]<=w and 0<=box[1]<box[3]<=h):return result
        result['valid']=True
        target=case['targetBox']
        if target is None:return result
        hit=target[0]<=point[0]<target[2] and target[1]<=point[1]<target[3]
        intersection=max(0,min(box[2],target[2])-max(box[0],target[0]))*max(0,min(box[3],target[3])-max(box[1],target[1]))
        union=(box[2]-box[0])*(box[3]-box[1])+(target[2]-target[0])*(target[3]-target[1])-intersection
        result.update(pointHit=hit,correct=hit,boxIou=intersection/union)
    except (KeyError,ValueError,TypeError,json.JSONDecodeError):pass
    return result

def image_prompt(case,space):
    extent='0 to 1000 on each axis' if space=='norm1000' else f"pixels, x from 0 to {case['width']-1}, y from 0 to {case['height']-1}"
    return (f"{case['prompt']} The screenshot is {case['width']} by {case['height']} pixels. "
        f"Give coordinates in {extent}, measured from the top-left. "
        'Return only JSON: {"action":"tap","point":[x,y],"box":[left,top,right,bottom]}. '
        'Use the visible target bounds and a point inside them. If absent return {"action":"none"}.')
