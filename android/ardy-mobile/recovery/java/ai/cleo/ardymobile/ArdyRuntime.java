package ai.cleo.ardymobile;

import android.os.SystemClock;
import java.util.Locale;

/* JADX INFO: loaded from: classes3.dex */
final class ArdyRuntime {
    private final ArdyControlState state = new ArdyControlState();
    private long lastFrame = SystemClock.elapsedRealtimeNanos();

    ArdyRuntime() {
    }

    ArdyControlState select(EmbeddingRecord record, String backend) {
        long start = SystemClock.elapsedRealtimeNanos();
        float[] vector = record.vector;
        if (vector == null) {
            vector = new float[4096];
        }
        this.state.label = record.label();
        this.state.energy = clamp01((metric(vector, 0, vector.length) * 1.4f) + 0.18f);
        this.state.locomotion = clamp01((Math.abs(metricSigned(vector, 512, 512)) * 18.0f) + 0.1f);
        this.state.gesture = clamp01((Math.abs(metricSigned(vector, 1024, 512)) * 18.0f) + 0.1f);
        this.state.turn = clampSigned(metricSigned(vector, 1536, 512) * 10.0f);
        this.state.posture = clampSigned(metricSigned(vector, 2048, 512) * 10.0f);
        this.state.lastMs = (SystemClock.elapsedRealtimeNanos() - start) / 1000000.0d;
        if (backend.toLowerCase(Locale.US).contains("qnn")) {
            this.state.lastMs += 0.0d;
        }
        return this.state;
    }

    ArdyControlState tick(boolean running) {
        long now = SystemClock.elapsedRealtimeNanos();
        float dt = Math.max(0.001f, (now - this.lastFrame) / 1.0E9f);
        this.lastFrame = now;
        this.state.fps = (this.state.fps * 0.9f) + ((1.0f / dt) * 0.1f);
        if (running) {
            float speed = (this.state.energy * 2.4f) + 1.2f + (this.state.locomotion * 1.6f);
            this.state.phase = (this.state.phase + (dt * speed)) % 1000.0f;
        }
        return this.state;
    }

    ArdyControlState state() {
        return this.state;
    }

    private static float metric(float[] vector, int start, int count) {
        double sum = 0.0d;
        int end = Math.min(vector.length, start + count);
        for (int i = start; i < end; i++) {
            sum += (double) Math.abs(vector[i]);
        }
        int i2 = end - start;
        return (float) (sum / ((double) Math.max(1, i2)));
    }

    private static float metricSigned(float[] vector, int start, int count) {
        double sum = 0.0d;
        int end = Math.min(vector.length, start + count);
        for (int i = start; i < end; i++) {
            sum += (double) vector[i];
        }
        int i2 = end - start;
        return (float) (sum / ((double) Math.max(1, i2)));
    }

    private static float clamp01(float value) {
        return Math.max(0.0f, Math.min(1.0f, value));
    }

    private static float clampSigned(float value) {
        return Math.max(-1.0f, Math.min(1.0f, value));
    }
}
