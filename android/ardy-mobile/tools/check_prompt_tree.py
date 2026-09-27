"""Host checks of prompt snapshots, revisions, interpolation and browser output contracts."""
import argparse,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--report',type=Path,required=True)
args=p.parse_args();root=Path(__file__).resolve().parents[1];out=root/'avatar-validation/app/build/prompt-tree-check';out.mkdir(parents=True,exist_ok=True)
jar=root/'payloads/dependencies/json-20250517.jar';app=root/'avatar-validation/app/src/main/java/ai/cleo/ardyavatarvalidation'
ardy_plan=root/'avatar-validation/app/src/main/java/ai/cleo/ardymobile/ArdyPlan.java'
sources=[ardy_plan]+[app/name for name in ['AvatarToolApi.java','MainAvatarToolApi.java','AgentControls.java','BrowserAction.java','BrowserTarget.java','BrowserPrompt.java','PromptTree.java']]+[root/'tools/PromptTreeCheck.java']
subprocess.run([str(args.jdk/'bin/javac.exe'),'-encoding','UTF-8','-cp',str(jar),'-d',str(out),*map(str,sources)],check=True)
result=subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+os.pathsep+str(jar),'ai.cleo.ardyavatarvalidation.PromptTreeCheck',str(out/'defaults.json')],text=True)
report=json.loads(result);args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='browserSchema'}))
