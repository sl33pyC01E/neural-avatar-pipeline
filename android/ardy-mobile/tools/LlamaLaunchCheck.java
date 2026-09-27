package ai.cleo.ardyavatarvalidation;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Saved startup-log regressions and bounded capture. No models or phone execution. */
public final class LlamaLaunchCheck {
    private static int checks;
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    private static String option(List<String> args,String key){return args.get(args.indexOf(key)+1);}
    public static void main(String[] ignored)throws Exception {
        // b11200 hid native INFO/offload counts at verbosity 3. Both actual
        // accelerator failures had already reached model-loaded/server-listening.
        String healthy="common_init_result: model loaded\nmain: server is listening on http://127.0.0.1:12345\n";
        for(String backend:List.of("llama-opencl","llama-hexagon")){
            JSONObject observed=LlamaLaunch.evidence(backend,healthy);
            check(!observed.getBoolean("offloadConfirmed")&&observed.getInt("offloadedLayers")==-1,"Missing optional log evidence must be representable without failing startup");
            check(observed.getString("summary").contains("requested")&&observed.getString("summary").contains("unavailable"),"Unconfirmed acceleration must not be labelled confirmed");
        }
        JSONObject zero=LlamaLaunch.evidence("llama-opencl",healthy+"offloaded 0/36 layers to GPU\n");
        check(!zero.getBoolean("offloadConfirmed")&&zero.getString("summary").contains("0/36"),"Explicit zero offload must remain visible");
        JSONObject gpu=LlamaLaunch.evidence("llama-opencl","x".repeat(28000)+"\nload_tensors: offloaded 36/36 layers to GPU\nload_tensors: GPUOpenCL model buffer size = 1250.00 MiB\nresolve_fused_ops: Flash Attention not supported, set to disabled\n"+healthy);
        check(gpu.getBoolean("offloadConfirmed")&&gpu.getInt("offloadedLayers")==36,"Offload evidence survives a long prefix");
        check(gpu.getString("summary").contains("Flash Attention disabled"),"Operator fallback remains visible");
        check(gpu.getJSONArray("buffers").length()==1,"Startup buffer measurements retained");
        JSONObject partial=LlamaLaunch.evidence("llama-hexagon","offloaded 20/43 layers to GPU\n");
        check(partial.getString("summary").contains("HTP0")&&partial.getString("summary").contains("20/43"),"Partial offload must retain actual count and requested device");
        check(!LlamaLaunch.evidence("llama-cpu","offloaded 0/43 layers to GPU").getBoolean("offloadConfirmed"),"CPU never labelled accelerated");
        JSONObject split=LlamaLaunch.evidence("llama-hexagon","gpu","offloaded 36/36 layers to GPU\nclip_ctx: CLIP using OpenCL backend\nclip_ctx: CLIP using OpenCL backend\n");
        check(split.getString("requestedDevice").equals("HTP0")&&split.getString("requestedEncoderDevice").equals("GPUOpenCL"),"Language and encoder requests must be distinct");
        check(split.getJSONArray("encoderBackends").length()==1&&split.getJSONArray("encoderBackends").getString(0).equals("OpenCL"),"Actual encoder backend captured without duplicating vision/audio initialization");
        check(LlamaLaunch.evidence("llama-hexagon","gpu",healthy).getString("summary").contains("backend unconfirmed"),"Requested encoder must not be presented as observed");
        JSONObject fallback=LlamaLaunch.evidence("llama-hexagon","gpu","CLIP using CPU backend\n");
        check(fallback.getJSONArray("encoderBackends").getString(0).equals("CPU"),"Encoder fallback remains visible despite GPU request");
        for(String backend:List.of("llama-cpu","llama-opencl","llama-hexagon"))for(String memory:List.of("mapped","fast"))for(String encoder:List.of("auto","cpu","gpu")){
            List<String> args=LlamaLaunch.options(backend,memory,encoder);boolean cpu=backend.equals("llama-cpu"),mapped=memory.equals("mapped");
            check(option(args,"--log-verbosity").equals("4"),"Native offload diagnostics enabled");
            check(option(args,"--lazy-mode").equals("on")&&option(args,"--ctx-checkpoints").equals("2")&&option(args,"--cache-ram").equals("0"),"Embedding and cache residency policy");
            check(args.contains("--no-repack")== (cpu&&mapped),"Only memory-focused CPU overrides backend weight layout");
            check(option(args,"-b").equals(mapped?"128":"256")&&option(args,"-ub").equals(mapped?"64":"128"),"Memory preset reaches graph batch sizes");
            check(option(args,"-ngl").equals(cpu?"0":"999")&&option(args,"--device").equals(cpu?"none":backend.equals("llama-opencl")?"GPUOpenCL":"HTP0"),"Requested backend remains explicit");
            boolean encoderGpu=encoder.equals("gpu")||(encoder.equals("auto")&&backend.equals("llama-opencl"));
            check(args.contains("--mmproj-offload")==encoderGpu&&args.contains("--no-mmproj-offload")!=encoderGpu,"Projector offload is independent of language device, without conflicting flags");
            check(option(args,"--mmproj-device").equals(encoderGpu?"GPUOpenCL":"none"),"Explicit projector device prevents accidental HTP inheritance");
        }
        try{LlamaLaunch.options("llama-bogus","mapped");throw new AssertionError("Unknown backend accepted");}catch(IOException expected){checks++;}
        try{LlamaLaunch.options("llama-cpu","bogus");throw new AssertionError("Unknown preset accepted");}catch(IOException expected){checks++;}
        try{LlamaLaunch.options("llama-hexagon","mapped","bogus");throw new AssertionError("Unknown encoder accepted");}catch(IOException expected){checks++;}
        Path directory=Files.createTempDirectory("cleo-native-log-check-");Path file=directory.resolve("native.log");
        try{
            LlamaLog capture=new LlamaLog(file.toFile());
            // Simulate verbose native output far larger than the cap, then a fatal
            // message; only recent diagnostics should survive without growing RAM.
            for(int i=0;i<180;i++)capture.append("native output "+i+" "+"x".repeat(16384));
            capture.start(new ByteArrayInputStream("last native failure\n".getBytes(StandardCharsets.UTF_8)));capture.finish();
            check(Files.size(file)<=1024*1024,"Diagnostic log is bounded");
            check(capture.text(4096).endsWith("last native failure\n"),"Recent native failure survives rotation and async EOF");
            check(!capture.text(1024*1024).contains("native output 0 "),"Old output is rotated");
            LlamaLog fresh=new LlamaLog(file.toFile());check(fresh.text(4096).isEmpty(),"A new attempt cannot reuse old offload evidence");
        }finally{Files.deleteIfExists(file);Files.delete(directory);}
        System.out.println(new JSONObject().put("passed",true).put("checks",checks).put("nativeInference",false).put("phoneTest",false));
    }
}
