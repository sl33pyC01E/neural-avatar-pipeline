package ai.cleo.ardyavatarvalidation;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;
/** Production cache lifecycle against a local fake peer; no weights or native inference. */
public final class LlamaCacheCheck {
    static int checks,evaluations,restores,saves;static String evaluated="";
    static void check(boolean v,String m){checks++;if(!v)throw new AssertionError(m);}
    public static void main(String[] args)throws Exception {
        File root=Files.createTempDirectory("cleo-cache-contract-").toFile();File directory=new File(root,"prompt-kv");directory.mkdirs();
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",e->{try{
            check(e.getRequestHeaders().getFirst("Authorization").startsWith("Bearer "),"Private endpoint authenticated");
            JSONObject request=new JSONObject(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)),response=new JSONObject();String path=e.getRequestURI().toString();
            if(path.equals("/apply-template")){
                JSONArray messages=request.getJSONArray("messages");StringBuilder rendered=new StringBuilder("<bos>");
                for(int i=0;i<messages.length();i++){JSONObject m=messages.getJSONObject(i);rendered.append('<').append(m.getString("role")).append('>').append(m.getString("content"));}
                response.put("prompt",rendered.toString()+"<assistant>");
            }else if(path.equals("/completion")){
                check(request.getInt("n_predict")==0,"Prefill only; no generated text");evaluated=request.getString("prompt");evaluations++;response.put("timings",new JSONObject().put("prompt_n",42));
            }else if(path.endsWith("action=save")){
                saves++;Files.writeString(new File(directory,request.getString("filename")).toPath(),"FAKE_KV:"+evaluated);response.put("n_saved",42);
            }else if(path.endsWith("action=restore")){
                restores++;check(Files.readString(new File(directory,request.getString("filename")).toPath()).startsWith("FAKE_KV:"),"Valid checkpoint sent to restore");response.put("n_restored",42);
            }else throw new AssertionError("Unexpected endpoint: "+path);
            byte[] bytes=response.toString().getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);
        }catch(Throwable ex){ex.printStackTrace();e.sendResponseHeaders(500,0);}finally{e.close();}});server.start();
        JSONObject settings=new JSONObject().put("diskCache",true),identity=new JSONObject().put("model","e2b").put("context",4096).put("runtime","b11200");
        JSONArray base=new JSONArray().put(new JSONObject().put("role","system").put("content","Saved system instruction"));
        try(LlamaRuntime first=new LlamaRuntime(root,settings,identity,server.getAddress().getPort())){
            JSONObject built=first.preparePrefix(base,null,0,false);
            check(evaluations==1&&saves==1&&restores==0,"First prefix computed and saved once");
            check(evaluated.equals("<bos><system>Saved system instruction<user>"),"Probe and user content excluded from disk");
            check(built.getInt("savedTokens")==42,"Saved-token count comes from runtime");
            String firstKey=built.getString("key");
            try(LlamaRuntime restarted=new LlamaRuntime(root,settings,identity,server.getAddress().getPort())){
                JSONObject hit=restarted.preparePrefix(base,null,0,false);check(hit.getInt("restoredTokens")==42&&evaluations==1&&restores==1,"Fresh runtime restores disk without prefill");
                Files.writeString(new File(directory,firstKey+".bin").toPath(),"CORRUPTED");
                JSONObject repaired=restarted.preparePrefix(base,null,0,false);check(evaluations==2&&restores==1&&repaired.getString("warning").contains("rejected"),"Corrupt file rebuilt without loading bad state");
                restarted.preparePrefix(base,null,0,true);check(evaluations==3&&restores==1,"Rebuild explicitly bypasses old state");
                JSONArray changed=new JSONArray().put(new JSONObject().put("role","system").put("content","Changed system instruction"));
                JSONObject edited=restarted.preparePrefix(changed,null,0,false);check(!firstKey.equals(edited.getString("key"))&&evaluations==4,"Prompt edit invalidates exact prefix");
            }
            try(LlamaRuntime e4=new LlamaRuntime(root,settings,new JSONObject(identity.toString()).put("model","e4b"),server.getAddress().getPort())){
                JSONObject other=e4.preparePrefix(base,null,0,false);check(!firstKey.equals(other.getString("key"))&&evaluations==5,"E4B cannot restore E2B state");
            }
            File unrelated=new File(root,"model.gguf");Files.writeString(unrelated.toPath(),"untouched");
            check(first.clearCache().getInt("files")==0&&Files.readString(unrelated.toPath()).equals("untouched"),"Clear deletes only owned prefixes");
        }finally{server.stop(0);try(var paths=Files.walk(root.toPath())){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}}
        System.out.println(new JSONObject().put("passed",true).put("checks",checks).put("prefills",evaluations).put("restores",restores).put("fakeHttpPeer",true).put("nativeInference",false).put("phoneTest",false));
    }
}
