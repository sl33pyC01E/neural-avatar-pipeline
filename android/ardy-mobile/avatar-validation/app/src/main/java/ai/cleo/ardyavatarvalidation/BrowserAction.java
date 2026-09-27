package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.Set;
import java.util.List;
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
        Set<String> fields=switch(kind){
            case "click" -> Set.of("action","box_2d","description","confirm");
            case "scroll" -> Set.of("action","direction","description","confirm");
            case "type" -> Set.of("action","text","description","confirm");
            case "ask" -> Set.of("action","question","description","confirm");
            case "done" -> Set.of("action","summary","description","confirm");
            default -> Set.of("action","description","confirm");
        };
        for(java.util.Iterator<String> i=action.keys();i.hasNext();){String key=i.next();if(!fields.contains(key))throw new IOException("Unexpected field for "+kind+": "+key);}
        if(action.has("description"))string(action,"description",4000);
        if(action.has("confirm")&&!(action.get("confirm") instanceof Boolean))throw new IOException("confirm must be true or false");
        if(kind.equals("click"))BrowserTarget.coordinates(action);
        if(kind.equals("scroll")&&!Set.of("up","down").contains(string(action,"direction",8)))throw new IOException("Unknown scroll direction");
        if(kind.equals("type"))string(action,"text",4000);
        if(kind.equals("ask")&&string(action,"question",4000).isBlank())throw new IOException("Empty follow-up question");
        if(kind.equals("done"))string(action,"summary",4000);
    }
    static JSONObject schema()throws JSONException {
        JSONArray options=new JSONArray();
        for(String kind:List.of("click","scroll","type","enter","back","ask","done")){
            JSONObject properties=new JSONObject().put("action",new JSONObject().put("type","string").put("enum",new JSONArray(List.of(kind))))
                .put("description",new JSONObject().put("type","string").put("maxLength",4000)).put("confirm",new JSONObject().put("type","boolean"));
            JSONArray required=new JSONArray(List.of("action"));
            String field=switch(kind){case "click"->"box_2d";case "scroll"->"direction";case "type"->"text";case "ask"->"question";case "done"->"summary";default->null;};
            if(field!=null){JSONObject spec=new JSONObject().put("type","string").put("maxLength",4000);
                if(kind.equals("click"))spec=new JSONObject().put("type","array").put("minItems",4).put("maxItems",4).put("items",new JSONObject().put("type","number").put("minimum",0).put("maximum",1000));
                if(kind.equals("scroll"))spec.put("enum",new JSONArray(List.of("up","down")));
                if(kind.equals("ask"))spec.put("minLength",1);
                properties.put(field,spec);required.put(field);
            }
            options.put(new JSONObject().put("type","object").put("properties",properties).put("required",required).put("additionalProperties",false));
        }
        return new JSONObject().put("anyOf",options);
    }
    private static String string(JSONObject value,String key,int limit)throws Exception {
        Object text=value.get(key);if(!(text instanceof String)||((String)text).length()>limit)throw new IOException("Invalid "+key);return (String)text;
    }
}
