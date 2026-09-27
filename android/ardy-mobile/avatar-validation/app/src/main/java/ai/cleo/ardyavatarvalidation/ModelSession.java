package ai.cleo.ardyavatarvalidation;

import com.google.ai.edge.litertlm.*;
import java.util.*;

/** The same validated avatar/browser pipeline can use LiteRT or llama.cpp. */
final class ModelSession implements AutoCloseable {
    private final Conversation lite;
    private final LlamaRuntime.Session llama;
    ModelSession(Conversation value){lite=value;llama=null;}
    ModelSession(LlamaRuntime.Session value){llama=value;lite=null;}
    void send(com.google.ai.edge.litertlm.Message message,MessageCallback callback,ThinkingConfig thinking,ResponseFormat format){
        if(lite!=null)lite.sendMessageAsync(message,callback,Collections.emptyMap(),null,null,null,null,thinking,format);
        else llama.send(message,callback,thinking,format);
    }
    void cancelProcess(){if(lite!=null)lite.cancelProcess();else llama.cancel();}
    int getTokenCount(){return lite!=null?lite.getTokenCount():llama.tokens;}
    @Override public void close(){if(lite!=null)lite.close();else llama.close();}
}
