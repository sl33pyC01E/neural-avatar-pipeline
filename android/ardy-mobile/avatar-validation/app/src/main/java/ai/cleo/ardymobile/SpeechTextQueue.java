package ai.cleo.ardymobile;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bounded phrase input for one take. AudioTrack and LAM outlive individual phrases. */
public final class SpeechTextQueue {
    public final String id;
    private final ArrayDeque<String> pending=new ArrayDeque<>();
    private boolean finished;
    private int characters;
    public SpeechTextQueue(String id){if(id==null||id.isBlank()||id.length()>100)throw new IllegalArgumentException("Invalid speech request");this.id=id;}
    public synchronized void append(String text)throws IOException {
        if(finished)throw new IOException("Speech input already ended");
        if(text==null||text.isBlank())return;
        if(text.length()>400||characters+text.length()>2000||pending.size()>=64)throw new IOException("Spoken reply is too long");
        characters+=text.length();pending.add(text);notifyAll();
    }
    public synchronized void finish(){finished=true;notifyAll();}
    public synchronized String next(AtomicBoolean cancelled)throws Exception {
        long deadline=System.nanoTime()+180_000_000_000L;
        while(pending.isEmpty()&&!finished&&!cancelled.get()){
            if(System.nanoTime()>deadline)throw new IOException("Timed out waiting for the rest of the reply");wait(50);
        }
        return cancelled.get()?null:pending.poll();
    }
}
