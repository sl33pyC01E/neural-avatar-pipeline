package ai.cleo.ardyavatarvalidation;

import java.util.*;

/** Small app-owned data contract. No model SDK or automatic tool execution. */
final class ModelData {
    enum Role { USER, MODEL, TOOL }
    interface Content {
        final class Text implements Content {private final String text;Text(String value){text=value;}String getText(){return text;}}
        final class ImageBytes implements Content {private final byte[] bytes;ImageBytes(byte[] value){bytes=value;}byte[] getBytes(){return bytes;}}
        final class AudioBytes implements Content {private final byte[] bytes;AudioBytes(byte[] value){bytes=value;}byte[] getBytes(){return bytes;}}
        final class ToolResponse implements Content {private final String name,response;ToolResponse(String name,String response){this.name=name;this.response=response;}String getName(){return name;}String getResponse(){return response;}}
    }
    static final class Contents {
        private final List<Content> contents;private Contents(List<Content> value){contents=List.copyOf(value);}
        static Contents of(String text){return new Contents(List.of(new Content.Text(text)));}
        static Contents of(List<Content> value){return new Contents(value);}List<Content> getContents(){return contents;}
    }
    static final class ToolCall {
        private final String name;private final Map<String,Object> arguments;
        ToolCall(String name,Map<String,Object> arguments){this.name=name;this.arguments=Collections.unmodifiableMap(new LinkedHashMap<>(arguments));}
        String getName(){return name;}Map<String,Object> getArguments(){return arguments;}
    }
    static final class ModelMessage {
        private final Contents contents;private final List<ToolCall> tools;private final Map<String,String> channels;
        ModelMessage(Role role,Contents contents,List<ToolCall> tools,Map<String,String> channels){this.contents=contents;this.tools=List.copyOf(tools);this.channels=Map.copyOf(channels);}
        Contents getContents(){return contents;}List<ToolCall> getToolCalls(){return tools;}Map<String,String> getChannels(){return channels;}
    }
    interface MessageCallback {void onMessage(ModelMessage message);void onDone();void onError(Throwable failure);}
    static final class ThinkingConfig {
        private final boolean enabled;private final int budget;
        ThinkingConfig(boolean enabled,int budget){this.enabled=enabled;this.budget=budget;}boolean getEnableThinking(){return enabled;}int getThinkingTokenBudget(){return budget;}
    }
    static final class ResponseFormat {
        private final String schema;private ResponseFormat(String schema){this.schema=schema;}
        static ResponseFormat json(String schema){return new ResponseFormat(schema);}String getSchemaOrPattern(){return schema;}
    }
}
