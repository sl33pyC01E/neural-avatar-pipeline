package ai.cleo.ardymobile;

import android.content.Context;
import ai.onnxruntime.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Existing LAM backbone, including sinc resampling, on a fixed 64-frame / 24 kHz audio window. */
public final class LamDriver implements AutoCloseable {
    private final Context context;
    private final OrtEnvironment environment=OrtEnvironment.getEnvironment("ardy-mobile");
    private OrtSession session;
    private final float[] window=new float[51200],identity={1,0,0,0,0,0,0,0,0,0,0,0};
    private long samplesSeen;
    private JSONObject metadata;
    private LamPostprocess post;
    public LamDriver(Context context){this.context=context.getApplicationContext();}
    public void warm() throws Exception {
        if(session!=null)return;
        String manifest;
        try(InputStream in=context.getAssets().open("lam/manifest.json")){manifest=new String(Embeddings.read(in),StandardCharsets.UTF_8);}
        metadata=new JSONObject(manifest);post=new LamPostprocess(metadata);
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
        try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()) {
            options.setIntraOpNumThreads(2);options.setInterOpNumThreads(1);
            options.addConfigEntry("session.intra_op.allow_spinning","0");options.addConfigEntry("session.inter_op.allow_spinning","0");
            session=environment.createSession(model.getPath(),options);
        }
        reset();
    }
    public void reset(){Arrays.fill(window,0);samplesSeen=0;if(post!=null)post.reset();}
    public JSONObject next(float[] pcm,int rate) throws Exception {
        if(rate!=24000||pcm.length<1||pcm.length>24000)throw new IllegalArgumentException("LAM expects up to one second of 24 kHz Pocket audio");
        warm();
        System.arraycopy(window,pcm.length,window,0,window.length-pcm.length);
        System.arraycopy(pcm,0,window,window.length-pcm.length,pcm.length);samplesSeen+=pcm.length;
        float[] values;
        try(OnnxTensor audio=OnnxTensor.createTensor(environment,FloatBuffer.wrap(window),new long[]{1,window.length});
            OnnxTensor id=OnnxTensor.createTensor(environment,FloatBuffer.wrap(identity),new long[]{1,12});
            OrtSession.Result output=session.run(Map.of("audio",audio,"identity",id))) {
            FloatBuffer buffer=((OnnxTensor)output.get(0)).getFloatBuffer();values=new float[buffer.remaining()];buffer.get(values);
        }
        int frames=(int)Math.ceil(pcm.length/800.0),start=64-frames;
        float[][] raw=new float[frames][52];float[] volume=new float[frames];
        for(int f=0;f<frames;f++) {
            System.arraycopy(values,(start+f)*52,raw[f],0,52);
            double energy=0;int center=f*800,half=Math.max(1,Math.min(800,pcm.length)/2);
            for(int i=center-half;i<center+half;i++)if(i>=0&&i<pcm.length)energy+=pcm[i]*pcm[i];
            volume[f]=(float)Math.sqrt(energy/(half*2));
        }
        float[][] processed=post.process(raw,volume,true);
        return new JSONObject().put("type","face").put("fps",30).put("names",metadata.getJSONArray("names"))
            .put("startSeconds",(samplesSeen-window.length+start*800)/24000.0).put("frames",new JSONArray(processed));
    }
    @Override public void close(){if(session!=null)try{session.close();}catch(OrtException ignored){}session=null;}
}
