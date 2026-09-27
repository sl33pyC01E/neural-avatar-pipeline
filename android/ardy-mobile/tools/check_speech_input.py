"""Host-only production text queue / synthetic PCM pipeline checks. No model inference."""
import argparse,json,os,subprocess
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'avatar-validation/app/build/speech-input-check';out.mkdir(parents=True,exist_ok=True)
jar=root/'payloads/dependencies/json-20250517.jar'
app=root/'avatar-validation/app/src/main/java/ai/cleo/ardymobile'
sources=[app/name for name in ['SpeechTextQueue.java','SpeechFacePipeline.java','LamTimeline.java']]+[root/'tools/SpeechInputCheck.java']
subprocess.run([str(args.jdk/'bin/javac.exe'),'-encoding','UTF-8','-cp',str(jar),'-d',str(out),*map(str,sources)],check=True)
result=subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+str(jar),'ai.cleo.ardymobile.SpeechInputCheck'],text=True)
report=json.loads(result);args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
