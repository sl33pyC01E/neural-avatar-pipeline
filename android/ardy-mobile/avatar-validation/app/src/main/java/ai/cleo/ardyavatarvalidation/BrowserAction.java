package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.Set;
import org.json.*;

/** Strict boundary between a model's answer and executable browser actions. */
final class BrowserAction {
    static JSONObject parse(String text)throws Exception {
        if(text.length()>24000)throw new IOException("Action response is too large");
        text=text.trim();
        if(text.startsWith("```"))text=text.replaceFirst("^```(?:json)?\\s*","").replaceFirst("\\s*```$","");
        JSONTokener tokens=new JSONTokener(text);Object value=tokens.nextValue();
        if(!(value instanceof JSONObject)||tokens.nextClean()!=0)throw new IOException("Expected one JSON action");
        JSONObject action=(JSONObject)value;validate(action);return action;
    }
    static void validate(JSONObject action)throws Exception {
        String kind=string(action,"action",32);
        if(!Set.of("click","scroll","type","enter","back","ask","done").contains(kind))throw new IOException("Unsupported action "+kind);
        if(action.has("confirm")&&!(action.get("confirm") instanceof Boolean))throw new IOException("confirm must be true or false");
        if(kind.equals("click"))BrowserTarget.coordinates(action);
        if(kind.equals("scroll")&&!Set.of("up","down").contains(string(action,"direction",8)))throw new IOException("Unknown scroll direction");
        if(kind.equals("type"))string(action,"text",4000);
        if(kind.equals("ask")&&string(action,"question",4000).isBlank())throw new IOException("Empty follow-up question");
        if(kind.equals("done"))string(action,"summary",4000);
    }
    private static String string(JSONObject value,String key,int limit)throws Exception {
        Object text=value.get(key);if(!(text instanceof String)||((String)text).length()>limit)throw new IOException("Invalid "+key);return (String)text;
    }
}
