package ai.cleo.ardymobile;

import ai.onnxruntime.*;
import android.content.Context;
import java.io.*;
import java.nio.file.*;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.*;

/** Recovered ARDY tensor contract and DDIM/FK math, with persistent rolling context.
 * Rendering receives source joints and local rotations, never displaced VRM vertices.
 * Owned by one worker; no polling thread, wake lock, or work while idle.
 */
public final class ArdySampler implements AutoCloseable {
    private final File filesDirectory;
    private final ArdyModelProfile profile;
    private final ArdyRuntimeData data;
    private final OrtEnvironment environment = OrtEnvironment.getEnvironment("ardy-mobile");
    private OrtSession denoiser, decoder;
    private final float[] history;
    private int historyCount, generatedFrames;
    private float globalX, globalZ;
    private StatefulRandom random;
    private float[] previousEmbedding;
    // CPU contract checks inspect the tensors actually passed to ORT; unset in the app.
    interface InputObserver { void inspect(String stage,Map<String,OnnxTensor> inputs)throws Exception; }
    InputObserver inputObserver;

    public static final class Settings {
        public int steps = 4;
        public int seed = 42;
        public float textGuidance = 2.0f;
        public float constraintGuidance = 2.0f;
        public float velocityX, velocityZ;
        public boolean constrainRoot = true;
        public ArdyPlan plan;
        public boolean lockRoot; // Stationary torso: every generated root constraint, not only the last frame.
    }

    public static final class Batch {
        public final int startFrame, frames, jointCount;
        public final float fps;
        public final float[] joints, roots, rotations;
        public final double elapsedMs;
        Batch(int startFrame, int frames, int jointCount, float fps, float[] joints,
              float[] roots, float[] rotations, double elapsedMs) {
            this.startFrame=startFrame; this.frames=frames; this.jointCount=jointCount;
            this.fps=fps; this.joints=joints; this.roots=roots; this.rotations=rotations;
            this.elapsedMs=elapsedMs;
        }
    }

    public ArdySampler(Context context, String modelId) throws Exception {
        this(context.getFilesDir(), modelId, ArdyRuntimeData.load(context, profile(modelId)));
    }

    /** Runs exactly the Android sampler against inventoried files on the development machine. */
    public ArdySampler(File filesDirectory, File assetsDirectory, String modelId) throws Exception {
        this(filesDirectory, modelId, ArdyRuntimeData.load(assetsDirectory, profile(modelId)));
    }

    private ArdySampler(File filesDirectory, String modelId, ArdyRuntimeData data) {
        this.filesDirectory=filesDirectory;
        this.profile=profile(modelId);
        this.data=data;
        if (data.genHorizonFrames % data.numFramesPerToken != 0 || data.maxFrames != data.maxTokens * data.numFramesPerToken)
            throw new IllegalArgumentException("Inconsistent ARDY token/frame metadata");
        this.history=new float[data.maxTokens*data.tokenDim];
    }

    private static ArdyModelProfile profile(String modelId) {
        if ("core8".equals(modelId)) return ArdyModelProfile.CORE8;
        if ("core40".equals(modelId)) return ArdyModelProfile.CORE40;
        throw new IllegalArgumentException("Unknown ARDY model: "+modelId);
    }

    public int generatedFrames(){return generatedFrames;}
    public boolean isWarm(){return denoiser!=null&&decoder!=null;}
    public void warm() throws Exception {
        if (denoiser!=null) return;
        OrtSession first=createSession(requireModel("denoiser.onnx"));
        try { decoder=createSession(requireModel("decoder.onnx")); denoiser=first; }
        catch(Exception failure) { first.close(); throw failure; }
    }

    public void reset(int seed) {
        Arrays.fill(history,0); historyCount=0; generatedFrames=0; globalX=0; globalZ=0;
        random=new StatefulRandom(seed); previousEmbedding=null;
    }

    /** Save at lifecycle boundaries, not every frame or horizon. */
    public void save(File destination) throws IOException {
        if(random==null)return;
        File directory=destination.getParentFile();if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Cannot save motion context");
        File temporary=new File(destination.getPath()+".partial");
        try(FileOutputStream file=new FileOutputStream(temporary);DataOutputStream out=new DataOutputStream(file)) {
            out.writeInt(0x41524432);out.writeUTF(profile.id);out.writeInt(data.tokenDim);out.writeInt(historyCount);out.writeInt(generatedFrames);
            out.writeFloat(globalX);out.writeFloat(globalZ);out.writeLong(random.state);
            for(int i=0;i<historyCount*data.tokenDim;i++)out.writeFloat(history[i]);
            out.writeInt(previousEmbedding==null?0:previousEmbedding.length);
            if(previousEmbedding!=null)for(float v:previousEmbedding)out.writeFloat(v);
            out.flush();file.getFD().sync();
        }
        Files.move(temporary.toPath(),destination.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
    }
    public boolean restore(File source) throws IOException {
        if(!source.isFile())return false;
        try(DataInputStream in=new DataInputStream(new FileInputStream(source))) {
            if(in.readInt()!=0x41524432||!in.readUTF().equals(profile.id)||in.readInt()!=data.tokenDim)throw new IOException("Incompatible motion checkpoint");
            int count=in.readInt(),frames=in.readInt();
            if(count<0||count>data.maxTokens||frames<0)throw new IOException("Invalid motion checkpoint dimensions");
            float x=finite(in.readFloat()),z=finite(in.readFloat());long rng=in.readLong();
            if(rng<0||rng>StatefulRandom.MASK)throw new IOException("Invalid motion random state");
            float[] saved=new float[count*data.tokenDim];for(int i=0;i<saved.length;i++)saved[i]=finite(in.readFloat());
            int width=in.readInt();if(width!=0&&width!=4096)throw new IOException("Invalid checkpoint embedding");
            float[] text=width==0?null:new float[width];if(text!=null)for(int i=0;i<width;i++)text[i]=finite(in.readFloat());
            if(in.read()!=-1)throw new IOException("Unexpected checkpoint data");
            Arrays.fill(history,0);System.arraycopy(saved,0,history,0,saved.length);historyCount=count;generatedFrames=frames;
            globalX=x;globalZ=z;previousEmbedding=text;random=new StatefulRandom(0);random.state=rng;return true;
        }
    }
    private static float finite(float value)throws IOException {if(!Float.isFinite(value))throw new IOException("Non-finite checkpoint");return value;}
    /** java.util.Random's exact LCG, exposed for checkpoints. Each horizon consumes an even Gaussian count. */
    private static final class StatefulRandom extends Random {
        static final long MASK=(1L<<48)-1;private long state;
        StatefulRandom(long seed){super(0);state=(seed^0x5DEECE66DL)&MASK;}
        @Override protected int next(int bits){state=(state*0x5DEECE66DL+0xBL)&MASK;return (int)(state>>>(48-bits));}
    }

    public Batch next(float[] embedding, Settings settings) throws Exception {
        if (embedding==null || embedding.length!=4096) throw new IllegalArgumentException("ARDY requires 4096-dimensional LLM2Vec features");
        for(float v:embedding) if(!Float.isFinite(v)) throw new IllegalArgumentException("Non-finite text features");
        warm(); if(random==null) reset(settings.seed);
        long started=System.nanoTime();
        int steps=Math.max(1,Math.min(settings.steps,data.numBaseDiffusionSteps));
        int newTokens=data.genHorizonFrames/data.numFramesPerToken;
        int retained=Math.min(historyCount,data.maxTokens-newTokens);
        int historyFrames=retained*data.numFramesPerToken;
        float[] x=new float[data.maxTokens*data.tokenDim];
        System.arraycopy(history,(historyCount-retained)*data.tokenDim,x,0,retained*data.tokenDim);
        fillRandomTokens(x,retained,newTokens,random);
        float[] hm=new float[data.maxFrames], gm=new float[data.maxFrames];
        float[] ht=new float[data.maxTokens],gt=new float[data.maxTokens],ft=new float[data.maxTokens];
        for(int f=0;f<data.maxFrames;f++) { if(f<historyFrames)hm[f]=1; else if(f<historyFrames+data.genHorizonFrames)gm[f]=1; }
        // Future tokens are valid only if they contain an actual observed constraint.
        // Padding is not a future constraint (HybridMotion.convert_frame_mask_to_token_mask).
        for(int t=0;t<data.maxTokens;t++) { if(t<retained)ht[t]=1; else if(t<retained+newTokens)gt[t]=1; }
        float[] observed=new float[data.maxFrames*data.motionDim], mask=new float[observed.length];
        if(settings.constrainRoot) {
            int end=historyFrames+data.genHorizonFrames-1, base=end*data.motionDim;
            float seconds=data.genHorizonFrames/data.fps;
            setObserved(observed,mask,base,0,settings.velocityX*seconds);
            setObserved(observed,mask,base,2,settings.velocityZ*seconds);
            if(Math.hypot(settings.velocityX,settings.velocityZ)>1e-5) {
                float angle=(float)Math.atan2(settings.velocityX,settings.velocityZ);
                setObserved(observed,mask,base,3,(float)Math.cos(angle));
                setObserved(observed,mask,base,4,(float)Math.sin(angle));
            }
            if(retained==0) { setObserved(observed,mask,0,0,0); setObserved(observed,mask,0,2,0); }
        }
        if(settings.lockRoot)for(int f=historyFrames;f<historyFrames+data.genHorizonFrames;f++){
            int base=f*data.motionDim;
            setObserved(observed,mask,base,0,0);setObserved(observed,mask,base,2,0);
            setObserved(observed,mask,base,3,1);setObserved(observed,mask,base,4,0);
        }
        if(!settings.lockRoot&&settings.plan!=null&&!settings.plan.path.isEmpty())for(int f=0;f<data.genHorizonFrames;f++){
            float[] target=settings.plan.root((generatedFrames+f)/data.fps);int base=(historyFrames+f)*data.motionDim;
            setObserved(observed,mask,base,0,target[0]-globalX);setObserved(observed,mask,base,2,target[1]-globalZ);
            setObserved(observed,mask,base,3,(float)Math.cos(target[2]));setObserved(observed,mask,base,4,(float)Math.sin(target[2]));
        }
        float[] text=embedding;
        if(previousEmbedding!=null && !Arrays.equals(previousEmbedding,embedding)) text=blend(previousEmbedding,embedding,.72f);
        Diffusion diffusion=new Diffusion(data.numBaseDiffusionSteps,steps);
        for(int step=steps-1;step>=0;step--) {
            if(Thread.currentThread().isInterrupted()) throw new InterruptedException("Motion generation cancelled");
            float[] clean=runDenoiser(settings,text,x,historyFrames,hm,gm,ht,gt,ft,observed,mask,step,steps);
            ddimUpdateTokenRange(x,clean,retained,newTokens,step,diffusion);
        }
        // Decode with retained context, then publish only the newly generated horizon.
        int validTokens=retained+newTokens;
        requantizeLatents(x,validTokens);
        float[] valid=Arrays.copyOf(x,validTokens*data.tokenDim);
        int validFrames=validTokens*data.numFramesPerToken;
        float[] root=rootFromTokens(valid,validFrames);
        // The recovered ONNX attention reshape is fixed-size despite symbolic input metadata.
        // Pad the tensors, but mark only real history+generation frames valid.
        float[] condition=Arrays.copyOf(globalRootToLocalRoot(root,validFrames),data.maxFrames*data.localRootDim);
        float[] body=runDecoder(extractLatents(x),condition,validFrames);
        float[] normalized=concatRootBody(root,body,validFrames);
        float[] joints=new float[data.genHorizonFrames*data.jointCount*3];
        float[] roots=new float[data.genHorizonFrames*3];
        float[] rotations=new float[data.genHorizonFrames*data.jointCount*9];
        float[] global=new float[data.jointCount*9], local=new float[global.length], posed=new float[data.jointCount*3];
        for(int f=0;f<data.genHorizonFrames;f++) {
            float[] motion=unnormalizeMotionFrame(normalized,historyFrames+f);
            motion[0]+=globalX; motion[2]+=globalZ;
            cont6dToMatrices(motion,global); globalToLocal(global,local); fk(local,motion,posed);
            System.arraycopy(posed,0,joints,f*posed.length,posed.length);
            System.arraycopy(motion,0,roots,f*3,3);
            System.arraycopy(local,0,rotations,f*local.length,local.length);
        }
        System.arraycopy(x,0,history,0,valid.length); historyCount=validTokens;
        float[] center=recenterHistoryRoot(history,historyCount,historyCount*data.numFramesPerToken-1);
        globalX+=center[0]; globalZ+=center[1]; previousEmbedding=embedding.clone();
        Batch result=new Batch(generatedFrames,data.genHorizonFrames,data.jointCount,data.fps,joints,roots,rotations,(System.nanoTime()-started)/1e6);
        generatedFrames+=data.genHorizonFrames;
        return result;
    }

    private float[] runDenoiser(Settings s,float[] text,float[] x,int historyFrames,
            float[] hm,float[] gm,float[] ht,float[] gt,float[] ft,float[] observed,float[] mask,int step,int steps) throws Exception {
        Map<String,OnnxTensor> inputs=new HashMap<>();
        try {
            inputs.put("cfg_weight_text",tensor(new float[]{s.textGuidance},1));
            inputs.put("cfg_weight_cstr",tensor(new float[]{s.constraintGuidance},1));
            inputs.put("x",tensor(x,1,data.maxTokens,data.tokenDim));
            inputs.put("history_len",tensor(new long[]{historyFrames},1));
            inputs.put("generation_len",tensor(new long[]{data.genHorizonFrames},1));
            inputs.put("history_mask",tensor(hm,1,data.maxFrames)); inputs.put("generation_mask",tensor(gm,1,data.maxFrames));
            inputs.put("history_token_mask",tensor(ht,1,data.maxTokens)); inputs.put("generation_token_mask",tensor(gt,1,data.maxTokens));
            inputs.put("future_token_mask",tensor(ft,1,data.maxTokens)); inputs.put("text_feat",tensor(text,1,1,text.length));
            inputs.put("timesteps",tensor(new long[]{mappedTimestep(step,steps)},1));
            float heading=historyFrames==0?0:(float)Math.atan2(x[4]*data.globalRootStd[4]+data.globalRootMean[4],x[3]*data.globalRootStd[3]+data.globalRootMean[3]);
            inputs.put("first_heading_angle",tensor(new float[]{heading},1));
            inputs.put("motion_mask",tensor(mask,1,data.maxFrames,data.motionDim)); inputs.put("observed_motion",tensor(observed,1,data.maxFrames,data.motionDim));
            if(inputObserver!=null)inputObserver.inspect("denoiser",inputs);
            try(OrtSession.Result result=denoiser.run(inputs)) { return tensorToFloatArray(result.get(0),x.length); }
        } finally { closeAll(inputs); }
    }

    private float[] runDecoder(float[] latents,float[] condition,int validFrames) throws Exception {
        Map<String,OnnxTensor> inputs=new HashMap<>();
        try {
            inputs.put("latent_tokens",tensor(latents,1,data.maxTokens,data.latentDim));
            inputs.put("external_cond",tensor(condition,1,data.maxFrames,data.localRootDim));
            float[] valid=new float[data.maxFrames];Arrays.fill(valid,0,validFrames,1);
            inputs.put("motion_pad_mask",tensor(valid,1,data.maxFrames));
            if(inputObserver!=null)inputObserver.inspect("decoder",inputs);
            try(OrtSession.Result result=decoder.run(inputs)) { return tensorToFloatArray(result.get(1),data.maxFrames*data.bodyDim); }
        } finally { closeAll(inputs); }
    }
    private static float[] blend(float[] a,float[] b,float alpha) {
        float[] out=new float[a.length]; double an=0,bn=0,on=0;
        for(int i=0;i<a.length;i++) { out[i]=a[i]*(1-alpha)+b[i]*alpha; an+=a[i]*a[i];bn+=b[i]*b[i];on+=out[i]*out[i]; }
        if(on>1e-12) { float scale=(float)((Math.sqrt(an)*(1-alpha)+Math.sqrt(bn)*alpha)/Math.sqrt(on)); for(int i=0;i<out.length;i++)out[i]*=scale; }
        return out;
    }
    @Override public void close() { close(decoder); close(denoiser); decoder=null; denoiser=null; }

    private void setObserved(float[] observed, float[] mask, int base, int dim, float value) {
        observed[base + dim] = (value - this.data.motionMean[dim]) / this.data.motionStd[dim];
        mask[base + dim] = 1.0f;
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

    private float[] extractLatents(float[] x) {
        int tokens=x.length/data.tokenDim;
        float[] latents = new float[tokens * this.data.latentDim];
        for (int token = 0; token < tokens; token++) {
            System.arraycopy(x, (this.data.tokenDim * token) + (this.data.numFramesPerToken * this.data.rootDim), latents, this.data.latentDim * token, this.data.latentDim);
        }
        return latents;
    }

    private void requantizeLatents(float[] x,int tokens) {
        // Match FSQVAETransformer.requantize, including ties-to-even rounding.
        for(int t=0;t<tokens;t++)for(int k=0;k<data.latentDim;k++) {
            int i=t*data.tokenDim+data.numFramesPerToken*data.rootDim+k;
            float raw=x[i]*data.latentStd[k]+data.latentMean[k];
            float scaled=Math.max(-1,Math.min(1,raw))*data.latentHalfWidth[k];
            float discrete=(float)Math.rint(scaled)/data.latentHalfWidth[k];
            x[i]=(discrete-data.latentMean[k])/data.latentStd[k];
        }
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
            int s = (joint * 6) + this.data.rootDim + (this.data.jointCount - 1) * 3;
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

    private OrtSession createSession(File model) throws Exception {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
        options.setIntraOpNumThreads(Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors())));
        options.setInterOpNumThreads(1);
        options.addConfigEntry("session.intra_op.allow_spinning", "0");
        options.addConfigEntry("session.inter_op.allow_spinning", "0");
        // QNN needs a matching QNN-enabled ORT build, SDK libraries and qualified graphs.
        // Provider-name strings alone do not establish coverage; never label CPU fallback NPU.
        try {
            return this.environment.createSession(model.getAbsolutePath(), options);
        } finally {
            options.close();
        }
    }

    private File requireModel(String name) {
        File file = new File(new File(this.filesDirectory, this.profile.modelDir), name);
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
