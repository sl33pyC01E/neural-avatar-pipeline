package ai.cleo.ardyavatarvalidation;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.Debug;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** One bounded startup receipt, containing settings/stages only, never chat or media. */
final class ModelDiagnostics {
    private static AtomicFile file(Context context){return new AtomicFile(new File(context.getFilesDir(),"gemma-load-state.json"));}
    static void stage(Context context,String phase,JSONObject selection){
        AtomicFile file=file(context);FileOutputStream out=null;
        try{
            ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();context.getSystemService(ActivityManager.class).getMemoryInfo(memory);
            JSONObject value=new JSONObject().put("timestamp",System.currentTimeMillis()).put("pid",android.os.Process.myPid())
                .put("stage",phase).put("selection",selection).put("pssKb",Debug.getPss()).put("availableBytes",memory.availMem);
            out=file.startWrite();out.write(value.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);
        }catch(Exception ignored){if(out!=null)file.failWrite(out);}
    }
    static String stopped(Context context,int pid,long since){
        JSONObject last=new JSONObject();
        try{last=new JSONObject(new String(file(context).readFully(),StandardCharsets.UTF_8));}catch(Exception ignored){}
        String reason="Gemma process stopped";
        if(Build.VERSION.SDK_INT>=30)try{
            for(ApplicationExitInfo exit:context.getSystemService(ActivityManager.class).getHistoricalProcessExitReasons(context.getPackageName(),pid,8)){
                if(!exit.getProcessName().equals(context.getPackageName()+":models")||exit.getTimestamp()<since)continue;
                if(exit.getReason()==ApplicationExitInfo.REASON_LOW_MEMORY)reason="Android stopped Gemma for low memory";
                else if(exit.getReason()==ApplicationExitInfo.REASON_CRASH_NATIVE)reason="Gemma's native runtime crashed";
                else if(exit.getReason()==ApplicationExitInfo.REASON_CRASH)reason="Gemma's model service crashed";
                if(pid==0)pid=exit.getPid();break;
            }
        }catch(Exception ignored){}
        if(pid!=0&&last.optInt("pid") == pid){
            JSONObject selection=last.optJSONObject("selection");
            reason+=" during "+last.optString("stage","model loading");
            if(selection!=null)reason+=" ("+(selection.optString("model").equals("gemma-e4b")?"E4B":"E2B")+", "+selection.optInt("contextTokens")+" context, "+selection.optInt("visualTokens")+" visual tokens)";
        }
        return reason+". Retry Launch. If memory runs out again, lower the context/image budget or select E2B in Settings.";
    }
}
