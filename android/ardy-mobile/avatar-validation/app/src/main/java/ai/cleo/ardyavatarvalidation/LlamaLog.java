package ai.cleo.ardyavatarvalidation;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Drain native output without retaining an unbounded log in RAM or on disk. */
final class LlamaLog {
    private static final int LIMIT=1024*1024,KEEP=512*1024;
    private final File file;
    private Thread reader;
    LlamaLog(File file)throws IOException {this.file=file;Files.write(file.toPath(),new byte[0]);}
    void start(InputStream input){
        reader=new Thread(()->{try(BufferedReader in=new BufferedReader(new InputStreamReader(input,StandardCharsets.UTF_8))){
            // Keep draining if storage fails, otherwise a full stdout pipe can
            // stall inference even though diagnostic logging is optional.
            String line;while((line=in.readLine())!=null)try{append(line.length()>32768?line.substring(0,32768)+" [truncated]":line);}catch(IOException ignored){}
        }catch(IOException failure){try{append("Log capture ended: "+failure.getMessage());}catch(IOException ignored){}}},"cleo-native-log");
        reader.setDaemon(true);reader.start();
    }
    synchronized void append(String line)throws IOException {
        byte[] next=(line+"\n").getBytes(StandardCharsets.UTF_8);
        try(RandomAccessFile out=new RandomAccessFile(file,"rw")){
            if(out.length()+next.length>LIMIT){byte[] tail=new byte[(int)Math.min(KEEP,out.length())];out.seek(out.length()-tail.length);out.readFully(tail);out.seek(0);out.write(tail);out.setLength(tail.length);}
            out.seek(out.length());out.write(next);
        }
    }
    synchronized String text(int limit)throws IOException {
        try(RandomAccessFile in=new RandomAccessFile(file,"r")){in.seek(Math.max(0,in.length()-limit));byte[] bytes=new byte[(int)(in.length()-in.getFilePointer())];in.readFully(bytes);return new String(bytes,StandardCharsets.UTF_8);}
    }
    void finish(){if(reader!=null)try{reader.join(500);}catch(InterruptedException e){Thread.currentThread().interrupt();}}
}
