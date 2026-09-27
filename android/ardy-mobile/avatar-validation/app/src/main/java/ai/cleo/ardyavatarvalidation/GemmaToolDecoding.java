package ai.cleo.ardyavatarvalidation;

import com.google.ai.edge.litertlm.ExperimentalFlags;
import java.util.concurrent.Callable;

/** LiteRT snapshots this process-wide flag when each conversation is created. */
final class GemmaToolDecoding {
    @androidx.annotation.OptIn(markerClass=com.google.ai.edge.litertlm.ExperimentalApi.class)
    static synchronized <T> T create(boolean hasTools,Callable<T> create)throws Exception {
        boolean previous=ExperimentalFlags.INSTANCE.getEnableConversationConstrainedDecoding();
        ExperimentalFlags.INSTANCE.setEnableConversationConstrainedDecoding(hasTools);
        try{return create.call();}
        finally{ExperimentalFlags.INSTANCE.setEnableConversationConstrainedDecoding(previous);}
    }
}
