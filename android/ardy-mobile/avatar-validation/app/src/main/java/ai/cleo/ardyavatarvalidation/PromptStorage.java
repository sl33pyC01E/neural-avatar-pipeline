package ai.cleo.ardyavatarvalidation;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Only the Activity writes. Model worker reads a fresh immutable snapshot per request. */
final class PromptStorage {
    private static AtomicFile file(Context context){return new AtomicFile(new File(context.getFilesDir(),"prompt-tree.json"));}
    static synchronized PromptTree load(Context context)throws Exception {
        AtomicFile file=file(context);byte[] bytes;
        try{bytes=file.readFully();}catch(FileNotFoundException absent){return PromptTree.defaultsOnly();}
        if(bytes.length>800000)throw new IOException("Saved prompt file is too large");
        JSONObject value=new JSONObject(new String(bytes,StandardCharsets.UTF_8));if(value.getInt("version")!=1)throw new IOException("Unsupported prompt file version");
        return new PromptTree(value.getJSONObject("overrides"));
    }
    static synchronized PromptTree save(Context context,JSONObject request)throws Exception {
        PromptTree current=load(context);
        if(!current.revision().equals(request.getString("revision")))throw new IOException("Prompts changed since this editor opened. Reload before saving.");
        String action=request.getString("action");if(!action.equals("save")&&!action.equals("reset"))throw new IOException("Unknown prompt action");
        PromptTree next=current.changed(request.getString("id"),action.equals("reset")?null:request.getString("text"));
        byte[] bytes=new JSONObject().put("version",1).put("overrides",next.overrides()).toString(2).getBytes(StandardCharsets.UTF_8);
        AtomicFile file=file(context);FileOutputStream output=null;
        try{output=file.startWrite();output.write(bytes);file.finishWrite(output);}catch(Exception error){if(output!=null)file.failWrite(output);throw error;}
        return next;
    }
}
