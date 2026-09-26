package ai.cleo.ardymobile;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.content.Context;
import android.os.SystemClock;
import java.io.File;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/* JADX INFO: loaded from: classes3.dex */
final class ArdyMobileSampler {
    private static final String DECODER = "decoder.onnx";
    private static final String DENOISER = "denoiser.onnx";
    private float[] bindVertices;
    private final Context context;
    private final ArdyRuntimeData data;
    private final OrtEnvironment environment = OrtEnvironment.getEnvironment("ardy-mobile");
    private final ArdyModelProfile profile;
    private final VrmRetargeter vrmRetargeter;

    ArdyMobileSampler(Context context, ArdyModelProfile profile) throws Exception {
        this.context = context.getApplicationContext();
        this.profile = profile;
        this.data = ArdyRuntimeData.load(context, profile);
        ArdyMeshAsset mesh = ArdyMeshAsset.load(context);
        this.bindVertices = mesh.positions;
        this.vrmRetargeter = new VrmRetargeter(VrmRetargetAsset.load(context), this.data, ardyAliases(mesh.jointNames));
    }

    String summary() {
        return this.data.summary() + "\n" + this.vrmRetargeter.summary();
    }

    int genHorizonFrames() {
        return this.data.genHorizonFrames;
    }

    int maxFullBatches() {
        return Math.max(1, this.profile.maxRolloutBatches);
    }

    float fps() {
        return this.data.fps;
    }

    /* JADX WARN: Unreachable blocks removed: 2, instructions: 3 */
    ArdySampleResult sample(ArdySampleSettings settings) throws Exception {
        SkinningResult skinned;
        VrmRetargeter.Result vrm;
        EmbeddingRecord primary = settings.primaryEmbedding();
        if (primary == null || !primary.hasVector()) {
            throw new IllegalArgumentException("Select a real cached LLM2Vec embedding first.");
        }
        int batches = Math.max(1, Math.min(settings.rolloutBatches, maxFullBatches()));
        int horizonTokens = Math.max(1, this.data.genHorizonFrames / this.data.numFramesPerToken);
        int targetTokens = batches * horizonTokens;
        int targetFrames = targetTokens * this.data.numFramesPerToken;
        float[][] textByBatch = textFeaturesByBatch(settings, batches, primary);
        long started = SystemClock.elapsedRealtimeNanos();
        OrtSession denoiser = null;
        OrtSession decoder = null;
        try {
            denoiser = createSession(requireModel(DENOISER), settings.qnn);
            OrtSession decoder2 = createSession(requireModel(DECODER), settings.qnn);
            try {
                long sessionsReady = SystemClock.elapsedRealtimeNanos();
                int routeFrames = this.data.maxFrames + targetFrames;
                float[] routeXz = settings.route.denseXz(routeFrames, this.data.fps);
                float[] routeHeading = settings.route.denseHeading(routeFrames, this.data.fps);
                int steps = Math.max(1, Math.min(settings.steps, this.data.numBaseDiffusionSteps));
                Diffusion diffusion = new Diffusion(this.data.numBaseDiffusionSteps, steps);
                long tensorsStarted = SystemClock.elapsedRealtimeNanos();
                try {
                    float[] x = runAutoregressiveDenoise(denoiser, settings, textByBatch, targetTokens, routeXz, routeHeading, diffusion, steps);
                    long denoised = SystemClock.elapsedRealtimeNanos();
                    float[] rootMotion = rootFromTokens(x, targetFrames);
                    float[] body = decodeRollout(decoder2, x, targetTokens, targetFrames);
                    float[] motion = concatRootBody(rootMotion, body, targetFrames);
                    SkinningResult skinned2 = skinMotion(motion, targetFrames);
                    if (settings.vrmRetarget.enabled) {
                        try {
                            VrmRetargeter vrmRetargeter = this.vrmRetargeter;
                            skinned = skinned2;
                            float[] rootMotion2 = skinned.joints;
                            vrm = vrmRetargeter.retarget(rootMotion2, this.data.jointCount, targetFrames, settings.vrmRetarget);
                        } catch (Throwable th) {
                            th = th;
                            decoder = decoder2;
                            close(decoder);
                            close(denoiser);
                            throw th;
                        }
                    } else {
                        skinned = skinned2;
                        vrm = null;
                    }
                    float[] visibleRoute = new float[targetFrames * 2];
                    System.arraycopy(routeXz, 0, visibleRoute, 0, visibleRoute.length);
                    long finished = SystemClock.elapsedRealtimeNanos();
                    try {
                        try {
                            String message = String.format(Locale.US, "%s sampled on %s\n%d x %d-frame rollout (%.2f s)\nembedding %s\nroute %s\n%s\nsession %.2f s, denoise %.2f s, decode+skin+retarget %.2f s", "ARDY " + this.profile.label, settings.qnn ? "QNN session" : "CPU", Integer.valueOf(batches), Integer.valueOf(this.data.genHorizonFrames), Float.valueOf(targetFrames / this.data.fps), settings.embeddingSummary + "\nconditioning: one-batch crossfade at embedding changes", settings.route.name, vrm == null ? "VRM retarget disabled" : vrm.summary, Double.valueOf(seconds(sessionsReady - started)), Double.valueOf(seconds(denoised - tensorsStarted)), Double.valueOf(seconds(finished - denoised)));
                            ArdySampleResult ardySampleResult = new ArdySampleResult(skinned.mesh, visibleRoute, settings.route.keypointXz(), targetFrames, this.data.vertexCount, this.data.fps, message, vrm);
                            close(decoder2);
                            close(denoiser);
                            return ardySampleResult;
                        } catch (Throwable th2) {
                            th = th2;
                            denoiser = denoiser;
                            decoder = decoder2;
                            close(decoder);
                            close(denoiser);
                            throw th;
                        }
                    } catch (Throwable th3) {
                        th = th3;
                        decoder = decoder2;
                    }
                } catch (Throwable th4) {
                    th = th4;
                    decoder = decoder2;
                }
            } catch (Throwable th5) {
                th = th5;
                decoder = decoder2;
            }
        } catch (Throwable th6) {
            th = th6;
        }
    }

    private float[] runDenoiser(OrtSession denoiser, ArdySampleSettings settings, float[] textFeat, float[] x, int historyLen, int generationLen, float[] historyMask, float[] generationMask, float[] historyTokenMask, float[] generationTokenMask, float[] futureTokenMask, float[] observedMotion, float[] motionMask, int step) throws Exception {
        Map<String, OnnxTensor> inputs = new HashMap<>();
        try {
            inputs.put("cfg_weight_text", tensor(new float[]{settings.textGuidance}, 1));
            inputs.put("cfg_weight_cstr", tensor(new float[]{settings.constraintGuidance}, 1));
            inputs.put("x", tensor(x, 1, this.data.maxTokens, this.data.tokenDim));
            inputs.put("history_len", tensor(new long[]{historyLen}, 1));
            inputs.put("generation_len", tensor(new long[]{generationLen}, 1));
            try {
                inputs.put("history_mask", tensor(historyMask, 1, this.data.maxFrames));
                try {
                    inputs.put("generation_mask", tensor(generationMask, 1, this.data.maxFrames));
                    inputs.put("history_token_mask", tensor(historyTokenMask, 1, this.data.maxTokens));
                    try {
                        inputs.put("generation_token_mask", tensor(generationTokenMask, 1, this.data.maxTokens));
                        try {
                            inputs.put("future_token_mask", tensor(futureTokenMask, 1, this.data.maxTokens));
                            inputs.put("text_feat", tensor(textFeat, 1, 1, 4096));
                            try {
                                inputs.put("timesteps", tensor(new long[]{mappedTimestep(step, settings.steps)}, 1));
                                inputs.put("first_heading_angle", tensor(new float[]{0.0f}, 1));
                                try {
                                    inputs.put("motion_mask", tensor(motionMask, 1, this.data.maxFrames, this.data.motionDim));
                                    try {
                                        inputs.put("observed_motion", tensor(observedMotion, 1, this.data.maxFrames, this.data.motionDim));
                                        try {
                                            OrtSession.Result result = denoiser.run(inputs);
                                            try {
                                                float[] fArrTensorToFloatArray = tensorToFloatArray(result.get(0), this.data.maxTokens * this.data.tokenDim);
                                                if (result != null) {
                                                    result.close();
                                                }
                                                closeAll(inputs);
                                                return fArrTensorToFloatArray;
                                            } catch (Throwable th) {
                                                if (result == null) {
                                                    throw th;
                                                }
                                                try {
                                                    result.close();
                                                    throw th;
                                                } catch (Throwable th2) {
                                                    th.addSuppressed(th2);
                                                    throw th;
                                                }
                                            }
                                        } catch (Throwable th3) {
                                            th = th3;
                                            closeAll(inputs);
                                            throw th;
                                        }
                                    } catch (Throwable th4) {
                                        th = th4;
                                    }
                                } catch (Throwable th5) {
                                    th = th5;
                                }
                            } catch (Throwable th6) {
                                th = th6;
                            }
                        } catch (Throwable th7) {
                            th = th7;
                            closeAll(inputs);
                            throw th;
                        }
                    } catch (Throwable th8) {
                        th = th8;
                        closeAll(inputs);
                        throw th;
                    }
                } catch (Throwable th9) {
                    th = th9;
                    closeAll(inputs);
                    throw th;
                }
            } catch (Throwable th10) {
                th = th10;
                closeAll(inputs);
                throw th;
            }
        } catch (Throwable th11) {
            th = th11;
        }
    }

    private float[] runAutoregressiveDenoise(OrtSession denoiser, ArdySampleSettings settings, float[][] textByBatch, int targetTokens, float[] routeXz, float[] routeHeading, Diffusion diffusion, int steps) throws Exception {
        int historyTokens;
        ArdySampleSettings ardySampleSettings = settings;
        int i = targetTokens;
        float[] allTokens = new float[this.data.tokenDim * i];
        float[] context = new float[this.data.maxTokens * this.data.tokenDim];
        Random seedStream = new Random(ardySampleSettings.seed);
        int i2 = 1;
        int horizonTokens = Math.max(1, this.data.genHorizonFrames / this.data.numFramesPerToken);
        int contextTokens = 0;
        int generatedTokens = 0;
        float globalX = 0.0f;
        float globalZ = 0.0f;
        while (generatedTokens < i) {
            int generationTokens = Math.min(horizonTokens, i - generatedTokens);
            int historyTokens2 = Math.min(contextTokens, this.data.maxTokens - generationTokens);
            int historyFrames = historyTokens2 * this.data.numFramesPerToken;
            int generationFrames = generationTokens * this.data.numFramesPerToken;
            int batchIndex = Math.max(0, Math.min(textByBatch.length - i2, generatedTokens / horizonTokens));
            int globalHistoryTokenStart = generatedTokens - historyTokens2;
            int globalFrameStart = globalHistoryTokenStart * this.data.numFramesPerToken;
            float[] x = new float[this.data.maxTokens * this.data.tokenDim];
            if (historyTokens2 > 0) {
                int contextStart = Math.max(0, contextTokens - historyTokens2);
                System.arraycopy(context, this.data.tokenDim * contextStart, x, 0, this.data.tokenDim * historyTokens2);
            }
            fillRandomTokens(x, historyTokens2, generationTokens, seedStream);
            float[] historyMask = new float[this.data.maxFrames];
            float[] generationMask = new float[this.data.maxFrames];
            int frame = 0;
            while (true) {
                historyTokens = historyTokens2;
                if (frame >= this.data.maxFrames) {
                    break;
                }
                if (frame < historyFrames) {
                    historyMask[frame] = 1.0f;
                } else if (frame < historyFrames + generationFrames) {
                    generationMask[frame] = 1.0f;
                }
                frame++;
                historyTokens2 = historyTokens;
            }
            float[] observedMotion = new float[this.data.maxFrames * this.data.motionDim];
            float[] motionMask = new float[this.data.maxFrames * this.data.motionDim];
            int historyTokens3 = historyTokens;
            int horizonTokens2 = horizonTokens;
            Random seedStream2 = seedStream;
            float[] context2 = context;
            fillRootKeyframeConditions(ardySampleSettings.route, routeXz, routeHeading, observedMotion, motionMask, historyFrames, globalX, globalZ, globalFrameStart, i * this.data.numFramesPerToken);
            float[] historyTokenMask = new float[this.data.maxTokens];
            float[] generationTokenMask = new float[this.data.maxTokens];
            float[] futureTokenMask = new float[this.data.maxTokens];
            for (int token = 0; token < this.data.maxTokens; token++) {
                if (token < historyTokens3) {
                    historyTokenMask[token] = 1.0f;
                } else if (token < historyTokens3 + generationTokens) {
                    generationTokenMask[token] = 1.0f;
                } else {
                    futureTokenMask[token] = 1.0f;
                }
            }
            int token2 = steps - 1;
            int index = token2;
            while (index >= 0) {
                float[] futureTokenMask2 = futureTokenMask;
                float[] generationTokenMask2 = generationTokenMask;
                int historyTokens4 = historyTokens3;
                float[] clean = runDenoiser(denoiser, settings, textByBatch[batchIndex], x, historyFrames, generationFrames, historyMask, generationMask, historyTokenMask, generationTokenMask2, futureTokenMask2, observedMotion, motionMask, index);
                ddimUpdateTokenRange(x, clean, historyTokens4, generationTokens, index, diffusion);
                index--;
                textByBatch = textByBatch;
                futureTokenMask = futureTokenMask2;
                generationTokenMask = generationTokenMask2;
                historyTokenMask = historyTokenMask;
                allTokens = allTokens;
                historyTokens3 = historyTokens4;
            }
            int historyTokens5 = historyTokens3;
            copyGeneratedTokensWithGlobalOffset(x, historyTokens5, generationTokens, allTokens, generatedTokens, globalX, globalZ);
            generatedTokens += generationTokens;
            contextTokens = historyTokens5 + generationTokens;
            System.arraycopy(x, 0, context2, 0, this.data.tokenDim * contextTokens);
            float[] center = recenterHistoryRoot(context2, contextTokens, (this.data.numFramesPerToken * contextTokens) - 1);
            globalX += center[0];
            globalZ += center[1];
            ardySampleSettings = settings;
            i = targetTokens;
            context = context2;
            i2 = 1;
            horizonTokens = horizonTokens2;
            seedStream = seedStream2;
        }
        return allTokens;
    }

    private float[][] textFeaturesByBatch(ArdySampleSettings settings, int batches, EmbeddingRecord primary) {
        float[][] raw = new float[batches][];
        for (int i = 0; i < batches; i++) {
            raw[i] = primary.vector;
        }
        if (settings.batchEmbeddings != null) {
            int count = Math.min(batches, settings.batchEmbeddings.length);
            for (int i2 = 0; i2 < count; i2++) {
                EmbeddingRecord record = settings.batchEmbeddings[i2];
                if (record != null && record.hasVector()) {
                    raw[i2] = record.vector;
                }
            }
        }
        float[][] values = new float[batches][];
        for (int i3 = 0; i3 < batches; i3++) {
            if (i3 > 0 && raw[i3] != raw[i3 - 1]) {
                values[i3] = blendTextFeatures(raw[i3 - 1], raw[i3], 0.72f);
            } else {
                values[i3] = raw[i3];
            }
        }
        return values;
    }

    private float[] blendTextFeatures(float[] previous, float[] current, float alpha) {
        float[] out = new float[4096];
        double prevNorm = 0.0d;
        double currentNorm = 0.0d;
        double outNorm = 0.0d;
        for (int i = 0; i < out.length; i++) {
            float p = previous[i];
            float c = current[i];
            float value = ((1.0f - alpha) * p) + (c * alpha);
            out[i] = value;
            prevNorm += (double) (p * p);
            currentNorm += (double) (c * c);
            outNorm += (double) (value * value);
        }
        if (outNorm > 1.0E-12d) {
            float targetNorm = (float) (((Math.sqrt(prevNorm) * ((double) (1.0f - alpha))) + (Math.sqrt(currentNorm) * ((double) alpha))) / Math.sqrt(outNorm));
            for (int i2 = 0; i2 < out.length; i2++) {
                out[i2] = out[i2] * targetNorm;
            }
        }
        return out;
    }

    private float[] decodeRollout(OrtSession decoder, float[] tokens, int targetTokens, int targetFrames) throws Exception {
        float[] body = new float[this.data.bodyDim * targetFrames];
        int tokenStart = 0;
        while (tokenStart < targetTokens) {
            int chunkTokens = Math.min(this.data.maxTokens, targetTokens - tokenStart);
            int chunkFrames = Math.min(targetFrames - (this.data.numFramesPerToken * tokenStart), this.data.numFramesPerToken * chunkTokens);
            float[] latentTokens = new float[this.data.maxTokens * this.data.latentDim];
            for (int token = 0; token < chunkTokens; token++) {
                int source = ((tokenStart + token) * this.data.tokenDim) + (this.data.numFramesPerToken * this.data.rootDim);
                System.arraycopy(tokens, source, latentTokens, this.data.latentDim * token, this.data.latentDim);
            }
            int frameStart = tokenStart * this.data.numFramesPerToken;
            float[] root = rootFromTokens(tokens, frameStart, this.data.maxFrames);
            float[] externalCond = globalRootToLocalRoot(root, this.data.maxFrames);
            float[] decoded = runDecoder(decoder, latentTokens, externalCond, this.data.maxFrames, this.data.maxTokens);
            for (int frame = 0; frame < chunkFrames; frame++) {
                System.arraycopy(decoded, this.data.bodyDim * frame, body, (frameStart + frame) * this.data.bodyDim, this.data.bodyDim);
            }
            tokenStart += chunkTokens;
        }
        return body;
    }

    /* JADX WARN: Unreachable blocks removed: 2, instructions: 4 */
    private float[] runDecoder(OrtSession decoder, float[] latentTokens, float[] externalCond, int frames, int tokens) throws Exception {
        Map<String, OnnxTensor> inputs = new HashMap<>();
        try {
            inputs.put("latent_tokens", tensor(latentTokens, 1, tokens, this.data.latentDim));
            try {
                inputs.put("external_cond", tensor(externalCond, 1, frames, this.data.localRootDim));
                inputs.put("motion_pad_mask", tensor(fill(frames, 1.0f), 1, frames));
                try {
                    OrtSession.Result result = decoder.run(inputs);
                    try {
                        if (result.size() >= 2) {
                            float[] fArrTensorToFloatArray = tensorToFloatArray(result.get(1), this.data.bodyDim * frames);
                            if (result != null) {
                                result.close();
                            }
                            closeAll(inputs);
                            return fArrTensorToFloatArray;
                        }
                        throw new IllegalStateException("Decoder returned " + result.size() + " output(s); expected root and body.");
                    } catch (Throwable th) {
                        if (result == null) {
                            throw th;
                        }
                        try {
                            result.close();
                            throw th;
                        } catch (Throwable th2) {
                            th.addSuppressed(th2);
                            throw th;
                        }
                    }
                } catch (Throwable th3) {
                    th = th3;
                    closeAll(inputs);
                    throw th;
                }
            } catch (Throwable th4) {
                th = th4;
            }
        } catch (Throwable th5) {
            th = th5;
        }
    }

    private void fillRootKeyframeConditions(ArdyRoute route, float[] routeXz, float[] headings, float[] observed, float[] mask, int historyFrames, float globalX, float globalZ, int globalFrameStart, int targetFrames) {
        float[] points = route.timeXz;
        for (int index = 0; index < points.length; index += 3) {
            int globalFrame = Math.max(0, Math.min(targetFrames - 1, Math.round(points[index] * this.data.fps)));
            int frame = globalFrame - globalFrameStart;
            if (frame >= historyFrames && frame < this.data.maxFrames) {
                int base = frame * this.data.motionDim;
                int routeFrame = routeFrame(globalFrame, routeXz);
                float x = points[index + 1] - globalX;
                float z = points[index + 2] - globalZ;
                float heading = headings[routeFrame];
                setObserved(observed, mask, base, 0, x);
                setObserved(observed, mask, base, 2, z);
                setObserved(observed, mask, base, 3, (float) Math.cos(heading));
                setObserved(observed, mask, base, 4, (float) Math.sin(heading));
            }
        }
    }

    private void setObserved(float[] observed, float[] mask, int base, int dim, float value) {
        observed[base + dim] = (value - this.data.motionMean[dim]) / this.data.motionStd[dim];
        mask[base + dim] = 1.0f;
    }

    private void copyGeneratedTokensWithGlobalOffset(float[] x, int sourceTokenStart, int tokenCount, float[] out, int outTokenStart, float globalX, float globalZ) {
        for (int token = 0; token < tokenCount; token++) {
            int source = (sourceTokenStart + token) * this.data.tokenDim;
            int target = (outTokenStart + token) * this.data.tokenDim;
            System.arraycopy(x, source, out, target, this.data.tokenDim);
            for (int inToken = 0; inToken < this.data.numFramesPerToken; inToken++) {
                int sourceRoot = (this.data.rootDim * inToken) + source;
                int targetRoot = (this.data.rootDim * inToken) + target;
                float rootX = (x[sourceRoot] * this.data.globalRootStd[0]) + this.data.globalRootMean[0] + globalX;
                float rootZ = (x[sourceRoot + 2] * this.data.globalRootStd[2]) + this.data.globalRootMean[2] + globalZ;
                out[targetRoot] = (rootX - this.data.globalRootMean[0]) / this.data.globalRootStd[0];
                out[targetRoot + 2] = (rootZ - this.data.globalRootMean[2]) / this.data.globalRootStd[2];
            }
        }
    }

    private float[] recenterHistoryRoot(float[] history, int tokens, int centerFrame) {
        int centerToken = centerFrame / this.data.numFramesPerToken;
        int centerInToken = centerFrame % this.data.numFramesPerToken;
        int centerBase = (this.data.tokenDim * centerToken) + (this.data.rootDim * centerInToken);
        float centerX = (history[centerBase] * this.data.globalRootStd[0]) + this.data.globalRootMean[0];
        float centerZ = (history[centerBase + 2] * this.data.globalRootStd[2]) + this.data.globalRootMean[2];
        translateHistoryRoot(history, tokens, -centerX, -centerZ);
        return new float[]{centerX, centerZ};
    }

    private void translateHistoryRoot(float[] history, int tokens, float deltaX, float deltaZ) {
        if (deltaX == 0.0f && deltaZ == 0.0f) {
            return;
        }
        int frames = this.data.numFramesPerToken * tokens;
        for (int frame = 0; frame < frames; frame++) {
            int token = frame / this.data.numFramesPerToken;
            int inToken = frame % this.data.numFramesPerToken;
            int base = (this.data.tokenDim * token) + (this.data.rootDim * inToken);
            float x = (history[base] * this.data.globalRootStd[0]) + this.data.globalRootMean[0] + deltaX;
            float z = (history[base + 2] * this.data.globalRootStd[2]) + this.data.globalRootMean[2] + deltaZ;
            history[base] = (x - this.data.globalRootMean[0]) / this.data.globalRootStd[0];
            history[base + 2] = (z - this.data.globalRootMean[2]) / this.data.globalRootStd[2];
        }
    }

    private float[] extractRootMotion(float[] x, float[] routeXz, float[] headings) {
        float[] root = new float[this.data.maxFrames * this.data.rootDim];
        for (int frame = 0; frame < this.data.maxFrames; frame++) {
            int token = frame / this.data.numFramesPerToken;
            int inToken = frame % this.data.numFramesPerToken;
            int source = (this.data.tokenDim * token) + (this.data.rootDim * inToken);
            int target = this.data.rootDim * frame;
            for (int i = 0; i < this.data.rootDim; i++) {
                root[target + i] = x[source + i];
            }
            int i2 = frame * 2;
            root[target] = (routeXz[i2] - this.data.globalRootMean[0]) / this.data.globalRootStd[0];
            root[target + 2] = (routeXz[(frame * 2) + 1] - this.data.globalRootMean[2]) / this.data.globalRootStd[2];
            root[target + 3] = (((float) Math.cos(headings[frame])) - this.data.globalRootMean[3]) / this.data.globalRootStd[3];
            root[target + 4] = (((float) Math.sin(headings[frame])) - this.data.globalRootMean[4]) / this.data.globalRootStd[4];
        }
        return root;
    }

    private float[] rootFromRoute(float[] routeXz, float[] headings, int frameStart, int frames) {
        float[] root = new float[this.data.rootDim * frames];
        for (int frame = 0; frame < frames; frame++) {
            int routeFrame = routeFrame(frameStart + frame, routeXz);
            int target = this.data.rootDim * frame;
            root[target] = (routeXz[routeFrame * 2] - this.data.globalRootMean[0]) / this.data.globalRootStd[0];
            root[target + 1] = (0.0f - this.data.globalRootMean[1]) / this.data.globalRootStd[1];
            root[target + 2] = (routeXz[(routeFrame * 2) + 1] - this.data.globalRootMean[2]) / this.data.globalRootStd[2];
            root[target + 3] = (((float) Math.cos(headings[routeFrame])) - this.data.globalRootMean[3]) / this.data.globalRootStd[3];
            root[target + 4] = (((float) Math.sin(headings[routeFrame])) - this.data.globalRootMean[4]) / this.data.globalRootStd[4];
        }
        return root;
    }

    private float[] rootFromTokens(float[] tokens, int frames) {
        return rootFromTokens(tokens, 0, frames);
    }

    private float[] rootFromTokens(float[] tokens, int frameStart, int frames) {
        float[] root = new float[this.data.rootDim * frames];
        int availableFrames = (tokens.length / this.data.tokenDim) * this.data.numFramesPerToken;
        for (int frame = 0; frame < frames; frame++) {
            int sourceFrame = Math.max(0, Math.min(availableFrames - 1, frameStart + frame));
            int token = sourceFrame / this.data.numFramesPerToken;
            int inToken = sourceFrame % this.data.numFramesPerToken;
            int source = (this.data.tokenDim * token) + (this.data.rootDim * inToken);
            System.arraycopy(tokens, source, root, this.data.rootDim * frame, this.data.rootDim);
        }
        return root;
    }

    private int routeFrame(int frame, float[] routeXz) {
        return Math.max(0, Math.min((routeXz.length / 2) - 1, frame));
    }

    private float[] extractLatents(float[] x) {
        float[] latents = new float[this.data.maxTokens * this.data.latentDim];
        for (int token = 0; token < this.data.maxTokens; token++) {
            System.arraycopy(x, (this.data.tokenDim * token) + (this.data.numFramesPerToken * this.data.rootDim), latents, this.data.latentDim * token, this.data.latentDim);
        }
        return latents;
    }

    private void fillRandomTokens(float[] x, int tokenStart, int tokenCount, Random random) {
        int start = this.data.tokenDim * tokenStart;
        int end = (tokenStart + tokenCount) * this.data.tokenDim;
        for (int i = start; i < end; i++) {
            x[i] = (float) random.nextGaussian();
        }
    }

    private float[] globalRootToLocalRoot(float[] normalizedRoot, int frames) {
        int i = frames;
        float[] raw = new float[this.data.rootDim * i];
        for (int frame = 0; frame < i; frame++) {
            int offset = this.data.rootDim * frame;
            for (int i2 = 0; i2 < this.data.rootDim; i2++) {
                raw[offset + i2] = (normalizedRoot[offset + i2] * this.data.globalRootStd[i2]) + this.data.globalRootMean[i2];
            }
        }
        float[] local = new float[this.data.localRootDim * i];
        int frame2 = 0;
        while (frame2 < i) {
            int next = Math.min(i - 1, frame2 + 1);
            int src = this.data.rootDim * frame2;
            int nxt = this.data.rootDim * next;
            float angle = (float) Math.atan2(raw[src + 4], raw[src + 3]);
            float nextAngle = (float) Math.atan2(raw[nxt + 4], raw[nxt + 3]);
            float rotVel = diffAngle(angle, nextAngle) * this.data.fps;
            float vx = (raw[nxt] - raw[src]) * this.data.fps;
            float vz = (raw[nxt + 2] - raw[src + 2]) * this.data.fps;
            if (frame2 == i - 1 && frame2 > 0) {
                int prev = (frame2 - 1) * this.data.localRootDim;
                rotVel = (local[prev] * this.data.localRootStd[0]) + this.data.localRootMean[0];
                vx = (local[prev + 1] * this.data.localRootStd[1]) + this.data.localRootMean[1];
                vz = (local[prev + 2] * this.data.localRootStd[2]) + this.data.localRootMean[2];
            }
            float y = raw[src + 1];
            int dst = this.data.localRootDim * frame2;
            local[dst] = (rotVel - this.data.localRootMean[0]) / this.data.localRootStd[0];
            local[dst + 1] = (vx - this.data.localRootMean[1]) / this.data.localRootStd[1];
            local[dst + 2] = (vz - this.data.localRootMean[2]) / this.data.localRootStd[2];
            local[dst + 3] = (y - this.data.localRootMean[3]) / this.data.localRootStd[3];
            frame2++;
            i = frames;
            raw = raw;
        }
        return local;
    }

    private float[] concatRootBody(float[] root, float[] body, int frames) {
        float[] motion = new float[this.data.motionDim * frames];
        for (int frame = 0; frame < frames; frame++) {
            System.arraycopy(root, this.data.rootDim * frame, motion, this.data.motionDim * frame, this.data.rootDim);
            System.arraycopy(body, this.data.bodyDim * frame, motion, (this.data.motionDim * frame) + this.data.rootDim, this.data.bodyDim);
        }
        return motion;
    }

    private SkinningResult skinMotion(float[] normalizedMotion, int frames) {
        float[] mesh = new float[this.data.vertexCount * frames * 3];
        float[] joints = new float[this.data.jointCount * frames * 3];
        float[] globalRot = new float[this.data.jointCount * 9];
        float[] localRot = new float[this.data.jointCount * 9];
        float[] posed = new float[this.data.jointCount * 3];
        for (int frame = 0; frame < frames; frame++) {
            float[] motion = unnormalizeMotionFrame(normalizedMotion, frame);
            cont6dToMatrices(motion, globalRot);
            globalToLocal(globalRot, localRot);
            fk(localRot, motion, posed);
            System.arraycopy(posed, 0, joints, this.data.jointCount * frame * 3, posed.length);
            skinFrame(globalRot, posed, mesh, this.data.vertexCount * frame * 3);
        }
        return new SkinningResult(mesh, joints);
    }

    private float[] unnormalizeMotionFrame(float[] normalizedMotion, int frame) {
        float[] motion = new float[this.data.motionDim];
        int offset = this.data.motionDim * frame;
        for (int i = 0; i < this.data.motionDim; i++) {
            motion[i] = (normalizedMotion[offset + i] * this.data.motionStd[i]) + this.data.motionMean[i];
        }
        return motion;
    }

    private void cont6dToMatrices(float[] motion, float[] out) {
        for (int joint = 0; joint < this.data.jointCount; joint++) {
            int s = (joint * 6) + 83;
            float x0 = motion[s];
            float x1 = motion[s + 1];
            float x2 = motion[s + 2];
            float invX = invLength(x0, x1, x2);
            float x3 = x0 * invX;
            float x4 = x1 * invX;
            float x5 = x2 * invX;
            float y0 = motion[s + 3];
            float y1 = motion[s + 4];
            float y2 = motion[s + 5];
            float z0 = (x4 * y2) - (x5 * y1);
            float z1 = (x5 * y0) - (x3 * y2);
            float z2 = (x3 * y1) - (x4 * y0);
            float invZ = invLength(z0, z1, z2);
            float z3 = z0 * invZ;
            float z4 = z1 * invZ;
            float z5 = z2 * invZ;
            int o = joint * 9;
            out[o] = x3;
            out[o + 1] = (z4 * x5) - (z5 * x4);
            out[o + 2] = z3;
            out[o + 3] = x4;
            out[o + 4] = (z5 * x3) - (z3 * x5);
            out[o + 5] = z4;
            out[o + 6] = x5;
            out[o + 7] = (z3 * x4) - (z4 * x3);
            out[o + 8] = z5;
        }
    }

    private void globalToLocal(float[] globalRot, float[] localRot) {
        for (int joint = 0; joint < this.data.jointCount; joint++) {
            int parent = this.data.jointParents[joint];
            if (parent < 0) {
                System.arraycopy(globalRot, joint * 9, localRot, joint * 9, 9);
            } else {
                mulAtBA(globalRot, parent * 9, globalRot, joint * 9, localRot, joint * 9);
            }
        }
    }

    private void fk(float[] localRot, float[] motion, float[] posed) {
        float rootX = motion[0];
        float rootY = motion[1];
        float rootZ = motion[2];
        float[] noRoot = new float[this.data.jointCount * 3];
        float[] globalRot = new float[this.data.jointCount * 9];
        float pelvisX = this.data.neutralJoints[0];
        float pelvisY = this.data.neutralJoints[1];
        float pelvisZ = this.data.neutralJoints[2];
        for (int joint = 0; joint < this.data.jointCount; joint++) {
            int parent = this.data.jointParents[joint];
            int j3 = joint * 3;
            int j9 = joint * 9;
            float nx = this.data.neutralJoints[j3] - pelvisX;
            float ny = this.data.neutralJoints[j3 + 1] - pelvisY;
            float nz = this.data.neutralJoints[j3 + 2] - pelvisZ;
            if (parent < 0) {
                System.arraycopy(localRot, j9, globalRot, j9, 9);
                noRoot[j3] = nx;
                noRoot[j3 + 1] = ny;
                noRoot[j3 + 2] = nz;
            } else {
                int p3 = parent * 3;
                int p9 = parent * 9;
                float px = this.data.neutralJoints[p3] - pelvisX;
                float py = this.data.neutralJoints[p3 + 1] - pelvisY;
                float pz = this.data.neutralJoints[p3 + 2] - pelvisZ;
                float rx = nx - px;
                float ry = ny - py;
                float rz = nz - pz;
                mul33(globalRot, p9, localRot, j9, globalRot, j9);
                noRoot[j3] = noRoot[p3] + (globalRot[p9] * rx) + (globalRot[p9 + 1] * ry) + (globalRot[p9 + 2] * rz);
                noRoot[j3 + 1] = noRoot[p3 + 1] + (globalRot[p9 + 3] * rx) + (globalRot[p9 + 4] * ry) + (globalRot[p9 + 5] * rz);
                noRoot[j3 + 2] = noRoot[p3 + 2] + (globalRot[p9 + 6] * rx) + (globalRot[p9 + 7] * ry) + (globalRot[p9 + 8] * rz);
            }
            posed[j3] = noRoot[j3] + rootX;
            posed[j3 + 1] = noRoot[j3 + 1] + rootY;
            posed[j3 + 2] = noRoot[j3 + 2] + rootZ;
        }
    }

    private void skinFrame(float[] globalRot, float[] posed, float[] mesh, int meshOffset) {
        for (int vertex = 0; vertex < this.data.vertexCount; vertex++) {
            int bind = vertex * 3;
            float vx = 0.0f;
            float vy = 0.0f;
            float vz = 0.0f;
            for (int influence = 0; influence < this.data.influencesPerVertex; influence++) {
                int iw = (this.data.influencesPerVertex * vertex) + influence;
                int joint = this.data.lbsIndices[iw];
                float weight = this.data.lbsWeights[iw];
                if (weight != 0.0f) {
                    float[] affine = affine(globalRot, posed, joint);
                    float bx = bindVertex(bind);
                    float by = bindVertex(bind + 1);
                    float bz = bindVertex(bind + 2);
                    vx += ((affine[0] * bx) + (affine[1] * by) + (affine[2] * bz) + affine[3]) * weight;
                    vy += ((affine[4] * bx) + (affine[5] * by) + (affine[6] * bz) + affine[7]) * weight;
                    vz += ((affine[8] * bx) + (affine[9] * by) + (affine[10] * bz) + affine[11]) * weight;
                }
            }
            int influence2 = meshOffset + bind;
            mesh[influence2] = vx;
            mesh[meshOffset + bind + 1] = vy;
            mesh[meshOffset + bind + 2] = vz;
        }
    }

    private float bindVertex(int index) {
        return this.bindVertices[index];
    }

    private float[] affine(float[] globalRot, float[] posed, int joint) {
        float[] posed4 = {globalRot[joint * 9], globalRot[(joint * 9) + 1], globalRot[(joint * 9) + 2], posed[joint * 3], globalRot[(joint * 9) + 3], globalRot[(joint * 9) + 4], globalRot[(joint * 9) + 5], posed[(joint * 3) + 1], globalRot[(joint * 9) + 6], globalRot[(joint * 9) + 7], globalRot[(joint * 9) + 8], posed[(joint * 3) + 2]};
        float[] out = new float[12];
        int inv = joint * 16;
        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 4; col++) {
                out[(row * 4) + col] = (posed4[row * 4] * this.data.bindRigInv[inv + col]) + (posed4[(row * 4) + 1] * this.data.bindRigInv[inv + 4 + col]) + (posed4[(row * 4) + 2] * this.data.bindRigInv[inv + 8 + col]) + (posed4[(row * 4) + 3] * this.data.bindRigInv[inv + 12 + col]);
            }
        }
        return out;
    }

    private OrtSession createSession(File model, boolean qnn) throws Exception {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
        options.setIntraOpNumThreads(Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors())));
        options.setInterOpNumThreads(1);
        if (qnn) {
            File backend = new File(this.context.getApplicationInfo().nativeLibraryDir, "libQnnHtp.so");
            if (!backend.isFile()) {
                throw new IllegalStateException("Bundled QNN HTP backend is absent: " + backend);
            }
            Map<String, String> config = new HashMap<>();
            config.put("backend_path", backend.getAbsolutePath());
            config.put("htp_performance_mode", "burst");
            config.put("htp_graph_finalization_optimization_mode", "3");
            config.put("qnn_context_priority", "high");
            config.put("offload_graph_io_quantization", "0");
            options.addQnn(config);
        }
        try {
            return this.environment.createSession(model.getAbsolutePath(), options);
        } finally {
            options.close();
        }
    }

    private File requireModel(String name) {
        File file = new File(new File(this.context.getFilesDir(), this.profile.modelDir), name);
        if (!file.isFile()) {
            throw new IllegalStateException("Missing phone model file " + file.getAbsolutePath());
        }
        return file;
    }

    private OnnxTensor tensor(float[] values, long... shape) throws Exception {
        return OnnxTensor.createTensor(this.environment, FloatBuffer.wrap(values), shape);
    }

    private OnnxTensor tensor(long[] values, long... shape) throws Exception {
        return OnnxTensor.createTensor(this.environment, LongBuffer.wrap(values), shape);
    }

    private static float[] tensorToFloatArray(OnnxValue value, int expected) throws Exception {
        FloatBuffer buffer = ((OnnxTensor) value).getFloatBuffer();
        buffer.position(0);
        float[] out = new float[buffer.remaining()];
        buffer.get(out);
        if (out.length != expected) {
            throw new IllegalStateException("Unexpected tensor length " + out.length + "; expected " + expected);
        }
        return out;
    }

    private static float[] randomTokens(int tokens, int dim, int seed) {
        Random random = new Random(seed);
        float[] values = new float[tokens * dim];
        for (int i = 0; i < values.length; i++) {
            values[i] = (float) random.nextGaussian();
        }
        return values;
    }

    private static float[] fill(int count, float value) {
        float[] values = new float[count];
        for (int i = 0; i < count; i++) {
            values[i] = value;
        }
        return values;
    }

    private void ddimUpdateTokenRange(float[] x, float[] clean, int tokenStart, int tokenCount, int step, Diffusion diffusion) {
        float sqrtRecip = diffusion.sqrtRecipAlphasCumprod[step];
        float sqrtRecipM1 = diffusion.sqrtRecipM1AlphasCumprod[step];
        float sqrtAlphaPrev = (float) Math.sqrt(diffusion.alphasCumprodPrev[step]);
        float sqrtOneMinusAlphaPrev = (float) Math.sqrt(1.0f - diffusion.alphasCumprodPrev[step]);
        int start = this.data.tokenDim * tokenStart;
        int end = (tokenStart + tokenCount) * this.data.tokenDim;
        for (int i = start; i < end; i++) {
            float eps = ((x[i] * sqrtRecip) - clean[i]) / sqrtRecipM1;
            x[i] = (clean[i] * sqrtAlphaPrev) + (sqrtOneMinusAlphaPrev * eps);
        }
    }

    private int mappedTimestep(int step, int requestedSteps) {
        int steps = Math.max(1, Math.min(requestedSteps, this.data.numBaseDiffusionSteps));
        float stride = (this.data.numBaseDiffusionSteps - 1.0f) / Math.max(1, steps - 1);
        return Math.min(this.data.numBaseDiffusionSteps - 1, Math.round(step * stride));
    }

    private static float diffAngle(float a, float b) {
        float cos = (float) ((Math.cos(b) * Math.cos(a)) + (Math.sin(b) * Math.sin(a)));
        float sin = (float) ((Math.sin(b) * Math.cos(a)) - (Math.cos(b) * Math.sin(a)));
        return (float) Math.atan2(sin, cos);
    }

    private static float invLength(float x, float y, float z) {
        return 1.0f / Math.max(1.0E-8f, (float) Math.sqrt(((x * x) + (y * y)) + (z * z)));
    }

    private static void mul33(float[] a, int ao, float[] b, int bo, float[] out, int oo) {
        float a00 = a[ao];
        float a01 = a[ao + 1];
        float a02 = a[ao + 2];
        float a10 = a[ao + 3];
        float a11 = a[ao + 4];
        float a12 = a[ao + 5];
        float a20 = a[ao + 6];
        float a21 = a[ao + 7];
        float a22 = a[ao + 8];
        float b00 = b[bo];
        float b01 = b[bo + 1];
        float b02 = b[bo + 2];
        float b10 = b[bo + 3];
        float b11 = b[bo + 4];
        float b12 = b[bo + 5];
        float b20 = b[bo + 6];
        float b21 = b[bo + 7];
        float b22 = b[bo + 8];
        out[oo] = (a00 * b00) + (a01 * b10) + (a02 * b20);
        out[oo + 1] = (a00 * b01) + (a01 * b11) + (a02 * b21);
        out[oo + 2] = (a00 * b02) + (a01 * b12) + (a02 * b22);
        out[oo + 3] = (a10 * b00) + (a11 * b10) + (a12 * b20);
        out[oo + 4] = (a10 * b01) + (a11 * b11) + (a12 * b21);
        out[oo + 5] = (a10 * b02) + (a11 * b12) + (a12 * b22);
        out[oo + 6] = (a20 * b00) + (a21 * b10) + (a22 * b20);
        out[oo + 7] = (a20 * b01) + (a21 * b11) + (a22 * b21);
        out[oo + 8] = (a20 * b02) + (a21 * b12) + (a22 * b22);
    }

    private static void mulAtBA(float[] a, int ao, float[] b, int bo, float[] out, int oo) {
        for (int r = 0; r < 3; r++) {
            for (int c = 0; c < 3; c++) {
                out[(r * 3) + oo + c] = (a[ao + r] * b[bo + c]) + (a[ao + 3 + r] * b[bo + 3 + c]) + (a[ao + 6 + r] * b[bo + 6 + c]);
            }
        }
    }

    private static void closeAll(Map<String, OnnxTensor> values) {
        for (OnnxTensor value : values.values()) {
            close(value);
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

    private static String[] ardyAliases(String[] names) {
        String[] out = new String[names.length];
        for (int i = 0; i < names.length; i++) {
            out[i] = ardyAlias(names[i]);
        }
        return out;
    }

    private static String ardyAlias(String name) {
        if ("Hips".equals(name)) {
            return "pelvis";
        }
        if ("Spine".equals(name)) {
            return "spine1";
        }
        if ("Spine1".equals(name)) {
            return "spine2";
        }
        if ("Spine2".equals(name)) {
            return "spine2_mid";
        }
        if ("Spine3".equals(name)) {
            return "spine3";
        }
        if ("Neck".equals(name)) {
            return "neck";
        }
        if ("Head".equals(name)) {
            return "head";
        }
        if ("RightShoulder".equals(name)) {
            return "right_collar";
        }
        if ("RightArm".equals(name)) {
            return "right_shoulder";
        }
        if ("RightForeArm".equals(name)) {
            return "right_elbow";
        }
        if ("RightHand".equals(name)) {
            return "right_wrist";
        }
        if ("LeftShoulder".equals(name)) {
            return "left_collar";
        }
        if ("LeftArm".equals(name)) {
            return "left_shoulder";
        }
        if ("LeftForeArm".equals(name)) {
            return "left_elbow";
        }
        if ("LeftHand".equals(name)) {
            return "left_wrist";
        }
        if ("RightUpLeg".equals(name)) {
            return "right_hip";
        }
        if ("RightLeg".equals(name)) {
            return "right_knee";
        }
        if ("RightFoot".equals(name)) {
            return "right_ankle";
        }
        if ("RightToeBase".equals(name)) {
            return "right_toe";
        }
        if ("LeftUpLeg".equals(name)) {
            return "left_hip";
        }
        if ("LeftLeg".equals(name)) {
            return "left_knee";
        }
        if ("LeftFoot".equals(name)) {
            return "left_ankle";
        }
        return "LeftToeBase".equals(name) ? "left_toe" : name;
    }

    private static final class SkinningResult {
        final float[] joints;
        final float[] mesh;

        SkinningResult(float[] mesh, float[] joints) {
            this.mesh = mesh;
            this.joints = joints;
        }
    }

    private static final class Diffusion {
        final float[] alphasCumprodPrev;
        final float[] sqrtRecipAlphasCumprod;
        final float[] sqrtRecipM1AlphasCumprod;

        Diffusion(int baseSteps, int sampleSteps) {
            float[] baseBetas = betaSchedule(baseSteps);
            float[] baseAlphaCumprod = new float[baseSteps];
            float accum = 1.0f;
            for (int i = 0; i < baseSteps; i++) {
                accum *= 1.0f - baseBetas[i];
                baseAlphaCumprod[i] = accum;
            }
            float stride = (baseSteps - 1.0f) / Math.max(1, sampleSteps - 1);
            float[] selected = new float[baseSteps];
            for (int i2 = 0; i2 < baseSteps; i2++) {
                int index = Math.min(baseSteps - 1, Math.round(i2 * stride));
                selected[i2] = baseAlphaCumprod[index];
            }
            float[] betas = new float[baseSteps];
            int i3 = 0;
            while (i3 < baseSteps) {
                float previous = i3 == 0 ? 1.0f : selected[i3 - 1];
                betas[i3] = 1.0f - (selected[i3] / previous);
                i3++;
            }
            float[] alphasCumprod = new float[baseSteps];
            float accum2 = 1.0f;
            for (int i4 = 0; i4 < baseSteps; i4++) {
                accum2 *= 1.0f - betas[i4];
                alphasCumprod[i4] = Math.max(1.0E-9f, accum2);
            }
            this.alphasCumprodPrev = new float[baseSteps];
            this.sqrtRecipAlphasCumprod = new float[baseSteps];
            this.sqrtRecipM1AlphasCumprod = new float[baseSteps];
            int i5 = 0;
            while (i5 < baseSteps) {
                this.alphasCumprodPrev[i5] = i5 == 0 ? 1.0f : alphasCumprod[i5 - 1];
                this.sqrtRecipAlphasCumprod[i5] = (float) Math.sqrt(1.0f / alphasCumprod[i5]);
                this.sqrtRecipM1AlphasCumprod[i5] = (float) Math.sqrt((1.0f - alphasCumprod[i5]) / alphasCumprod[i5]);
                i5++;
            }
        }

        private static float[] betaSchedule(int steps) {
            float[] betas = new float[steps];
            for (int i = 0; i < steps; i++) {
                double t1 = ((double) i) / ((double) steps);
                double t2 = ((double) (i + 1)) / ((double) steps);
                double a1 = Math.pow(Math.cos((((t1 + 0.008d) / 1.008d) * 3.141592653589793d) / 2.0d), 2.0d);
                double a2 = Math.pow(Math.cos((((0.008d + t2) / 1.008d) * 3.141592653589793d) / 2.0d), 2.0d);
                betas[i] = (float) Math.min(1.0d - (a2 / a1), 0.999d);
            }
            return betas;
        }
    }
}
