package ai.cleo.ardymobile;

import android.content.Context;
import android.net.Uri;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONObject;

/** Copies a user-selected model with bounded memory and verifies its inventoried hash. */
public final class ModelImporter {
    public static String copy(Context context, Uri uri) throws Exception {
        JSONObject allowed;
        try(InputStream input=context.getAssets().open("import-models.json")) {
            allowed=new JSONObject(new String(Embeddings.read(input),StandardCharsets.UTF_8));
        }
        File temporary=File.createTempFile("model-import-",".partial",context.getFilesDir());
        try {
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            try(InputStream input=context.getContentResolver().openInputStream(uri);FileOutputStream output=new FileOutputStream(temporary)) {
                if(input==null)throw new IOException("Cannot open selected model");
                byte[] buffer=new byte[1024*1024];int n;
                while((n=input.read(buffer))!=-1) {
                    if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Model import cancelled");
                    output.write(buffer,0,n);digest.update(buffer,0,n);
                }
                output.getFD().sync();
            }
            StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
            String match=null;for(Iterator<String> names=allowed.keys();names.hasNext();) {
                String name=names.next();if(hash.toString().equals(allowed.getString(name)))match=name;
            }
            if(match==null)throw new IOException("This file is not one of the recovered compatible Ardy/LLM2Vec models");
            File target=new File(context.getFilesDir(),match);
            if(!target.getParentFile().isDirectory()&&!target.getParentFile().mkdirs())throw new IOException("Cannot create model directory");
            // Identical model already imported: avoid changing a file mapped by a live session.
            if(target.isFile()) {
                try(InputStream input=new FileInputStream(target)) {
                    MessageDigest check=MessageDigest.getInstance("SHA-256");byte[] b=new byte[1024*1024];int n;
                    while((n=input.read(b))!=-1)check.update(b,0,n);
                    if(Arrays.equals(check.digest(),hexBytes(hash.toString())))return match;
                }
                throw new IOException("An existing model differs; stop the runtime before replacing it");
            }
            Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);
            return match;
        } finally { Files.deleteIfExists(temporary.toPath()); }
    }
    private static byte[] hexBytes(String hash) {
        byte[] b=new byte[hash.length()/2];for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(hash.substring(i*2,i*2+2),16);return b;
    }
}
