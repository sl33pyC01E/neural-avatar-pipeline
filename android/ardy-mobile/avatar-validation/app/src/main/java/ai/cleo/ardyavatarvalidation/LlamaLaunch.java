package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Launch policy and observations, independent of Android/inference for regression tests. */
final class LlamaLaunch {
    static List<String> options(String backend,String memory)throws IOException {
        if(!Set.of("llama-cpu","llama-opencl","llama-hexagon").contains(backend)||!Set.of("mapped","fast").contains(memory))throw new IOException("Unsupported llama.cpp launch settings");
        boolean lean=memory.equals("mapped"),gpu=backend.equals("llama-opencl"),npu=backend.equals("llama-hexagon");
        List<String> args=new ArrayList<>(List.of("-t","2","-tb","2","-b",lean?"128":"256","-ub",lean?"64":"128",
            "-ngl",(gpu||npu)?"999":"0","--device",gpu?"GPUOpenCL":npu?"HTP0":"none",
            gpu?"--mmproj-offload":"--no-mmproj-offload","--no-warmup","--parallel","1",
            "--cache-ram","0","--ctx-checkpoints","2","--lazy-mode","on","--fit","off",
            "--poll","0","--poll-batch","0","--jinja","--no-webui","--no-context-shift","--log-verbosity","4"));
        // GPU/NPU own their weight layout. CPU can avoid the anonymous repacked copy
        // and leave immutable weights in the model's reclaimable file mapping.
        if(lean&&backend.equals("llama-cpu"))args.add("--no-repack");return args;
    }
    static JSONObject evidence(String backend,String output)throws JSONException {
        String device=backend.equals("llama-opencl")?"GPUOpenCL":backend.equals("llama-hexagon")?"HTP0":"CPU";
        JSONObject result=new JSONObject().put("requestedDevice",device);int offloaded=-1,total=-1;
        Matcher layers=Pattern.compile("offloaded\\s+(\\d+)/(\\d+)\\s+layers").matcher(output);
        while(layers.find()){offloaded=Integer.parseInt(layers.group(1));total=Integer.parseInt(layers.group(2));}
        result.put("offloadedLayers",offloaded).put("totalLayers",total);
        boolean confirmed=!backend.equals("llama-cpu")&&offloaded>0;
        result.put("offloadConfirmed",confirmed);
        String detail=backend.equals("llama-cpu")?"CPU":offloaded>=0?device+" · "+offloaded+"/"+total+" layers offloaded":device+" requested · offload count unavailable";
        if(output.contains("Flash Attention not supported, set to disabled"))detail+=" · Flash Attention disabled by runtime";
        JSONArray buffers=new JSONArray();
        for(String line:output.split("\\R"))if(line.contains("buffer size")||line.contains("KV self size")||line.contains("lazy read enabled"))buffers.put(line.trim());
        return result.put("summary",detail).put("buffers",buffers);
    }
}
