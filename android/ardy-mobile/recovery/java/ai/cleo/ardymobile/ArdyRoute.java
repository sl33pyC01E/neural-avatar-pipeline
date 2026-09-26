package ai.cleo.ardymobile;

import java.util.Locale;

/* JADX INFO: loaded from: classes3.dex */
final class ArdyRoute {
    final String name;
    final float[] timeXz;

    private ArdyRoute(String name, float[] timeXz) {
        this.name = name;
        this.timeXz = (float[]) timeXz.clone();
    }

    static ArdyRoute fromTimeXz(String name, float[] timeXz) {
        if (timeXz == null || timeXz.length < 6 || timeXz.length % 3 != 0) {
            return stationary();
        }
        float[] sorted = (float[]) timeXz.clone();
        for (int i = 3; i < sorted.length; i += 3) {
            for (int j = i; j >= 3 && sorted[j] < sorted[j - 3]; j -= 3) {
                swapTriplet(sorted, j, j - 3);
            }
        }
        sorted[0] = 0.0f;
        sorted[1] = 0.0f;
        sorted[2] = 0.0f;
        for (int i2 = 3; i2 < sorted.length; i2 += 3) {
            sorted[i2] = Math.max(0.05f, sorted[i2]);
            if (i2 > 3 && sorted[i2] <= sorted[i2 - 3]) {
                sorted[i2] = sorted[i2 - 3] + 0.05f;
            }
        }
        return new ArdyRoute(name, sorted);
    }

    static ArdyRoute stationary() {
        return new ArdyRoute("stationary", new float[]{0.0f, 0.0f, 0.0f, 1.6f, 0.0f, 0.0f, 3.2f, 0.0f, 0.0f});
    }

    static ArdyRoute straight() {
        return new ArdyRoute("straight walk", new float[]{0.0f, 0.0f, 0.0f, 1.6f, 0.0f, 0.8f, 3.2f, 0.0f, 1.6f});
    }

    static ArdyRoute curve() {
        return new ArdyRoute("right curve", new float[]{0.0f, 0.0f, 0.0f, 1.0f, 0.25f, 0.45f, 2.2f, 0.55f, 1.05f, 3.2f, 0.85f, 1.45f});
    }

    static ArdyRoute sidestep() {
        return new ArdyRoute("side step left", new float[]{0.0f, 0.0f, 0.0f, 1.2f, -0.45f, 0.25f, 2.2f, -0.8f, 0.45f, 3.2f, -0.9f, 0.8f});
    }

    static ArdyRoute editable(String baseName, float duration, float endX, float endZ, float bendX) {
        float seconds = clamp(duration, 0.8f, 4.0f);
        float midT = seconds * 0.5f;
        return new ArdyRoute(baseName + " editable", new float[]{0.0f, 0.0f, 0.0f, midT, (endX * 0.5f) + bendX, 0.5f * endZ, seconds, endX, endZ});
    }

    float duration() {
        return this.timeXz[this.timeXz.length - 3];
    }

    float endX() {
        return this.timeXz[this.timeXz.length - 2];
    }

    float endZ() {
        return this.timeXz[this.timeXz.length - 1];
    }

    float bendX() {
        if (this.timeXz.length < 6) {
            return 0.0f;
        }
        return this.timeXz[4] - (endX() * 0.5f);
    }

    float[] keypointXz() {
        float[] values = new float[(this.timeXz.length / 3) * 2];
        int out = 0;
        for (int i = 0; i < this.timeXz.length; i += 3) {
            int out2 = out + 1;
            values[out] = this.timeXz[i + 1];
            out = out2 + 1;
            values[out2] = this.timeXz[i + 2];
        }
        return values;
    }

    float[] denseXz(int frames, float fps) {
        float[] values = new float[frames * 2];
        for (int frame = 0; frame < frames; frame++) {
            sample(frame / fps, values, frame * 2);
        }
        return values;
    }

    float[] denseHeading(int frames, float fps) {
        float[] xz = denseXz(frames, fps);
        float[] heading = new float[frames];
        int frame = 0;
        while (frame < frames) {
            int prev = Math.max(0, frame - 1);
            int next = Math.min(frames - 1, frame + 1);
            float dx = xz[next * 2] - xz[prev * 2];
            float dz = xz[(next * 2) + 1] - xz[(prev * 2) + 1];
            if (Math.hypot(dx, dz) < 1.0E-5d) {
                heading[frame] = frame > 0 ? heading[frame - 1] : 0.0f;
            } else {
                heading[frame] = (float) Math.atan2(dx, dz);
            }
            frame++;
        }
        return heading;
    }

    String describe() {
        StringBuilder builder = new StringBuilder(this.name).append(": ");
        for (int i = 0; i < this.timeXz.length; i += 3) {
            if (i > 0) {
                builder.append(" -> ");
            }
            builder.append(String.format(Locale.US, "(%.1fs, %.2f, %.2f)", Float.valueOf(this.timeXz[i]), Float.valueOf(this.timeXz[i + 1]), Float.valueOf(this.timeXz[i + 2])));
        }
        return builder.toString();
    }

    private void sample(float seconds, float[] output, int offset) {
        if (seconds <= this.timeXz[0]) {
            output[offset] = this.timeXz[1];
            output[offset + 1] = this.timeXz[2];
            return;
        }
        for (int i = 3; i < this.timeXz.length; i += 3) {
            float startT = this.timeXz[i - 3];
            float endT = this.timeXz[i];
            if (seconds <= endT || i + 3 >= this.timeXz.length) {
                float denom = Math.max(1.0E-4f, endT - startT);
                float alpha = clamp((seconds - startT) / denom, 0.0f, 1.0f);
                float sx = this.timeXz[i - 2];
                float sz = this.timeXz[i - 1];
                float ex = this.timeXz[i + 1];
                float ez = this.timeXz[i + 2];
                output[offset] = ((ex - sx) * alpha) + sx;
                output[offset + 1] = ((ez - sz) * alpha) + sz;
                return;
            }
        }
        output[offset] = this.timeXz[this.timeXz.length - 2];
        output[offset + 1] = this.timeXz[this.timeXz.length - 1];
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static void swapTriplet(float[] values, int a, int b) {
        for (int i = 0; i < 3; i++) {
            float temp = values[a + i];
            values[a + i] = values[b + i];
            values[b + i] = temp;
        }
    }
}
