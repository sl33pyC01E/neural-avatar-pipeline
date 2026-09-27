package ai.cleo.ardyavatarvalidation;
import com.google.ai.edge.litertlm.*;
import java.util.*;
import org.json.*;
public final class LlamaProtocolCheck {
    static int checks;
    static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
    static JSONObject delta(JSONObject d)throws Exception{return new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("delta",d)));}
    public static void main(String[] ignored)throws Exception {
        JSONObject tool=new JSONObject().put("name","act").put("parameters",new JSONObject().put("type","object"));
        JSONObject request=LlamaProtocol.request(new JSONArray(),tool,256,768);
        check(request.getBoolean("cache_prompt")&&request.getInt("id_slot")==0,"Stable slot with prefix reuse");
        check(request.getInt("max_tokens")==1024&&request.getInt("reasoning_budget_tokens")==256,"Reasoning budget");
        check(request.getJSONObject("chat_template_kwargs").getBoolean("enable_thinking"),"Thinking flag");
        check(!LlamaProtocol.request(new JSONArray(),null,0,512).getJSONObject("chat_template_kwargs").getBoolean("enable_thinking"),"Thinking off");
        check(request.getJSONArray("tools").getJSONObject(0).getJSONObject("function").getString("name").equals("act"),"Tool schema passed");
        LlamaProtocol.Stream s=new LlamaProtocol.Stream();
        com.google.ai.edge.litertlm.Message thought=s.accept(delta(new JSONObject().put("reasoning_content","Plan")));
        check(thought.getChannels().get("analysis").equals("Plan"),"Thought stays separate");
        s.accept(delta(new JSONObject().put("content","Hello ")));s.accept(delta(new JSONObject().put("content","world")));
        for(JSONObject fragment:List.of(new JSONObject().put("index",0).put("id","call_1").put("function",new JSONObject().put("name","act").put("arguments","{\"face\":")),new JSONObject().put("index",0).put("function",new JSONObject().put("arguments","{\"head\":0.5},\"schedule\":[{\"at_seconds\":1}]}"))))s.accept(delta(new JSONObject().put("tool_calls",new JSONArray().put(fragment))));
        s.accept(new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("finish_reason","tool_calls"))).put("usage",new JSONObject().put("total_tokens",120)).put("timings",new JSONObject().put("cache_n",90)));
        List<ToolCall> calls=s.finish();check(calls.size()==1&&calls.get(0).getName().equals("act"),"Fragmented calls assembled");
        check(((Number)((Map<?,?>)calls.get(0).getArguments().get("face")).get("head")).doubleValue()==.5,"Nested tool arguments converted");
        check(s.answer.toString().equals("Hello world")&&s.reasoning.toString().equals("Plan"),"Streaming deltas append exactly once");
        check(s.timings.getInt("cache_n")==90&&s.usage.getInt("total_tokens")==120,"Actual cache/token metrics preserved");
        Deque<JSONObject> pending=new ArrayDeque<>(s.calls.values());
        com.google.ai.edge.litertlm.Message reply=new com.google.ai.edge.litertlm.Message(Role.TOOL,Contents.Companion.of(List.of(new Content.ToolResponse("act","{\"ok\":true}"))),List.of(),Map.of());
        JSONObject wired=LlamaProtocol.input(reply,pending).getJSONObject(0);check(wired.getString("tool_call_id").equals("call_1")&&wired.getString("name").equals("act")&&pending.isEmpty(),"Tool response matched by ID/name");
        com.google.ai.edge.litertlm.Message media=new com.google.ai.edge.litertlm.Message(Role.USER,Contents.Companion.of(List.of(new Content.ImageBytes(new byte[]{1,2}),new Content.AudioBytes(new byte[]{3,4}),new Content.Text("Describe"))),List.of(),Map.of());
        JSONArray parts=LlamaProtocol.input(media,new ArrayDeque<>()).getJSONObject(0).getJSONArray("content");
        check(parts.getJSONObject(0).getJSONObject("image_url").getString("url").endsWith("AQI="),"Image stays in request");
        check(parts.getJSONObject(1).getJSONObject("input_audio").getString("format").equals("wav"),"Direct Gemma audio");
        check(LlamaProtocol.prefix("<system>Private instruction<user>A_probe","<system>Private instruction<user>Z_probe").equals("<system>Private instruction<user>"),"Cache excludes probe/user content");
        JSONObject a=new JSONObject("{\"z\":1,\"a\":{\"b\":2,\"a\":0}}"),b=new JSONObject("{\"a\":{\"a\":0,\"b\":2},\"z\":1}");
        check(LlamaProtocol.hash(LlamaProtocol.canonical(a)).equals(LlamaProtocol.hash(LlamaProtocol.canonical(b))),"Deterministic cache identity independent of object iteration order");
        b.put("z",2);check(!LlamaProtocol.hash(LlamaProtocol.canonical(a)).equals(LlamaProtocol.hash(LlamaProtocol.canonical(b))),"Changed identity invalidates cache");
        try{new LlamaProtocol.Stream().finish();throw new AssertionError("Truncated SSE accepted");}catch(java.io.IOException expected){checks++;}
        try{LlamaProtocol.input(reply,new ArrayDeque<>());throw new AssertionError("Unknown tool reply accepted");}catch(java.io.IOException expected){checks++;}
        System.out.println(new JSONObject().put("passed",true).put("checks",checks).put("inference",false));
    }
}
