package ai.cleo.ardyavatarvalidation;
import java.io.IOException;
import java.util.*;
import org.json.*;
import com.google.ai.edge.litertlm.*;
/** Exercises the production tool validator, stream accumulator and SDK schema adapter. No models. */
public final class ModelChatProtocolCheck {
    interface Attempt {void run()throws Exception;}
    static int rejected;
    static void rejects(Attempt attempt)throws Exception {try{attempt.run();throw new AssertionError("Invalid tool accepted");}catch(IOException|JSONException expected){rejected++;}}
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] ignored)throws Exception {
        JSONArray catalog=new JSONArray().put(new JSONObject().put("key","neutral").put("id","bank:idle").put("label","Relaxed speaking idle"))
            .put(new JSONObject().put("key","wave").put("id","saved:wave").put("label","Right hand wave"));
        AvatarToolApi api=new AvatarToolApi(catalog,new JSONArray(List.of("happy","aa","injected")));
        check(api.plan().getString("embeddingId").equals("bank:idle"),"Default cached embedding");
        JSONObject valid=new JSONObject().put("motion","wave").put("expression","happy").put("strength",.3).put("cue_seconds",.25).put("tail_seconds",1);
        check(api.execute("avatar_stage",valid).getJSONObject("plan").getString("embeddingId").equals("saved:wave"),"Tool resolves the cached text embedding");
        JSONObject copy=api.plan();copy.put("embeddingId","bad");check(api.plan().getString("embeddingId").equals("saved:wave"),"Plan defensive copy");
        for(String key:List.of("motion","expression","strength","cue_seconds","tail_seconds")){
            api.reset();JSONObject missing=new JSONObject(valid.toString());missing.remove(key);rejects(()->api.execute("avatar_stage",missing));
        }
        for(Object[] invalid:List.of(new Object[]{"motion","shell"},new Object[]{"expression","aa"},new Object[]{"strength",.76},new Object[]{"strength",-.1},new Object[]{"strength","0.3"},new Object[]{"cue_seconds",3.01},new Object[]{"cue_seconds",-1},new Object[]{"tail_seconds",.49},new Object[]{"tail_seconds",3.01},new Object[]{"unknown",true})){
            api.reset();JSONObject value=new JSONObject(valid.toString()).put((String)invalid[0],invalid[1]);rejects(()->api.execute("avatar_stage",value));
            check(api.plan().getString("embeddingId").equals("bank:idle"),"Invalid call changed the plan");
        }
        api.reset();rejects(()->api.execute("run_code",valid));
        api.reset();for(int i=0;i<3;i++)api.execute("avatar_stage",valid);rejects(()->api.execute("avatar_stage",valid));
        rejects(()->new AvatarToolApi(new JSONArray(),new JSONArray()));
        rejects(()->new AvatarToolApi(new JSONArray().put(new JSONObject().put("key","a").put("id","../../file").put("label","bad")),new JSONArray()));
        api.reset();api.execute("avatar_stage",new JSONObject(valid.toString()).put("strength",0).put("cue_seconds",0).put("tail_seconds",.5));
        api.execute("avatar_stage",new JSONObject(valid.toString()).put("strength",.75).put("cue_seconds",3).put("tail_seconds",3));
        JSONObject extended=new JSONObject(valid.toString()).put("camera",new JSONObject().put("distance",.62).put("yaw",25))
            .put("root",new JSONObject().put("x",1).put("heading",90)).put("face",new JSONObject().put("head",.5))
            .put("schedule",new JSONArray().put(new JSONObject().put("at_seconds",1).put("transition_seconds",.5).put("camera",new JSONObject().put("distance",2)))
                .put(new JSONObject().put("at_seconds",2).put("expression","happy").put("strength",.3)));
        api.reset();check(api.execute("avatar_stage",extended).getJSONObject("plan").getJSONArray("schedule").length()==2,"Timed avatar controls preserved");
        for(JSONObject bad:List.of(new JSONObject().put("root",new JSONObject().put("x",4)),new JSONObject().put("root",new JSONObject().put("y",1)),
            new JSONObject().put("camera",new JSONObject().put("distance",0)),new JSONObject().put("camera",new JSONObject().put("yaw","20")),new JSONObject().put("face",new JSONObject().put("mouth",3)),
            new JSONObject().put("schedule",new JSONArray().put(new JSONObject().put("at_seconds",2).put("root",new JSONObject().put("x",1))).put(new JSONObject().put("at_seconds",1).put("root",new JSONObject().put("x",2)))),
            new JSONObject().put("schedule",new JSONArray().put(new JSONObject().put("at_seconds",1).put("expression","aa").put("strength",.1))),
            new JSONObject().put("schedule",new JSONArray().put(new JSONObject().put("at_seconds",1))),
            new JSONObject().put("schedule",new JSONArray().put(new JSONObject().put("at_seconds",31).put("root",new JSONObject().put("x",1)))))) {
            JSONObject call=new JSONObject(valid.toString());for(String key:bad.keySet())call.put(key,bad.get(key));api.reset();rejects(()->api.execute("avatar_stage",call));
        }
        ExperimentalFlags.INSTANCE.setVisualTokenBudget(560);check(ExperimentalFlags.INSTANCE.getVisualTokenBudget()==560,"Actual Android SDK visual budget setter");ExperimentalFlags.INSTANCE.setVisualTokenBudget(280);
        final String schema=api.description().toString();
        ToolManager manager=new ToolManager(List.of(ToolKt.tool(new OpenApiTool(){public String getToolDescriptionJsonString(){return schema;}public String execute(String args){throw new AssertionError("Automatic tool execution");}})));
        String adapted=manager.getToolsDescription().toString();
        check(adapted.contains("avatar_stage")&&adapted.contains("parameters"),"Actual LiteRT SDK accepted the OpenAPI tool schema");
        GemmaStream stream=new GemmaStream();stream.append("",Map.of("thought","Choose "));stream.append(null,Map.of("thought","a wave.","unknown","discard"));
        check(stream.event().getString("partial").isEmpty(),"Reasoning not spoken");
        stream.append("Hello",Map.of());stream.append(" there!",null);
        check(stream.event().getString("partial").equals("Hello there!")&&stream.event().getString("reasoning").equals("Choose a wave."),"Streaming deltas remain separate and ordered");
        String[] invalid={"{\"action\":\"click\",\"box\":[0,0,1001,2]}","{\"action\":\"click\",\"box\":[0,0,0,2]}","{\"action\":\"click\",\"box\":[\"0\",0,2,2]}","{\"action\":\"type\",\"text\":1}","{\"action\":\"enter\",\"confirm\":\"true\"}","{\"action\":\"shell\"}","{\"action\":\"scroll\",\"direction\":\"left\"}","{\"action\":\"ask\",\"question\":\"\"}","{\"action\":\"back\"} trailing"};
        for(String text:invalid){try{BrowserAction.parse(text);throw new AssertionError("Unsafe action accepted: "+text);}catch(IOException|JSONException expected){}}
        check(BrowserAction.parse("```json\n{\"action\":\"click\",\"box\":[0,0,1000,1000],\"confirm\":true}\n```").getBoolean("confirm"),"Confirmation preserved");
        check(BrowserAction.parse("{\"action\":\"ask\",\"question\":\"Which tab?\"}").getString("action").equals("ask"),"Follow-up action");
        BrowserAction.parse("{\"action\":\"done\",\"summary\":\"Finished\"}");

        System.out.println(new JSONObject().put("passed",true).put("phoneTest",false).put("modelInference",false).put("invalidAvatarInputsRejected",rejected).put("cachedEmbeddingResolution",true).put("liveSdkToolSchema",true).put("extensiveControlsValidated",true).put("sdkVisualTokenBudget",true).put("sdkTools",new JSONArray(adapted)).put("reasoningAndAnswerDeltasSeparated",true).put("browserParserPreserved",true));
    }
}
