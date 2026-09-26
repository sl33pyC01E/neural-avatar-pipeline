package ai.cleo.ardyavatarvalidation;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Host-only protocol checks with a fake HTTP model. No model or device is executed. */
public final class ModelChatProtocolCheck {
    static final List<JSONObject> requests=new ArrayList<>();
    static boolean fail,truncate;
    public static void main(String[] args)throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{try {
            check(exchange.getRequestHeaders().getFirst("Authorization").startsWith("Bearer "),"Authenticated loopback");
            byte[] input=exchange.getRequestBody().readAllBytes();String response;
            if(exchange.getRequestURI().getPath().equals("/inference")){
                check(new String(input,StandardCharsets.UTF_8).contains("filename=\"input.wav\""),"Whisper WAV multipart");
                response="{\"text\":\"spoken request\",\"deviceRequestMs\":15}";
            }else{
                JSONObject request=new JSONObject(new String(input,StandardCharsets.UTF_8));requests.add(request);
                check(request.getInt("reasoning_budget_tokens")==256,"Reasoning budget is forwarded under the actual API key");
                check(request.getJSONObject("chat_template_kwargs").getBoolean("enable_thinking"),"Reasoning enabled");
                check(request.getBoolean("cache_prompt")&&request.getInt("id_slot")==0,"Persistent prefix slot");
                if(fail){exchange.sendResponseHeaders(400,3);exchange.getResponseBody().write("bad".getBytes());exchange.close();return;}
                response="data: {\"choices\":[{\"delta\":{\"content\":null,\"reasoning_content\":\"thinking\"},\"finish_reason\":null}]}\n\n"
                    +"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n";
                if(!truncate)response+="data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"timings\":{\"cache_n\":17}}\n\ndata: [DONE]\n\n";
            }
            byte[] bytes=response.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        }catch(Throwable error){error.printStackTrace();exchange.close();}});
        server.start();
        try(NativeChatRuntime runtime=new NativeChatRuntime(null)){
            Class<?> worker=Class.forName("ai.cleo.ardyavatarvalidation.NativeChatRuntime$Worker");Constructor<?> constructor=worker.getDeclaredConstructors()[0];constructor.setAccessible(true);
            Process dummy=new Process(){public OutputStream getOutputStream(){return OutputStream.nullOutputStream();}public InputStream getInputStream(){return InputStream.nullInputStream();}public InputStream getErrorStream(){return InputStream.nullInputStream();}public int waitFor(){return 0;}public int exitValue(){throw new IllegalThreadStateException();}public void destroy(){}public boolean isAlive(){return true;}};
            Object endpoint=constructor.newInstance(dummy,server.getAddress().getPort(),new File("unused"));
            Field llm=NativeChatRuntime.class.getDeclaredField("llm");llm.setAccessible(true);llm.set(runtime,endpoint);
            JSONObject first=runtime.chat("first","image",new byte[]{1,2,3},256,event->{});
            check(first.getString("text").equals("hello"),"Reasoning/null deltas are not answer text");
            check(first.getJSONObject("timings").getInt("cache_n")==17,"Cache metrics");
            runtime.chat("second","",null,256,event->{});
            JSONArray history=requests.get(1).getJSONArray("messages");check(history.length()==3,"Previous user and assistant prefix");
            check(history.getJSONObject(0).getJSONArray("content").getJSONObject(1).getJSONObject("image_url").getString("url").endsWith("AQID"),"Image retained in prefix");
            runtime.agent("browser goal",new byte[]{4},256,event->{});check(requests.get(2).getJSONArray("messages").length()==1,"Browser screenshot does not inherit chat");
            runtime.chat("third","",null,256,event->{});check(requests.get(3).getJSONArray("messages").length()==5,"Chat survives browser turn");
            fail=true;try{runtime.chat("failed","",null,256,event->{});throw new AssertionError("HTTP error accepted");}catch(IOException expected){}fail=false;
            truncate=true;try{runtime.chat("truncated","",null,256,event->{});throw new AssertionError("Truncated stream accepted");}catch(IOException expected){}truncate=false;
            runtime.chat("fourth","",null,256,event->{});check(requests.get(6).getJSONArray("messages").length()==7,"Failed turns never enter history");
            runtime.newChat();Field whisper=NativeChatRuntime.class.getDeclaredField("whisper");whisper.setAccessible(true);whisper.set(runtime,endpoint);
            JSONObject audio=runtime.chat("","audio",new byte[44],256,event->{});
            check(audio.getString("transcript").equals("spoken request"),"Whisper transcript");
            check(requests.get(7).getJSONArray("messages").getJSONObject(0).getJSONArray("content").length()==1,"Qwen receives transcript, not unsupported audio");
            try{runtime.chat("cancel","",null,256,event->runtime.cancel());throw new AssertionError("Cancelled response accepted");}catch(IOException expected){}
            runtime.chat("after cancel","",null,256,event->{});check(requests.get(9).getJSONArray("messages").length()==3,"Cancelled turn never enters history");
        }finally{server.stop(0);}
        String[] invalid={"{\"action\":\"click\",\"box\":[0,0,1001,2]}","{\"action\":\"click\",\"box\":[0,0,0,2]}","{\"action\":\"click\",\"box\":[\"0\",0,2,2]}","{\"action\":\"type\",\"text\":1}","{\"action\":\"enter\",\"confirm\":\"true\"}","{\"action\":\"shell\"}","{\"action\":\"scroll\",\"direction\":\"left\"}","{\"action\":\"ask\",\"question\":\"\"}","{\"action\":\"back\"} trailing"};
        for(String text:invalid){try{BrowserAction.parse(text);throw new AssertionError("Unsafe action accepted: "+text);}catch(IOException|JSONException expected){}}
        check(BrowserAction.parse("```json\n{\"action\":\"click\",\"box\":[0,0,1000,1000],\"confirm\":true}\n```").getBoolean("confirm"),"Confirmation preserved");
        check(BrowserAction.parse("{\"action\":\"ask\",\"question\":\"Which tab?\"}").getString("action").equals("ask"),"Follow-up action");
        BrowserAction.parse("{\"action\":\"done\",\"summary\":\"Finished\"}");
        System.out.println("{\"passed\":true,\"phoneTest\":false,\"model\":\"fake HTTP endpoint\",\"prefixHistory\":true,\"reasoningBudget\":true,\"imageInput\":true,\"whisperRouting\":true,\"failedTurnsExcluded\":true,\"browserIsolation\":true,\"invalidActionsRejected\":9}");
    }
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
}
