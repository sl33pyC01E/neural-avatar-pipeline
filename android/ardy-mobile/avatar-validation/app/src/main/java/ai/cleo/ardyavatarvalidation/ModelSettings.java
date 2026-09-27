package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.*;
import org.json.*;

/** Encoder first, language model second. Exactly the four supported pairings. */
final class ModelSettings {
    static JSONObject select(JSONObject request)throws Exception {
        String pipeline=request.optString("pipeline","gpu-npu"),model=request.optString("model","gemma");
        String backend,encoder;
        switch(pipeline){
            case "gpu-npu":backend="llama-hexagon";encoder="gpu";break;
            case "gpu-gpu":backend="llama-opencl";encoder="gpu";break;
            case "gpu-cpu":backend="llama-cpu";encoder="gpu";break;
            case "cpu-cpu":backend="llama-cpu";encoder="cpu";break;
            default:throw new IOException("Unsupported encoder / decoder pairing");
        }
        for(String key:List.of("backend","llamaEncoder"))if(request.has(key)&&!request.getString(key).equals(key.equals("backend")?backend:encoder))throw new IOException("Model devices do not match the selected pairing");
        int context=request.optInt("contextTokens",4096),visual=request.optInt("visualTokens",280),reasoning=request.optInt("reasoning",0);
        for(String key:List.of("contextTokens","visualTokens","reasoning"))if(request.has(key)&&(!(request.get(key) instanceof Number)||request.getDouble(key)!=request.getInt(key)))throw new IOException("Invalid numeric model setting");
        if(!Set.of("gemma","gemma-e4b").contains(model)||!Set.of(4096,8192,16384,32768,65536,131072).contains(context)||!Set.of(70,140,280,560,1120).contains(visual)||!Set.of(0,128,256,512).contains(reasoning))throw new IOException("Unsupported Gemma settings");
        String memory=request.optString("llamaMemory","mapped");if(!Set.of("mapped","fast").contains(memory))throw new IOException("Unsupported memory preset");
        return new JSONObject().put("model",model).put("pipeline",pipeline).put("backend",backend).put("llamaEncoder",encoder).put("contextTokens",context).put("visualTokens",visual).put("reasoning",reasoning).put("llamaMemory",memory).put("diskCache",request.optBoolean("diskCache",true));
    }
}
