package ai.cleo.ardyavatarvalidation;

import android.content.Context;
import static ai.cleo.ardyavatarvalidation.ModelData.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Pinned app-private llama.cpp worker. Starts only on an explicit model load. */
final class LlamaRuntime implements AutoCloseable {
    private final Context context;
    private final String token=UUID.randomUUID().toString();
    private final File cacheDir,pidFile;
    private File log;
    private LlamaLog capture;
    private JSONObject startupEvidence=new JSONObject();
    private volatile Process process;
    private volatile HttpURLConnection connection;
    private volatile boolean closed,cancelled;
    private int port;
    private JSONObject settings,identity;
    volatile JSONObject lastTiming=new JSONObject(),cacheState=new JSONObject();
    volatile String backendEvidence="Not loaded";
    private static final long CACHE_LIMIT=2L*1024*1024*1024;

    LlamaRuntime(Context c){context=c;cacheDir=new File(c.getFilesDir(),"prompt-kv");log=new File(c.getCacheDir(),"cleo-llama.log");pidFile=new File(c.getCacheDir(),"cleo-llama.pid");}
    // Host contract tests use a fake HTTP peer, never a model or phone.
    LlamaRuntime(File directory,JSONObject selection,JSONObject modelIdentity,int localPort){
        context=null;cacheDir=new File(directory,"prompt-kv");cacheDir.mkdirs();log=new File(directory,"test.log");pidFile=new File(directory,"test.pid");settings=selection;identity=modelIdentity;port=localPort;
    }
    void load(JSONObject selection,Consumer<String> progress)throws Exception {
        settings=new JSONObject(selection.toString());cacheDir.mkdirs();
        JSONObject manifest;try(InputStream in=context.getAssets().open("gemma-qat.json")){manifest=new JSONObject(new String(read(in,65536),StandardCharsets.UTF_8));}
        String variant=settings.getString("model").equals("gemma-e4b")?"E4B":"E2B";
        File model=model(manifest,"gemma-4-"+variant+"_q4_0-it.gguf"),projector=model(manifest,"gemma-4-"+variant+"-it-mmproj.gguf");
        identity=new JSONObject().put("runtime",manifest.getJSONObject("runtime").getString("commit")).put("settings",settings).put("models",manifest.getJSONArray("models"));
        String backend=settings.getString("backend"),dir=context.getApplicationInfo().nativeLibraryDir;
        List<String> options=LlamaLaunch.options(backend,settings.optString("llamaMemory","mapped"),settings.optString("llamaEncoder","auto"));identity.put("launchOptions",new JSONArray(options));
        log=new File(context.getCacheDir(),"cleo-"+variant.toLowerCase(Locale.ROOT)+"-"+backend+".log");capture=new LlamaLog(log);
        try(ServerSocket socket=new ServerSocket(0,0,InetAddress.getByName("127.0.0.1"))){port=socket.getLocalPort();}
        List<String> cmd=new ArrayList<>(List.of(dir+"/libcleo_llama_runner.so",pidFile.getPath(),dir+"/libcleo_llama_server.so",
            "-m",model.getPath(),"--mmproj",projector.getPath(),"-c",String.valueOf(settings.getInt("contextTokens"))));
        cmd.addAll(options);cmd.addAll(List.of("--image-max-tokens",String.valueOf(settings.getInt("visualTokens")),
            "--slot-save-path",cacheDir.getPath()+"/","--host","127.0.0.1","--port",String.valueOf(port),"--api-key",token));
        ProcessBuilder builder=new ProcessBuilder(cmd).directory(context.getCacheDir()).redirectErrorStream(true);
        builder.environment().put("LD_LIBRARY_PATH",dir+":/vendor/lib64");
        builder.environment().put("ADSP_LIBRARY_PATH",dir+";/vendor/lib/rfsa/adsp;/system/lib/rfsa/adsp");
        builder.environment().put("GGML_HEXAGON_DEVICES","1");
        builder.environment().put("GGML_OPENCL_KERNEL_CACHE_DIR",context.getCacheDir().getPath());
        synchronized(this){if(closed)throw new InterruptedIOException("Unloaded");process=builder.start();capture.start(process.getInputStream());}
        long start=(System.nanoTime()/1_000_000L),last=0;
        while((System.nanoTime()/1_000_000L)-start<240000){
            check();if(!process.isAlive())throw new IOException("llama.cpp stopped while loading. "+tail());
            HttpURLConnection c=open("/health");c.setReadTimeout(1000);c.setConnectTimeout(1000);
            boolean ready=false;try{ready=c.getResponseCode()==200;}catch(IOException ignored){}finally{c.disconnect();}
            if(ready){
                // /health=200 is the readiness contract. Native INFO is TRACE (4)
                // in b11200, so a missing log phrase must never kill a healthy worker.
                String output="";try{output=capture.text(1024*1024);}catch(IOException ignored){}
                startupEvidence=LlamaLaunch.evidence(backend,settings.optString("llamaEncoder","auto"),output);
                backendEvidence=startupEvidence.getString("summary");
                try{Files.write(new File(context.getCacheDir(),"cleo-"+variant.toLowerCase(Locale.ROOT)+"-"+backend+"-startup.json").toPath(),
                    new JSONObject().put("selection",settings).put("evidence",startupEvidence).put("log",log.getName()).toString().getBytes(StandardCharsets.UTF_8));}
                catch(IOException failure){startupEvidence.put("logWarning","Startup receipt could not be saved: "+failure.getMessage());}
                cacheState=cacheStatus();return;
            }
            if((System.nanoTime()/1_000_000L)-last>3000){progress.accept("Loading Gemma QAT · "+backend+" · "+(((System.nanoTime()/1_000_000L)-start)/1000)+" s");last=(System.nanoTime()/1_000_000L);}
            Thread.sleep(150);
        }throw new IOException("Gemma QAT load timed out. "+tail());
    }
    private File model(JSONObject manifest,String name)throws Exception {
        JSONArray files=manifest.getJSONArray("models");JSONObject expected=null;for(int i=0;i<files.length();i++)if(files.getJSONObject(i).getString("file").equals(name))expected=files.getJSONObject(i);
        File f=new File(context.getFilesDir(),"benchmark/"+name);
        if(expected==null||!f.isFile()||f.length()!=expected.getLong("bytes"))throw new IOException("Missing or incomplete official QAT model: "+name);
        // Provisioner verifies SHA-256 before atomic installation. Include size/mtime
        // in the identity too, so replacing a file cannot reuse an earlier KV file.
        expected.put("installedModified",f.lastModified());return f;
    }
    Session session(String system,JSONObject tool,int reasoning,int maxTokens)throws Exception {
        cancelled=false;check();return new Session(system,tool,reasoning,maxTokens);
    }
    final class Session implements AutoCloseable {
        final JSONArray messages=new JSONArray();final JSONObject tool;final int reasoning,maxTokens;
        final Deque<JSONObject> pending=new ArrayDeque<>();int tokens=-1;boolean ended;
        Session(String system,JSONObject tool,int reasoning,int maxTokens)throws Exception {
            this.tool=tool;this.reasoning=reasoning;this.maxTokens=maxTokens;
            if(!system.isBlank())messages.put(new JSONObject().put("role","system").put("content",system));
            if(settings.optBoolean("diskCache",true))try{
                preparePrefix(messages,tool,reasoning,false);tokens=cacheState.optInt("restoredTokens",cacheState.optInt("savedTokens",-1));
            }catch(Exception failure){check();cacheState=cacheStatus().put("operation","Disk cache unavailable; evaluating prompt normally").put("warning",failure.getMessage());}
        }
        void send(ModelMessage input,MessageCallback callback,ThinkingConfig thinking,ResponseFormat format){
            try{
                if(ended)throw new IOException("Conversation closed");cancelled=false;check();
                JSONArray next=new JSONArray();for(int i=0;i<messages.length();i++)next.put(messages.get(i));JSONArray add=LlamaProtocol.input(input,pending);for(int i=0;i<add.length();i++)next.put(add.get(i));
                int budget=thinking==null?reasoning:thinking.getEnableThinking()?thinking.getThinkingTokenBudget():0;
                JSONObject request=LlamaProtocol.request(next,tool,budget,maxTokens);
                if(format!=null)request.put("response_format",new JSONObject().put("type","json_schema").put("json_schema",new JSONObject().put("name","browser_action").put("strict",true).put("schema",new JSONObject(format.getSchemaOrPattern()))));
                LlamaProtocol.Stream result=stream(request,callback);List<ToolCall> calls=result.finish();check();
                for(int i=0;i<add.length();i++)messages.put(add.get(i));messages.put(result.assistant());pending.addAll(result.calls.values());
                tokens=result.usage.optInt("total_tokens",-1);
                lastTiming=new JSONObject().put("timings",result.timings).put("usage",result.usage).put("finishReason",result.finish);
                if(!calls.isEmpty())callback.onMessage(new ModelMessage(Role.MODEL,Contents.of(""),calls,Collections.emptyMap()));
                callback.onDone();
            }catch(Throwable e){ended=true;callback.onError(e);}
        }
        void cancel(){LlamaRuntime.this.cancel();}
        @Override public void close(){ended=true;}
    }
    private LlamaProtocol.Stream stream(JSONObject request,MessageCallback callback)throws Exception {
        HttpURLConnection c=open("/v1/chat/completions");connection=c;
        try{
            postBody(c,request);requireOk(c);LlamaProtocol.Stream stream=new LlamaProtocol.Stream();
            try(BufferedReader reader=new BufferedReader(new InputStreamReader(c.getInputStream(),StandardCharsets.UTF_8))){
                String line;while((line=reader.readLine())!=null){check();if(!line.startsWith("data:"))continue;String data=line.substring(5).trim();if(data.equals("[DONE]"))break;if(!data.isEmpty())callback.onMessage(stream.accept(new JSONObject(data)));}
            }check();return stream;
        }finally{connection=null;c.disconnect();}
    }
    JSONObject preparePrefix(JSONArray base,JSONObject tool,int reasoning,boolean rebuild)throws Exception {
        cancelled=false;check();long start=System.nanoTime();
        JSONArray a=new JSONArray(base.toString()).put(new JSONObject().put("role","user").put("content","A_CLEO_PREFIX_PROBE"));
        JSONArray b=new JSONArray(base.toString()).put(new JSONObject().put("role","user").put("content","Z_CLEO_PREFIX_PROBE"));
        // Render twice without inference. Only their common prefix is evaluated:
        // no probe text, user messages, images, or generated answers are persisted.
        String prefix=LlamaProtocol.prefix(post("/apply-template",LlamaProtocol.request(a,tool,reasoning,1)).getString("prompt"),post("/apply-template",LlamaProtocol.request(b,tool,reasoning,1)).getString("prompt"));
        String key=LlamaProtocol.hash(LlamaProtocol.canonical(identity)+"\n"+prefix);
        File data=new File(cacheDir,key+".bin"),meta=new File(cacheDir,key+".json"),partial=new File(cacheDir,key+".partial");
        String warning="";
        if(!rebuild&&data.isFile()&&meta.isFile())try{
            JSONObject m=new JSONObject(new String(Files.readAllBytes(meta.toPath()),StandardCharsets.UTF_8));
            if(!key.equals(m.getString("key"))||data.length()!=m.getLong("bytes")||!digest(data).equals(m.getString("sha256")))throw new IOException("Saved KV checksum mismatch");
            JSONObject restored=post("/slots/0?action=restore",new JSONObject().put("filename",data.getName()));
            if(restored.optInt("n_restored",0)<=0)throw new IOException("Empty saved KV state");data.setLastModified(System.currentTimeMillis());
            cacheState=cacheStatus().put("operation","Restored disk prefix").put("key",key).put("restoredTokens",restored.getInt("n_restored")).put("restoreMs",elapsed(start));return cacheState;
        }catch(Exception bad){check();warning="Saved prefix rejected: "+bad.getMessage();Files.deleteIfExists(data.toPath());Files.deleteIfExists(meta.toPath());}
        JSONObject evaluated=post("/completion",new JSONObject().put("prompt",prefix).put("n_predict",0).put("cache_prompt",true).put("id_slot",0));
        double prefill=elapsed(start);JSONObject saved=post("/slots/0?action=save",new JSONObject().put("filename",partial.getName()));
        if(!partial.isFile()||partial.length()==0||saved.optInt("n_saved",0)<=0)throw new IOException("Runtime did not save a prompt prefix");
        if(partial.length()>CACHE_LIMIT){Files.deleteIfExists(partial.toPath());throw new IOException("Prompt prefix exceeds the 2 GiB disk cache limit");}
        JSONObject m=new JSONObject().put("key",key).put("bytes",partial.length()).put("sha256",digest(partial)).put("savedTokens",saved.getInt("n_saved"));
        Files.move(partial.toPath(),data.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        File temp=new File(cacheDir,key+".meta-partial");Files.write(temp.toPath(),m.toString().getBytes(StandardCharsets.UTF_8));Files.move(temp.toPath(),meta.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);prune(key);
        cacheState=cacheStatus().put("operation","Built and saved disk prefix").put("key",key).put("savedTokens",saved.getInt("n_saved")).put("prefillMs",prefill).put("saveMs",elapsed(start)-prefill).put("warning",warning).put("prefillTimings",evaluated.optJSONObject("timings"));return cacheState;
    }
    private void prune(String keep)throws IOException {
        File[] files=cacheDir.listFiles(f->f.getName().matches("[0-9a-f]{64}\\.bin"));if(files==null)return;
        Arrays.sort(files,Comparator.comparingLong(File::lastModified));long size=Arrays.stream(files).mapToLong(File::length).sum();int count=files.length;
        for(File f:files)if(!f.getName().equals(keep+".bin")&&(size>CACHE_LIMIT||count>12)){size-=f.length();count--;Files.deleteIfExists(f.toPath());Files.deleteIfExists(new File(cacheDir,f.getName().replace(".bin",".json")).toPath());}
    }
    JSONObject cacheStatus()throws JSONException {
        File[] files=cacheDir.listFiles(f->f.getName().matches("[0-9a-f]{64}\\.bin"));long bytes=files==null?0:Arrays.stream(files).mapToLong(File::length).sum();
        return new JSONObject().put("supported",true).put("enabled",settings!=null&&settings.optBoolean("diskCache",true)).put("files",files==null?0:files.length).put("bytes",bytes).put("limitBytes",CACHE_LIMIT).put("backendEvidence",backendEvidence).put("startupEvidence",startupEvidence).put("logFile",log.getName());
    }
    JSONObject clearCache()throws Exception {
        File[] files=cacheDir.listFiles(f->f.isFile()&&f.getName().matches("[0-9a-f]{64}\\.(bin|json|partial|meta-partial)"));if(files!=null)for(File f:files)Files.delete(f.toPath());
        cacheState=cacheStatus().put("operation","Disk prefixes cleared; live conversation retained");return cacheState;
    }
    private JSONObject post(String path,JSONObject body)throws Exception {
        check();HttpURLConnection c=open(path);connection=c;try{postBody(c,body);requireOk(c);JSONObject r=new JSONObject(new String(read(c.getInputStream(),4*1024*1024),StandardCharsets.UTF_8));check();return r;}finally{connection=null;c.disconnect();}
    }
    private HttpURLConnection open(String path)throws IOException {
        HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:"+port+path).openConnection();c.setConnectTimeout(3000);c.setReadTimeout(180000);c.setRequestProperty("Authorization","Bearer "+token);return c;
    }
    private static void postBody(HttpURLConnection c,JSONObject body)throws IOException {
        c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream o=c.getOutputStream()){o.write(bytes);}
    }
    private static void requireOk(HttpURLConnection c)throws IOException {int status=c.getResponseCode();if(status>=400){InputStream in=c.getErrorStream();throw new IOException("llama.cpp HTTP "+status+": "+(in==null?"":new String(read(in,4096),StandardCharsets.UTF_8)));}}
    private static byte[] read(InputStream input,int max)throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[8192];int n;while((n=input.read(bytes,0,Math.min(bytes.length,max-out.size())))>0)out.write(bytes,0,n);return out.toByteArray();}
    private static String digest(File f)throws Exception {MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[1024*1024];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:digest.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    private static double elapsed(long start){return (System.nanoTime()-start)/1e6;}
    private String tail(){try{return capture==null?"No native log captured":capture.text(24000);}catch(IOException e){return e.toString();}}
    int pid(){if(process==null||!process.isAlive())return 0;try{return Integer.parseInt(new String(Files.readAllBytes(pidFile.toPath()),StandardCharsets.UTF_8).trim());}catch(Exception e){return 0;}}
    private void check()throws IOException {if(closed||cancelled)throw new InterruptedIOException("Model operation cancelled");if(process!=null&&!process.isAlive())throw new IOException("llama.cpp worker stopped. "+tail());}
    void cancel(){cancelled=true;HttpURLConnection c=connection;if(c!=null)c.disconnect();}
    @Override public synchronized void close(){closed=true;cancel();if(process!=null){process.destroyForcibly();process=null;}if(capture!=null)capture.finish();}
}
