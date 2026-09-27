package ai.cleo.ardyavatarvalidation;

import static ai.cleo.ardyavatarvalidation.ModelData.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Pure wire protocol; no inference, native handles, or automatic tool execution. */
final class LlamaProtocol {
    static JSONObject request(JSONArray messages,JSONObject tool,int reasoning,int maxTokens)throws JSONException {
        JSONObject r=new JSONObject().put("messages",messages).put("stream",true).put("cache_prompt",true).put("id_slot",0)
            .put("temperature",.3).put("top_k",40).put("top_p",.95).put("seed",42).put("max_tokens",maxTokens+reasoning)
            .put("reasoning_format","deepseek").put("reasoning_budget_tokens",reasoning)
            .put("chat_template_kwargs",new JSONObject().put("enable_thinking",reasoning>0))
            .put("timings_per_token",true).put("stream_options",new JSONObject().put("include_usage",true));
        if(tool!=null)r.put("tools",new JSONArray().put(new JSONObject().put("type","function").put("function",tool)));
        return r;
    }
    static JSONArray input(ModelMessage m,Deque<JSONObject> pending)throws Exception {
        JSONArray result=new JSONArray(),parts=new JSONArray();
        for(Content c:m.getContents().getContents()){
            if(c instanceof Content.Text)parts.put(new JSONObject().put("type","text").put("text",((Content.Text)c).getText()));
            else if(c instanceof Content.ImageBytes)parts.put(new JSONObject().put("type","image_url").put("image_url",new JSONObject().put("url","data:image/png;base64,"+Base64.getEncoder().encodeToString(((Content.ImageBytes)c).getBytes()))));
            else if(c instanceof Content.AudioBytes)parts.put(new JSONObject().put("type","input_audio").put("input_audio",new JSONObject().put("data",Base64.getEncoder().encodeToString(((Content.AudioBytes)c).getBytes())).put("format","wav")));
            else if(c instanceof Content.ToolResponse){
                Content.ToolResponse response=(Content.ToolResponse)c;JSONObject call=pending.poll();
                if(call==null||!call.getJSONObject("function").getString("name").equals(response.getName()))throw new IOException("Mismatched avatar tool response");
                result.put(new JSONObject().put("role","tool").put("tool_call_id",call.getString("id")).put("name",response.getName()).put("content",String.valueOf(response.getResponse())));
            }else throw new IOException("Unsupported Gemma input");
        }
        if(parts.length()>0)result.put(new JSONObject().put("role","user").put("content",parts));
        return result;
    }
    static String prefix(String a,String b)throws IOException {
        int end=0;while(end<Math.min(a.length(),b.length())&&a.charAt(end)==b.charAt(end))end++;
        if(end==0)throw new IOException("Chat template has no stable prefix");
        if(Character.isHighSurrogate(a.charAt(end-1)))end--;
        return a.substring(0,end);
    }
    static String canonical(Object x)throws JSONException {
        if(x instanceof JSONObject){JSONObject o=(JSONObject)x;List<String> keys=new ArrayList<>();o.keys().forEachRemaining(keys::add);Collections.sort(keys);List<String> parts=new ArrayList<>();for(String k:keys)parts.add(JSONObject.quote(k)+":"+canonical(o.get(k)));return "{"+String.join(",",parts)+"}";}
        if(x instanceof JSONArray){List<String> p=new ArrayList<>();JSONArray a=(JSONArray)x;for(int i=0;i<a.length();i++)p.add(canonical(a.get(i)));return "["+String.join(",",p)+"]";}
        return x instanceof String?JSONObject.quote((String)x):String.valueOf(x);
    }
    static String hash(String value)throws Exception {
        byte[] h=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:h)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
    }
    static Map<String,Object> map(JSONObject object)throws JSONException {
        Map<String,Object> out=new LinkedHashMap<>();for(Iterator<String> i=object.keys();i.hasNext();){String k=i.next();out.put(k,plain(object.get(k)));}return out;
    }
    private static Object plain(Object value)throws JSONException {
        if(value instanceof JSONObject)return map((JSONObject)value);
        if(value instanceof JSONArray){List<Object> out=new ArrayList<>();JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++)out.add(plain(a.get(i)));return out;}
        return value==JSONObject.NULL?null:value;
    }
    static final class Stream {
        final StringBuilder answer=new StringBuilder(),reasoning=new StringBuilder();
        final SortedMap<Integer,JSONObject> calls=new TreeMap<>();
        JSONObject timings=new JSONObject(),usage=new JSONObject();String finish="";
        ModelMessage accept(JSONObject chunk)throws Exception {
            if(chunk.has("error"))throw new IOException(chunk.get("error").toString());
            if(chunk.optJSONObject("timings")!=null)timings=chunk.getJSONObject("timings");
            if(chunk.optJSONObject("usage")!=null)usage=chunk.getJSONObject("usage");
            JSONArray choices=chunk.optJSONArray("choices");StringBuilder text=new StringBuilder(),thought=new StringBuilder();
            if(choices!=null)for(int n=0;n<choices.length();n++){
                JSONObject choice=choices.getJSONObject(n),delta=choice.optJSONObject("delta");
                if(!choice.isNull("finish_reason"))finish=choice.getString("finish_reason");
                if(delta==null)continue;
                if(!delta.isNull("content"))text.append(delta.getString("content"));
                if(!delta.isNull("reasoning_content"))thought.append(delta.getString("reasoning_content"));
                JSONArray fragments=delta.optJSONArray("tool_calls");
                if(fragments!=null)for(int i=0;i<fragments.length();i++){
                    JSONObject f=fragments.getJSONObject(i);int index=f.getInt("index");if(index<0||index>7)throw new IOException("Too many tool calls");
                    JSONObject target=calls.get(index);if(target==null){target=new JSONObject().put("type","function").put("id","").put("function",new JSONObject().put("name","").put("arguments",""));calls.put(index,target);}
                    if(!f.isNull("id"))target.put("id",target.getString("id")+f.getString("id"));
                    JSONObject fn=f.optJSONObject("function"),dest=target.getJSONObject("function");
                    if(fn!=null)for(String k:List.of("name","arguments"))if(!fn.isNull(k))dest.put(k,dest.getString(k)+fn.getString(k));
                    if(dest.getString("arguments").length()>65536)throw new IOException("Tool arguments too large");
                }
            }
            answer.append(text);reasoning.append(thought);
            return new ModelMessage(Role.MODEL,Contents.of(text.toString()),Collections.emptyList(),Map.of("analysis",thought.toString()));
        }
        List<ToolCall> finish()throws Exception {
            if(finish.isEmpty())throw new IOException("Gemma stream ended without a completion marker");
            List<ToolCall> result=new ArrayList<>();for(JSONObject c:calls.values()){
                JSONObject f=c.getJSONObject("function");if(c.getString("id").isEmpty()||f.getString("name").isEmpty())throw new IOException("Incomplete tool call");
                result.add(new ToolCall(f.getString("name"),map(new JSONObject(f.getString("arguments")))));
            }return result;
        }
        JSONObject assistant()throws JSONException {
            JSONObject a=new JSONObject().put("role","assistant").put("content",answer.toString());
            if(reasoning.length()>0)a.put("reasoning_content",reasoning.toString());
            if(!calls.isEmpty())a.put("tool_calls",new JSONArray(calls.values()));return a;
        }
    }
}
