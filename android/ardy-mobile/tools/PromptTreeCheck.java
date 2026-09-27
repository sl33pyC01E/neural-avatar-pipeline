package ai.cleo.ardyavatarvalidation;

import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Exercise the immutable snapshots used by native persistence and model entry points. */
public final class PromptTreeCheck {
    static int checks;
    interface Work {void run()throws Exception;}
    static void check(boolean result,String message){checks++;if(!result)throw new AssertionError(message);}
    static void reject(Work action)throws Exception {try{action.run();throw new AssertionError("Invalid edit/action accepted");}catch(java.io.IOException|JSONException expected){checks++;}}
    public static void main(String[] args)throws Exception {
        PromptTree original=PromptTree.defaultsOnly();JSONArray nodes=original.document().getJSONArray("nodes");Set<String> ids=new HashSet<>();
        for(int i=0;i<nodes.length();i++){
            JSONObject n=nodes.getJSONObject(i);String id=n.getString("id");check(ids.add(id),"Duplicate id");check(!n.getString("trigger").isBlank(),"Missing trigger");
            PromptTree changed=original.changed(id,n.getString("text")+"\nEdited wording.");
            check(!original.revision().equals(changed.revision()),"Edit did not change revision");
            check(new PromptTree(new JSONObject(changed.overrides().toString())).text(id).equals(changed.text(id)),"Persisted edit did not round-trip");
            check(changed.changed(id,null).revision().equals(original.revision()),"Reset did not restore original");
        }
        PromptTree browser=original.changed("browser.system","Use a valid JSON object.");
        check(original.fingerprint("main.system","main.tools.").equals(browser.fingerprint("main.system","main.tools.")),"Browser edit invalidated Main prefix");
        check(!original.fingerprint("browser.").equals(browser.fingerprint("browser.")),"Browser edit did not invalidate browser revision");
        PromptTree main=original.changed("main.system","You are Cleo. Reply briefly.");
        check(!original.fingerprint("main.system","main.tools.").equals(main.fingerprint("main.system","main.tools.")),"Main prefix not invalidated");
        check(original.fingerprint("avatar.system","avatar.tools.").equals(main.fingerprint("avatar.system","avatar.tools.")),"Main edit invalidated debug prefix");
        PromptTree perTurn=original.changed("main.turn","{{frame}} {{scene}}\n{{message}}");
        check(original.fingerprint("main.system","main.tools.").equals(perTurn.fingerprint("main.system","main.tools.")),"Per-turn edit invalidated prefill");
        String injected="literal {{frame}} $1 \\ text <script>";
        check(perTurn.render("main.turn",Map.of("frame","face","scene","{}","message",injected)).endsWith(injected),"User content was recursively interpolated");
        reject(()->original.changed("main.turn","No scene"));reject(()->original.changed("main.turn",original.text("main.turn")+" {{unknown}}"));
        reject(()->original.changed("unknown","value"));reject(()->original.changed("main.system"," "));reject(()->original.changed("main.system","a".repeat(16385)));
        reject(()->new PromptTree(new JSONObject().put("main.system",2)));reject(()->original.render("main.turn",Map.of("frame","face")));
        check(original.changed("chat.system","").text("chat.system").isEmpty(),"Empty default chat instruction not allowed");
        JSONArray motions=new JSONArray("[{\"key\":\"wave\",\"id\":\"saved:wave\",\"label\":\"Right hand wave\"}]");
        MainAvatarToolApi api=new MainAvatarToolApi(motions,new JSONArray(List.of("happy")));
        String id="main.tools.description";PromptTree wording=original.changed(id,"Choose an expression for the next reply.");
        JSONObject schema=wording.describe(api.description(),"main.tools");check(schema.getString("description").equals(wording.text(id)),"Tool edit not applied");
        check(schema.getJSONObject("parameters").toString().equals(api.description().getJSONObject("parameters").toString()),"Tool wording changed argument contract");
        check(original.render("avatar.system",Map.of("motions",api.motionCatalog())).contains("wave = Right hand wave"),"Live catalog not injected");
        reject(()->BrowserAction.parse("click: [357, 498, 564, 944], click the search icon"));
        reject(()->BrowserAction.parse("{\"action\":\"click\",\"box_2d\":[357,498,564,944]} extra string"));
        reject(()->BrowserAction.parse("{\"action\":\"back\",\"unexpected\":\"extra string\"}"));
        BrowserAction.parse("{\"action\":\"click\",\"box_2d\":[357,498,564,944],\"description\":\"Search icon\"}");checks++;
        check(BrowserAction.schema().getJSONArray("anyOf").length()==7,"Action schema incomplete");
        check(BrowserPrompt.turn(browser,"Find search","","https://example.test",636,280).contains("636 pixels wide by 280 pixels high"),"Actual viewport omitted");
        Path fixture=Path.of(args[0]);Files.createDirectories(fixture.getParent());Files.writeString(fixture,original.document().toString(2));
        System.out.println(new JSONObject().put("passed",true).put("checks",checks).put("editableNodes",nodes.length()).put("promptRevision",original.revision()).put("browserSchema",BrowserAction.schema()).put("phoneTest",false).put("modelInference",false));
    }
}
