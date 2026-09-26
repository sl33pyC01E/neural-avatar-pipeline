package ai.cleo.ardyavatarvalidation;

import java.util.*;
import org.json.*;

/** Keeps answer text and model-provided thought channels separate while streaming. */
final class GemmaStream {
    final StringBuilder answer=new StringBuilder(),reasoning=new StringBuilder();
    void append(String text,Map<String,String> channels){
        if(text!=null)answer.append(text);
        if(channels!=null)for(Map.Entry<String,String> channel:channels.entrySet()){
            if(Set.of("analysis","thought","reasoning").contains(channel.getKey())&&channel.getValue()!=null)reasoning.append(channel.getValue());
        }
    }
    JSONObject event()throws JSONException{return new JSONObject().put("partial",answer.toString()).put("reasoning",reasoning.toString());}
}
