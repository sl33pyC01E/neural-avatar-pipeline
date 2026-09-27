package ai.cleo.ardyavatarvalidation;

import android.content.*;
import android.os.*;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

final class ModelChatClient {
    private final Context context;private final Consumer<JSONObject> events;
    private final Handler main=new Handler(Looper.getMainLooper());
    private Messenger service;private boolean bound;private final ArrayDeque<String> pending=new ArrayDeque<>();
    private final Messenger reply=new Messenger(new Handler(Looper.getMainLooper(),message->{
        try{JSONObject event=new JSONObject(message.getData().getString("json","{}"));if(event.optBoolean("unloaded"))close();deliver(event);}catch(JSONException ignored){}return true;
    }));
    private final ServiceConnection connection=new ServiceConnection(){
        public void onServiceConnected(ComponentName name,IBinder binder){service=new Messenger(binder);while(!pending.isEmpty())dispatch(pending.removeFirst());}
        public void onServiceDisconnected(ComponentName name){close();events.accept(error("Model process stopped. Load a model to continue."));}
        public void onBindingDied(ComponentName name){close();events.accept(error("Model service stopped. Load a model to continue."));}
    };
    ModelChatClient(Context context,Consumer<JSONObject> events){this.context=context;this.events=events;}
    private void deliver(JSONObject event){events.accept(event);}
    void request(String json){main.post(()->{
        try{
            if(json.length()>65536)throw new IllegalArgumentException("Chat request too large");
            JSONObject value=new JSONObject(json);value.put("avatarPid",android.os.Process.myPid()).put("resident",context.getSharedPreferences("runtime",Context.MODE_PRIVATE).getBoolean("resident",true));String action=value.optString("action");
            if(action.equals("background")&&!bound)return;
            Intent intent=new Intent(context,ModelChatService.class);
            if(action.equals("load")||action.equals("send")||action.equals("agentStep")||action.equals("avatarSend")||action.equals("mainPrepare")||action.equals("mainSend"))context.startForegroundService(intent);
            if(!bound){bound=context.bindService(intent,connection,Context.BIND_AUTO_CREATE);if(!bound)throw new IllegalStateException("Cannot bind local models");}
            if(service==null){if(pending.size()>4)throw new IllegalStateException("Model service is still starting");pending.add(value.toString());}else dispatch(value.toString());
        }catch(Exception failure){events.accept(error(failure.toString()));}
    });}
    private void dispatch(String json){try{Message message=Message.obtain(null,ModelChatService.COMMAND);Bundle bundle=new Bundle();bundle.putString("json",json);message.setData(bundle);message.replyTo=reply;service.send(message);}catch(RemoteException failure){close();events.accept(error("Model service disconnected. Load again."));}}
    private static JSONObject error(String text){try{return new JSONObject().put("type","chat").put("error",text).put("disconnected",true);}catch(JSONException impossible){throw new IllegalStateException(impossible);}}
    void close(){if(bound)context.unbindService(connection);bound=false;service=null;pending.clear();}
}
