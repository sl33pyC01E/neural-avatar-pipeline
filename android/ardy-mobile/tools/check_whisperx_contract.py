"""Compile actual Java WAV and alignment code; no model or phone inference."""
import argparse
import json
from pathlib import Path
import subprocess
import zipfile

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--jdk',type=Path,required=True);p.add_argument('--ort-aar',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'avatar-validation/app/build/whisperx-contract';out.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(a.ort_aar) as archive:(out/'ort.jar').write_bytes(archive.read('classes.jar'))
stub=out/'android/content/Context.java';stub.parent.mkdir(parents=True,exist_ok=True);stub.write_text('package android.content;public class Context {public java.io.File getFilesDir(){return null;}}')
java=root/'avatar-validation/app/src/main/java/ai/cleo/ardyavatarvalidation'
classpath=str(out/'ort.jar')+';'+str(root/'payloads/dependencies/json-20250517.jar')
subprocess.run([str(a.jdk/'bin/javac.exe'),'-cp',classpath,'-d',str(out),str(stub),str(java/'WhisperXRuntime.java'),str(java/'WhisperXAlignment.java'),str(root/'tools/WhisperXContractCheck.java')],check=True)
output=subprocess.check_output([str(a.jdk/'bin/java.exe'),'-cp',str(out)+';'+classpath,'ai.cleo.ardyavatarvalidation.WhisperXContractCheck'],text=True)
result=json.loads(output);a.report.write_text(json.dumps(result,indent=2)+'\n');print(output)
