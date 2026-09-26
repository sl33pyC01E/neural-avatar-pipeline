"""Check the actual MiniJinja template and retained-prefix contract without inference."""
import argparse
import json
from pathlib import Path
import minijinja


def check(template):
    environment=minijinja.Environment(templates={'chat':template})
    # Mirror LiteRT 0.17.1's Rust capability probe and FastVLM MessageToTemplateInput.
    def probe(value):
        try:return 'test content' in environment.render_template('chat',messages=[{'role':'user','content':value}],add_generation_prompt=False)
        except Exception:return False
    typed=not probe('test content') and probe([{'type':'text','text':'test content'}])
    assert typed, 'Typed content is required to preserve assistant reasoning in FastVLM 0.17.1'
    def adapt(message):
        if isinstance(message['content'],str) and typed:
            return {'role':message['role'],'content':[{'type':'text','text':message['content']}]}
        if isinstance(message['content'],list) and len(message['content'])==1 and message['content'][0]['type']=='text' and not typed:
            return {'role':message['role'],'content':message['content'][0]['text']}
        return message
    def render(messages,thinking,generation):
        return environment.render_template('chat',messages=[adapt(message) for message in messages],enable_thinking=thinking,add_generation_prompt=generation)
    count=0
    for thinking in (False,True):
        for parts in (False,True):
            history=[{'role':'system','content':'You are Cleopatra.'}]
            for turn in range(3):
                value=[{'type':'image','image':'fixture'},{'type':'text','text':'Read the icon.'}] if parts else 'Read the icon.'
                history.append({'role':'user','content':value})
                prefix=render(history,thinking,True)
                expected='<think>\n' if thinking else '<think>\n\n</think>\n\n'
                assert prefix.endswith('<|im_start|>assistant\n'+expected)
                thought='Inspecting the label.\n' if thinking else ''
                answer='\n\nThe settings icon.' if thinking else 'The settings icon.'
                generated=(thought+'</think>' if thinking else '')+answer
                # FastVLM's ToMessageImpl always emits typed assistant content.
                item={'role':'assistant','content':[{'type':'text','text':answer}]}
                if thinking:item.update(reasoning_content=thought,channels={'thought':thought})
                history.append(item)
                complete=render(history,thinking,False)
                assert complete==prefix+generated+'<|im_end|>\n', 'History changed the cached prefix'
                next_prefix=render(history+[{'role':'user','content':'Next'}],thinking,True)
                assert next_prefix.startswith(complete)
                if parts:assert '<|vision_start|><image_soft_token><|vision_end|>' in prefix
                count+=1
    return {'passed':True,'cases':count,'templateEngine':'MiniJinja','retainedPrefix':True,
            'reasoningToggle':True,'stringAndPartsUserContent':True,'typedAssistantHistory':True,'fastVlm0171AdapterModeled':True,'requiresTypedContent':typed,'imageMarker':True,'phoneExecution':False,
            'limitation':'Template checks do not establish model quality or runtime budget enforcement.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--template',type=Path,default=Path(__file__).resolve().parents[1]/'benchmark/qwen-litert/chat.jinja');p.add_argument('--report',type=Path)
    a=p.parse_args();value=check(a.template.read_text(encoding='utf-8'));encoded=json.dumps(value,indent=2)+'\n'
    if a.report:a.report.write_text(encoded,encoding='utf-8')
    print(encoded,end='')
