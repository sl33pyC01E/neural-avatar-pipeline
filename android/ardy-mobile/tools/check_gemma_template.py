"""Inspect/render the actual bundled Gemma template. No model loading or inference."""
import argparse,json
from pathlib import Path
from jinja2 import Environment
from inspect_litert import sections
from litert_lm_builder.runtime.proto import llm_metadata_pb2
p=argparse.ArgumentParser(description=__doc__);p.add_argument('model',type=Path);p.add_argument('--protocol',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
row=next(row for row in sections(a.model) if row['type']==5)
with a.model.open('rb') as f:
    f.seek(row['begin']);metadata=llm_metadata_pb2.LlmMetadata.FromString(f.read(row['end']-row['begin']))
channels=[c.channel_name for c in metadata.channels]
assert 'thought' in channels
assert metadata.llm_model_type.gemma4.code_fence_start=='<|tool_call>'
env=Environment();env.globals['raise_exception']=lambda message:(_ for _ in ()).throw(ValueError(message))
template=env.from_string(metadata.jinja_prompt_template)
tools=json.loads(a.protocol.read_text())['sdkTools']
messages=[dict(role='system',content='You are Cleopatra.'),dict(role='user',content=[dict(type='text',text='Say hello.')])]
def render(messages,thinking):return template.render(messages=messages,tools=tools,bos_token='<bos>',add_generation_prompt=True,enable_thinking=thinking)
on,off=render(messages,True),render(messages,False)
assert '<|think|>' in on and '<|think|>' not in off
assert 'avatar_stage' in on and 'cue_seconds' in on and 'neutral' in on
assert on.endswith('<|turn>model\n')
messages+=[dict(role='model',content=[],tool_calls=[dict(type='function',function=dict(name='avatar_stage',arguments=dict(motion='wave',expression='happy',strength=.3,cue_seconds=.25,tail_seconds=1)))]),dict(role='tool',content=[dict(type='tool_response',name='avatar_stage',response=json.dumps(dict(ok=True)))])]
response=render(messages,True)
assert 'call:avatar_stage' in response and 'response:avatar_stage' in response and response.endswith('<tool_response|>')
messages+=[dict(role='model',content=[dict(type='text',text='Hello there!')]),dict(role='user',content=[dict(type='text',text='What did you say?')])]
followup=render(messages,True)
assert 'Hello there!' in followup and 'What did you say?' in followup and followup.endswith('<|turn>model\n')
protocol=json.loads(a.protocol.read_text())
if 'mainSdkTools' in protocol:
    tools=protocol['mainSdkTools']
    preface=template.render(messages=[dict(role='system',content=protocol['mainInstructions'])],tools=tools,bos_token='<bos>',add_generation_prompt=False,enable_thinking=False)
    assert 'act' in preface and '<|think|>' not in preface and not preface.endswith('<|turn>model\n')
    main_messages=[dict(role='system',content=protocol['mainInstructions']),dict(role='user',content=[dict(type='text',text='APP SCENE: frame=face; {}\nUSER MESSAGE:\nHello')])]
    main_off,main_on=render(main_messages,False),render(main_messages,True)
    assert 'act' in main_off and 'gesture' in main_off and 'APP SCENE' in main_off
    assert '<|think|>' not in main_off and '<|think|>' in main_on
    main_messages+=[dict(role='model',content=[],tool_calls=[dict(type='function',function=dict(name='act',arguments=dict(emotion='happy',intensity=.2)))]),dict(role='tool',content=[dict(type='tool_response',name='act',response=json.dumps(dict(ok=True)))])]
    assert 'response:act' in render(main_messages,False)
report=dict(passed=True,phoneExecution=False,modelInference=False,thinkingToggleChangesActualPrompt=True,thoughtChannel=channels,mainToolTemplateValidated=True,systemOnlyPrefillTemplateValidated='mainSdkTools' in protocol,actualSdkToolsRender=True,toolResponseContinuation=True,followupRetainsHistory=True,artifact=a.model.name)
a.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
