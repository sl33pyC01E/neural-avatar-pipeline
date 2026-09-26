package ai.cleo.ardymobile;

import java.io.*;
import java.nio.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** One bounded, lossless float WAV of the user's latest completed generation. */
public final class PocketRecording implements AutoCloseable {
    public interface Sink { void accept(float[] samples,int rate) throws Exception; }
    private final File destination,temporary;
    private RandomAccessFile output;
    private int rate;
    private long samples;
    public PocketRecording(File destination) throws IOException {
        this.destination=destination;temporary=new File(destination.getPath()+".partial");
        output=new RandomAccessFile(temporary,"rw");output.setLength(0);output.write(new byte[44]);
    }
    public void append(float[] values,int sampleRate) throws IOException {
        if(sampleRate<=0||(rate!=0&&rate!=sampleRate))throw new IOException("Pocket sample rate changed");
        if((samples+values.length)*4>32*1024*1024)throw new IOException("Speech exceeds the diagnostic audio limit");
        rate=sampleRate;
        ByteBuffer bytes=ByteBuffer.allocate(values.length*4).order(ByteOrder.LITTLE_ENDIAN);
        for(float value:values){if(!Float.isFinite(value))throw new IOException("Non-finite Pocket audio");bytes.putFloat(value);}
        output.write(bytes.array());samples+=values.length;
    }
    public void finish() throws IOException {
        if(samples==0)throw new IOException("Pocket returned no audio");
        int size=Math.toIntExact(samples*4);
        ByteBuffer header=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.putInt(0x46464952).putInt(size+36).putInt(0x45564157).putInt(0x20746d66).putInt(16);
        header.putShort((short)3).putShort((short)1).putInt(rate).putInt(rate*4).putShort((short)4).putShort((short)32);
        header.putInt(0x61746164).putInt(size);
        output.seek(0);output.write(header.array());output.getFD().sync();output.close();output=null;
        java.nio.file.Files.move(temporary.toPath(),destination.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }
    public void play(AtomicBoolean cancelled,Sink sink) throws Exception {
        if(output!=null)throw new IllegalStateException("Finish synthesis before buffered playback");
        try(RandomAccessFile input=new RandomAccessFile(destination,"r")) {
            input.seek(44);long remaining=samples;
            while(remaining>0&&!cancelled.get()) {
                int count=(int)Math.min(rate/2,remaining);
                byte[] bytes=new byte[count*4];input.readFully(bytes);
                float[] values=new float[count];ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(values);
                sink.accept(values,rate);remaining-=count;
            }
        }
    }
    public static float[] readCompleted(File file) throws IOException {
        if(!file.isFile())throw new IOException("Generate an Anna clip in tab 2 first");
        try(RandomAccessFile input=new RandomAccessFile(file,"r")) {
            if(input.length()<44||input.length()>32*1024*1024+44)throw new IOException("Invalid Pocket clip length");
            byte[] bytes=new byte[44];input.readFully(bytes);ByteBuffer header=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            if(header.getInt(0)!=0x46464952||header.getInt(8)!=0x45564157||header.getShort(20)!=3||header.getShort(22)!=1||header.getInt(24)!=24000||header.getShort(34)!=32||header.getInt(36)!=0x61746164||header.getInt(40)!=input.length()-44)throw new IOException("Expected Pocket's mono 24 kHz float WAV");
            bytes=new byte[header.getInt(40)];input.readFully(bytes);
            float[] values=new float[bytes.length/4];ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(values);
            for(float value:values)if(!Float.isFinite(value))throw new IOException("Invalid Pocket sample");
            if(values.length==0)throw new IOException("Pocket clip is empty");
            return values;
        }
    }
    @Override public void close() throws IOException {
        if(output!=null){output.close();output=null;java.nio.file.Files.deleteIfExists(temporary.toPath());}
    }
}
