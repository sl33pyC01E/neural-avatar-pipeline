package ai.cleo.ardymobile;

import java.lang.reflect.Array;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;

/* JADX INFO: loaded from: classes3.dex */
final class VrmRetargeter {
    private static final String[][] BASE_RETARGET_BONES = {new String[]{"Hips", "Spine", "pelvis", "spine1"}, new String[]{"Spine", "Chest", "spine1", "spine2"}, new String[]{"Neck", "Head", "neck", "head"}, new String[]{"LeftShoulder", "LeftUpperArm", "left_collar", "left_shoulder"}, new String[]{"LeftUpperArm", "LeftLowerArm", "left_shoulder", "left_elbow"}, new String[]{"LeftLowerArm", "LeftHand", "left_elbow", "left_wrist"}, new String[]{"RightShoulder", "RightUpperArm", "right_collar", "right_shoulder"}, new String[]{"RightUpperArm", "RightLowerArm", "right_shoulder", "right_elbow"}, new String[]{"RightLowerArm", "RightHand", "right_elbow", "right_wrist"}, new String[]{"Hips", "LeftUpperLeg", "pelvis", "left_hip"}, new String[]{"LeftUpperLeg", "LeftLowerLeg", "left_hip", "left_knee"}, new String[]{"LeftLowerLeg", "LeftFoot", "left_knee", "left_ankle"}, new String[]{"Hips", "RightUpperLeg", "pelvis", "right_hip"}, new String[]{"RightUpperLeg", "RightLowerLeg", "right_hip", "right_knee"}, new String[]{"RightLowerLeg", "RightFoot", "right_knee", "right_ankle"}};
    private final VrmRetargetAsset asset;
    private final ArdyRuntimeData data;
    private final int mappedBoneCount;
    private final float medianBoneScale;
    private final int rootIndex;
    private final Basis sourceBasis;
    private final float[] sourceRest;
    private final Basis targetBasis;
    private final HashMap<String, Integer> sourceNames = new HashMap<>();
    private final HashMap<String, Integer> targetNames = new HashMap<>();

    static final class Result {
        final int[] edgePairs;
        final int frames;
        final int jointCount;
        final String[] jointNames;
        final float[] jointPositions;
        final int[] parents;
        final float[] restJoints;
        final String summary;

        Result(float[] jointPositions, float[] restJoints, String[] jointNames, int[] parents, int[] edgePairs, int frames, int jointCount, String summary) {
            this.jointPositions = jointPositions;
            this.restJoints = restJoints;
            this.jointNames = jointNames;
            this.parents = parents;
            this.edgePairs = edgePairs;
            this.frames = frames;
            this.jointCount = jointCount;
            this.summary = summary;
        }
    }

    VrmRetargeter(VrmRetargetAsset asset, ArdyRuntimeData data, String[] ardyAliases) {
        this.asset = asset;
        this.data = data;
        for (int i = 0; i < ardyAliases.length; i++) {
            this.sourceNames.put(ardyAliases[i], Integer.valueOf(i));
        }
        for (int i2 = 0; i2 < asset.boneNames.length; i2++) {
            this.targetNames.put(asset.boneNames[i2], Integer.valueOf(i2));
        }
        this.rootIndex = targetIndex("Hips", 0);
        this.sourceRest = centeredSourceRest(data);
        this.sourceBasis = makeBodyBasis(this.sourceRest, sourceIndex("left_shoulder"), sourceIndex("right_shoulder"), sourceIndex("pelvis"), sourceIndex("head"));
        this.targetBasis = makeBodyBasis(asset.restCentered, firstTargetIndex("LeftUpperArm", "LeftShoulder"), firstTargetIndex("RightUpperArm", "RightShoulder"), targetIndex("Hips", 0), targetIndex("Head", -1));
        float[] scales = boneScales();
        this.mappedBoneCount = scales.length;
        this.medianBoneScale = median(scales, 1.0f);
    }

    String summary() {
        return this.asset.summary() + String.format(Locale.US, "\nRetarget map: %d bone scale links, median %.3fx", Integer.valueOf(this.mappedBoneCount), Float.valueOf(this.medianBoneScale));
    }

    Result retarget(float[] sourceWorldJoints, int sourceJointCount, int frames, VrmRetargetSettings settings) {
        int targetCount;
        boolean[] hasGoal;
        String str;
        char c;
        int i = frames;
        int targetCount2 = this.asset.boneCount();
        float[] out = new float[i * targetCount2 * 3];
        float[] sourceFrame = new float[sourceJointCount * 3];
        float[] centeredSource = new float[sourceJointCount * 3];
        float[] targetFrame = new float[targetCount2 * 3];
        float[] goals = new float[targetCount2 * 3];
        boolean[] hasGoal2 = new boolean[targetCount2];
        int[][] jointMap = jointMap(settings.legMode);
        int[] bodyChain = chain("Hips", "Spine", "Chest", "UpperChest", "Neck", "Head");
        int upperTorso = this.targetNames.containsKey("UpperChest") ? targetIndex("UpperChest", -1) : targetIndex("Chest", -1);
        int[] leftShoulderChain = compact(upperTorso, targetIndex("LeftShoulder", -1), targetIndex("LeftUpperArm", -1));
        String str2 = "RightUpperArm";
        String str3 = "LeftUpperArm";
        int[] rightShoulderChain = compact(upperTorso, targetIndex("RightShoulder", -1), targetIndex("RightUpperArm", -1));
        int[] leftLegChain = chain("Hips", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot");
        String str4 = "RightFoot";
        int[] rightLegChain = chain("Hips", "RightUpperLeg", "RightLowerLeg", "RightFoot");
        int frame = 0;
        while (frame < i) {
            int srcOffset = frame * sourceJointCount * 3;
            int frame2 = frame;
            int frame3 = sourceFrame.length;
            int upperTorso2 = upperTorso;
            System.arraycopy(sourceWorldJoints, srcOffset, sourceFrame, 0, frame3);
            centerSource(sourceFrame, centeredSource);
            char c2 = 0;
            System.arraycopy(this.asset.restCentered, 0, targetFrame, 0, this.asset.restCentered.length);
            Arrays.fill(hasGoal2, false);
            int length = jointMap.length;
            int t = 0;
            while (t < length) {
                int[] pair = jointMap[t];
                int targetCount3 = targetCount2;
                int targetCount4 = pair[c2];
                int source = pair[1];
                if (targetCount4 != this.rootIndex) {
                    hasGoal = hasGoal2;
                    str = str3;
                    c = 0;
                    float sx = centeredSource[source * 3];
                    float sy = centeredSource[(source * 3) + 1];
                    float sz = centeredSource[(source * 3) + 2];
                    float[] absoluteSource = transformSourceVector(sx, sy, sz, this.sourceBasis, this.targetBasis);
                    float goalX = this.asset.restCentered[this.rootIndex * 3] + (absoluteSource[0] * this.medianBoneScale);
                    float f = this.asset.restCentered[(this.rootIndex * 3) + 1];
                    float f2 = absoluteSource[1];
                    float sx2 = this.medianBoneScale;
                    float goalY = f + (f2 * sx2);
                    float f3 = this.asset.restCentered[(this.rootIndex * 3) + 2];
                    float f4 = absoluteSource[2];
                    float sy2 = this.medianBoneScale;
                    float goalZ = f3 + (f4 * sy2);
                    int t2 = targetCount4 * 3;
                    goals[t2] = this.asset.restCentered[t2] + ((goalX - this.asset.restCentered[t2]) * settings.strength);
                    float f5 = this.asset.restCentered[t2 + 1];
                    float f6 = goalY - this.asset.restCentered[t2 + 1];
                    float goalX2 = settings.strength;
                    goals[t2 + 1] = f5 + (f6 * goalX2);
                    goals[t2 + 2] = this.asset.restCentered[t2 + 2] + ((goalZ - this.asset.restCentered[t2 + 2]) * settings.strength);
                    hasGoal[targetCount4] = true;
                } else {
                    str = str3;
                    c = 0;
                    hasGoal = hasGoal2;
                    setGoal(goals, hasGoal2, targetCount4, this.asset.restCentered, targetCount4);
                }
                t++;
                str4 = str4;
                hasGoal2 = hasGoal;
                str2 = str2;
                length = length;
                targetCount2 = targetCount3;
                c2 = c;
                srcOffset = srcOffset;
                sourceFrame = sourceFrame;
                str3 = str;
                jointMap = jointMap;
                upperTorso2 = upperTorso2;
            }
            int[][] jointMap2 = jointMap;
            float[] sourceFrame2 = sourceFrame;
            int targetCount5 = targetCount2;
            char c3 = c2;
            String str5 = str3;
            int upperTorso3 = upperTorso2;
            String str6 = str4;
            boolean[] hasGoal3 = hasGoal2;
            String str7 = str2;
            if (settings.legMode == 1) {
                setRestGoal(goals, hasGoal3, "LeftFoot");
                setRestGoal(goals, hasGoal3, str6);
            }
            applySleeveBarrierGoals(goals, hasGoal3, settings);
            float[] fArr = targetFrame;
            float[] fArr2 = goals;
            solveFabrikChain(fArr, bodyChain, fArr2, hasGoal3, 10);
            solveFabrikChain(fArr, leftShoulderChain, fArr2, hasGoal3, 8);
            float[] goals2 = goals;
            float[] targetFrame2 = targetFrame;
            solveTwoBone(targetFrame, targetIndex(str5, -1), targetIndex("LeftLowerArm", -1), targetIndex("LeftHand", -1), goals, hasGoal3, targetIndex("LeftLowerArm", -1));
            solveFabrikChain(targetFrame2, rightShoulderChain, goals2, hasGoal3, 8);
            solveTwoBone(targetFrame2, targetIndex(str7, -1), targetIndex("RightLowerArm", -1), targetIndex("RightHand", -1), goals2, hasGoal3, targetIndex("RightLowerArm", -1));
            if (settings.legMode != 0) {
                solveFabrikChain(targetFrame2, leftLegChain, goals2, hasGoal3, 10);
                solveFabrikChain(targetFrame2, rightLegChain, goals2, hasGoal3, 10);
            }
            float rootX = sourceFrame2[c3] * settings.rootXzScale;
            float rootY = (-this.asset.floorY) + settings.rootHeightOffset;
            float rootZ = sourceFrame2[2] * settings.rootXzScale;
            int dst = frame2 * targetCount5 * 3;
            int joint = 0;
            while (true) {
                targetCount = targetCount5;
                if (joint < targetCount) {
                    int j = joint * 3;
                    out[dst + j] = targetFrame2[j] + rootX;
                    out[dst + j + 1] = targetFrame2[j + 1] + rootY;
                    out[dst + j + 2] = targetFrame2[j + 2] + rootZ;
                    joint++;
                    targetCount5 = targetCount;
                }
            }
            frame = frame2 + 1;
            str4 = str6;
            str3 = str5;
            str2 = str7;
            hasGoal2 = hasGoal3;
            upperTorso = upperTorso3;
            targetFrame = targetFrame2;
            sourceFrame = sourceFrame2;
            jointMap = jointMap2;
            i = frames;
            targetCount2 = targetCount;
            goals = goals2;
        }
        int targetCount6 = targetCount2;
        String summary = String.format(Locale.US, "VRM retarget %s: %d frames, %s legs, strength %.2f, root %.2fx, height %.2fm, sleeve %.2f", this.asset.avatarName, Integer.valueOf(frames), settings.legModeName(), Float.valueOf(settings.strength), Float.valueOf(settings.rootXzScale), Float.valueOf(settings.rootHeightOffset), Float.valueOf(settings.sleeveBarrierStrength));
        return new Result(out, this.asset.restWorldFrame(settings.rootHeightOffset), this.asset.boneNames, this.asset.parents, this.asset.edgePairs, frames, targetCount6, summary);
    }

    private float[] centeredSourceRest(ArdyRuntimeData data) {
        float[] rest = new float[data.jointCount * 3];
        float px = data.neutralJoints[0];
        float py = data.neutralJoints[1];
        float pz = data.neutralJoints[2];
        for (int joint = 0; joint < data.jointCount; joint++) {
            int j = joint * 3;
            rest[j] = data.neutralJoints[j] - px;
            rest[j + 1] = data.neutralJoints[j + 1] - py;
            rest[j + 2] = data.neutralJoints[j + 2] - pz;
        }
        return rest;
    }

    private float[] boneScales() {
        char c;
        String[][] bones = retargetBonesForTarget();
        float[] scales = new float[bones.length];
        int count = 0;
        char c2 = 0;
        int i = 0;
        for (int length = bones.length; i < length; length = length) {
            String[] bone = bones[i];
            int tp = targetIndex(bone[c2], -1);
            int tc = targetIndex(bone[1], -1);
            int sp = sourceIndex(bone[2]);
            int sc = sourceIndex(bone[3]);
            if (tp < 0 || tc < 0 || sp < 0) {
                c = c2;
            } else if (sc < 0) {
                c = c2;
            } else {
                float tvx = this.asset.restCentered[tc * 3] - this.asset.restCentered[tp * 3];
                float tvy = this.asset.restCentered[(tc * 3) + 1] - this.asset.restCentered[(tp * 3) + 1];
                float tvz = this.asset.restCentered[(tc * 3) + 2] - this.asset.restCentered[(tp * 3) + 2];
                float svx = this.sourceRest[sc * 3] - this.sourceRest[sp * 3];
                float svy = this.sourceRest[(sc * 3) + 1] - this.sourceRest[(sp * 3) + 1];
                float svz = this.sourceRest[(sc * 3) + 2] - this.sourceRest[(sp * 3) + 2];
                float[] source = transformSourceVector(svx, svy, svz, this.sourceBasis, this.targetBasis);
                float length2 = length(tvx, tvy, tvz);
                c = 0;
                float f = source[0];
                float svz2 = source[1];
                float tvz2 = source[2];
                scales[count] = length2 / Math.max(length(f, svz2, tvz2), 1.0E-5f);
                count++;
            }
            i++;
            c2 = c;
            bones = bones;
        }
        return Arrays.copyOf(scales, count);
    }

    private String[][] retargetBonesForTarget() {
        boolean hasUpperChest = this.targetNames.containsKey("UpperChest");
        String upperTorso = hasUpperChest ? "UpperChest" : "Chest";
        String[][] extra = hasUpperChest ? new String[][]{new String[]{"Chest", "UpperChest", "spine2", "spine3"}} : (String[][]) Array.newInstance((Class<?>) String.class, 0, 0);
        String[][] bones = (String[][]) Array.newInstance((Class<?>) String.class, BASE_RETARGET_BONES.length + extra.length + 3, 4);
        int out = 0 + 1;
        bones[0] = BASE_RETARGET_BONES[0];
        int out2 = out + 1;
        bones[out] = BASE_RETARGET_BONES[1];
        int length = extra.length;
        int i = 0;
        while (i < length) {
            String[] item = extra[i];
            bones[out2] = item;
            i++;
            out2++;
        }
        int out3 = out2 + 1;
        bones[out2] = new String[]{upperTorso, "Neck", "spine3", "neck"};
        int out4 = out3 + 1;
        bones[out3] = BASE_RETARGET_BONES[2];
        int out5 = out4 + 1;
        bones[out4] = new String[]{upperTorso, "LeftShoulder", "spine3", "left_collar"};
        int i2 = 3;
        while (i2 < 6) {
            bones[out5] = BASE_RETARGET_BONES[i2];
            i2++;
            out5++;
        }
        int out6 = out5 + 1;
        bones[out5] = new String[]{upperTorso, "RightShoulder", "spine3", "right_collar"};
        int i3 = 6;
        while (i3 < BASE_RETARGET_BONES.length) {
            bones[out6] = BASE_RETARGET_BONES[i3];
            i3++;
            out6++;
        }
        return (String[][]) Arrays.copyOf(bones, out6);
    }

    private int[][] jointMap(int i) {
        boolean zContainsKey = this.targetNames.containsKey("UpperChest");
        String[][] strArr = new String[13][];
        strArr[0] = new String[]{"Hips", "pelvis"};
        strArr[1] = new String[]{"Spine", "spine1"};
        String[] strArr2 = new String[2];
        strArr2[0] = "Chest";
        strArr2[1] = zContainsKey ? "spine2" : "spine3";
        strArr[2] = strArr2;
        strArr[3] = new String[]{"Neck", "neck"};
        strArr[4] = new String[]{"Head", "head"};
        strArr[5] = new String[]{"LeftShoulder", "left_collar"};
        strArr[6] = new String[]{"LeftUpperArm", "left_shoulder"};
        strArr[7] = new String[]{"LeftLowerArm", "left_elbow"};
        strArr[8] = new String[]{"LeftHand", "left_wrist"};
        strArr[9] = new String[]{"RightShoulder", "right_collar"};
        strArr[10] = new String[]{"RightUpperArm", "right_shoulder"};
        strArr[11] = new String[]{"RightLowerArm", "right_elbow"};
        strArr[12] = new String[]{"RightHand", "right_wrist"};
        String[][] strArr3 = i == 0 ? (String[][]) Array.newInstance((Class<?>) String.class, 0, 0) : new String[][]{new String[]{"LeftUpperLeg", "left_hip"}, new String[]{"LeftLowerLeg", "left_knee"}, new String[]{"RightUpperLeg", "right_hip"}, new String[]{"RightLowerLeg", "right_knee"}};
        String[][] strArr4 = i == 2 ? new String[][]{new String[]{"LeftFoot", "left_ankle"}, new String[]{"RightFoot", "right_ankle"}} : (String[][]) Array.newInstance((Class<?>) String.class, 0, 0);
        int[][] iArr = (int[][]) Array.newInstance((Class<?>) Integer.TYPE, strArr.length + strArr3.length + strArr4.length + (zContainsKey ? 1 : 0), 2);
        int iAppendMap = 0;
        for (int i2 = 0; i2 < strArr.length; i2++) {
            if (zContainsKey && i2 == 3) {
                iAppendMap = appendMap(iArr, iAppendMap, "UpperChest", "spine3");
            }
            iAppendMap = appendMap(iArr, iAppendMap, strArr[i2][0], strArr[i2][1]);
        }
        for (String[] strArr5 : strArr3) {
            iAppendMap = appendMap(iArr, iAppendMap, strArr5[0], strArr5[1]);
        }
        for (String[] strArr6 : strArr4) {
            iAppendMap = appendMap(iArr, iAppendMap, strArr6[0], strArr6[1]);
        }
        return (int[][]) Arrays.copyOf(iArr, iAppendMap);
    }

    private int appendMap(int[][] values, int out, String target, String source) {
        int ti = targetIndex(target, -1);
        int si = sourceIndex(source);
        if (ti >= 0 && si >= 0) {
            values[out][0] = ti;
            values[out][1] = si;
            return out + 1;
        }
        return out;
    }

    private void centerSource(float[] sourceFrame, float[] out) {
        float px = sourceFrame[0];
        float py = sourceFrame[1];
        float pz = sourceFrame[2];
        for (int joint = 0; joint < sourceFrame.length / 3; joint++) {
            int j = joint * 3;
            out[j] = sourceFrame[j] - px;
            out[j + 1] = sourceFrame[j + 1] - py;
            out[j + 2] = sourceFrame[j + 2] - pz;
        }
    }

    private void setGoal(float[] goals, boolean[] hasGoal, int target, float[] source, int sourceIndex) {
        int t = target * 3;
        int s = sourceIndex * 3;
        goals[t] = source[s];
        goals[t + 1] = source[s + 1];
        goals[t + 2] = source[s + 2];
        hasGoal[target] = true;
    }

    private void setRestGoal(float[] goals, boolean[] hasGoal, String name) {
        int index = targetIndex(name, -1);
        if (index >= 0) {
            setGoal(goals, hasGoal, index, this.asset.restCentered, index);
        }
    }

    private void applySleeveBarrierGoals(float[] goals, boolean[] hasGoal, VrmRetargetSettings settings) {
        if (settings.sleeveBarrierStrength <= 0.0f || settings.sleeveBarrierWidth <= 0.0f) {
            return;
        }
        applySleevePair(goals, hasGoal, -1.0f, "LeftUpperArm", "LeftLowerArm", "LeftHand", settings);
        applySleevePair(goals, hasGoal, 1.0f, "RightUpperArm", "RightLowerArm", "RightHand", settings);
    }

    private void applySleevePair(float[] goals, boolean[] hasGoal, float side, String upperName, String lowerName, String handName, VrmRetargetSettings settings) {
        int upper = targetIndex(upperName, -1);
        int lower = targetIndex(lowerName, -1);
        int hand = targetIndex(handName, -1);
        if (upper < 0 || lower < 0 || hand < 0) {
            return;
        }
        float width = Math.max(settings.sleeveBarrierWidth, Math.max(Math.abs(this.asset.restCentered[hand * 3]) * 0.72f, Math.abs(this.asset.restCentered[lower * 3]) * 0.68f));
        float handAmount = settings.sleeveBarrierStrength * sleeveBarrierWeight(goals, hasGoal, upper, hand, hand);
        float lowerAmount = settings.sleeveBarrierStrength * sleeveBarrierWeight(goals, hasGoal, upper, hand, lower) * 0.9f;
        pushGoalOutsideSleeveBarrier(goals, hasGoal, lower, side, width * 0.9f, lowerAmount);
        pushGoalOutsideSleeveBarrier(goals, hasGoal, hand, side, width, handAmount);
    }

    private float sleeveBarrierWeight(float[] goals, boolean[] hasGoal, int upper, int hand, int point) {
        int p = point * 3;
        float y = hasGoal[point] ? goals[p + 1] : this.asset.restCentered[p + 1];
        float span = Math.max(0.03f, this.asset.restCentered[(upper * 3) + 1] - this.asset.restCentered[(hand * 3) + 1]);
        return clamp((this.asset.restCentered[(upper * 3) + 1] - y) / span, 0.25f, 1.0f);
    }

    private void pushGoalOutsideSleeveBarrier(float[] goals, boolean[] hasGoal, int index, float side, float minAbsX, float amount) {
        if (index < 0 || amount <= 0.0f) {
            return;
        }
        int i = index * 3;
        if (!hasGoal[index]) {
            goals[i] = this.asset.restCentered[i];
            goals[i + 1] = this.asset.restCentered[i + 1];
            goals[i + 2] = this.asset.restCentered[i + 2];
            hasGoal[index] = true;
        }
        float sideX = goals[i] * side;
        if (sideX < minAbsX) {
            goals[i] = goals[i] + (((side * minAbsX) - goals[i]) * amount);
        }
        float closeWeight = sideX < 1.35f * minAbsX ? 0.35f * amount : 0.0f;
        if (closeWeight > 0.0f) {
            int i2 = i + 2;
            goals[i2] = goals[i2] + ((this.asset.restCentered[i + 2] - goals[i + 2]) * closeWeight);
        }
    }

    private void solveFabrikChain(float[] frame, int[] chain, float[] goals, boolean[] hasGoal, int iterations) {
        int i;
        float[] fArr = goals;
        int[] usable = new int[chain.length];
        int count = 0;
        for (int index : chain) {
            if (index >= 0 && index < this.asset.boneCount()) {
                usable[count] = index;
                count++;
            }
        }
        int i2 = 2;
        if (count < 2) {
            return;
        }
        int end = usable[count - 1];
        if (hasGoal[end]) {
            float[] positions = new float[count * 3];
            float[] lengths = new float[count - 1];
            float total = 0.0f;
            int i3 = 0;
            while (true) {
                i = 1;
                if (i3 >= count) {
                    break;
                }
                int src = usable[i3] * 3;
                if (hasGoal[usable[i3]]) {
                    positions[i3 * 3] = fArr[src];
                    positions[(i3 * 3) + 1] = fArr[src + 1];
                    positions[(i3 * 3) + i2] = fArr[src + 2];
                } else {
                    positions[i3 * 3] = frame[src];
                    positions[(i3 * 3) + 1] = frame[src + 1];
                    positions[(i3 * 3) + i2] = frame[src + 2];
                }
                if (i3 > 0) {
                    int a = usable[i3 - 1] * 3;
                    int b = usable[i3] * 3;
                    lengths[i3 - 1] = distance(this.asset.restCentered, a, this.asset.restCentered, b);
                    total += lengths[i3 - 1];
                }
                i3++;
                i2 = 2;
            }
            int root = usable[0] * 3;
            positions[0] = frame[root];
            positions[1] = frame[root + 1];
            positions[2] = frame[root + 2];
            float rootToGoal = distance(positions, 0, fArr, end * 3);
            if (rootToGoal >= total) {
                int lastRest = usable[count - 1] * 3;
                float[] fallback = normalize(this.asset.restCentered[lastRest] - this.asset.restCentered[root], this.asset.restCentered[lastRest + 1] - this.asset.restCentered[root + 1], this.asset.restCentered[lastRest + 2] - this.asset.restCentered[root + 2], 0.0f, 1.0f, 0.0f);
                float[] direction = normalize(fArr[end * 3] - positions[0], fArr[(end * 3) + 1] - positions[1], fArr[(end * 3) + 2] - positions[2], fallback[0], fallback[1], fallback[2]);
                for (int i4 = 1; i4 < count; i4++) {
                    positions[i4 * 3] = positions[(i4 - 1) * 3] + (direction[0] * lengths[i4 - 1]);
                    positions[(i4 * 3) + 1] = positions[((i4 - 1) * 3) + 1] + (direction[1] * lengths[i4 - 1]);
                    positions[(i4 * 3) + 2] = positions[((i4 - 1) * 3) + 2] + (direction[2] * lengths[i4 - 1]);
                }
            } else {
                int iteration = 0;
                while (iteration < iterations) {
                    positions[(count - 1) * 3] = fArr[end * 3];
                    positions[((count - 1) * 3) + i] = fArr[(end * 3) + i];
                    positions[((count - 1) * 3) + 2] = fArr[(end * 3) + 2];
                    for (int i5 = count - 2; i5 >= 0; i5--) {
                        int aRest = usable[i5] * 3;
                        int bRest = usable[i5 + 1] * 3;
                        float[] fallback2 = normalize(this.asset.restCentered[aRest] - this.asset.restCentered[bRest], this.asset.restCentered[aRest + 1] - this.asset.restCentered[bRest + 1], this.asset.restCentered[aRest + 2] - this.asset.restCentered[bRest + 2], 0.0f, 1.0f, 0.0f);
                        float[] direction2 = normalize(positions[i5 * 3] - positions[(i5 + 1) * 3], positions[(i5 * 3) + 1] - positions[((i5 + 1) * 3) + 1], positions[(i5 * 3) + 2] - positions[((i5 + 1) * 3) + 2], fallback2[0], fallback2[1], fallback2[2]);
                        positions[i5 * 3] = positions[(i5 + 1) * 3] + (direction2[0] * lengths[i5]);
                        positions[(i5 * 3) + 1] = positions[((i5 + 1) * 3) + 1] + (direction2[1] * lengths[i5]);
                        positions[(i5 * 3) + 2] = positions[((i5 + 1) * 3) + 2] + (direction2[2] * lengths[i5]);
                    }
                    positions[0] = frame[root];
                    positions[1] = frame[root + 1];
                    positions[2] = frame[root + 2];
                    for (int i6 = 0; i6 < count - 1; i6++) {
                        int aRest2 = usable[i6] * 3;
                        int bRest2 = usable[i6 + 1] * 3;
                        float[] fallback3 = normalize(this.asset.restCentered[bRest2] - this.asset.restCentered[aRest2], this.asset.restCentered[bRest2 + 1] - this.asset.restCentered[aRest2 + 1], this.asset.restCentered[bRest2 + 2] - this.asset.restCentered[aRest2 + 2], 0.0f, 1.0f, 0.0f);
                        float[] direction3 = normalize(positions[(i6 + 1) * 3] - positions[i6 * 3], positions[((i6 + 1) * 3) + 1] - positions[(i6 * 3) + 1], positions[((i6 + 1) * 3) + 2] - positions[(i6 * 3) + 2], fallback3[0], fallback3[1], fallback3[2]);
                        positions[(i6 + 1) * 3] = positions[i6 * 3] + (direction3[0] * lengths[i6]);
                        positions[((i6 + 1) * 3) + 1] = positions[(i6 * 3) + 1] + (direction3[1] * lengths[i6]);
                        positions[((i6 + 1) * 3) + 2] = positions[(i6 * 3) + 2] + (direction3[2] * lengths[i6]);
                    }
                    iteration++;
                    fArr = goals;
                    i = 1;
                }
            }
            for (int i7 = 1; i7 < count; i7++) {
                int dst = usable[i7] * 3;
                frame[dst] = positions[i7 * 3];
                frame[dst + 1] = positions[(i7 * 3) + 1];
                frame[dst + 2] = positions[(i7 * 3) + 2];
            }
        }
    }

    private void solveTwoBone(float[] frame, int rootIndex, int midIndex, int endIndex, float[] goals, boolean[] hasGoal, int poleIndex) {
        float poleX;
        float poleY;
        float poleZ;
        if (rootIndex < 0 || midIndex < 0 || endIndex < 0 || !hasGoal[endIndex]) {
            return;
        }
        int root = rootIndex * 3;
        int mid = midIndex * 3;
        int end = endIndex * 3;
        float upperLength = distance(this.asset.restCentered, root, this.asset.restCentered, mid);
        float lowerLength = distance(this.asset.restCentered, mid, this.asset.restCentered, end);
        if (upperLength >= 1.0E-5f && lowerLength >= 1.0E-5f) {
            float rawX = goals[end] - frame[root];
            float rawY = goals[end + 1] - frame[root + 1];
            float rawZ = goals[end + 2] - frame[root + 2];
            float rawDistance = length(rawX, rawY, rawZ);
            float minReach = Math.abs(upperLength - lowerLength) + 1.0E-4f;
            float maxReach = (upperLength + lowerLength) - 1.0E-4f;
            float targetDistance = clamp(rawDistance, minReach, maxReach);
            float[] restForward = normalize(this.asset.restCentered[end] - this.asset.restCentered[root], this.asset.restCentered[end + 1] - this.asset.restCentered[root + 1], this.asset.restCentered[end + 2] - this.asset.restCentered[root + 2], 0.0f, -1.0f, 0.0f);
            float f = restForward[0];
            float minReach2 = restForward[1];
            float[] forward = normalize(rawX, rawY, rawZ, f, minReach2, restForward[2]);
            if (poleIndex < 0 || !hasGoal[poleIndex]) {
                poleX = this.asset.restCentered[mid] - this.asset.restCentered[root];
                poleY = this.asset.restCentered[mid + 1] - this.asset.restCentered[root + 1];
                poleZ = this.asset.restCentered[mid + 2] - this.asset.restCentered[root + 2];
            } else {
                int pole = poleIndex * 3;
                poleX = goals[pole] - frame[root];
                poleY = goals[pole + 1] - frame[root + 1];
                poleZ = goals[pole + 2] - frame[root + 2];
            }
            float dot = dot(poleX, poleY, poleZ, forward[0], forward[1], forward[2]);
            float projX = poleX - (forward[0] * dot);
            float projY = poleY - (forward[1] * dot);
            float projZ = poleZ - (forward[2] * dot);
            float restPoleX = this.asset.restCentered[mid] - this.asset.restCentered[root];
            float restPoleY = this.asset.restCentered[mid + 1] - this.asset.restCentered[root + 1];
            float restPoleZ = this.asset.restCentered[mid + 2] - this.asset.restCentered[root + 2];
            float restDot = dot(restPoleX, restPoleY, restPoleZ, forward[0], forward[1], forward[2]);
            float[] fallbackPole = normalize(restPoleX - (forward[0] * restDot), restPoleY - (forward[1] * restDot), restPoleZ - (forward[2] * restDot), 0.0f, 0.0f, 1.0f);
            float[] pole2 = normalize(projX, projY, projZ, fallbackPole[0], fallbackPole[1], fallbackPole[2]);
            float along = (((upperLength * upperLength) + (targetDistance * targetDistance)) - (lowerLength * lowerLength)) / (2.0f * targetDistance);
            float height = (float) Math.sqrt(Math.max((upperLength * upperLength) - (along * along), 0.0f));
            frame[mid] = frame[root] + (forward[0] * along) + (pole2[0] * height);
            frame[mid + 1] = frame[root + 1] + (forward[1] * along) + (pole2[1] * height);
            frame[mid + 2] = frame[root + 2] + (forward[2] * along) + (pole2[2] * height);
            frame[end] = frame[root] + (forward[0] * targetDistance);
            frame[end + 1] = frame[root + 1] + (forward[1] * targetDistance);
            frame[end + 2] = frame[root + 2] + (forward[2] * targetDistance);
        }
    }

    private int[] chain(String... names) {
        int[] raw = new int[names.length];
        int count = 0;
        for (String name : names) {
            int index = targetIndex(name, -1);
            if (index >= 0) {
                raw[count] = index;
                count++;
            }
        }
        return Arrays.copyOf(raw, count);
    }

    private int[] compact(int... indices) {
        int[] raw = new int[indices.length];
        int count = 0;
        for (int index : indices) {
            if (index >= 0) {
                raw[count] = index;
                count++;
            }
        }
        return Arrays.copyOf(raw, count);
    }

    private int firstTargetIndex(String first, String second) {
        int index = targetIndex(first, -1);
        return index >= 0 ? index : targetIndex(second, -1);
    }

    private int targetIndex(String name, int fallback) {
        Integer index = this.targetNames.get(name);
        return index == null ? fallback : index.intValue();
    }

    private int sourceIndex(String name) {
        Integer index = this.sourceNames.get(name);
        if (index == null) {
            return -1;
        }
        return index.intValue();
    }

    private static Basis makeBodyBasis(float[] points, int left, int right, int root, int head) {
        if (left < 0 || right < 0 || root < 0 || head < 0) {
            return new Basis(new float[]{1.0f, 0.0f, 0.0f}, new float[]{0.0f, 1.0f, 0.0f}, new float[]{0.0f, 0.0f, 1.0f});
        }
        int l = left * 3;
        int r = right * 3;
        int ro = root * 3;
        int h = head * 3;
        float[] x = normalize(points[r] - points[l], points[r + 1] - points[l + 1], points[r + 2] - points[l + 2], 1.0f, 0.0f, 0.0f);
        float[] yRaw = normalize(points[h] - points[ro], points[h + 1] - points[ro + 1], points[h + 2] - points[ro + 2], 0.0f, 1.0f, 0.0f);
        float[] z = normalize(crossX(x, yRaw), crossY(x, yRaw), crossZ(x, yRaw), 0.0f, 0.0f, 1.0f);
        float[] y = normalize(crossX(z, x), crossY(z, x), crossZ(z, x), 0.0f, 1.0f, 0.0f);
        return new Basis(x, y, z);
    }

    private static float[] transformSourceVector(float x, float y, float z, Basis source, Basis target) {
        float cx = dot(x, y, z, source.x[0], source.x[1], source.x[2]);
        float cy = dot(x, y, z, source.y[0], source.y[1], source.y[2]);
        float cz = -dot(x, y, z, source.z[0], source.z[1], source.z[2]);
        return new float[]{(target.x[0] * cx) + (target.y[0] * cy) + (target.z[0] * cz), (target.x[1] * cx) + (target.y[1] * cy) + (target.z[1] * cz), (target.x[2] * cx) + (target.y[2] * cy) + (target.z[2] * cz)};
    }

    private static float median(float[] values, float fallback) {
        if (values.length == 0) {
            return fallback;
        }
        float[] sorted = (float[]) values.clone();
        Arrays.sort(sorted);
        int mid = sorted.length / 2;
        return (sorted.length & 1) == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5f;
    }

    private static float[] normalize(float x, float y, float z, float fx, float fy, float fz) {
        float len = length(x, y, z);
        return len <= 1.0E-7f ? new float[]{fx, fy, fz} : new float[]{x / len, y / len, z / len};
    }

    private static float distance(float[] a, int ao, float[] b, int bo) {
        return length(a[ao] - b[bo], a[ao + 1] - b[bo + 1], a[ao + 2] - b[bo + 2]);
    }

    private static float length(float x, float y, float z) {
        return (float) Math.sqrt((x * x) + (y * y) + (z * z));
    }

    private static float dot(float ax, float ay, float az, float bx, float by, float bz) {
        return (ax * bx) + (ay * by) + (az * bz);
    }

    private static float crossX(float[] a, float[] b) {
        return (a[1] * b[2]) - (a[2] * b[1]);
    }

    private static float crossY(float[] a, float[] b) {
        return (a[2] * b[0]) - (a[0] * b[2]);
    }

    private static float crossZ(float[] a, float[] b) {
        return (a[0] * b[1]) - (a[1] * b[0]);
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static final class Basis {
        final float[] x;
        final float[] y;
        final float[] z;

        Basis(float[] x, float[] y, float[] z) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }
}
