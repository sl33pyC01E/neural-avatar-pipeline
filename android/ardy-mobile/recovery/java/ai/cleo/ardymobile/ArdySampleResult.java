package ai.cleo.ardymobile;

import java.util.Locale;

/* JADX INFO: loaded from: classes3.dex */
final class ArdySampleResult {
    final float fps;
    final int frames;
    final float[] meshPositions;
    final String message;
    final float[] routeKeypointsXz;
    final float[] routeXz;
    final int vertexCount;
    final int[] vrmEdgePairs;
    final int vrmJointCount;
    final String[] vrmJointNames;
    final int[] vrmJointParents;
    final float[] vrmJointPositions;
    final float[] vrmRestJoints;

    ArdySampleResult(float[] meshPositions, float[] routeXz, float[] routeKeypointsXz, int frames, int vertexCount, float fps, String message, VrmRetargeter.Result vrm) {
        this.meshPositions = meshPositions;
        this.routeXz = routeXz;
        this.routeKeypointsXz = routeKeypointsXz;
        this.frames = frames;
        this.vertexCount = vertexCount;
        this.fps = fps;
        this.message = message;
        this.vrmJointPositions = vrm == null ? null : vrm.jointPositions;
        this.vrmRestJoints = vrm == null ? null : vrm.restJoints;
        this.vrmJointNames = vrm == null ? null : vrm.jointNames;
        this.vrmJointParents = vrm == null ? null : vrm.parents;
        this.vrmEdgePairs = vrm != null ? vrm.edgePairs : null;
        this.vrmJointCount = vrm == null ? 0 : vrm.jointCount;
    }

    String frameSummary(int currentFrame) {
        return String.format(Locale.US, "generated frame %d / %d | %.1f fps", Integer.valueOf(Math.max(0, currentFrame) + 1), Integer.valueOf(this.frames), Float.valueOf(this.fps));
    }
}
