package ai.cleo.ardymobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.GLUtils;
import android.opengl.Matrix;
import android.view.MotionEvent;
import java.io.InputStream;
import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.Locale;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/* JADX INFO: loaded from: classes3.dex */
final class ArdySkinView extends GLSurfaceView {
    private static final String LINE_FRAGMENT = "precision mediump float;\nuniform vec4 uColor;\nvoid main() {\n  gl_FragColor = uColor;\n}\n";
    private static final String LINE_VERTEX = "uniform mat4 uMvp;\nattribute vec3 aPosition;\nvoid main() {\n  gl_Position = uMvp * vec4(aPosition, 1.0);\n}\n";
    private static final int MAX_VRM_TEXTURE_SIZE = 1024;
    private static final String MESH_FRAGMENT = "precision mediump float;\nuniform vec4 uColor;\nvarying float vLight;\nvoid main() {\n  gl_FragColor = vec4(uColor.rgb * vLight, uColor.a);\n}\n";
    private static final String MESH_VERTEX = "uniform mat4 uMvp;\nuniform mat4 uModel;\nattribute vec3 aPosition;\nattribute vec3 aNormal;\nvarying float vLight;\nvoid main() {\n  vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);\n  vec3 light = normalize(vec3(0.3, 0.85, 0.42));\n  vLight = 0.34 + max(dot(n, light), 0.0) * 0.66;\n  gl_Position = uMvp * vec4(aPosition, 1.0);\n}\n";
    private static final String TEXTURE_FRAGMENT = "precision mediump float;\nuniform sampler2D uTexture;\nuniform vec4 uColor;\nvarying float vLight;\nvarying vec2 vUv;\nvoid main() {\n  vec4 tex = texture2D(uTexture, vUv) * uColor;\n  gl_FragColor = vec4(tex.rgb * vLight, tex.a);\n}\n";
    private static final String TEXTURE_VERTEX = "uniform mat4 uMvp;\nuniform mat4 uModel;\nattribute vec3 aPosition;\nattribute vec3 aNormal;\nattribute vec2 aUv;\nvarying float vLight;\nvarying vec2 vUv;\nvoid main() {\n  vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);\n  vec3 light = normalize(vec3(0.3, 0.85, 0.42));\n  vLight = 0.38 + max(dot(n, light), 0.0) * 0.62;\n  vUv = vec2(aUv.x, 1.0 - aUv.y);\n  gl_Position = uMvp * vec4(aPosition, 1.0);\n}\n";
    private float lastX;
    private float lastY;
    private final String loadError;
    private final ArdyMeshAsset mesh;
    private final ArdyMotionAsset motion;
    private final SceneRenderer renderer;
    private final VrmRetargetAsset vrmAsset;
    private final VrmMeshAsset vrmMesh;

    ArdySkinView(Context context) throws Exception {
        super(context);
        ArdyMeshAsset loadedMesh = null;
        ArdyMotionAsset loadedMotion = null;
        VrmRetargetAsset loadedVrm = null;
        VrmMeshAsset loadedVrmMesh = null;
        String error = null;
        try {
            loadedMesh = ArdyMeshAsset.load(context);
            loadedMotion = ArdyMotionAsset.load(context, "generated-motions/ardy-walk-wave.json");
            loadedVrm = VrmRetargetAsset.load(context);
            loadedVrmMesh = VrmMeshAsset.load(context);
        } catch (Throwable throwable) {
            error = throwable.getClass().getSimpleName() + ": " + throwable.getMessage();
        }
        this.mesh = loadedMesh;
        this.motion = loadedMotion;
        this.vrmAsset = loadedVrm;
        this.vrmMesh = loadedVrmMesh;
        this.loadError = error;
        setEGLContextClientVersion(2);
        this.renderer = new SceneRenderer(context.getApplicationContext(), this.mesh, this.motion, this.vrmAsset, this.vrmMesh);
        setRenderer(this.renderer);
        setRenderMode(1);
    }

    /* JADX INFO: renamed from: lambda$setPlaying$0$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m2lambda$setPlaying$0$aicleoardymobileArdySkinView(boolean playing) {
        this.renderer.setPlaying(playing);
    }

    void setPlaying(final boolean playing) {
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda5
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m2lambda$setPlaying$0$aicleoardymobileArdySkinView(playing);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$setGeneratedMotion$1$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m1lambda$setGeneratedMotion$1$aicleoardymobileArdySkinView(ArdySampleResult result) {
        this.renderer.setGeneratedMotion(result);
    }

    void setGeneratedMotion(final ArdySampleResult result) {
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda0
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m1lambda$setGeneratedMotion$1$aicleoardymobileArdySkinView(result);
            }
        });
    }

    void setRouteOverlay(ArdyRoute route) {
        if (route == null) {
            return;
        }
        final float[] dense = route.denseXz(64, 20.0f);
        final float[] keypoints = route.keypointXz();
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda1
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m3lambda$setRouteOverlay$2$aicleoardymobileArdySkinView(dense, keypoints);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$setRouteOverlay$2$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m3lambda$setRouteOverlay$2$aicleoardymobileArdySkinView(float[] dense, float[] keypoints) {
        this.renderer.setRouteOverlay(dense, keypoints);
    }

    /* JADX INFO: renamed from: lambda$setShowRootPath$3$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m5lambda$setShowRootPath$3$aicleoardymobileArdySkinView(boolean show) {
        this.renderer.setShowRootPath(show);
    }

    void setShowRootPath(final boolean show) {
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda7
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m5lambda$setShowRootPath$3$aicleoardymobileArdySkinView(show);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$setShowVrmSkeleton$4$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m7lambda$setShowVrmSkeleton$4$aicleoardymobileArdySkinView(boolean show) {
        this.renderer.setShowVrmSkeleton(show);
    }

    void setShowVrmSkeleton(final boolean show) {
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda2
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m7lambda$setShowVrmSkeleton$4$aicleoardymobileArdySkinView(show);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$setShowVrmModel$5$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m6lambda$setShowVrmModel$5$aicleoardymobileArdySkinView(boolean show) {
        this.renderer.setShowVrmModel(show);
    }

    void setShowVrmModel(final boolean show) {
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda6
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m6lambda$setShowVrmModel$5$aicleoardymobileArdySkinView(show);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$setShowArdyMesh$6$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m4lambda$setShowArdyMesh$6$aicleoardymobileArdySkinView(boolean show) {
        this.renderer.setShowArdyMesh(show);
    }

    void setShowArdyMesh(final boolean show) {
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda3
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m4lambda$setShowArdyMesh$6$aicleoardymobileArdySkinView(show);
            }
        });
    }

    String summary() {
        if (this.mesh == null) {
            return "ARDY assets failed: " + this.loadError;
        }
        String clip = this.motion == null ? "No cached validation clip loaded" : "Cached validation clip: " + this.motion.frames + " frames at " + String.format(Locale.US, "%.1f fps", Float.valueOf(this.motion.fps));
        return this.mesh.summary() + "\nStartup view: static ARDY bind pose\n" + clip + (this.vrmAsset == null ? "\nVRM retarget asset unavailable" : "\n" + this.vrmAsset.summary()) + (this.vrmMesh == null ? "\nVRM render mesh unavailable" : "\n" + this.vrmMesh.summary());
    }

    String frameSummary() {
        return this.renderer.frameSummary();
    }

    @Override // android.view.View
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() == 0) {
            this.lastX = event.getX();
            this.lastY = event.getY();
            return true;
        }
        if (event.getAction() != 2) {
            return true;
        }
        final float dx = event.getX() - this.lastX;
        final float dy = event.getY() - this.lastY;
        this.lastX = event.getX();
        this.lastY = event.getY();
        queueEvent(new Runnable() { // from class: ai.cleo.ardymobile.ArdySkinView$$ExternalSyntheticLambda4
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m0lambda$onTouchEvent$7$aicleoardymobileArdySkinView(dx, dy);
            }
        });
        return true;
    }

    /* JADX INFO: renamed from: lambda$onTouchEvent$7$ai-cleo-ardymobile-ArdySkinView, reason: not valid java name */
    /* synthetic */ void m0lambda$onTouchEvent$7$aicleoardymobileArdySkinView(float dx, float dy) {
        this.renderer.drag(dx, dy);
    }

    private static final class SceneRenderer implements GLSurfaceView.Renderer {
        private float activeFps;
        private int activeFrames;
        private String activeLabel;
        private float activeMaxX;
        private float activeMaxY;
        private float activeMaxZ;
        private float activeMinX;
        private float activeMinY;
        private float activeMinZ;
        private float[] activePositions;
        private float[] activeRouteKeypointsXz;
        private float[] activeRouteXz;
        private int[] activeVrmEdges;
        private int activeVrmFrames;
        private int activeVrmJointCount;
        private float[] activeVrmJoints;
        private float[] activeVrmRestJoints;
        private boolean centerRestVrmOnMesh;
        private final Context context;
        private final float[] currentPositions;
        private FloatBuffer gridBuffer;
        private int gridVertexCount;
        private ShortBuffer indexBuffer;
        private int indexCount;
        private final float[] interleaved;
        private int lineColor;
        private int lineMvp;
        private int linePosition;
        private int lineProgram;
        private final ArdyMeshAsset mesh;
        private FloatBuffer meshBuffer;
        private int meshColor;
        private int meshModelUniform;
        private int meshMvp;
        private int meshNormal;
        private int meshPosition;
        private int meshProgram;
        private final ArdyMotionAsset motion;
        private final float[] normals;
        private FloatBuffer routeBuffer;
        private FloatBuffer routePointBuffer;
        private int routePointVertexCount;
        private int routeVertexCount;
        private boolean showArdyMesh;
        private boolean showVrmModel;
        private int textureProgram;
        private float[] vrmAnimatedVertices;
        private final VrmRetargetAsset vrmAsset;
        private int vrmColor;
        private ShortBuffer vrmIndexBuffer;
        private final VrmMeshAsset vrmMesh;
        private boolean vrmMeshDirty;
        private int vrmModelUniform;
        private int vrmMvp;
        private int vrmNormal;
        private int vrmPosition;
        private FloatBuffer vrmSkeletonBuffer;
        private int vrmSkeletonVertexCount;
        private int vrmTexture;
        private int[] vrmTextureIds;
        private int vrmUv;
        private FloatBuffer vrmVertexBuffer;
        private int whiteTexture;
        private final float[] projection = new float[16];
        private final float[] view = new float[16];
        private final float[] meshModel = new float[16];
        private final float[] vrmModel = new float[16];
        private final float[] groundModel = new float[16];
        private final float[] vp = new float[16];
        private final float[] mvp = new float[16];
        private int width = 1;
        private int height = 1;
        private int currentFrame = -1;
        private long startedAtNs = System.nanoTime();
        private boolean playing = false;
        private boolean showRootPath = true;
        private boolean showVrmSkeleton = true;
        private float orbitYaw = -34.0f;
        private float orbitPitch = 20.0f;

        SceneRenderer(Context context, ArdyMeshAsset mesh, ArdyMotionAsset motion, VrmRetargetAsset vrmAsset, VrmMeshAsset vrmMesh) {
            boolean z;
            boolean z2;
            this.context = context;
            this.mesh = mesh;
            this.motion = motion;
            this.vrmAsset = vrmAsset;
            this.vrmMesh = vrmMesh;
            if (vrmMesh != null) {
                z = true;
            } else {
                z = false;
            }
            this.showVrmModel = z;
            if (vrmMesh == null) {
                z2 = true;
            } else {
                z2 = false;
            }
            this.showArdyMesh = z2;
            if (mesh != null) {
                this.currentPositions = new float[mesh.vertexCount * 3];
                this.interleaved = new float[mesh.vertexCount * 6];
                this.normals = new float[mesh.vertexCount * 3];
                this.activePositions = mesh.positions;
                this.activeRouteXz = new float[0];
                this.activeRouteKeypointsXz = new float[0];
                this.activeFrames = 1;
                this.activeFps = motion != null ? motion.fps : 20.0f;
                this.activeLabel = "bind pose";
                computeActiveBounds();
                float[] initial = this.activePositions;
                System.arraycopy(initial, 0, this.currentPositions, 0, this.currentPositions.length);
                rebuildInterleaved();
                this.meshBuffer = floatBuffer(this.interleaved);
                this.indexBuffer = shortBuffer(mesh.indices);
                if (vrmMesh != null) {
                    this.vrmAnimatedVertices = (float[]) vrmMesh.vertices.clone();
                    this.vrmVertexBuffer = floatBuffer(this.vrmAnimatedVertices);
                    this.vrmIndexBuffer = shortBuffer(vrmMesh.indices);
                }
                this.gridBuffer = floatBuffer(buildGrid());
                this.routeBuffer = floatBuffer(buildRoute(this.activeRouteXz));
                this.routePointBuffer = floatBuffer(buildRoutePointMarkers(this.activeRouteKeypointsXz));
                this.indexCount = mesh.indices.length;
                this.gridVertexCount = 84;
                this.routeVertexCount = this.activeRouteXz.length / 2;
                this.routePointVertexCount = 0;
                if (vrmAsset != null) {
                    this.activeVrmJoints = vrmAsset.restWorldFrame(0.0f);
                    this.activeVrmRestJoints = this.activeVrmJoints;
                    this.activeVrmEdges = vrmAsset.edgePairs;
                    this.activeVrmFrames = 1;
                    this.activeVrmJointCount = vrmAsset.boneCount();
                    this.centerRestVrmOnMesh = false;
                    this.vrmMeshDirty = true;
                    float[] lines = buildVrmSkeleton(0);
                    this.vrmSkeletonBuffer = floatBuffer(lines);
                    this.vrmSkeletonVertexCount = lines.length / 3;
                    return;
                }
                return;
            }
            this.currentPositions = new float[0];
            this.interleaved = new float[0];
            this.normals = new float[0];
            this.activePositions = new float[0];
            this.activeRouteXz = new float[0];
            this.activeRouteKeypointsXz = new float[0];
            this.activeFrames = 0;
            this.activeFps = 20.0f;
            this.activeLabel = "no mesh";
            this.activeVrmJoints = new float[0];
            this.activeVrmRestJoints = new float[0];
            this.activeVrmEdges = new int[0];
        }

        void setPlaying(boolean next) {
            if (this.playing == next) {
                return;
            }
            this.playing = next;
            if (this.playing) {
                float seconds = (this.currentFrame < 0 || this.motion == null) ? 0.0f : this.currentFrame / this.motion.fps;
                this.startedAtNs = System.nanoTime() - ((long) (1.0E9f * seconds));
            }
        }

        void drag(float dx, float dy) {
            this.orbitYaw += 0.25f * dx;
            this.orbitPitch = clamp(this.orbitPitch + (0.18f * dy), -8.0f, 58.0f);
        }

        void setGeneratedMotion(ArdySampleResult result) {
            if (this.mesh == null || result == null || result.meshPositions == null || result.meshPositions.length < this.mesh.vertexCount * 3) {
                return;
            }
            this.activePositions = result.meshPositions;
            this.activeRouteXz = result.routeXz == null ? new float[0] : result.routeXz;
            this.activeRouteKeypointsXz = result.routeKeypointsXz == null ? new float[0] : result.routeKeypointsXz;
            this.activeFrames = result.frames;
            this.activeFps = result.fps;
            this.activeLabel = "phone sampled";
            this.playing = true;
            if (result.vrmJointPositions != null && result.vrmJointCount > 0) {
                this.activeVrmJoints = result.vrmJointPositions;
                this.activeVrmRestJoints = result.vrmRestJoints == null ? this.activeVrmJoints : result.vrmRestJoints;
                this.activeVrmEdges = result.vrmEdgePairs == null ? new int[0] : result.vrmEdgePairs;
                this.activeVrmFrames = result.frames;
                this.activeVrmJointCount = result.vrmJointCount;
                this.centerRestVrmOnMesh = false;
                this.vrmMeshDirty = true;
                float[] lines = buildVrmSkeleton(0);
                this.vrmSkeletonBuffer = floatBuffer(lines);
                this.vrmSkeletonVertexCount = lines.length / 3;
            }
            computeActiveBounds();
            this.currentFrame = -1;
            this.startedAtNs = System.nanoTime();
            this.routeBuffer = floatBuffer(buildRoute(this.activeRouteXz));
            this.routeVertexCount = this.activeRouteXz.length / 2;
            float[] markers = buildRoutePointMarkers(this.activeRouteKeypointsXz);
            this.routePointBuffer = floatBuffer(markers);
            this.routePointVertexCount = markers.length / 3;
        }

        void setRouteOverlay(float[] routeXz, float[] keypointsXz) {
            this.activeRouteXz = routeXz == null ? new float[0] : routeXz;
            this.activeRouteKeypointsXz = keypointsXz == null ? new float[0] : keypointsXz;
            this.routeBuffer = floatBuffer(buildRoute(this.activeRouteXz));
            this.routeVertexCount = this.activeRouteXz.length / 2;
            float[] markers = buildRoutePointMarkers(this.activeRouteKeypointsXz);
            this.routePointBuffer = floatBuffer(markers);
            this.routePointVertexCount = markers.length / 3;
        }

        void setShowRootPath(boolean show) {
            this.showRootPath = show;
        }

        void setShowVrmSkeleton(boolean show) {
            this.showVrmSkeleton = show;
        }

        void setShowVrmModel(boolean show) {
            this.showVrmModel = show;
        }

        void setShowArdyMesh(boolean show) {
            this.showArdyMesh = show;
        }

        String frameSummary() {
            return this.activeFrames <= 0 ? "No ARDY motion loaded" : String.format(Locale.US, "%s %d / %d | %.1f fps", this.activeLabel, Integer.valueOf(Math.max(0, this.currentFrame) + 1), Integer.valueOf(this.activeFrames), Float.valueOf(this.activeFps));
        }

        @Override // android.opengl.GLSurfaceView.Renderer
        public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            GLES20.glClearColor(0.055f, 0.063f, 0.078f, 1.0f);
            GLES20.glEnable(2929);
            GLES20.glDisable(2884);
            this.meshProgram = program(ArdySkinView.MESH_VERTEX, ArdySkinView.MESH_FRAGMENT);
            this.textureProgram = program(ArdySkinView.TEXTURE_VERTEX, ArdySkinView.TEXTURE_FRAGMENT);
            this.lineProgram = program(ArdySkinView.LINE_VERTEX, ArdySkinView.LINE_FRAGMENT);
            this.meshPosition = GLES20.glGetAttribLocation(this.meshProgram, "aPosition");
            this.meshNormal = GLES20.glGetAttribLocation(this.meshProgram, "aNormal");
            this.meshMvp = GLES20.glGetUniformLocation(this.meshProgram, "uMvp");
            this.meshModelUniform = GLES20.glGetUniformLocation(this.meshProgram, "uModel");
            this.meshColor = GLES20.glGetUniformLocation(this.meshProgram, "uColor");
            this.vrmPosition = GLES20.glGetAttribLocation(this.textureProgram, "aPosition");
            this.vrmNormal = GLES20.glGetAttribLocation(this.textureProgram, "aNormal");
            this.vrmUv = GLES20.glGetAttribLocation(this.textureProgram, "aUv");
            this.vrmMvp = GLES20.glGetUniformLocation(this.textureProgram, "uMvp");
            this.vrmModelUniform = GLES20.glGetUniformLocation(this.textureProgram, "uModel");
            this.vrmColor = GLES20.glGetUniformLocation(this.textureProgram, "uColor");
            this.vrmTexture = GLES20.glGetUniformLocation(this.textureProgram, "uTexture");
            this.linePosition = GLES20.glGetAttribLocation(this.lineProgram, "aPosition");
            this.lineMvp = GLES20.glGetUniformLocation(this.lineProgram, "uMvp");
            this.lineColor = GLES20.glGetUniformLocation(this.lineProgram, "uColor");
            this.whiteTexture = createWhiteTexture();
            this.vrmTextureIds = loadVrmTextures();
        }

        @Override // android.opengl.GLSurfaceView.Renderer
        public void onSurfaceChanged(GL10 gl, int w, int h) {
            this.width = Math.max(1, w);
            this.height = Math.max(1, h);
            GLES20.glViewport(0, 0, this.width, this.height);
            Matrix.perspectiveM(this.projection, 0, 43.0f, this.width / this.height, 0.05f, 30.0f);
        }

        @Override // android.opengl.GLSurfaceView.Renderer
        public void onDrawFrame(GL10 gl) {
            GLES20.glClear(16640);
            if (this.mesh == null) {
                return;
            }
            updateCamera();
            updateFrame();
            drawGrid();
            drawRoute();
            drawRoutePoints();
            if (this.showArdyMesh) {
                drawMesh();
            }
            drawVrmModel();
            drawVrmSkeleton();
        }

        private void updateFrame() {
            if (this.activeFrames <= 0 || this.activePositions.length < this.mesh.vertexCount * 3) {
                return;
            }
            int nextFrame = this.currentFrame;
            if (this.playing) {
                float elapsed = (System.nanoTime() - this.startedAtNs) / 1.0E9f;
                nextFrame = ((int) Math.floor(this.activeFps * elapsed)) % this.activeFrames;
            } else if (nextFrame < 0) {
                nextFrame = 0;
            }
            boolean frameChanged = nextFrame != this.currentFrame;
            if (frameChanged || this.vrmMeshDirty) {
                if (frameChanged) {
                    this.currentFrame = nextFrame;
                    System.arraycopy(this.activePositions, this.mesh.vertexCount * nextFrame * 3, this.currentPositions, 0, this.currentPositions.length);
                    rebuildInterleaved();
                    this.meshBuffer.position(0);
                    this.meshBuffer.put(this.interleaved);
                    this.meshBuffer.position(0);
                }
                if (this.activeVrmJoints != null && this.activeVrmJointCount > 0 && this.activeVrmFrames > 0) {
                    float[] lines = buildVrmSkeleton(nextFrame);
                    if (this.vrmSkeletonBuffer == null || lines.length / 3 != this.vrmSkeletonVertexCount) {
                        this.vrmSkeletonBuffer = floatBuffer(lines);
                        this.vrmSkeletonVertexCount = lines.length / 3;
                    } else {
                        this.vrmSkeletonBuffer.position(0);
                        this.vrmSkeletonBuffer.put(lines);
                        this.vrmSkeletonBuffer.position(0);
                    }
                }
                updateVrmMesh(nextFrame);
            }
        }

        private void updateCamera() {
            float yaw = (float) Math.toRadians(this.orbitYaw);
            float pitch = (float) Math.toRadians(this.orbitPitch);
            float radius = Math.max(3.2f, Math.max(this.activeMaxX - this.activeMinX, this.activeMaxZ - this.activeMinZ) * 1.8f);
            float eyeX = (float) (Math.sin(yaw) * Math.cos(pitch) * ((double) radius));
            float eyeY = (float) ((Math.sin(pitch) * ((double) radius)) + ((double) 0.82f));
            float eyeZ = (float) (Math.cos(yaw) * Math.cos(pitch) * ((double) radius));
            Matrix.setLookAtM(this.view, 0, eyeX, eyeY, eyeZ, 0.0f, 0.82f, 0.0f, 0.0f, 1.0f, 0.0f);
            Matrix.multiplyMM(this.vp, 0, this.projection, 0, this.view, 0);
            Matrix.setIdentityM(this.meshModel, 0);
            float centerX = (this.activeMinX + this.activeMaxX) * 0.5f;
            float centerZ = (this.activeMinZ + this.activeMaxZ) * 0.5f;
            float floorY = this.activeMinY;
            Matrix.translateM(this.meshModel, 0, -centerX, -floorY, -centerZ);
            Matrix.setIdentityM(this.vrmModel, 0);
            if (this.vrmMesh != null) {
                Matrix.rotateM(this.vrmModel, 0, 180.0f, 0.0f, 1.0f, 0.0f);
                Matrix.translateM(this.vrmModel, 0, -this.vrmMesh.centerX(), -this.vrmMesh.minY, -this.vrmMesh.centerZ());
            }
            Matrix.setIdentityM(this.groundModel, 0);
            Matrix.translateM(this.groundModel, 0, -centerX, 0.0f, -centerZ);
        }

        private void drawMesh() {
            Matrix.multiplyMM(this.mvp, 0, this.vp, 0, this.meshModel, 0);
            GLES20.glUseProgram(this.meshProgram);
            this.meshBuffer.position(0);
            GLES20.glVertexAttribPointer(this.meshPosition, 3, 5126, false, 24, (Buffer) this.meshBuffer);
            GLES20.glEnableVertexAttribArray(this.meshPosition);
            this.meshBuffer.position(3);
            GLES20.glVertexAttribPointer(this.meshNormal, 3, 5126, false, 24, (Buffer) this.meshBuffer);
            GLES20.glEnableVertexAttribArray(this.meshNormal);
            GLES20.glUniformMatrix4fv(this.meshMvp, 1, false, this.mvp, 0);
            GLES20.glUniformMatrix4fv(this.meshModelUniform, 1, false, this.meshModel, 0);
            GLES20.glUniform4f(this.meshColor, 0.31f, 0.84f, 0.66f, 1.0f);
            this.indexBuffer.position(0);
            GLES20.glDrawElements(4, this.indexCount, 5123, this.indexBuffer);
            GLES20.glDisableVertexAttribArray(this.meshNormal);
            GLES20.glDisableVertexAttribArray(this.meshPosition);
        }

        private void drawVrmModel() {
            float[] color;
            if (!this.showVrmModel || this.vrmMesh == null || this.vrmVertexBuffer == null || this.vrmIndexBuffer == null) {
                return;
            }
            Matrix.multiplyMM(this.mvp, 0, this.vp, 0, this.vrmModel, 0);
            GLES20.glUseProgram(this.textureProgram);
            char c = 1;
            char c2 = 0;
            GLES20.glUniformMatrix4fv(this.vrmMvp, 1, false, this.mvp, 0);
            GLES20.glUniformMatrix4fv(this.vrmModelUniform, 1, false, this.vrmModel, 0);
            GLES20.glUniform1i(this.vrmTexture, 0);
            GLES20.glActiveTexture(33984);
            GLES20.glEnable(3042);
            GLES20.glBlendFunc(770, 771);
            VrmMeshAsset.Primitive[] primitiveArr = this.vrmMesh.primitives;
            int length = primitiveArr.length;
            int i = 0;
            while (i < length) {
                VrmMeshAsset.Primitive primitive = primitiveArr[i];
                VrmMeshAsset.Material material = (primitive.material < 0 || primitive.material >= this.vrmMesh.materials.length) ? null : this.vrmMesh.materials[primitive.material];
                if (material == null) {
                    color = new float[4];
                    color[c2] = 1.0f;
                    color[c] = 1.0f;
                    color[2] = 1.0f;
                    color[3] = 1.0f;
                } else {
                    color = material.color;
                }
                GLES20.glUniform4f(this.vrmColor, color[c2], color[c], color[2], color[3]);
                int texture = this.whiteTexture;
                if (material != null && this.vrmTextureIds != null && primitive.material < this.vrmTextureIds.length && this.vrmTextureIds[primitive.material] != 0) {
                    texture = this.vrmTextureIds[primitive.material];
                }
                GLES20.glBindTexture(3553, texture);
                FloatBuffer vertices = this.vrmVertexBuffer.duplicate();
                vertices.position(primitive.vertexOffset * this.vrmMesh.strideFloats);
                GLES20.glVertexAttribPointer(this.vrmPosition, 3, 5126, false, this.vrmMesh.strideFloats * 4, (Buffer) vertices);
                GLES20.glEnableVertexAttribArray(this.vrmPosition);
                FloatBuffer vertices2 = this.vrmVertexBuffer.duplicate();
                vertices2.position((primitive.vertexOffset * this.vrmMesh.strideFloats) + 3);
                GLES20.glVertexAttribPointer(this.vrmNormal, 3, 5126, false, this.vrmMesh.strideFloats * 4, (Buffer) vertices2);
                GLES20.glEnableVertexAttribArray(this.vrmNormal);
                FloatBuffer vertices3 = this.vrmVertexBuffer.duplicate();
                vertices3.position((primitive.vertexOffset * this.vrmMesh.strideFloats) + 6);
                GLES20.glVertexAttribPointer(this.vrmUv, 2, 5126, false, this.vrmMesh.strideFloats * 4, (Buffer) vertices3);
                GLES20.glEnableVertexAttribArray(this.vrmUv);
                ShortBuffer indices = this.vrmIndexBuffer.duplicate();
                indices.position(primitive.indexOffset);
                GLES20.glDrawElements(4, primitive.indexCount, 5123, indices);
                i++;
                c = 1;
                c2 = 0;
            }
            GLES20.glDisableVertexAttribArray(this.vrmUv);
            GLES20.glDisableVertexAttribArray(this.vrmNormal);
            GLES20.glDisableVertexAttribArray(this.vrmPosition);
            GLES20.glDisable(3042);
            GLES20.glBindTexture(3553, 0);
        }

        private void drawGrid() {
            Matrix.multiplyMM(this.mvp, 0, this.vp, 0, this.groundModel, 0);
            GLES20.glUseProgram(this.lineProgram);
            this.gridBuffer.position(0);
            GLES20.glVertexAttribPointer(this.linePosition, 3, 5126, false, 12, (Buffer) this.gridBuffer);
            GLES20.glEnableVertexAttribArray(this.linePosition);
            GLES20.glUniformMatrix4fv(this.lineMvp, 1, false, this.mvp, 0);
            GLES20.glLineWidth(1.0f);
            GLES20.glUniform4f(this.lineColor, 0.16f, 0.27f, 0.28f, 1.0f);
            GLES20.glDrawArrays(1, 0, this.gridVertexCount);
            GLES20.glDisableVertexAttribArray(this.linePosition);
        }

        private void drawRoute() {
            if (!this.showRootPath || this.routeVertexCount < 2) {
                return;
            }
            Matrix.multiplyMM(this.mvp, 0, this.vp, 0, this.groundModel, 0);
            GLES20.glUseProgram(this.lineProgram);
            this.routeBuffer.position(0);
            GLES20.glVertexAttribPointer(this.linePosition, 3, 5126, false, 12, (Buffer) this.routeBuffer);
            GLES20.glEnableVertexAttribArray(this.linePosition);
            GLES20.glUniformMatrix4fv(this.lineMvp, 1, false, this.mvp, 0);
            GLES20.glLineWidth(5.0f);
            GLES20.glUniform4f(this.lineColor, 0.86f, 0.62f, 0.26f, 1.0f);
            GLES20.glDrawArrays(3, 0, this.routeVertexCount);
            GLES20.glDisableVertexAttribArray(this.linePosition);
        }

        private void drawRoutePoints() {
            if (!this.showRootPath || this.routePointVertexCount < 2) {
                return;
            }
            Matrix.multiplyMM(this.mvp, 0, this.vp, 0, this.groundModel, 0);
            GLES20.glUseProgram(this.lineProgram);
            this.routePointBuffer.position(0);
            GLES20.glVertexAttribPointer(this.linePosition, 3, 5126, false, 12, (Buffer) this.routePointBuffer);
            GLES20.glEnableVertexAttribArray(this.linePosition);
            GLES20.glUniformMatrix4fv(this.lineMvp, 1, false, this.mvp, 0);
            GLES20.glLineWidth(4.0f);
            GLES20.glUniform4f(this.lineColor, 0.49f, 0.91f, 0.71f, 1.0f);
            GLES20.glDrawArrays(1, 0, this.routePointVertexCount);
            GLES20.glDisableVertexAttribArray(this.linePosition);
        }

        private void drawVrmSkeleton() {
            if (!this.showVrmSkeleton || this.vrmSkeletonBuffer == null || this.vrmSkeletonVertexCount < 2) {
                return;
            }
            Matrix.multiplyMM(this.mvp, 0, this.vp, 0, this.vrmMesh == null ? this.meshModel : this.vrmModel, 0);
            GLES20.glDisable(2929);
            GLES20.glUseProgram(this.lineProgram);
            this.vrmSkeletonBuffer.position(0);
            GLES20.glVertexAttribPointer(this.linePosition, 3, 5126, false, 12, (Buffer) this.vrmSkeletonBuffer);
            GLES20.glEnableVertexAttribArray(this.linePosition);
            GLES20.glUniformMatrix4fv(this.lineMvp, 1, false, this.mvp, 0);
            GLES20.glLineWidth(5.0f);
            GLES20.glUniform4f(this.lineColor, 0.96f, 0.4f, 0.82f, 1.0f);
            GLES20.glDrawArrays(1, 0, this.vrmSkeletonVertexCount);
            GLES20.glDisableVertexAttribArray(this.linePosition);
            GLES20.glEnable(2929);
        }

        private void updateVrmMesh(int frame) {
            int bone;
            if (this.vrmMesh != null && this.vrmAnimatedVertices != null && this.vrmVertexBuffer != null && this.activeVrmJoints != null && this.activeVrmRestJoints != null && this.activeVrmJointCount > 0) {
                if (this.activeVrmFrames <= 0) {
                    return;
                }
                int clampedFrame = Math.max(0, Math.min(this.activeVrmFrames - 1, frame));
                int frameOffset = this.activeVrmJointCount * clampedFrame * 3;
                if ((this.activeVrmJointCount * 3) + frameOffset > this.activeVrmJoints.length || this.activeVrmJointCount * 3 > this.activeVrmRestJoints.length) {
                    return;
                }
                for (int vertex = 0; vertex < this.vrmMesh.vertexCount; vertex++) {
                    int src = this.vrmMesh.strideFloats * vertex;
                    int skin = vertex * 4;
                    float dx = 0.0f;
                    float dy = 0.0f;
                    float dz = 0.0f;
                    for (int slot = 0; slot < 4; slot++) {
                        float weight = this.vrmMesh.boneWeights[skin + slot];
                        if (weight > 0.0f && (bone = this.vrmMesh.boneIndices[skin + slot] & 255) < this.activeVrmJointCount) {
                            int joint = bone * 3;
                            dx += (this.activeVrmJoints[frameOffset + joint] - this.activeVrmRestJoints[joint]) * weight;
                            dy += (this.activeVrmJoints[(frameOffset + joint) + 1] - this.activeVrmRestJoints[joint + 1]) * weight;
                            dz += (this.activeVrmJoints[(frameOffset + joint) + 2] - this.activeVrmRestJoints[joint + 2]) * weight;
                        }
                    }
                    this.vrmAnimatedVertices[src] = this.vrmMesh.vertices[src] + dx;
                    this.vrmAnimatedVertices[src + 1] = this.vrmMesh.vertices[src + 1] + dy;
                    this.vrmAnimatedVertices[src + 2] = this.vrmMesh.vertices[src + 2] + dz;
                    this.vrmAnimatedVertices[src + 3] = this.vrmMesh.vertices[src + 3];
                    this.vrmAnimatedVertices[src + 4] = this.vrmMesh.vertices[src + 4];
                    this.vrmAnimatedVertices[src + 5] = this.vrmMesh.vertices[src + 5];
                    this.vrmAnimatedVertices[src + 6] = this.vrmMesh.vertices[src + 6];
                    this.vrmAnimatedVertices[src + 7] = this.vrmMesh.vertices[src + 7];
                }
                this.vrmVertexBuffer.position(0);
                this.vrmVertexBuffer.put(this.vrmAnimatedVertices);
                this.vrmVertexBuffer.position(0);
                this.vrmMeshDirty = false;
            }
        }

        private void rebuildInterleaved() {
            for (int i = 0; i < this.normals.length; i++) {
                this.normals[i] = 0.0f;
            }
            for (int i2 = 0; i2 < this.mesh.indices.length; i2 += 3) {
                int ia = this.mesh.indices[i2] & 65535;
                int ib = this.mesh.indices[i2 + 1] & 65535;
                int ic = 65535 & this.mesh.indices[i2 + 2];
                accumulateNormal(this.currentPositions, this.normals, ia, ib, ic);
            }
            for (int i3 = 0; i3 < this.normals.length; i3 += 3) {
                normalize(this.normals, i3);
            }
            for (int vertex = 0; vertex < this.mesh.vertexCount; vertex++) {
                int source = vertex * 3;
                int target = vertex * 6;
                this.interleaved[target] = this.currentPositions[source];
                this.interleaved[target + 1] = this.currentPositions[source + 1];
                this.interleaved[target + 2] = this.currentPositions[source + 2];
                this.interleaved[target + 3] = this.normals[source];
                this.interleaved[target + 4] = this.normals[source + 1];
                this.interleaved[target + 5] = this.normals[source + 2];
            }
        }

        private static void accumulateNormal(float[] positions, float[] normals, int ia, int ib, int ic) {
            int a = ia * 3;
            int b = ib * 3;
            int c = ic * 3;
            float abx = positions[b] - positions[a];
            float aby = positions[b + 1] - positions[a + 1];
            float abz = positions[b + 2] - positions[a + 2];
            float acx = positions[c] - positions[a];
            float acy = positions[c + 1] - positions[a + 1];
            float acz = positions[c + 2] - positions[a + 2];
            float nx = (aby * acz) - (abz * acy);
            float ny = (abz * acx) - (abx * acz);
            float nz = (abx * acy) - (aby * acx);
            add(normals, a, nx, ny, nz);
            add(normals, b, nx, ny, nz);
            add(normals, c, nx, ny, nz);
        }

        private static void add(float[] values, int offset, float x, float y, float z) {
            values[offset] = values[offset] + x;
            int i = offset + 1;
            values[i] = values[i] + y;
            int i2 = offset + 2;
            values[i2] = values[i2] + z;
        }

        private static void normalize(float[] values, int offset) {
            float x = values[offset];
            float y = values[offset + 1];
            float z = values[offset + 2];
            float length = (float) Math.sqrt((x * x) + (y * y) + (z * z));
            if (length < 1.0E-6f) {
                values[offset] = 0.0f;
                values[offset + 1] = 1.0f;
                values[offset + 2] = 0.0f;
            } else {
                values[offset] = x / length;
                values[offset + 1] = y / length;
                values[offset + 2] = z / length;
            }
        }

        private static float[] buildGrid() {
            float[] values = new float[252];
            int out = 0;
            for (int i = -10; i <= 10; i++) {
                float v = i * 0.25f;
                int out2 = out + 1;
                values[out] = -2.5f;
                int out3 = out2 + 1;
                values[out2] = 0.0f;
                int out4 = out3 + 1;
                values[out3] = v;
                int out5 = out4 + 1;
                values[out4] = 2.5f;
                int out6 = out5 + 1;
                values[out5] = 0.0f;
                int out7 = out6 + 1;
                values[out6] = v;
                int out8 = out7 + 1;
                values[out7] = v;
                int out9 = out8 + 1;
                values[out8] = 0.0f;
                int out10 = out9 + 1;
                values[out9] = -2.5f;
                int out11 = out10 + 1;
                values[out10] = v;
                int out12 = out11 + 1;
                values[out11] = 0.0f;
                out = out12 + 1;
                values[out12] = 2.5f;
            }
            return values;
        }

        private static float[] buildRoute(float[] routeXz) {
            if (routeXz == null || routeXz.length < 4) {
                return new float[0];
            }
            float[] route = new float[(routeXz.length / 2) * 3];
            int out = 0;
            int i = 0;
            while (i < routeXz.length) {
                int out2 = out + 1;
                route[out] = routeXz[i];
                int out3 = out2 + 1;
                route[out2] = 0.025f;
                route[out3] = routeXz[i + 1];
                i += 2;
                out = out3 + 1;
            }
            return route;
        }

        private static float[] buildRoutePointMarkers(float[] pointsXz) {
            if (pointsXz == null || pointsXz.length < 2) {
                return new float[0];
            }
            float[] values = new float[(pointsXz.length / 2) * 12];
            int out = 0;
            for (int i = 0; i < pointsXz.length; i += 2) {
                float x = pointsXz[i];
                float z = pointsXz[i + 1];
                int out2 = out + 1;
                values[out] = x - 0.055f;
                int out3 = out2 + 1;
                values[out2] = 0.04f;
                int out4 = out3 + 1;
                values[out3] = z - 0.055f;
                int out5 = out4 + 1;
                values[out4] = x + 0.055f;
                int out6 = out5 + 1;
                values[out5] = 0.04f;
                int out7 = out6 + 1;
                values[out6] = z + 0.055f;
                int out8 = out7 + 1;
                values[out7] = x - 0.055f;
                int out9 = out8 + 1;
                values[out8] = 0.04f;
                int out10 = out9 + 1;
                values[out9] = z + 0.055f;
                int out11 = out10 + 1;
                values[out10] = x + 0.055f;
                int out12 = out11 + 1;
                values[out11] = 0.04f;
                out = out12 + 1;
                values[out12] = z - 0.055f;
            }
            return values;
        }

        private float[] buildVrmSkeleton(int frame) {
            if (this.activeVrmJoints == null || this.activeVrmEdges == null || this.activeVrmJointCount <= 0) {
                return new float[0];
            }
            int clampedFrame = Math.max(0, Math.min(Math.max(0, this.activeVrmFrames - 1), frame));
            int frameOffset = this.activeVrmJointCount * clampedFrame * 3;
            if ((this.activeVrmJointCount * 3) + frameOffset > this.activeVrmJoints.length) {
                return new float[0];
            }
            float[] lines = new float[(this.activeVrmEdges.length / 2) * 2 * 3];
            float alignX = this.centerRestVrmOnMesh ? (this.activeMinX + this.activeMaxX) * 0.5f : 0.0f;
            float alignZ = this.centerRestVrmOnMesh ? (this.activeMinZ + this.activeMaxZ) * 0.5f : 0.0f;
            int out = 0;
            for (int i = 0; i < this.activeVrmEdges.length; i += 2) {
                int a = this.activeVrmEdges[i];
                int b = this.activeVrmEdges[i + 1];
                if (a >= 0 && b >= 0 && a < this.activeVrmJointCount && b < this.activeVrmJointCount) {
                    int ao = (a * 3) + frameOffset;
                    int bo = (b * 3) + frameOffset;
                    int out2 = out + 1;
                    lines[out] = this.activeVrmJoints[ao] + alignX;
                    int out3 = out2 + 1;
                    lines[out2] = this.activeVrmJoints[ao + 1];
                    int out4 = out3 + 1;
                    lines[out3] = this.activeVrmJoints[ao + 2] + alignZ;
                    int out5 = out4 + 1;
                    lines[out4] = this.activeVrmJoints[bo] + alignX;
                    int out6 = out5 + 1;
                    lines[out5] = this.activeVrmJoints[bo + 1];
                    out = out6 + 1;
                    lines[out6] = this.activeVrmJoints[bo + 2] + alignZ;
                }
            }
            int i2 = lines.length;
            return out == i2 ? lines : copyOf(lines, out);
        }

        private static float[] copyOf(float[] values, int length) {
            float[] out = new float[length];
            System.arraycopy(values, 0, out, 0, length);
            return out;
        }

        private void computeActiveBounds() {
            this.activeMinX = Float.POSITIVE_INFINITY;
            this.activeMinY = Float.POSITIVE_INFINITY;
            this.activeMinZ = Float.POSITIVE_INFINITY;
            this.activeMaxX = Float.NEGATIVE_INFINITY;
            this.activeMaxY = Float.NEGATIVE_INFINITY;
            this.activeMaxZ = Float.NEGATIVE_INFINITY;
            for (int i = 0; i < this.activePositions.length; i += 3) {
                float x = this.activePositions[i];
                float y = this.activePositions[i + 1];
                float z = this.activePositions[i + 2];
                this.activeMinX = Math.min(this.activeMinX, x);
                this.activeMinY = Math.min(this.activeMinY, y);
                this.activeMinZ = Math.min(this.activeMinZ, z);
                this.activeMaxX = Math.max(this.activeMaxX, x);
                this.activeMaxY = Math.max(this.activeMaxY, y);
                this.activeMaxZ = Math.max(this.activeMaxZ, z);
            }
            if (!Float.isFinite(this.activeMinX)) {
                this.activeMinX = this.mesh.minX;
                this.activeMinY = this.mesh.minY;
                this.activeMinZ = this.mesh.minZ;
                this.activeMaxX = this.mesh.maxX;
                this.activeMaxY = this.mesh.maxY;
                this.activeMaxZ = this.mesh.maxZ;
            }
        }

        private int[] loadVrmTextures() {
            if (this.vrmMesh == null) {
                return new int[0];
            }
            int[] textures = new int[this.vrmMesh.materials.length];
            for (int i = 0; i < textures.length; i++) {
                textures[i] = loadTexture(this.vrmMesh.materials[i].textureAsset);
            }
            return textures;
        }

        private int loadTexture(String assetPath) {
            if (assetPath == null || assetPath.isEmpty()) {
                return this.whiteTexture;
            }
            int[] ids = new int[1];
            GLES20.glGenTextures(1, ids, 0);
            int texture = ids[0];
            GLES20.glBindTexture(3553, texture);
            GLES20.glTexParameteri(3553, 10241, 9729);
            GLES20.glTexParameteri(3553, 10240, 9729);
            GLES20.glTexParameteri(3553, 10242, 33071);
            GLES20.glTexParameteri(3553, 10243, 33071);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try {
                InputStream input = this.context.getAssets().open(assetPath);
                try {
                    BitmapFactory.decodeStream(input, null, bounds);
                    if (input != null) {
                        input.close();
                    }
                    BitmapFactory.Options options = new BitmapFactory.Options();
                    options.inScaled = false;
                    options.inSampleSize = textureSampleSize(bounds.outWidth, bounds.outHeight);
                    try {
                        InputStream input2 = this.context.getAssets().open(assetPath);
                        try {
                            Bitmap bitmap = BitmapFactory.decodeStream(input2, null, options);
                            if (bitmap == null) {
                                throw new IllegalStateException("decode failed");
                            }
                            GLUtils.texImage2D(3553, 0, bitmap, 0);
                            bitmap.recycle();
                            if (input2 != null) {
                                input2.close();
                            }
                            return texture;
                        } catch (Throwable th) {
                            if (input2 != null) {
                                try {
                                    input2.close();
                                } catch (Throwable th2) {
                                    th.addSuppressed(th2);
                                }
                            }
                            throw th;
                        }
                    } catch (Throwable th3) {
                        GLES20.glDeleteTextures(1, ids, 0);
                        return this.whiteTexture;
                    }
                } catch (Throwable ignored) {
                    if (input != null) {
                        try {
                            input.close();
                        } catch (Throwable th4) {
                            ignored.addSuppressed(th4);
                        }
                    }
                    throw ignored;
                }
            } catch (Throwable th5) {
                GLES20.glDeleteTextures(1, ids, 0);
                return this.whiteTexture;
            }
        }

        private static int textureSampleSize(int width, int height) {
            int sample = 1;
            while (true) {
                if (width / sample > ArdySkinView.MAX_VRM_TEXTURE_SIZE || height / sample > ArdySkinView.MAX_VRM_TEXTURE_SIZE) {
                    sample *= 2;
                } else {
                    return Math.max(1, sample);
                }
            }
        }

        private int createWhiteTexture() {
            int[] ids = new int[1];
            GLES20.glGenTextures(1, ids, 0);
            GLES20.glBindTexture(3553, ids[0]);
            GLES20.glTexParameteri(3553, 10241, 9729);
            GLES20.glTexParameteri(3553, 10240, 9729);
            ByteBuffer pixel = ByteBuffer.allocateDirect(4);
            pixel.put((byte) -1);
            pixel.put((byte) -1);
            pixel.put((byte) -1);
            pixel.put((byte) -1);
            pixel.position(0);
            GLES20.glTexImage2D(3553, 0, 6408, 1, 1, 0, 6408, 5121, pixel);
            return ids[0];
        }

        private static FloatBuffer floatBuffer(float[] values) {
            ByteBuffer buffer = ByteBuffer.allocateDirect(values.length * 4).order(ByteOrder.nativeOrder());
            FloatBuffer floats = buffer.asFloatBuffer();
            floats.put(values);
            floats.position(0);
            return floats;
        }

        private static ShortBuffer shortBuffer(short[] values) {
            ByteBuffer buffer = ByteBuffer.allocateDirect(values.length * 2).order(ByteOrder.nativeOrder());
            ShortBuffer shorts = buffer.asShortBuffer();
            shorts.put(values);
            shorts.position(0);
            return shorts;
        }

        private static int program(String vertex, String fragment) {
            int vertexShader = shader(35633, vertex);
            int fragmentShader = shader(35632, fragment);
            int program = GLES20.glCreateProgram();
            GLES20.glAttachShader(program, vertexShader);
            GLES20.glAttachShader(program, fragmentShader);
            GLES20.glLinkProgram(program);
            int[] status = new int[1];
            GLES20.glGetProgramiv(program, 35714, status, 0);
            if (status[0] == 0) {
                throw new IllegalStateException("GL link failed: " + GLES20.glGetProgramInfoLog(program));
            }
            return program;
        }

        private static int shader(int type, String source) {
            int shader = GLES20.glCreateShader(type);
            GLES20.glShaderSource(shader, source);
            GLES20.glCompileShader(shader);
            int[] status = new int[1];
            GLES20.glGetShaderiv(shader, 35713, status, 0);
            if (status[0] == 0) {
                throw new IllegalStateException("GL compile failed: " + GLES20.glGetShaderInfoLog(shader));
            }
            return shader;
        }

        private static float clamp(float value, float min, float max) {
            return Math.max(min, Math.min(max, value));
        }
    }
}
