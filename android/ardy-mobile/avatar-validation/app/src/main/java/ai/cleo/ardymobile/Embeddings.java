package ai.cleo.ardymobile;

import android.content.Context;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/** Bundled steering bank plus durable vectors produced by the recovered GGUF JNI backend. */
public final class Embeddings {
    private final Context context;
    private final File directory;
    public Embeddings(Context context) {
        this.context=context.getApplicationContext(); directory=new File(context.getFilesDir(),"embeddings");
        if(!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot create embedding cache");
    }
    public JSONArray list() throws Exception {
        JSONArray result=new JSONArray();
        String[] names=context.getAssets().list("sample-cache");
        if(names!=null) for(String name:names) if(name.endsWith(".json")) {
            try(InputStream input=context.getAssets().open("sample-cache/"+name)) {
                JSONObject item=new JSONObject(new String(read(input),StandardCharsets.UTF_8));
                item.put("id","bank:"+name.substring(0,name.length()-5)); result.put(item);
            }
        }
        File[] files=directory.listFiles((dir,name)->name.endsWith(".json"));
        if(files!=null) for(File file:files) try(InputStream input=new FileInputStream(file)) {
            JSONObject item=new JSONObject(new String(read(input),StandardCharsets.UTF_8));
            item.put("id","saved:"+file.getName().replace(".json","")); result.put(item);
        }
        return result;
    }
    public float[] load(String id) throws Exception {
        if(id==null || !id.matches("(bank|saved):[a-zA-Z0-9_-]+")) throw new IllegalArgumentException("Invalid embedding identifier");
        String key=id.substring(id.indexOf(':')+1);
        try(InputStream input=id.startsWith("bank:") ? context.getAssets().open("sample-cache/"+key+".npy") : new FileInputStream(new File(directory,key+".f32"))) {
            byte[] bytes=read(input);
            float[] vector=id.startsWith("bank:") ? npy(bytes) : floats(bytes,0);
            validate(vector); return vector;
        }
    }
    public JSONObject create(String text) throws Exception {
        text=text==null ? "" : text.trim();
        if(text.isEmpty()) throw new IllegalArgumentException("Enter a motion description");
        File model=new File(context.getFilesDir(),"embedding-models/ardy-llm2vec-q4_k_m.gguf");
        if(!model.isFile()) throw new FileNotFoundException("The compatible LLM2Vec model has not been imported");
        String key=hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        File metadata=new File(directory,key+".json");
        if(metadata.isFile() && new File(directory,key+".f32").isFile()) {
            try(InputStream in=new FileInputStream(metadata)) { return new JSONObject(new String(read(in),StandardCharsets.UTF_8)).put("id","saved:"+key); }
        }
        float[] vector=NativeLlm2Vec.embed(model.getAbsolutePath(),text); validate(vector);
        ByteBuffer buffer=ByteBuffer.allocate(vector.length*4).order(ByteOrder.LITTLE_ENDIAN);
        buffer.asFloatBuffer().put(vector);
        atomic(new File(directory,key+".f32"),buffer.array());
        JSONObject record=new JSONObject().put("key",key).put("text",text).put("nickname",text).put("width",vector.length)
            .put("dtype","float32").put("encoder","ARDY LLM2Vec Q4_K_M").put("createdAt",System.currentTimeMillis()/1000.0);
        atomic(metadata,record.toString().getBytes(StandardCharsets.UTF_8));
        return record.put("id","saved:"+key);
    }
    public boolean nativeAvailable() { return NativeLlm2Vec.available(); }
    public boolean modelAvailable() { return new File(context.getFilesDir(),"embedding-models/ardy-llm2vec-q4_k_m.gguf").isFile(); }
    private static float[] npy(byte[] bytes) throws IOException {
        if(bytes.length<10 || bytes[0]!=(byte)0x93 || !new String(bytes,1,5,StandardCharsets.US_ASCII).equals("NUMPY")) throw new IOException("Invalid NPY header");
        int version=bytes[6]&255;
        int offset=version==1 ? 10 : 12;
        if(version<1 || version>3 || bytes.length<offset) throw new IOException("Unsupported NPY version");
        ByteBuffer b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int size=version==1 ? b.getShort(8)&65535 : b.getInt(8);
        if(size<0 || (long)offset+size>bytes.length) throw new IOException("Truncated NPY header");
        String header=new String(bytes,offset,size,StandardCharsets.UTF_8);
        if(!header.matches("(?s).*['\"]descr['\"]\\s*:\\s*['\"]<f4['\"].*")) throw new IOException("Expected little-endian float32 embedding");
        return floats(bytes,offset+size);
    }
    private static float[] floats(byte[] bytes,int offset) throws IOException {
        if((bytes.length-offset)%4!=0) throw new IOException("Invalid float32 length");
        FloatBuffer buffer=ByteBuffer.wrap(bytes,offset,bytes.length-offset).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
        float[] values=new float[buffer.remaining()]; buffer.get(values); return values;
    }
    static void validate(float[] vector) {
        if(vector.length!=4096) throw new IllegalArgumentException("Expected 4096 text features");
        double norm=0; for(float v:vector) { if(!Float.isFinite(v)) throw new IllegalArgumentException("Invalid embedding values"); norm+=(double)v*v; }
        if(norm<1e-12) throw new IllegalArgumentException("Embedding is empty");
    }
    static byte[] read(InputStream input) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] buffer=new byte[65536]; int n;
        while((n=input.read(buffer))!=-1) out.write(buffer,0,n); return out.toByteArray();
    }
    private static void atomic(File file,byte[] bytes) throws IOException {
        File temporary=new File(file.getPath()+".partial");
        try(FileOutputStream output=new FileOutputStream(temporary)) { output.write(bytes); output.getFD().sync(); }
        if(!temporary.renameTo(file)) throw new IOException("Could not save embedding");
    }
    private static String hex(byte[] data) { StringBuilder s=new StringBuilder(); for(byte b:data)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString(); }
}
