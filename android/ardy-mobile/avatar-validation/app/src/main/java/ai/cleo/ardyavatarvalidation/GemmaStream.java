package ai.cleo.ardyavatarvalidation;

import java.util.*;
import org.json.*;

/** Keeps answer text and model-provided thought channels separate while streaming. */
final class GemmaStream {
    final StringBuilder answer=new StringBuilder(),reasoning=new StringBuilder();
    private final boolean spoken;
    private final StringBuilder raw=new StringBuilder();
    GemmaStream(){this(false);}GemmaStream(boolean spoken){this.spoken=spoken;}
    static String spoken(String raw){
        String value=raw.stripLeading();
        if("cleopatra:".startsWith(value.stripTrailing().toLowerCase(Locale.ROOT)))return "";
        return value.replaceFirst("(?i)^cleopatra\\s*:\\s*", "");
    }
    void append(String text,Map<String,String> channels){
        if(text!=null){raw.append(text);answer.setLength(0);answer.append(spoken?spoken(raw.toString()):raw.toString());}
        if(channels!=null)for(Map.Entry<String,String> channel:channels.entrySet()){
            if(Set.of("analysis","thought","reasoning").contains(channel.getKey())&&channel.getValue()!=null)reasoning.append(channel.getValue());
        }
    }
    void finish(){if(spoken){answer.setLength(0);answer.append(raw.toString().stripLeading().replaceFirst("(?i)^cleopatra\\s*:\\s*", ""));}}
    JSONObject event()throws JSONException{return new JSONObject().put("partial",answer.toString()).put("reasoning",reasoning.toString());}
}
