package ai.cleo.ardymobile;

import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Exercises the app's actual sampler and recovered weights on a desktop CPU, without a phone. */
public final class ArdyCpuCheck {
    static void require(boolean value,String message) { if(!value)throw new AssertionError(message); }
    static float[] read(File path) throws Exception {
        FloatBuffer b=ByteBuffer.wrap(Files.readAllBytes(path.toPath())).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
        float[] v=new float[b.remaining()]; b.get(v); return v;
    }
    static double distance(float[] a,int offset,float[] b,int bo) {
        double sum=0; for(int k=0;k<3;k++)sum+=Math.pow(a[offset+k]-b[bo+k],2); return Math.sqrt(sum);
    }
    static JSONArray rows(float[] v,int width) {
        JSONArray rows=new JSONArray(); for(int i=0;i<v.length;i+=width) {
            JSONArray row=new JSONArray(); for(int k=0;k<width;k++)row.put(v[i+k]); rows.put(row);
        } return rows;
    }
    public static void main(String[] args) throws Exception {
        File models=new File(args[0]), assets=new File(args[1]), output=new File(args[3]);
        float[] embedding=read(new File(args[2])); require(embedding.length==4096,"text width");
        JSONArray reports=new JSONArray();
        for(String id:new String[]{"core8","core40"}) {
            ArdyModelProfile profile=id.equals("core8")?ArdyModelProfile.CORE8:ArdyModelProfile.CORE40;
            ArdyRuntimeData data=ArdyRuntimeData.load(assets,profile);
            JSONArray timings=new JSONArray(), joints=new JSONArray(), roots=new JSONArray(), rotations=new JSONArray();
            float[] lastRoot=null, firstJoints=null;
            double maxBoneError=0,maxRotationError=0,maxRootStep=0,maxSeamStep=0;
            int total=0;
            ArdySampler.Settings settings=new ArdySampler.Settings(); settings.constrainRoot=false;
            try(ArdySampler sampler=new ArdySampler(models,assets,id)) {
                sampler.inputObserver=(stage,inputs)->{
                    if(stage.equals("denoiser")) {
                        float[] ht=tensor(inputs.get("history_token_mask")),gt=tensor(inputs.get("generation_token_mask"));
                        float[] ft=tensor(inputs.get("future_token_mask")),x=tensor(inputs.get("x"));
                        for(float v:ft)require(v==0,"Unobserved future must be masked out");
                        int retained=0;for(float v:ht)if(v==1)retained++;
                        long h=inputs.get("history_len").getLongBuffer().get();
                        require(h==retained*data.numFramesPerToken,"History token/frame alignment");
                        for(int t=0;t<retained;t++)for(int k=0;k<data.latentDim;k++) {
                            int i=t*data.tokenDim+data.numFramesPerToken*data.rootDim+k;
                            double level=(x[i]*data.latentStd[k]+data.latentMean[k])*data.latentHalfWidth[k];
                            require(Math.abs(level-Math.rint(level))<1e-4,"History must lie on FSQ lattice");
                        }
                        double expected=h==0?0:Math.atan2(x[4]*data.globalRootStd[4]+data.globalRootMean[4],x[3]*data.globalRootStd[3]+data.globalRootMean[3]);
                        require(Math.abs(tensor(inputs.get("first_heading_angle"))[0]-expected)<1e-6,"Heading follows first retained frame");
                    } else {
                        int frames=0;boolean padding=false;for(float v:tensor(inputs.get("motion_pad_mask"))){if(v==1){require(!padding,"Noncontiguous decoder mask");frames++;}else{require(v==0,"Invalid mask");padding=true;}}
                        long tokens=inputs.get("latent_tokens").getInfo().getShape()[1];
                        require(frames>0&&frames<=tokens*data.numFramesPerToken,"Decoder masks invalid padded context");
                        float[] cond=tensor(inputs.get("external_cond"));
                        for(int k=0;k<3;k++)require(Math.abs(cond[(int)(frames-1)*data.localRootDim+k]-cond[(int)(frames-2)*data.localRootDim+k])<1e-5,"Last valid velocity repeats previous sample");
                    }
                };
                for(int b=0;b<9;b++) {
                    ArdySampler.Batch batch=sampler.next(embedding,settings);
                    require(batch.startFrame==total,"Rolling frame index");
                    require(batch.frames==data.genHorizonFrames,"Horizon length");
                    if(b==0)firstJoints=batch.joints.clone();
                    for(float[] array:new float[][]{batch.joints,batch.roots,batch.rotations})
                        for(float v:array) require(Float.isFinite(v),"Non-finite output");
                    for(int f=0;f<batch.frames;f++) {
                        if(lastRoot!=null) {
                            double step=distance(batch.roots,f*3,lastRoot,0);
                            maxRootStep=Math.max(maxRootStep,step); if(f==0)maxSeamStep=Math.max(maxSeamStep,step);
                        }
                        lastRoot=Arrays.copyOfRange(batch.roots,f*3,f*3+3);
                        JSONArray frameRot=new JSONArray();
                        for(int j=0;j<batch.jointCount;j++) {
                            int p=data.jointParents[j];
                            if(p>=0) {
                                double length=distance(batch.joints,(f*batch.jointCount+j)*3,batch.joints,(f*batch.jointCount+p)*3);
                                double rest=distance(data.neutralJoints,j*3,data.neutralJoints,p*3);
                                maxBoneError=Math.max(maxBoneError,Math.abs(length-rest));
                            }
                            int base=(f*batch.jointCount+j)*9;
                            for(int r=0;r<3;r++)for(int c=0;c<3;c++) {
                                double dot=0;for(int k=0;k<3;k++)dot+=batch.rotations[base+r*3+k]*batch.rotations[base+c*3+k];
                                maxRotationError=Math.max(maxRotationError,Math.abs(dot-(r==c?1:0)));
                            }
                            frameRot.put(rows(Arrays.copyOfRange(batch.rotations,base,base+9),3));
                        }
                        joints.put(rows(Arrays.copyOfRange(batch.joints,f*batch.jointCount*3,(f+1)*batch.jointCount*3),3));
                        roots.put(rows(Arrays.copyOfRange(batch.roots,f*3,f*3+3),3).get(0));
                        rotations.put(frameRot);
                    }
                    total+=batch.frames; timings.put(batch.elapsedMs);
                    System.err.println(id+" batch "+b+": "+Math.round(batch.elapsedMs)+" ms");
                }
                File checkpoint=output.toPath().resolveSibling(id+"-checkpoint.bin").toFile();sampler.save(checkpoint);
                ArdySampler.Batch continuation=sampler.next(embedding,settings);
                sampler.close();
                try(ArdySampler resumed=new ArdySampler(models,assets,id)) {
                    require(resumed.restore(checkpoint),"Checkpoint not restored");
                    ArdySampler.Batch next=resumed.next(embedding,settings);
                    require(next.startFrame==continuation.startFrame&&Arrays.equals(next.joints,continuation.joints)
                        &&Arrays.equals(next.rotations,continuation.rotations),"Checkpoint must preserve exact rolling/RNG state");
                }
                sampler.reset(settings.seed);
                require(Arrays.equals(firstJoints,sampler.next(embedding,settings).joints),"Reset must reproduce initial generation");
            }
            require(maxBoneError<0.0001,"FK bone lengths changed");
            require(maxRotationError<0.0001,"Invalid rotation matrices");
            JSONObject motion=new JSONObject().put("fps",data.fps).put("joints",joints).put("rootPositions",roots).put("rotations",rotations);
            Files.writeString(output.toPath().resolveSibling(id+"-generated.json"),motion.toString());
            reports.put(new JSONObject().put("model",id).put("frames",total).put("horizons",9).put("steps",settings.steps)
                .put("actualOrtInputsAudited",true).put("futureConstraintsSparse",true).put("historyOnFsqLattice",true).put("croppedHeadingCorrect",true).put("decoderValidLength",true)
                .put("generationMs",timings).put("historyCapacityExceeded",true).put("resetReproducible",true).put("checkpointContinuationExact",true)
                .put("maxBoneLengthErrorM",maxBoneError).put("maxRotationOrthonormalityError",maxRotationError)
                .put("maxRootFrameStepM",maxRootStep).put("maxRootHorizonSeamStepM",maxSeamStep));
        }
        JSONObject report=new JSONObject().put("passed",true).put("device","Windows CPU").put("phoneTest",false)
            .put("limits","Numeric continuity checks; no claim of phone speed, visual quality or whole-app integration.")
            .put("models",reports);
        Files.writeString(output.toPath(),report.toString(2)+"\n"); System.out.println(report.toString());
    }
    static float[] tensor(ai.onnxruntime.OnnxTensor tensor) {
        FloatBuffer buffer=tensor.getFloatBuffer();float[] out=new float[buffer.remaining()];buffer.get(out);return out;
    }
}
