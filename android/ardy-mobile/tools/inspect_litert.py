"""Read LiteRT-LM section metadata without loading an inference runtime or weights."""
import argparse
import json
from pathlib import Path
import struct
import flatbuffers.table
import flatbuffers.number_types as numbers


def sections(path):
    with path.open('rb') as stream:
        prefix=stream.read(32)
        if prefix[:8]!=b'LITERTLM':raise ValueError('Not a LiteRT-LM package')
        metadata_end=struct.unpack_from('<Q',prefix,24)[0]
        if not 32<metadata_end<4*1024*1024:raise ValueError('Unexpected metadata size')
        data=stream.read(metadata_end-32)
    def table(position):return flatbuffers.table.Table(data,position)
    def child(value,field):return table(value.Indirect(value.Pos+value.Offset(field)))
    def vector(value):
        offset=value.Offset(4)
        return [] if not offset else [table(value.Indirect(value.Vector(offset)+4*i)) for i in range(value.VectorLen(offset))]
    root=table(struct.unpack_from('<I',data,0)[0]);rows=[]
    for section in vector(child(root,6)):
        items={}
        for pair in vector(section):
            key=pair.String(pair.Pos+pair.Offset(4)).decode();kind=pair.Get(numbers.Uint8Flags,pair.Pos+pair.Offset(6));value=child(pair,8)
            if kind==9:items[key]=value.String(value.Pos+value.Offset(4)).decode()
        def number(field,kind):
            offset=section.Offset(field)
            return section.Get(kind,section.Pos+offset) if offset else 0
        rows.append(dict(metadata=items,begin=number(6,numbers.Uint64Flags),end=number(8,numbers.Uint64Flags),
                         type=number(10,numbers.Uint8Flags),endFieldOffset=32+section.Pos+section.Offset(8)))
    return rows


def inspect(path):
    rows=[section['metadata'] for section in sections(path)]
    kinds={row.get('model_type') for row in rows}
    return dict(file=path.name,bytes=path.stat().st_size,sections=rows,vision='tf_lite_vision_encoder' in kinds,
                audio='tf_lite_audio_encoder_hw' in kinds,phoneExecution=False)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('files',type=Path,nargs='+');parser.add_argument('--report',type=Path)
    args=parser.parse_args();results=[inspect(path) for path in args.files]
    encoded=json.dumps(results,indent=2)+'\n'
    if args.report:args.report.write_text(encoded,encoding='utf-8')
    print(encoded,end='')
