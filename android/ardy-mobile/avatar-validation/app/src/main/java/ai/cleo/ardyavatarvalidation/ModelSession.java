package ai.cleo.ardyavatarvalidation;
import static ai.cleo.ardyavatarvalidation.ModelData.*;
/** One llama.cpp conversation through the validated app protocol. */
final class ModelSession implements AutoCloseable {
    private final LlamaRuntime.Session llama;
    ModelSession(LlamaRuntime.Session value){llama=value;}
    void send(ModelMessage message,MessageCallback callback,ThinkingConfig thinking,ResponseFormat format){llama.send(message,callback,thinking,format);}
    void cancelProcess(){llama.cancel();}int getTokenCount(){return llama.tokens;}
    @Override public void close(){llama.close();}
}
