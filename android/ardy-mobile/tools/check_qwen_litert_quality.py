"""Conversion correctness gate on native Linux LiteRT 0.17.1; never a phone benchmark."""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import platform
import re
from datetime import datetime, timezone
import litert_lm
from PIL import Image
from tokenizers import Tokenizer


def answer(message):
    content=message.get('content',[])
    return content if isinstance(content,str) else ''.join(part.get('text','') for part in content if part.get('type')=='text')


def sampler(thinking):
    return litert_lm.SamplerConfig(top_k=20,top_p=.95 if thinking else .8,temperature=1.0 if thinking else .7,seed=42)


def penalty():
    return litert_lm.RepetitionPenaltyConfig(repetition_penalty=1.0,presence_penalty=1.5,frequency_penalty=0.0,window_size=0)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('model',type=Path);p.add_argument('--converter',type=Path,required=True);p.add_argument('--report',type=Path,required=True)
    p.add_argument('--build-receipt',type=Path,help='Attach the passing report to the matching export receipt')
    p.add_argument('--tokenizer',type=Path,required=True,help='Pinned source tokenizer.json for counting the emitted reasoning tokens')
    p.add_argument('--context',type=int,default=8192);p.add_argument('--image-size',type=int,default=768)
    a=p.parse_args();spec=importlib.util.spec_from_file_location('upstream_gate',a.converter/'scripts/verify_quality.py')
    gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
    with a.model.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    tokenizer=Tokenizer.from_file(str(a.tokenizer))
    rows=[];prefix=[];vision=[];error=None;engine=None
    try:
        engine=litert_lm.Engine(str(a.model),backend=litert_lm.Backend.CPU(thread_count=2),vision_backend=litert_lm.Backend.CPU(thread_count=2),max_num_tokens=a.context,max_num_images=1)
        for label,question,pattern in gate.QUESTIONS:
            with engine.create_conversation(thinking_config=litert_lm.ThinkingConfig(False,0),max_output_tokens=512,
                    sampler_config=sampler(False),filter_channel_content_from_kv_cache=False) as chat:
                response=chat.send_message(question+gate.SUFFIX,repetition_penalty_config=penalty())
            text=gate.strip_think(answer(response));degenerate=not text.strip() or gate.degenerate(text)
            rows.append(dict(label=label,answer=text,correct=bool(re.search(pattern,text.lower())),degenerate=degenerate))
            print(json.dumps(rows[-1]),flush=True)
        # Exercise actual retained conversations and thought-channel restoration.
        for thinking,budget in [(False,0),(True,128)]:
            with engine.create_conversation(thinking_config=litert_lm.ThinkingConfig(thinking,budget),max_output_tokens=512+budget,
                    sampler_config=sampler(thinking),filter_channel_content_from_kv_cache=False) as chat:
                turns=[]
                for prompt in ('Remember the code word violet. Reply briefly.','What code word did I give you? Answer with the word only.'):
                    response=chat.send_message(prompt,repetition_penalty_config=penalty());turns.append(dict(answer=answer(response),reasoning=response.get('reasoning_content',''),channels=response.get('channels',{})))
                    turns[-1]['reasoningTokens']=len(tokenizer.encode(turns[-1]['reasoning'],add_special_tokens=False).ids)
                thought=any(turn['reasoning'] or turn['channels'].get('thought') for turn in turns)
                passed=all(turn['answer'].strip() and not gate.degenerate(turn['answer']) and turn['reasoningTokens']<=budget for turn in turns) and 'violet' in turns[-1]['answer'].lower() and bool(thought)==thinking
                prefix.append(dict(thinking=thinking,budget=budget,turns=turns,thoughtChannelObserved=bool(thought),passed=passed))
                print(json.dumps(prefix[-1]),flush=True)
        # Check image injection, vision execution and decoder together. This is
        # deliberately a basic conversion gate, not a browser-grounding score.
        for color in ('red','blue'):
            image=Image.new('RGB',(a.image_size,a.image_size),color);blob=io.BytesIO();image.save(blob,format='PNG')
            with engine.create_conversation(thinking_config=litert_lm.ThinkingConfig(False,0),max_output_tokens=128,
                    sampler_config=sampler(False)) as chat:
                response=chat.send_message(litert_lm.Contents.of(litert_lm.Content.ImageBytes(blob.getvalue()),'What color fills this image? Answer with only the color.'),repetition_penalty_config=penalty())
            text=gate.strip_think(answer(response));passed=bool(re.search(r'\b'+color+r'\b',text.lower())) and not gate.degenerate(text)
            vision.append(dict(color=color,answer=text,passed=passed));print(json.dumps(vision[-1]),flush=True)
    except Exception as exception:
        error=str(exception)
    finally:
        if engine is not None:engine.close()
    correct=sum(row['correct'] for row in rows);passed=error is None and len(rows)==8 and correct>=6 and not any(row['degenerate'] for row in rows) and len(prefix)==2 and all(row['passed'] for row in prefix) and len(vision)==2 and all(row['passed'] for row in vision)
    result=dict(passed=passed,file=a.model.name,sha256=digest,correct=correct,total=8,minimum=6,questions=rows,retainedConversation=prefix,imagePipeline=vision,error=error,
        date=datetime.now(timezone.utc).isoformat(),host=platform.node(),architecture=platform.machine(),
        contextTokens=a.context,imageSize=a.image_size,
        tokenizerSha256=hashlib.sha256(a.tokenizer.read_bytes()).hexdigest(),
        sampling=dict(topK=20,thinking=dict(temperature=1.0,topP=.95),nonThinking=dict(temperature=.7,topP=.8),presencePenalty=1.5,repetitionPenalty=1.0,seed=42),
        runtime='LiteRT-LM API 0.17.1 native Linux ARM64 CPU, 2 threads',scope='Conversion and conversation correctness only; no speed or phone qualification',phoneExecuted=False,phoneQualified=False)
    a.report.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(passed=passed,correct=correct,total=8)))
    if not passed:raise SystemExit(1)
    if a.build_receipt:
        receipt=json.loads(a.build_receipt.read_text())
        if receipt.get('sha256')!=digest or not receipt.get('graphExported') or receipt.get('contextTokens')!=a.context or receipt.get('imageSize')!=a.image_size:raise ValueError('Export receipt does not describe the checked model')
        receipt['generationQuality']=result
        a.build_receipt.write_text(json.dumps(receipt,indent=2)+'\n')


if __name__=='__main__':main()
