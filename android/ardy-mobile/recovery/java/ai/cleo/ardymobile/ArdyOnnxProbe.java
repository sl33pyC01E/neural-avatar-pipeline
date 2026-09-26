package ai.cleo.ardymobile;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.content.Context;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/* JADX INFO: loaded from: classes3.dex */
final class ArdyOnnxProbe {
    private static final String DECODER = "decoder.onnx";
    private static final String DENOISER = "denoiser.onnx";
    private static final int FRAMES = 64;
    private static final int MOTION_REP_DIM = 330;
    private static final int TOKENS = 16;
    private static final int TOKEN_DIM = 148;
    private final Context context;
    private final OrtEnvironment environment = OrtEnvironment.getEnvironment("ardy-mobile");
    private final ArdyModelProfile profile;

    ArdyOnnxProbe(Context context, ArdyModelProfile profile) {
        this.context = context.getApplicationContext();
        this.profile = profile;
    }

    String providers() {
        try {
            return String.valueOf(OrtEnvironment.getAvailableProviders());
        } catch (Throwable error) {
            return "provider query failed: " + briefError(error);
        }
    }

    String modelDirectory() {
        return modelRoot().getAbsolutePath();
    }

    ProbeResult checkModelFiles() {
        try {
            File denoiserFile = requireModel(DENOISER);
            File decoderFile = requireModel(DECODER);
            return ProbeResult.ok(modelSummary("Phone ARDY " + this.profile.label + " model files ready", denoiserFile, decoderFile));
        } catch (Throwable error) {
            return ProbeResult.fail("Phone ARDY model files missing: " + briefError(error));
        }
    }

    /* JADX WARN: Code duplicated, block: B:28:0x0082  */
    /* JADX WARN: Code duplicated, block: B:29:0x0085  */
    ProbeResult loadSessions(boolean qnn) {
        String str;
        String str2;
        String str3;
        long started = SystemClock.elapsedRealtimeNanos();
        OrtSession denoiser = null;
        OrtSession decoder = null;
        try {
            File denoiserFile = requireModel(DENOISER);
            File decoderFile = requireModel(DECODER);
            long checked = SystemClock.elapsedRealtimeNanos();
            denoiser = createSession(denoiserFile, qnn, false);
            decoder = createSession(decoderFile, qnn, false);
            long loaded = SystemClock.elapsedRealtimeNanos();
            str = "QNN";
            try {
                str2 = "CPU";
                try {
                    try {
                        ProbeResult probeResultOk = ProbeResult.ok(String.format(Locale.US, "%s sessions loaded\nmodel check %.2f s, session create %.2f s\n%s\nproviders %s", qnn ? "QNN" : "CPU", Double.valueOf(seconds(checked - started)), Double.valueOf(seconds(loaded - checked)), modelSummary("models", denoiserFile, decoderFile), providers()));
                        close(decoder);
                        close(denoiser);
                        return probeResultOk;
                    } catch (Throwable th) {
                        error = th;
                        try {
                            StringBuilder sb = new StringBuilder();
                            if (qnn) {
                                str3 = str;
                            } else {
                                str3 = str2;
                            }
                            return ProbeResult.fail(sb.append(str3).append(" session load failed: ").append(briefError(error)).toString());
                        } finally {
                            close(decoder);
                            close(denoiser);
                        }
                    }
                } catch (Throwable th2) {
                    error = th2;
                    StringBuilder sb2 = new StringBuilder();
                    if (qnn) {
                        str3 = str;
                    } else {
                        str3 = str2;
                    }
                    return ProbeResult.fail(sb2.append(str3).append(" session load failed: ").append(briefError(error)).toString());
                }
            } catch (Throwable th3) {
                error = th3;
                str2 = "CPU";
                StringBuilder sb3 = new StringBuilder();
                if (qnn) {
                    str3 = str;
                } else {
                    str3 = str2;
                }
                return ProbeResult.fail(sb3.append(str3).append(" session load failed: ").append(briefError(error)).toString());
            }
        } catch (Throwable th4) {
            error = th4;
            str = "QNN";
        }
    }

    /* JADX WARN: Code duplicated, block: B:100:? A[Catch: all -> 0x024a, SYNTHETIC, TryCatch #6 {all -> 0x024a, blocks: (B:31:0x01f6, B:54:0x0233, B:53:0x0230, B:57:0x023c, B:58:0x0249, B:49:0x022a), top: B:90:0x0015, inners: #9 }] */
    /* JADX WARN: Code duplicated, block: B:62:0x0252  */
    /* JADX WARN: Code duplicated, block: B:63:0x0255  */
    /* JADX WARN: Code duplicated, block: B:68:0x027f A[DONT_GENERATE, LOOP:1: B:66:0x0279->B:68:0x027f, LOOP_END] */
    /* JADX WARN: Code duplicated, block: B:95:0x022a A[EXC_TOP_SPLITTER, SYNTHETIC] */
    ProbeResult runDenoiser(boolean qnn, float[] textFeat) {
        String str;
        String str2;
        Throwable th;
        String profile;
        long started = SystemClock.elapsedRealtimeNanos();
        OrtSession denoiser = null;
        Map<String, OnnxTensor> inputs = new HashMap<>();
        String str3 = "CPU";
        try {
            if (textFeat != null) {
                try {
                    if (textFeat.length == 4096) {
                        File denoiserFile = requireModel(DENOISER);
                        denoiser = createSession(denoiserFile, qnn, qnn);
                        long loaded = SystemClock.elapsedRealtimeNanos();
                        inputs.put("cfg_weight_text", tensor(new float[]{2.0f}, 1));
                        inputs.put("cfg_weight_cstr", tensor(new float[]{2.0f}, 1));
                        inputs.put("x", tensor(new float[2368], 1, 16, 148));
                        inputs.put("history_len", tensor(new long[]{4}, 1));
                        inputs.put("generation_len", tensor(new long[]{60}, 1));
                        inputs.put("history_mask", tensor(maskFrames(true), 1, 64));
                        inputs.put("generation_mask", tensor(maskFrames(false), 1, 64));
                        inputs.put("history_token_mask", tensor(maskTokens(true), 1, 16));
                        inputs.put("generation_token_mask", tensor(maskTokens(false), 1, 16));
                        inputs.put("future_token_mask", tensor(new float[TOKENS], 1, 16));
                        inputs.put("text_feat", tensor(textFeat, 1, 1, 4096));
                        inputs.put("timesteps", tensor(new long[]{0}, 1));
                        inputs.put("first_heading_angle", tensor(new float[]{0.0f}, 1));
                        inputs.put("motion_mask", tensor(new float[21120], 1, 64, 330));
                        inputs.put("observed_motion", tensor(new float[21120], 1, 64, 330));
                        long tensorsReady = SystemClock.elapsedRealtimeNanos();
                        OrtSession.Result ignored = denoiser.run(inputs, Collections.singleton("output"));
                        try {
                            long ran = SystemClock.elapsedRealtimeNanos();
                            if (!qnn) {
                                profile = "";
                            } else {
                                try {
                                    String profilePath = denoiser.endProfiling();
                                    String profile2 = "\nprofile " + profilePath + "\n" + providerSummary(new File(profilePath));
                                    profile = profile2;
                                } catch (Throwable ignoredProfile) {
                                    try {
                                        String profile3 = "\nprofile unavailable: " + briefError(ignoredProfile);
                                        profile = profile3;
                                    } catch (Throwable ignoredProfile2) {
                                        th = ignoredProfile2;
                                        str = "QNN";
                                        str3 = "CPU";
                                        if (ignored == null) {
                                            throw th;
                                        }
                                        try {
                                            ignored.close();
                                            throw th;
                                        } catch (Throwable th2) {
                                            th.addSuppressed(th2);
                                            throw th;
                                        }
                                        try {
                                            StringBuilder sb = new StringBuilder();
                                            if (qnn) {
                                                str2 = str;
                                            } else {
                                                str2 = str3;
                                            }
                                            return ProbeResult.fail(sb.append(str2).append(" denoiser run failed: ").append(briefError(error)).toString());
                                        } finally {
                                            for (OnnxTensor tensor : inputs.values()) {
                                                close(tensor);
                                            }
                                            close(denoiser);
                                        }
                                    }
                                }
                            }
                            str = "QNN";
                            try {
                                try {
                                    try {
                                        ProbeResult probeResultOk = ProbeResult.ok(String.format(Locale.US, "%s denoiser forward completed\nsession %.2f s, tensors %.2f s, run %.2f s%s", qnn ? "QNN" : "CPU", Double.valueOf(seconds(loaded - started)), Double.valueOf(seconds(tensorsReady - loaded)), Double.valueOf(seconds(ran - tensorsReady)), profile));
                                        if (ignored != null) {
                                            ignored.close();
                                        }
                                        for (OnnxTensor tensor2 : inputs.values()) {
                                            close(tensor2);
                                        }
                                        close(denoiser);
                                        return probeResultOk;
                                    } catch (Throwable th3) {
                                        th = th3;
                                        th = th;
                                        if (ignored == null) {
                                            throw th;
                                        }
                                        ignored.close();
                                        throw th;
                                        StringBuilder sb2 = new StringBuilder();
                                        if (qnn) {
                                            str2 = str;
                                        } else {
                                            str2 = str3;
                                        }
                                        return ProbeResult.fail(sb2.append(str2).append(" denoiser run failed: ").append(briefError(error)).toString());
                                    }
                                } catch (Throwable th4) {
                                    th = th4;
                                }
                            } catch (Throwable th5) {
                                th = th5;
                                str3 = "CPU";
                                th = th;
                                if (ignored == null) {
                                    throw th;
                                }
                                ignored.close();
                                throw th;
                                StringBuilder sb3 = new StringBuilder();
                                if (qnn) {
                                    str2 = str;
                                } else {
                                    str2 = str3;
                                }
                                return ProbeResult.fail(sb3.append(str2).append(" denoiser run failed: ").append(briefError(error)).toString());
                            }
                        } catch (Throwable th6) {
                            th = th6;
                            str = "QNN";
                        }
                    }
                } catch (Throwable th7) {
                    error = th7;
                    str = "QNN";
                    str3 = "CPU";
                    StringBuilder sb4 = new StringBuilder();
                    if (qnn) {
                        str2 = str;
                    } else {
                        str2 = str3;
                    }
                    return ProbeResult.fail(sb4.append(str2).append(" denoiser run failed: ").append(briefError(error)).toString());
                }
            }
            throw new IllegalArgumentException("A real 4096-wide cached LLM2Vec feature is required");
        } catch (Throwable th8) {
            error = th8;
        }
    }

    private OrtSession createSession(File model, boolean qnn, boolean profile) throws Exception {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
        options.setIntraOpNumThreads(Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors())));
        options.setInterOpNumThreads(1);
        if (qnn) {
            String backend = this.context.getApplicationInfo().nativeLibraryDir + "/libQnnHtp.so";
            if (!new File(backend).isFile()) {
                throw new IllegalStateException("Bundled QNN HTP backend is absent: " + backend);
            }
            Map<String, String> config = new HashMap<>();
            config.put("backend_path", backend);
            config.put("htp_performance_mode", "burst");
            config.put("htp_graph_finalization_optimization_mode", "3");
            config.put("qnn_context_priority", "high");
            config.put("offload_graph_io_quantization", "0");
            config.put("profiling_level", profile ? "basic" : "off");
            options.addQnn(config);
            if (profile) {
                options.enableProfiling(new File(this.context.getFilesDir(), "ardy-denoiser-ort").getAbsolutePath());
            }
        }
        try {
            return this.environment.createSession(model.getAbsolutePath(), options);
        } finally {
            options.close();
        }
    }

    private OnnxTensor tensor(float[] values, long... shape) throws Exception {
        return OnnxTensor.createTensor(this.environment, FloatBuffer.wrap(values), shape);
    }

    private OnnxTensor tensor(long[] values, long... shape) throws Exception {
        return OnnxTensor.createTensor(this.environment, LongBuffer.wrap(values), shape);
    }

    /* JADX WARN: Code duplicated, block: B:11:0x0014  */
    private static float[] maskFrames(boolean history) {
        float[] mask = new float[FRAMES];
        for (int i = 0; i < mask.length; i++) {
            float f = 0.0f;
            if (history) {
                if (i < 4) {
                    f = 1.0f;
                }
            } else if (i >= 4) {
                f = 1.0f;
            }
            mask[i] = f;
        }
        return mask;
    }

    /* JADX WARN: Code duplicated, block: B:11:0x0013  */
    private static float[] maskTokens(boolean history) {
        float[] mask = new float[TOKENS];
        for (int i = 0; i < mask.length; i++) {
            float f = 0.0f;
            if (history) {
                if (i == 0) {
                    f = 1.0f;
                }
            } else if (i != 0) {
                f = 1.0f;
            }
            mask[i] = f;
        }
        return mask;
    }

    private File requireModel(String name) throws IOException {
        File root = modelRoot();
        File file = new File(root, name);
        if (file.isFile() && file.length() > 0) {
            return file;
        }
        if (!root.isDirectory() && !root.mkdirs()) {
            throw new IOException("Could not create model directory " + root);
        }
        throw new IOException("Expected " + file.getAbsolutePath());
    }

    private File modelRoot() {
        return new File(this.context.getFilesDir(), this.profile.modelDir);
    }

    private String modelSummary(String prefix, File denoiserFile, File decoderFile) {
        return String.format(Locale.US, "%s\n%s\ndenoiser %.1f MiB, decoder %.1f MiB", prefix, modelRoot().getAbsolutePath(), Double.valueOf(denoiserFile.length() / 1048576.0d), Double.valueOf(decoderFile.length() / 1048576.0d));
    }

    private static String providerSummary(File profile) throws IOException {
        InputStream input = new FileInputStream(profile);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try {
                byte[] buffer = new byte[65536];
                while (true) {
                    int read = input.read(buffer);
                    if (read < 0) {
                        break;
                    }
                    output.write(buffer, 0, read);
                    try {
                        input.close();
                    } catch (Throwable th) {
                        th.addSuppressed(th);
                    }
                    throw th;
                }
                String text = output.toString("UTF-8");
                output.close();
                input.close();
                int cpu = count(text, "CPUExecutionProvider");
                int qnn = count(text, "QNNExecutionProvider");
                if (qnn == 0 && cpu > 0) {
                    return "provider audit: CPU fallback only (" + cpu + " CPU node events, 0 QNN)";
                }
                return "provider audit: " + qnn + " QNN node events, " + cpu + " CPU node events";
            } catch (Throwable th2) {
                try {
                    output.close();
                } catch (Throwable th3) {
                    th2.addSuppressed(th3);
                }
                throw th2;
            }
        } catch (Throwable th4) {
            input.close();
            throw th4;
        }
    }

    private static int count(String haystack, String needle) {
        int count = 0;
        int index = 0;
        while (true) {
            int index2 = haystack.indexOf(needle, index);
            if (index2 >= 0) {
                count++;
                index = index2 + needle.length();
            } else {
                return count;
            }
        }
    }

    private static void close(AutoCloseable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Throwable th) {
        }
    }

    private static double seconds(long nanos) {
        return nanos / 1.0E9d;
    }

    private static String briefError(Throwable error) {
        String message = "";
        int depth = 0;
        for (Throwable current = error; current != null && depth < 8; current = current.getCause()) {
            String candidate = current.getMessage();
            if (candidate != null && !candidate.trim().isEmpty()) {
                message = candidate.trim();
            }
            depth++;
        }
        if (message.isEmpty()) {
            message = error.getClass().getSimpleName();
        }
        String message2 = message.replaceAll("\\s+", " ");
        return message2.length() <= 360 ? message2 : message2.substring(0, 357) + "...";
    }

    static final class ProbeResult {
        final String message;
        final boolean ok;

        private ProbeResult(boolean ok, String message) {
            this.ok = ok;
            this.message = message;
        }

        static ProbeResult ok(String message) {
            return new ProbeResult(true, message);
        }

        static ProbeResult fail(String message) {
            return new ProbeResult(false, message);
        }
    }
}
