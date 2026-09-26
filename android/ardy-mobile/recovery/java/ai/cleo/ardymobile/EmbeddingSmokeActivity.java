package ai.cleo.ardymobile;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

/* JADX INFO: loaded from: classes3.dex */
public final class EmbeddingSmokeActivity extends Activity {
    private static final String TAG = "ArdyEmbedSmoke";

    @Override // android.app.Activity
    protected void onCreate(Bundle savedInstanceState) {
        final String text;
        super.onCreate(savedInstanceState);
        if (getIntent().getStringExtra("text") == null) {
            text = "walk naturally";
        } else {
            text = getIntent().getStringExtra("text");
        }
        Log.i(TAG, "starting embedding smoke test text=\"" + text + "\"");
        new Thread(new Runnable() { // from class: ai.cleo.ardymobile.EmbeddingSmokeActivity$$ExternalSyntheticLambda0
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m8lambda$onCreate$0$aicleoardymobileEmbeddingSmokeActivity(text);
            }
        }, "embedding-smoke").start();
    }

    /* JADX INFO: renamed from: lambda$onCreate$0$ai-cleo-ardymobile-EmbeddingSmokeActivity, reason: not valid java name */
    /* synthetic */ void m8lambda$onCreate$0$aicleoardymobileEmbeddingSmokeActivity(String text) {
        Runnable runnable;
        final EmbeddingSmokeActivity embeddingSmokeActivity = this;
        try {
            long started = System.nanoTime();
            OnDeviceTextEmbedder embedder = new OnDeviceTextEmbedder(embeddingSmokeActivity);
            Log.i(TAG, "status: " + embedder.status().replace('\n', ' '));
            try {
                OnDeviceTextEmbedder.EmbeddingResult result = embedder.embed(text);
                double normSq = 0.0d;
                double sum = 0.0d;
                float[] fArr = result.vector;
                int length = fArr.length;
                int i = 0;
                while (i < length) {
                    try {
                        float value = fArr[i];
                        normSq += ((double) value) * ((double) value);
                        sum += (double) value;
                        i++;
                        fArr = fArr;
                        length = length;
                        embedder = embedder;
                    } catch (Throwable th) {
                        failure = th;
                        embeddingSmokeActivity = this;
                        try {
                            Log.e(TAG, "failed", failure);
                            runnable = new Runnable() { // from class: ai.cleo.ardymobile.EmbeddingSmokeActivity$$ExternalSyntheticLambda1
                                @Override // java.lang.Runnable
                                public final void run() {
                                    this.f$0.finish();
                                }
                            };
                            embeddingSmokeActivity.runOnUiThread(runnable);
                        } catch (Throwable th2) {
                            embeddingSmokeActivity.runOnUiThread(new Runnable() { // from class: ai.cleo.ardymobile.EmbeddingSmokeActivity$$ExternalSyntheticLambda1
                                @Override // java.lang.Runnable
                                public final void run() {
                                    this.f$0.finish();
                                }
                            });
                            throw th2;
                        }
                    }
                }
                long elapsedMs = Math.round((System.nanoTime() - started) / 1000000.0d);
                Log.i(TAG, "ok encoder=\"" + result.encoder + "\" length=" + result.vector.length + " norm=" + Math.sqrt(normSq) + " sum=" + sum + " elapsedMs=" + elapsedMs);
                embeddingSmokeActivity = this;
                runnable = new Runnable() { // from class: ai.cleo.ardymobile.EmbeddingSmokeActivity$$ExternalSyntheticLambda1
                    @Override // java.lang.Runnable
                    public final void run() {
                        this.f$0.finish();
                    }
                };
            } catch (Throwable th3) {
                failure = th3;
            }
        } catch (Throwable th4) {
            failure = th4;
        }
        embeddingSmokeActivity.runOnUiThread(runnable);
    }
}
