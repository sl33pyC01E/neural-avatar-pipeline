"""Change only Qwen's conversation metadata; never claim a new graph/context export."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
from litert_lm_builder.runtime.proto import llm_metadata_pb2
from inspect_litert import sections
from check_qwen_template import check


def sha(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def section_hash(path,row):
    value=hashlib.sha256();remaining=row['end']-row['begin']
    with path.open('rb') as stream:
        stream.seek(row['begin'])
        while remaining:
            chunk=stream.read(min(remaining,1024*1024))
            if not chunk:raise ValueError('Truncated section')
            value.update(chunk);remaining-=len(chunk)
    return value.hexdigest()


def repack(source,target,template,expected_sha=None):
    if source.resolve()==target.resolve():raise ValueError('Use a separate derived artifact')
    original_sha=sha(source)
    if expected_sha and original_sha!=expected_sha:raise ValueError('Source package hash mismatch')
    check(template)
    rows=sections(source);metadata=[r for r in rows if r['type']==5]
    if len(metadata)!=1:raise ValueError('Expected exactly one LlmMetadata section')
    row=metadata[0]
    with source.open('rb') as stream:
        stream.seek(row['begin']);original=stream.read(row['end']-row['begin'])
    md=llm_metadata_pb2.LlmMetadata.FromString(original)
    if not md.llm_model_type.HasField('fast_vlm'):raise ValueError('Expected Qwen FastVLM')
    if '<|im_start|>' not in md.jinja_prompt_template:raise ValueError('Expected ChatML template')
    md.jinja_prompt_template=template
    md.supports_thinking=True
    del md.channels[:]
    channel=md.channels.add();channel.channel_name='thought';channel.start='<think>\n';channel.end='</think>';channel.is_reasoning_channel=True
    encoded=md.SerializeToString()
    boundary=min(r['begin'] for r in rows if r['begin']>row['begin'])
    if row['begin']+len(encoded)>boundary:raise ValueError('Metadata exceeds reserved section padding')
    target.parent.mkdir(parents=True,exist_ok=True)
    partial=target.with_suffix(target.suffix+'.partial');shutil.copyfile(source,partial)
    with partial.open('r+b') as stream:
        stream.seek(row['begin']);stream.write(encoded)
        stream.write(bytes(max(0,row['end']-row['begin']-len(encoded))))
        stream.seek(row['endFieldOffset']);stream.write(struct.pack('<Q',row['begin']+len(encoded)))
    preserved=[]
    for other in rows:
        if other is row:continue
        before=section_hash(source,other);after=section_hash(partial,other)
        if before!=after:raise ValueError('Non-metadata section changed')
        preserved.append(dict(type=other['type'],metadata=other['metadata'],sha256=after))
    partial.replace(target)
    return dict(file=target.name,bytes=target.stat().st_size,sha256=sha(target),sourceFile=source.name,
                sourceSha256=original_sha,templateSha256=hashlib.sha256(template.encode()).hexdigest(),
                imageSize=md.llm_model_type.fast_vlm.image_tensor_width,contextTokens=md.max_num_tokens,
                thinkingChannel=dict(name='thought',start=channel.start,end=channel.end),preservedSections=preserved,
                graphExported=False,phoneQualified=False)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('target',type=Path);p.add_argument('--template',type=Path,required=True);p.add_argument('--sha256');p.add_argument('--report',type=Path,required=True)
    a=p.parse_args();result=repack(a.source,a.target,a.template.read_text(encoding='utf-8'),a.sha256)
    a.report.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
