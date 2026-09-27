"""Host-only checks of production Gemma streaming and validated avatar tools. No inference."""
import argparse,json,os,subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'avatar-validation/app/build/gemma-protocol-check';out.mkdir(parents=True,exist_ok=True)
jars=[root/'payloads/dependencies/json-20250517.jar',Path(os.environ.get('ANDROID_HOME', str(Path.home()/'AppData/Local/Android/Sdk')))/'platforms/android-36/android.jar']
classpath=os.pathsep.join(map(str,jars))
app=root/'avatar-validation/app/src/main/java/ai/cleo/ardyavatarvalidation'
ardy_plan=root/'avatar-validation/app/src/main/java/ai/cleo/ardymobile/ArdyPlan.java'
sources=[ardy_plan]+[app/name for name in ['AvatarToolApi.java','MainAvatarToolApi.java','AgentControls.java','GemmaStream.java','GemmaFailure.java','BrowserAction.java','BrowserTarget.java','BrowserPrompt.java','PromptTree.java','LlamaProtocol.java','LlamaRuntime.java','LlamaLaunch.java','LlamaLog.java','ModelData.java','ModelSettings.java']]+[root/'tools/ModelChatProtocolCheck.java',root/'tools/LlamaProtocolCheck.java',root/'tools/LlamaCacheCheck.java',root/'tools/LlamaLaunchCheck.java']
subprocess.run([str(args.jdk/'bin/javac.exe'),'-encoding','UTF-8','-cp',classpath,'-d',str(out),*map(str,sources)],check=True)
result=subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+classpath,'ai.cleo.ardyavatarvalidation.ModelChatProtocolCheck'],text=True)
llama=json.loads(subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+classpath,'ai.cleo.ardyavatarvalidation.LlamaProtocolCheck'],text=True));
cache_report=json.loads(subprocess.check_output([str(args.jdk/'bin/java.exe'),'--add-modules','jdk.httpserver','-cp',str(out)+os.pathsep+classpath,'ai.cleo.ardyavatarvalidation.LlamaCacheCheck'],text=True));
launch_report=json.loads(subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+classpath,'ai.cleo.ardyavatarvalidation.LlamaLaunchCheck'],text=True))
report=json.loads(result.strip());report['llamaProtocol']=llama;report['llamaDiskCache']=cache_report;report['llamaLaunch']=launch_report;args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
