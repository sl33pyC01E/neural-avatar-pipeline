package ai.cleo.ardymobile;

import android.content.Context;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.*;

/** Existing LAM backbone, including sinc resampling, on a fixed 64-frame / 24 kHz audio window. */
public final class LamDriver implements AutoCloseable {
    private final Context context;
    private LamWindow engine;
    private JSONObject metadata;
    public LamDriver(Context context){this.context=context.getApplicationContext();}
    private void readMetadata() throws Exception {
        if(metadata!=null)return;
        String manifest;
        try(InputStream in=context.getAssets().open("lam/manifest.json")){manifest=new String(Embeddings.read(in),StandardCharsets.UTF_8);}
        metadata=new JSONObject(manifest);
    }
    public String cacheIdentity() throws Exception {
        readMetadata();
        // Bump this revision when windowing or LamPostprocess changes. Gains run after this cache.
        return "lam-timeline-v1-mono24k-window64-hop30:"+metadata.toString();
    }
    public boolean isWarm(){return engine!=null;}
    public void warm() throws Exception {
        if(engine!=null)return;
        readMetadata();
        File root=new File(context.getFilesDir(),"lam");if(!root.isDirectory()&&!root.mkdirs())throw new IOException("Cannot prepare LAM");
        File model=new File(root,"lam-window64-24k.onnx");
        File stamp=new File(root,"sha256.txt");String installed="";
        if(stamp.isFile())try(InputStream in=new FileInputStream(stamp)){installed=new String(Embeddings.read(in),StandardCharsets.UTF_8);}
        if(!model.isFile()||model.length()!=metadata.getLong("onnxBytes")||!installed.equals(metadata.getString("onnxSha256"))) {
            File temp=new File(root,"lam.partial");java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
            try(InputStream in=context.getAssets().open("lam/lam-window64-24k.onnx");FileOutputStream out=new FileOutputStream(temp)){
                byte[] b=new byte[1024*1024];int n;while((n=in.read(b))!=-1){out.write(b,0,n);digest.update(b,0,n);}out.getFD().sync();
            }
            StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
            if(!hash.toString().equals(metadata.getString("onnxSha256")))throw new IOException("LAM payload checksum mismatch");
            if(!temp.renameTo(model))throw new IOException("Cannot install LAM payload");
            try(FileOutputStream out=new FileOutputStream(stamp)){out.write(hash.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
        }
        engine=new LamWindow(model.getPath(),metadata);
    }
    public void reset(){if(engine!=null)engine.reset();}
    public JSONObject next(float[] pcm,int rate) throws Exception {warm();return engine.next(pcm,rate);}
    @Override public void close(){if(engine!=null)engine.close();engine=null;}
}
