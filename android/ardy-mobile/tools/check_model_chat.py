"""Host-only checks of production Gemma streaming and validated avatar tools. No inference."""
import argparse,json,os,subprocess,zipfile
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'avatar-validation/app/build/gemma-protocol-check';out.mkdir(parents=True,exist_ok=True)
cache=Path.home()/'.gradle/caches/modules-2/files-2.1'
jars=[root/'payloads/dependencies/json-20250517.jar',root/'payloads/litert-api/classes.jar']
annotation_aar=next((cache/'androidx.annotation/annotation-experimental/1.4.1').rglob('*.aar'))
annotation_jar=out/'annotation-experimental.jar'
with zipfile.ZipFile(annotation_aar) as archive: annotation_jar.write_bytes(archive.read('classes.jar'))
jars.append(annotation_jar)
for folder in ['org.jetbrains.kotlin/kotlin-stdlib/2.4.0','com.google.code.gson/gson']:
    found=sorted((cache/folder).rglob('*.jar'));assert found,folder;jars.append(found[-1])
classpath=os.pathsep.join(map(str,jars))
app=root/'avatar-validation/app/src/main/java/ai/cleo/ardyavatarvalidation'
sources=[app/name for name in ['AvatarToolApi.java','MainAvatarToolApi.java','GemmaStream.java','GemmaFailure.java','GemmaToolDecoding.java','BrowserAction.java']]+[root/'tools/ModelChatProtocolCheck.java']
subprocess.run([str(args.jdk/'bin/javac.exe'),'-encoding','UTF-8','-cp',classpath,'-d',str(out),*map(str,sources)],check=True)
result=subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+classpath,'ai.cleo.ardyavatarvalidation.ModelChatProtocolCheck'],text=True)
report=json.loads(result.strip());args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
