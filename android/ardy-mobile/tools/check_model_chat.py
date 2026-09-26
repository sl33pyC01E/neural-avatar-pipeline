"""Compile/run the real Java chat adapter and action parser against a host fake server."""
import argparse
import json
import re
from pathlib import Path
import subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jdk',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'avatar-validation/app/build/chat-protocol-check'
out.mkdir(parents=True,exist_ok=True)
stubs={
    'android/content/Context.java':'package android.content; public class Context {public java.io.File getFilesDir(){return null;} public java.io.File getCacheDir(){return null;} public android.content.pm.ApplicationInfo getApplicationInfo(){return null;}}',
    'android/content/pm/ApplicationInfo.java':'package android.content.pm; public class ApplicationInfo {public String nativeLibraryDir;}',
    'android/os/SystemClock.java':'package android.os; public class SystemClock {public static long elapsedRealtimeNanos(){return System.nanoTime();}public static long elapsedRealtime(){return System.nanoTime()/1000000;}}',
    'android/util/Base64.java':'package android.util; public class Base64 {public static final int NO_WRAP=2; public static String encodeToString(byte[] b,int flags){return java.util.Base64.getEncoder().encodeToString(b);}}',
    'ai/cleo/ardyavatarvalidation/WhisperXRuntime.java':'package ai.cleo.ardyavatarvalidation; final class WhisperXRuntime {WhisperXRuntime(android.content.Context c){} org.json.JSONObject transcribe(byte[] b){throw new UnsupportedOperationException("Protocol test must not execute ASR");}void cancel(){}void close(){}}',
}
sources=[]
for name,text in stubs.items():
    path=out/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);sources.append(str(path))
app=root/'avatar-validation/app/src/main/java/ai/cleo/ardyavatarvalidation'
sources += [str(app/name) for name in ['NativeChatRuntime.java','BrowserAction.java']]
sources.append(str(root/'tools/ModelChatProtocolCheck.java'))
jar=root/'payloads/dependencies/json-20250517.jar'
subprocess.run([str(args.jdk/'bin/javac.exe'),'-cp',str(jar),'-d',str(out),*sources],check=True)
result=subprocess.check_output([str(args.jdk/'bin/java.exe'),'-cp',str(out)+';'+str(jar),'ai.cleo.ardyavatarvalidation.ModelChatProtocolCheck'],text=True)
report=json.loads(result.strip())
source=(root/'payloads/whisper.cpp/examples/server/server.cpp').read_text(encoding='utf-8')
accepted=set(re.findall(r'arg\s*==\s*"([^"]+)"',source))
for flag in report['whisperArguments']+['--host','--port']:
    if flag.startswith('-'):assert flag in accepted, 'Unsupported whisper-server argument: '+flag
assert re.search(r'bool\s+no_context\s*=\s*true',source),'Recheck independent Whisper request context'
report['whisperFlagsMatchPinnedServerParser']=True
args.report.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
