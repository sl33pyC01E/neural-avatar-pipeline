package ai.cleo.ardyavatarvalidation;

import android.content.Context;
import android.os.SystemClock;
import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.*;
import org.json.*;

/** App-owned native workers. All inference stays on this device. */
final class NativeChatRuntime implements AutoCloseable {
    private final Context context;
    private final List<Worker> workers=new ArrayList<>();
    private Worker llm,whisper;
    private volatile WhisperXRuntime whisperX;
    private volatile HttpURLConnection connection;
    private JSONArray messages=new JSONArray();
    private final String token=UUID.randomUUID().toString();
    private volatile boolean closed,cancelled;
    double loadMs;
    String backendEvidence="";

    NativeChatRuntime(Context context){this.context=context;}
    void load(String model,String backend,String asr,int imageMinTokens,int imageTokens,int imageBatchTokens,Consumer<String> progress)throws Exception {
        long start=SystemClock.elapsedRealtimeNanos();
        boolean qwen=model.equals("qwen"),gpu=backend.equals("opencl");
        if(!Set.of("qwen","gemma").contains(model)||!Set.of("cpu","opencl").contains(backend)||!Set.of("tiny","base","small","whisperx-base").contains(asr))throw new IOException("Unknown model configuration");
        List<String> args=new ArrayList<>(Arrays.asList("-m",model(qwen?"Qwen3.5-2B-Q4_K_M.gguf":"gemma-4-E2B-it-Q4_0.gguf"),
            "--mmproj",model(qwen?"qwen35-mmproj-F16.gguf":"mmproj-gemma-4-E2B-it-Q8_0.gguf"),
            "-c","4096","-t","2","-tb","2","-ngl",gpu?"999":"0",gpu?"--mmproj-offload":"--no-mmproj-offload",
            "--no-warmup","--parallel","1","--cache-ram","128","--poll","0","--poll-batch","0","--jinja","--no-webui",
            "--image-min-tokens",String.valueOf(imageMinTokens==0?-1:imageMinTokens),"--image-max-tokens",String.valueOf(imageTokens),
            "--mtmd-batch-max-tokens",String.valueOf(imageBatchTokens),"--api-key",token));
        String label=(qwen?"Qwen":"Gemma")+" "+(gpu?"GPU":"CPU");
        progress.accept("Loading "+label+"…");
        llm=start(gpu?"libcleo_llama_opencl.so":"libcleo_llama.so",args,gpu,model+"-"+backend);
        waitReady(llm,"/health",label,progress);
        try(InputStream log=new FileInputStream(llm.log)){backendEvidence=new String(readUpTo(log,2*1024*1024),StandardCharsets.UTF_8);}
        if(gpu&&!hasGpuEvidence(backendEvidence))throw new IOException("GPU offload was not confirmed. Log: "+llm.log.getName());
        if(qwen){
            progress.accept("Qwen ready · loading Whisper "+asr+"…");
            loadWhisper(asr,progress);
        }
        loadMs=elapsed(start);
    }
    private String model(String name)throws IOException {
        File file=new File(context.getFilesDir(),"benchmark/"+name);
        if(!file.isFile())throw new IOException("Missing installed model: "+name);
        return file.getPath();
    }
    static List<String> whisperArguments(String file){return Arrays.asList("-m",file,"-t","2","-ng","-nf","-bo","1","-bs","1","-l","en");}
    static boolean hasGpuEvidence(String log){return Pattern.compile("(?:CLEO_GPU_LAYERS=|offloaded )([1-9][0-9]*)/[0-9]+").matcher(log).find();}
    void loadWhisper(String asr,Consumer<String> progress)throws Exception {
        if(asr.equals("whisperx-base")){
            progress.accept("Loading WhisperX · VAD, base.en and word alignment…");
            WhisperXRuntime candidate=new WhisperXRuntime(context);
            synchronized(workers){if(closed){candidate.close();throw new InterruptedIOException("Unloaded");}whisperX=candidate;}
            return;
        }
        if(!Set.of("tiny","base","small").contains(asr))throw new IOException("Unknown Whisper model");
        whisper=start("libcleo_whisper.so",whisperArguments(model("ggml-"+asr+".en-q5_1.bin")),false,"whisper-"+asr);
        waitReady(whisper,"/health","Qwen ready · Whisper "+asr,progress);
    }
    JSONObject transcribeAudio(byte[] audio)throws Exception {cancelled=false;return transcribe(audio);}
    private Worker start(String binary,List<String> args,boolean gpu,String label)throws Exception {
        int port;try(ServerSocket socket=new ServerSocket(0,0,InetAddress.getByName("127.0.0.1"))){port=socket.getLocalPort();}
        File executable=new File(context.getApplicationInfo().nativeLibraryDir,binary);
        if(!executable.canExecute())throw new IOException("Packaged runtime is unavailable: "+binary);
        List<String> command=new ArrayList<>();command.add(executable.getPath());command.addAll(args);
        command.addAll(Arrays.asList("--host","127.0.0.1","--port",String.valueOf(port)));
        File[] previous=context.getCacheDir().listFiles(f->f.isFile()&&f.getName().matches("cleo-(qwen|gemma|whisper)-[a-z]+-[0-9]+\\.log"));
        if(previous!=null){Arrays.sort(previous,Comparator.comparingLong(File::lastModified).reversed());for(int i=11;i<previous.length;i++)previous[i].delete();}
        File log=new File(context.getCacheDir(),"cleo-"+label+"-"+System.currentTimeMillis()+".log");
        ProcessBuilder builder=new ProcessBuilder(command).directory(context.getCacheDir()).redirectErrorStream(true).redirectOutput(log);
        builder.environment().put("CLEO_LOCAL_API_KEY",token);
        if(gpu){builder.environment().put("LD_LIBRARY_PATH","/vendor/lib64");builder.environment().put("GGML_OPENCL_KERNEL_CACHE_DIR",context.getCacheDir().getPath());}
        Worker worker;
        synchronized(workers){if(closed)throw new InterruptedIOException("Unloaded");worker=new Worker(builder.start(),port,log);workers.add(worker);}
        return worker;
    }
    private void waitReady(Worker worker,String path,String label,Consumer<String> progress)throws Exception {
        long started=SystemClock.elapsedRealtime(),deadline=started+180000,nextProgress=started+3000;
        while(SystemClock.elapsedRealtime()<deadline){
            if(closed)throw new InterruptedIOException("Unloaded");
            if(!worker.process.isAlive())throw new IOException(label+" exited ("+worker.process.exitValue()+"). "+worker.log.getName()+"\n"+tail(worker.log));
            HttpURLConnection c=open(worker,path);c.setReadTimeout(1000);c.setConnectTimeout(1000);
            try{if(c.getResponseCode()==200)return;}catch(IOException ignored){}finally{c.disconnect();}
            if(SystemClock.elapsedRealtime()>=nextProgress){progress.accept("Loading "+label+" · "+((SystemClock.elapsedRealtime()-started)/1000)+" s…");nextProgress=SystemClock.elapsedRealtime()+3000;}
            Thread.sleep(150);
        }
        throw new IOException(label+" loading timed out. "+worker.log.getName()+"\n"+tail(worker.log));
    }
    JSONObject chat(String prompt,String kind,byte[] media,int reasoning,Consumer<JSONObject> event)throws Exception {
        cancelled=false;
        if(closed||llm==null||!llm.process.isAlive())throw new IOException("Load the model first");
        String transcript=null;JSONObject asrDetails=null;double asrMs=-1;long start=SystemClock.elapsedRealtimeNanos();
        if("audio".equals(kind)&&(whisper!=null||whisperX!=null)){
            event.accept(new JSONObject().put("phase","Transcribing with Whisper…"));
            JSONObject asr=transcribe(media);asrDetails=asr;transcript=asr.getString("text").trim();asrMs=asr.optDouble("deviceRequestMs",-1);
            if(transcript.isEmpty())throw new IOException("Whisper found no speech. No empty turn was added.");
            event.accept(new JSONObject().put("transcript",transcript).put("asrMs",asrMs));
            prompt=(prompt.isBlank()?"":prompt+"\n\n")+transcript;kind="";
        }
        JSONArray content=new JSONArray();content.put(new JSONObject().put("type","text").put("text",prompt));
        if("image".equals(kind))content.put(new JSONObject().put("type","image_url").put("image_url",new JSONObject().put("url","data:image/png;base64,"+Base64.encodeToString(media,Base64.NO_WRAP))));
        if("audio".equals(kind))content.put(new JSONObject().put("type","input_audio").put("input_audio",new JSONObject().put("data",Base64.encodeToString(media,Base64.NO_WRAP)).put("format","wav")));
        JSONObject user=new JSONObject().put("role","user").put("content",content);
        JSONArray requestMessages=new JSONArray();for(int i=0;i<messages.length();i++)requestMessages.put(messages.get(i));requestMessages.put(user);
        JSONObject request=new JSONObject().put("messages",requestMessages).put("stream",true).put("cache_prompt",true).put("id_slot",0)
            .put("temperature",.3).put("seed",42).put("max_tokens",512+reasoning).put("reasoning_budget_tokens",reasoning)
            .put("chat_template_kwargs",new JSONObject().put("enable_thinking",reasoning>0)).put("timings_per_token",true)
            .put("stream_options",new JSONObject().put("include_usage",true));
        HttpURLConnection c=open(llm,"/v1/chat/completions");connection=c;c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
        StringBuilder answer=new StringBuilder();JSONObject timings=new JSONObject(),usage=new JSONObject();double first=-1,device=-1,current=-1;String finish="";
        try{
            try(OutputStream out=c.getOutputStream()){out.write(request.toString().getBytes(StandardCharsets.UTF_8));}
            requireOk(c);
            try(BufferedReader reader=new BufferedReader(new InputStreamReader(c.getInputStream(),StandardCharsets.UTF_8))){
                String line;long lastEmit=0;
                while((line=reader.readLine())!=null){
                    if(closed||cancelled)throw new InterruptedIOException("Response cancelled");
                    if(!line.startsWith("data: "))continue;line=line.substring(6);if(line.equals("[DONE]"))break;
                    JSONObject value=new JSONObject(line);if(value.has("error"))throw new IOException(value.get("error").toString());
                    if(value.has("cleoBenchmark")){JSONObject t=value.getJSONObject("cleoBenchmark");current=t.getDouble("elapsedMs");if(t.optBoolean("complete"))device=current;continue;}
                    if(value.has("timings"))timings=value.getJSONObject("timings");if(value.optJSONObject("usage")!=null)usage=value.getJSONObject("usage");
                    JSONArray choices=value.optJSONArray("choices");if(choices==null)continue;
                    for(int i=0;i<choices.length();i++){
                        JSONObject choice=choices.getJSONObject(i),delta=choice.optJSONObject("delta");
                        String chunk=delta==null||delta.isNull("content")?"":delta.getString("content");
                        if(!chunk.isEmpty()){if(first<0)first=elapsed(start);answer.append(chunk);}
                        if(!choice.isNull("finish_reason"))finish=choice.optString("finish_reason","");
                    }
                    long now=SystemClock.elapsedRealtime();if(now-lastEmit>60){event.accept(new JSONObject().put("partial",answer.toString()).put("firstTokenMs",first));lastEmit=now;}
                }
            }
            if(closed||cancelled)throw new InterruptedIOException("Response cancelled");
            if(answer.length()==0||finish.isEmpty())throw new IOException("The model response did not complete. "+finish);
            messages.put(user).put(new JSONObject().put("role","assistant").put("content",answer.toString()));
            JSONObject result=new JSONObject().put("text",answer.toString()).put("totalMs",elapsed(start)).put("firstTokenMs",first)
                .put("modelMs",device).put("asrMs",asrMs).put("timings",timings).put("usage",usage).put("finishReason",finish)
                .put("cachePrompt",true).put("turns",messages.length()/2);
            if(transcript!=null)result.put("transcript",transcript).put("asrDetails",asrDetails);return result;
        }finally{connection=null;c.disconnect();}
    }
    private JSONObject transcribe(byte[] wav)throws Exception {
        if(whisperX!=null)return whisperX.transcribe(wav);
        if(wav==null||wav.length<44)throw new IOException("No WAV audio attached");
        String boundary="cleo"+UUID.randomUUID();HttpURLConnection c=open(whisper,"/inference");connection=c;
        c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
        try{
            try(OutputStream out=c.getOutputStream()){
                write(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n");
                write(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"input.wav\"\r\nContent-Type: audio/wav\r\n\r\n");out.write(wav);write(out,"\r\n--"+boundary+"--\r\n");
            }
            requireOk(c);JSONObject result=new JSONObject(new String(readUpTo(c.getInputStream(),1024*1024),StandardCharsets.UTF_8));
            if(cancelled)throw new InterruptedIOException("Response cancelled");return result;
        }finally{connection=null;c.disconnect();}
    }
    private HttpURLConnection open(Worker worker,String path)throws IOException {
        HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:"+worker.port+path).openConnection();
        c.setRequestProperty("Authorization","Bearer "+token);c.setConnectTimeout(3000);c.setReadTimeout(180000);return c;
    }
    private static void requireOk(HttpURLConnection c)throws IOException {
        if(c.getResponseCode()>=400){InputStream input=c.getErrorStream();String error=input==null?"":new String(readUpTo(input,2048),StandardCharsets.UTF_8);throw new IOException("Model request "+c.getResponseCode()+": "+error);}
    }
    private static byte[] readUpTo(InputStream input,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;while(out.size()<limit&&(n=input.read(buffer,0,Math.min(buffer.length,limit-out.size())))!=-1)out.write(buffer,0,n);return out.toByteArray();}
    private static void write(OutputStream out,String value)throws IOException{out.write(value.getBytes(StandardCharsets.UTF_8));}
    private static String tail(File file){try(RandomAccessFile input=new RandomAccessFile(file,"r")){input.seek(Math.max(0,input.length()-16384));byte[] data=new byte[(int)(input.length()-input.getFilePointer())];input.readFully(data);return new String(data,StandardCharsets.UTF_8);}catch(IOException e){return e.toString();}}
    static double elapsed(long started){return (SystemClock.elapsedRealtimeNanos()-started)/1e6;}
    void newChat(){messages=new JSONArray();}
    JSONObject agent(String prompt,byte[] image,int reasoning,Consumer<JSONObject> event)throws Exception {
        JSONArray chatHistory=messages;messages=new JSONArray();
        try{return chat(prompt,"image",image,reasoning,event);}finally{messages=chatHistory;}
    }
    void cancel(){cancelled=true;WhisperXRuntime current=whisperX;if(current!=null)current.cancel();HttpURLConnection active=connection;if(active!=null)active.disconnect();}
    int[] pids(){synchronized(workers){return workers.stream().filter(w->w.process.isAlive()).mapToInt(Worker::pid).filter(pid->pid>0).toArray();}}
    int workerCount(){synchronized(workers){return (int)workers.stream().filter(w->w.process.isAlive()).count();}}
    @Override public void close(){closed=true;HttpURLConnection c=connection;if(c!=null)c.disconnect();synchronized(workers){if(whisperX!=null){whisperX.close();whisperX=null;}for(Worker worker:workers)worker.process.destroyForcibly();workers.clear();}messages=new JSONArray();}
    private static final class Worker {
        final java.lang.Process process;final int port;final File log;
        Worker(java.lang.Process process,int port,File log){this.process=process;this.port=port;this.log=log;}
        int pid(){try(FileInputStream input=new FileInputStream(log)){byte[] head=new byte[256];int n=input.read(head);if(n>0){Matcher m=Pattern.compile("CLEO_PID=(\\d+)").matcher(new String(head,0,n,StandardCharsets.UTF_8));if(m.find())return Integer.parseInt(m.group(1));}}catch(Exception ignored){}return 0;}
    }
}
