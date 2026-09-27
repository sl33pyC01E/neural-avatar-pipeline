package ai.cleo.ardyavatarvalidation;

import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.nio.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.json.*;

final class ChatInputs {
    private final Context context;private final Consumer<JSONObject> events;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile AudioRecord recorder;private volatile boolean recording;
    ChatInputs(Context context,Consumer<JSONObject> events){this.context=context;this.events=events;}
    void importFile(Uri uri,String kind,String scope){worker.execute(()->{try(InputStream input=context.getContentResolver().openInputStream(uri)){
        if(input==null)throw new IOException("Cannot open attachment");byte[] bytes=readBounded(input,20*1024*1024);
        if(kind.equals("image")){
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if(options.outWidth<=0||options.outHeight<=0)throw new IOException("Unsupported image");
            // Full-resolution camera photos are decoded at a bounded size before rotation/PNG encoding.
            options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
            options.inJustDecodeBounds=false;
            Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new IOException("Unsupported image");
            try{android.media.ExifInterface exif=new android.media.ExifInterface(new ByteArrayInputStream(bytes));int orientation=exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION,1);Matrix transform=new Matrix();
                if(orientation==2)transform.setScale(-1,1);if(orientation==3)transform.setRotate(180);if(orientation==4)transform.setScale(1,-1);
                if(orientation==5){transform.setRotate(90);transform.postScale(-1,1);}if(orientation==6)transform.setRotate(90);
                if(orientation==7){transform.setRotate(270);transform.postScale(-1,1);}if(orientation==8)transform.setRotate(270);
                if(orientation>1){Bitmap oriented=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),transform,true);if(oriented!=bitmap){bitmap.recycle();bitmap=oriented;}}
            }catch(IOException ignored){}
            File file=file("png");int width=bitmap.getWidth(),height=bitmap.getHeight();try(FileOutputStream out=new FileOutputStream(file)){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}finally{bitmap.recycle();}
            if(file.length()>20*1024*1024){file.delete();throw new IOException("Decoded image exceeds 20 MB");}
            attached(scope,file,kind,width+" × "+height);
        }else{
            if(bytes.length<44||!new String(bytes,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")||!new String(bytes,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WAVE"))throw new IOException("Attach a WAV file, or use Record");
            File file=file("wav");try(FileOutputStream out=new FileOutputStream(file)){out.write(bytes);}attached(scope,file,"audio","WAV audio");
        }
    }catch(Exception failure){error(scope,failure);}});}
    @android.annotation.SuppressLint("MissingPermission")
    void startRecording(String scope){
        if(recording)return;if(recorder!=null){error(scope,new IOException("Finishing the previous recording; try again in a moment"));return;}if(context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){error(scope,new IOException("Microphone permission is needed to record"));return;}
        int size=Math.max(4096,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT));
        try{AudioRecord audio=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size);
            if(audio.getState()!=AudioRecord.STATE_INITIALIZED){audio.release();throw new IOException("Microphone initialization failed");}
            recorder=audio;recording=true;audio.startRecording();emit(scope,new JSONObject().put("recording",true));
            worker.execute(()->{try{ByteArrayOutputStream pcm=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int limit=16000*2*60;
                while(recording&&pcm.size()<limit){int n=audio.read(buffer,0,Math.min(buffer.length,limit-pcm.size()));if(n<0){if(recording)throw new IOException("Audio input failed: "+n);break;}if(n>0)pcm.write(buffer,0,n);}
                if(pcm.size()<3200)throw new IOException("Recording was too short");byte[] raw=pcm.toByteArray();File file=file("wav");
                try(FileOutputStream out=new FileOutputStream(file)){out.write(wavHeader(raw.length));out.write(raw);}
                emit(scope,new JSONObject().put("attachment",new JSONObject().put("file",file.getName()).put("kind","audio").put("recorded",true).put("label",String.format(Locale.ROOT,"Recorded %.1f s",raw.length/32000.0))));
            }catch(Exception failure){error(scope,failure);}finally{recording=false;try{audio.stop();}catch(Exception ignored){}audio.release();recorder=null;try{emit(scope,new JSONObject().put("recording",false));}catch(JSONException ignored){}}});
        }catch(Exception failure){recording=false;error(scope,failure);}
    }
    void stopRecording(){recording=false;AudioRecord audio=recorder;if(audio!=null)try{audio.stop();}catch(Exception ignored){}}
    private static byte[] wavHeader(int bytes){ByteBuffer b=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);b.put(new byte[]{'R','I','F','F'}).putInt(36+bytes).put(new byte[]{'W','A','V','E','f','m','t',' '}).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).put(new byte[]{'d','a','t','a'}).putInt(bytes);return b.array();}
    private File file(String suffix)throws IOException{
        File root=new File(context.getCacheDir(),"chat-input");if(!root.isDirectory()&&!root.mkdirs())throw new IOException("Cannot save attachment");
        File[] old=root.listFiles(f->f.isFile()&&f.getName().matches("[a-fA-F0-9-]{36}\\.(png|wav)"));
        if(old!=null){Arrays.sort(old,Comparator.comparingLong(File::lastModified).reversed());for(int i=7;i<old.length;i++)old[i].delete();}
        return new File(root,UUID.randomUUID()+"."+suffix);
    }
    private static byte[] readBounded(InputStream input,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(out.size()+count>limit)throw new IOException("Attachment exceeds 20 MB");out.write(buffer,0,count);}return out.toByteArray();}
    private void attached(String scope,File file,String kind,String label)throws JSONException{emit(scope,new JSONObject().put("attachment",new JSONObject().put("file",file.getName()).put("kind",kind).put("label",label)));}
    private void error(String scope,Exception failure){try{emit(scope,new JSONObject().put("inputError",failure.getMessage()));}catch(JSONException ignored){}}
    private void emit(String scope,JSONObject value){try{value.put("type","chat").put("inputScope",scope);}catch(JSONException ignored){}main.post(()->events.accept(value));}
    void close(){stopRecording();worker.shutdown();}
}
