package ai.cleo.ardymobile;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowInsets;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.SpinnerAdapter;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/* JADX INFO: loaded from: classes3.dex */
public final class MainActivity extends Activity {
    private LinearLayout additionalEmbeddingContainer;
    private Button ardyMeshButton;
    private Spinner cachedSpinner;
    private TextView constraintGuidanceValue;
    private Button createEmbeddingButton;
    private boolean destroyed;
    private TextView embeddingBackendInfo;
    private int lastKeyboardHeight;
    private ScrollView mainScroll;
    private LinearLayout mainScrollContent;
    private TextView metrics;
    private TextView modelInfo;
    private Spinner modelSpinner;
    private EditText newEmbeddingNickname;
    private EditText newEmbeddingText;
    private Button nextEmbeddingButton;
    private ArdyOnnxProbe onnxProbe;
    private Button playButton;
    private Spinner presetSpinner;
    private Button previousEmbeddingButton;
    private boolean rebuildingTimeline;
    private SeekBar rolloutLengthSlider;
    private boolean rolloutLengthTouched;
    private TextView rolloutLengthValue;
    private Button rootPathButton;
    private RouteEditorView routeEditor;
    private TextView routeInfo;
    private ArdyMobileSampler sampler;
    private int scrollAssistBaseBottomPadding;
    private TextView seedValue;
    private ArdySkinView skinView;
    private TextView status;
    private TextView stepsValue;
    private EmbeddingStore store;
    private OnDeviceTextEmbedder textEmbedder;
    private TextView textGuidanceValue;
    private LinearLayout timeline;
    private boolean updatingEmbeddingUi;
    private TextView vrmHeightValue;
    private TextView vrmInfo;
    private Spinner vrmLegModeSpinner;
    private Button vrmModelButton;
    private Button vrmRetargetButton;
    private TextView vrmRootScaleValue;
    private Button vrmSkeletonButton;
    private TextView vrmSleeveValue;
    private TextView vrmSleeveWidthValue;
    private TextView vrmStrengthValue;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ArrayList<EmbeddingRecord> cached = new ArrayList<>();
    private boolean playing = false;
    private boolean hasGeneratedMotion = false;
    private boolean rootPathVisible = true;
    private boolean vrmRetargetEnabled = true;
    private boolean vrmModelVisible = true;
    private boolean vrmSkeletonVisible = true;
    private boolean ardyMeshVisible = false;
    private final int normalSkinHeightDp = 380;
    private final int keyboardSkinHeightDp = 110;
    private final int normalRouteEditorHeightDp = 280;
    private final int keyboardRouteEditorHeightDp = 120;
    private final ArrayList<AdditionalEmbeddingRow> additionalEmbeddingRows = new ArrayList<>();
    private final ArdyRoute[] presets = {ArdyRoute.stationary(), ArdyRoute.straight(), ArdyRoute.curve(), ArdyRoute.sidestep()};
    private int modelIndex = 0;
    private ArdyModelProfile currentProfile = ArdyModelProfile.ALL[0];
    private int presetIndex = 0;
    private int sampleSteps = 4;
    private int sampleSeed = 42;
    private int rolloutBatches = 1;
    private int vrmLegMode = 2;
    private float textGuidance = 2.0f;
    private float constraintGuidance = 2.0f;
    private float vrmStrength = 1.0f;
    private float vrmRootXzScale = 1.0f;
    private float vrmHeightOffset = 0.0f;
    private float vrmSleeveStrength = 0.65f;
    private float vrmSleeveWidth = 0.16f;
    private final Runnable frameLoop = new Runnable() { // from class: ai.cleo.ardymobile.MainActivity.1
        @Override // java.lang.Runnable
        public void run() {
            if (MainActivity.this.destroyed) {
                return;
            }
            MainActivity.this.metrics.setText(MainActivity.this.metricText());
            MainActivity.this.handler.postDelayed(this, 250L);
        }
    };

    /* JADX INFO: Access modifiers changed from: private */
    interface SliderBinding {
        void onValue(int i, TextView textView);
    }

    @Override // android.app.Activity
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(16, 17, 20));
        window.setNavigationBarColor(Color.rgb(16, 17, 20));
        window.setSoftInputMode(16);
        this.store = new EmbeddingStore(this);
        this.textEmbedder = new OnDeviceTextEmbedder(this);
        this.onnxProbe = new ArdyOnnxProbe(this, this.currentProfile);
        setContentView(buildUi());
        setModelProfile(0, false);
        refreshRuntimeControls();
        refreshRouteControls();
        rebuildTimeline();
        loadEmbeddings();
        this.handler.post(this.frameLoop);
    }

    @Override // android.app.Activity
    protected void onResume() {
        super.onResume();
        if (this.skinView != null) {
            this.skinView.onResume();
        }
    }

    @Override // android.app.Activity
    protected void onPause() {
        if (this.skinView != null) {
            this.skinView.onPause();
        }
        super.onPause();
    }

    @Override // android.app.Activity
    protected void onDestroy() {
        this.destroyed = true;
        this.worker.shutdownNow();
        super.onDestroy();
    }

    private LinearLayout buildUi() {
        LinearLayout linearLayout = new LinearLayout(this);
        linearLayout.setOrientation(1);
        linearLayout.setBackgroundColor(Color.rgb(16, 17, 20));
        if (Build.VERSION.SDK_INT >= 30) {
            linearLayout.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda3
                @Override // android.view.View.OnApplyWindowInsetsListener
                public final WindowInsets onApplyWindowInsets(View view, WindowInsets windowInsets) {
                    return MainActivity.lambda$buildUi$0(view, windowInsets);
                }
            });
        } else {
            linearLayout.setPadding(0, dp(24), 0, 0);
        }
        this.skinView = new ArdySkinView(this);
        linearLayout.addView(this.skinView, new LinearLayout.LayoutParams(-1, dp(380)));
        ScrollView scrollView = new ScrollView(this);
        this.mainScroll = scrollView;
        installKeyboardScrollAssist(scrollView);
        LinearLayout linearLayout2 = new LinearLayout(this);
        this.mainScrollContent = linearLayout2;
        linearLayout2.setOrientation(1);
        linearLayout2.setPadding(dp(14), dp(14), dp(14), dp(24));
        this.scrollAssistBaseBottomPadding = linearLayout2.getPaddingBottom();
        scrollView.addView(linearLayout2);
        linearLayout.addView(scrollView, new LinearLayout.LayoutParams(-1, 0, 1.0f));
        this.status = text("Loading real ARDY assets...", 16, Color.rgb(235, 239, 244));
        linearLayout2.addView(this.status);
        this.metrics = text("Metrics pending", 13, Color.rgb(176, 186, 198));
        linearLayout2.addView(this.metrics);
        linearLayout2.addView(label("Cached LLM2Vec Feature"));
        LinearLayout embeddingRow = row();
        this.previousEmbeddingButton = button("Prev");
        this.previousEmbeddingButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda13
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m23lambda$buildUi$1$aicleoardymobileMainActivity(view);
            }
        });
        embeddingRow.addView(this.previousEmbeddingButton, new LinearLayout.LayoutParams(dp(72), -2));
        this.cachedSpinner = spinner(new String[]{"No bundled real LLM2Vec cache loaded"});
        embeddingRow.addView(this.cachedSpinner, new LinearLayout.LayoutParams(0, -2, 1.0f));
        this.nextEmbeddingButton = button("Next");
        this.nextEmbeddingButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda14
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m32lambda$buildUi$2$aicleoardymobileMainActivity(view);
            }
        });
        embeddingRow.addView(this.nextEmbeddingButton, new LinearLayout.LayoutParams(dp(72), -2));
        linearLayout2.addView(embeddingRow);
        addEmbeddingCreationControls(linearLayout2);
        addRolloutLengthControl(linearLayout2);
        linearLayout2.addView(label("Additional Embeddings"));
        this.additionalEmbeddingContainer = new LinearLayout(this);
        this.additionalEmbeddingContainer.setOrientation(1);
        linearLayout2.addView(this.additionalEmbeddingContainer);
        ensureTrailingBlankEmbeddingRow();
        Drawer trajectory = drawer("Trajectory", true);
        trajectory.body.addView(label("Root Path"));
        this.routeInfo = text("", 12, Color.rgb(195, 207, 221));
        trajectory.body.addView(this.routeInfo);
        this.rootPathButton = button("Hide root path in 3D");
        this.rootPathButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda15
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m33lambda$buildUi$3$aicleoardymobileMainActivity(view);
            }
        });
        trajectory.body.addView(this.rootPathButton);
        trajectory.body.addView(label("Trajectory Preset"));
        this.presetSpinner = spinner(presetLabels());
        this.presetSpinner.setSelection(this.presetIndex);
        trajectory.body.addView(this.presetSpinner);
        this.routeEditor = new RouteEditorView(this);
        this.routeEditor.setListener(new RouteEditorView.Listener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda16
            @Override // ai.cleo.ardymobile.RouteEditorView.Listener
            public final void onRouteChanged() {
                this.f$0.m34lambda$buildUi$4$aicleoardymobileMainActivity();
            }
        });
        trajectory.body.addView(this.routeEditor, new LinearLayout.LayoutParams(-1, dp(280)));
        this.timeline = new LinearLayout(this);
        this.timeline.setOrientation(1);
        trajectory.body.addView(this.timeline);
        this.presetSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { // from class: ai.cleo.ardymobile.MainActivity.2
            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position >= 0 && position < MainActivity.this.presets.length) {
                    MainActivity.this.presetIndex = position;
                    MainActivity.this.routeEditor.setRoute(MainActivity.this.presets[MainActivity.this.presetIndex]);
                    MainActivity.this.refreshRouteControls();
                    MainActivity.this.rebuildTimeline();
                }
            }

            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        linearLayout2.addView(trajectory.container);
        addVrmRetargetControls(linearLayout2);
        LinearLayout sampleRow = row();
        Button sampleCpu = button("Sample CPU");
        sampleCpu.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda17
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m35lambda$buildUi$5$aicleoardymobileMainActivity(view);
            }
        });
        sampleRow.addView(sampleCpu, rowButtonParams());
        Button sampleQnn = button("Sample QNN");
        sampleQnn.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda18
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m36lambda$buildUi$6$aicleoardymobileMainActivity(view);
            }
        });
        sampleRow.addView(sampleQnn, rowButtonParams());
        linearLayout2.addView(sampleRow);
        Drawer runtime = drawer("Runtime Settings", false);
        runtime.body.addView(label("ARDY Rollout Model"));
        this.modelSpinner = spinner(ArdyModelProfile.labels());
        this.modelSpinner.setSelection(this.modelIndex);
        this.modelSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { // from class: ai.cleo.ardymobile.MainActivity.3
            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position != MainActivity.this.modelIndex || MainActivity.this.sampler == null) {
                    MainActivity.this.setModelProfile(position, true);
                }
            }

            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        runtime.body.addView(this.modelSpinner);
        this.playButton = button("No generated rollout loaded");
        this.playButton.setEnabled(false);
        this.playButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda19
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m37lambda$buildUi$7$aicleoardymobileMainActivity(view);
            }
        });
        runtime.body.addView(this.playButton);
        this.stepsValue = addSlider(runtime.body, "Denoise steps", 1, 10, this.sampleSteps, new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda20
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m38lambda$buildUi$8$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.textGuidanceValue = addSlider(runtime.body, "Text guidance scale", 0, 50, Math.round(this.textGuidance * 10.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda21
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m39lambda$buildUi$9$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.constraintGuidanceValue = addSlider(runtime.body, "Constraint guidance scale", 0, 50, Math.round(this.constraintGuidance * 10.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda4
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m24lambda$buildUi$10$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.seedValue = addSlider(runtime.body, "Seed", 0, 999, this.sampleSeed, new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda5
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m25lambda$buildUi$11$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.modelInfo = text("", 12, Color.rgb(162, 202, 255));
        runtime.body.addView(this.modelInfo);
        linearLayout2.addView(runtime.container);
        Drawer debug = drawer("Debug", false);
        Button modelCheck = button("Check phone ARDY model files");
        modelCheck.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda6
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m26lambda$buildUi$12$aicleoardymobileMainActivity(view);
            }
        });
        debug.body.addView(modelCheck);
        Button cpuLoad = button("Probe ARDY ONNX CPU load");
        cpuLoad.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda7
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m27lambda$buildUi$13$aicleoardymobileMainActivity(view);
            }
        });
        debug.body.addView(cpuLoad);
        Button qnnLoad = button("Probe ARDY ONNX QNN load");
        qnnLoad.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda8
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m28lambda$buildUi$14$aicleoardymobileMainActivity(view);
            }
        });
        debug.body.addView(qnnLoad);
        Button cpuRun = button("Run one ARDY denoiser forward on CPU");
        cpuRun.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda9
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m29lambda$buildUi$15$aicleoardymobileMainActivity(view);
            }
        });
        debug.body.addView(cpuRun);
        Button qnnRun = button("Run one ARDY denoiser forward on QNN");
        qnnRun.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda10
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m30lambda$buildUi$16$aicleoardymobileMainActivity(view);
            }
        });
        debug.body.addView(qnnRun);
        Button embeddingCheck = button("Check on-phone LLM2Vec model folder");
        embeddingCheck.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda12
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m31lambda$buildUi$17$aicleoardymobileMainActivity(view);
            }
        });
        debug.body.addView(embeddingCheck);
        linearLayout2.addView(debug.container);
        return linearLayout;
    }

    static /* synthetic */ WindowInsets lambda$buildUi$0(View view, WindowInsets insets) {
        Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
        view.setPadding(0, bars.top, 0, bars.bottom);
        return insets;
    }

    /* JADX INFO: renamed from: lambda$buildUi$1$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m23lambda$buildUi$1$aicleoardymobileMainActivity(View view) {
        stepPrimaryEmbedding(-1);
    }

    /* JADX INFO: renamed from: lambda$buildUi$2$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m32lambda$buildUi$2$aicleoardymobileMainActivity(View view) {
        stepPrimaryEmbedding(1);
    }

    /* JADX INFO: renamed from: lambda$buildUi$3$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m33lambda$buildUi$3$aicleoardymobileMainActivity(View view) {
        this.rootPathVisible = !this.rootPathVisible;
        this.skinView.setShowRootPath(this.rootPathVisible);
        this.rootPathButton.setText(this.rootPathVisible ? "Hide root path in 3D" : "Show root path in 3D");
    }

    /* JADX INFO: renamed from: lambda$buildUi$4$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m34lambda$buildUi$4$aicleoardymobileMainActivity() {
        if (this.rebuildingTimeline) {
            return;
        }
        refreshRouteControls();
        rebuildTimeline();
    }

    /* JADX INFO: renamed from: lambda$buildUi$5$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m35lambda$buildUi$5$aicleoardymobileMainActivity(View view) {
        runSampler(false);
    }

    /* JADX INFO: renamed from: lambda$buildUi$6$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m36lambda$buildUi$6$aicleoardymobileMainActivity(View view) {
        runSampler(true);
    }

    /* JADX INFO: renamed from: lambda$buildUi$7$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m37lambda$buildUi$7$aicleoardymobileMainActivity(View view) {
        if (this.hasGeneratedMotion) {
            this.playing = !this.playing;
            this.skinView.setPlaying(this.playing);
            refreshPlayButton();
        }
    }

    /* JADX INFO: renamed from: lambda$buildUi$8$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m38lambda$buildUi$8$aicleoardymobileMainActivity(int value, TextView label) {
        this.sampleSteps = value;
        label.setText(String.valueOf(value));
    }

    /* JADX INFO: renamed from: lambda$buildUi$9$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m39lambda$buildUi$9$aicleoardymobileMainActivity(int value, TextView label) {
        this.textGuidance = value / 10.0f;
        label.setText(String.format(Locale.US, "%.1f", Float.valueOf(this.textGuidance)));
    }

    /* JADX INFO: renamed from: lambda$buildUi$10$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m24lambda$buildUi$10$aicleoardymobileMainActivity(int value, TextView label) {
        this.constraintGuidance = value / 10.0f;
        label.setText(String.format(Locale.US, "%.1f", Float.valueOf(this.constraintGuidance)));
    }

    /* JADX INFO: renamed from: lambda$buildUi$11$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m25lambda$buildUi$11$aicleoardymobileMainActivity(int value, TextView label) {
        this.sampleSeed = value;
        label.setText(String.valueOf(value));
    }

    /* JADX INFO: renamed from: lambda$buildUi$12$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m26lambda$buildUi$12$aicleoardymobileMainActivity(View view) {
        runModelCheck();
    }

    /* JADX INFO: renamed from: lambda$buildUi$13$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m27lambda$buildUi$13$aicleoardymobileMainActivity(View view) {
        runLoadProbe(false);
    }

    /* JADX INFO: renamed from: lambda$buildUi$14$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m28lambda$buildUi$14$aicleoardymobileMainActivity(View view) {
        runLoadProbe(true);
    }

    /* JADX INFO: renamed from: lambda$buildUi$15$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m29lambda$buildUi$15$aicleoardymobileMainActivity(View view) {
        runDenoiserProbe(false);
    }

    /* JADX INFO: renamed from: lambda$buildUi$16$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m30lambda$buildUi$16$aicleoardymobileMainActivity(View view) {
        runDenoiserProbe(true);
    }

    /* JADX INFO: renamed from: lambda$buildUi$17$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m31lambda$buildUi$17$aicleoardymobileMainActivity(View view) {
        refreshEmbeddingBackendInfo();
    }

    private void loadEmbeddings() {
        loadEmbeddings(null);
    }

    private void loadEmbeddings(final String selectKey) {
        this.worker.execute(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda22
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m43lambda$loadEmbeddings$19$aicleoardymobileMainActivity(selectKey);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$loadEmbeddings$19$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m43lambda$loadEmbeddings$19$aicleoardymobileMainActivity(final String selectKey) {
        try {
            this.cached.clear();
            this.cached.addAll(this.store.loadBundledCache());
            this.cached.addAll(this.store.loadSaved());
            this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda50
                @Override // java.lang.Runnable
                public final void run() {
                    this.f$0.m42lambda$loadEmbeddings$18$aicleoardymobileMainActivity(selectKey);
                }
            });
        } catch (Throwable error) {
            fail("Embedding load failed", error);
        }
    }

    /* JADX INFO: renamed from: lambda$loadEmbeddings$18$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m42lambda$loadEmbeddings$18$aicleoardymobileMainActivity(String selectKey) {
        bindSpinner(this.cachedSpinner, labels(this.cached, "No real cached LLM2Vec embeddings"));
        if (selectKey != null) {
            for (int i = 0; i < this.cached.size(); i++) {
                if (selectKey.equals(this.cached.get(i).key)) {
                    this.cachedSpinner.setSelection(i);
                    break;
                }
            }
        }
        refreshAdditionalEmbeddingRows();
        refreshEmbeddingBackendInfo();
        this.status.setText(String.format(Locale.US, "Ready: %d real cached LLM2Vec feature(s). ARDY mobile sampling is experimental.", Integer.valueOf(this.cached.size())));
    }

    private void addEmbeddingCreationControls(LinearLayout panel) {
        Drawer creator = drawer("Embedding Creation", false);
        this.embeddingBackendInfo = text("", 12, Color.rgb(195, 207, 221));
        creator.body.addView(this.embeddingBackendInfo);
        creator.body.addView(label("Motion Prompt"));
        this.newEmbeddingText = new EditText(this);
        this.newEmbeddingText.setSingleLine(false);
        this.newEmbeddingText.setMinLines(2);
        this.newEmbeddingText.setMaxLines(4);
        this.newEmbeddingText.setTextColor(Color.rgb(235, 239, 244));
        this.newEmbeddingText.setHintTextColor(Color.rgb(120, 130, 142));
        this.newEmbeddingText.setTextSize(13.0f);
        this.newEmbeddingText.setHint("walk naturally and wave");
        this.newEmbeddingText.setInputType(147457);
        creator.body.addView(this.newEmbeddingText, new LinearLayout.LayoutParams(-1, -2));
        creator.body.addView(label("Nickname"));
        this.newEmbeddingNickname = new EditText(this);
        this.newEmbeddingNickname.setSingleLine(true);
        this.newEmbeddingNickname.setTextColor(Color.rgb(235, 239, 244));
        this.newEmbeddingNickname.setHintTextColor(Color.rgb(120, 130, 142));
        this.newEmbeddingNickname.setTextSize(13.0f);
        this.newEmbeddingNickname.setHint("optional cache label");
        this.newEmbeddingNickname.setInputType(16385);
        creator.body.addView(this.newEmbeddingNickname, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout row = row();
        Button refresh = button("Refresh");
        refresh.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda41
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m12x65f8ad0e(view);
            }
        });
        row.addView(refresh, rowButtonParams());
        this.createEmbeddingButton = button("Create on phone");
        this.createEmbeddingButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda42
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m13xe3d0690f(view);
            }
        });
        row.addView(this.createEmbeddingButton, rowButtonParams());
        creator.body.addView(row);
        panel.addView(creator.container);
        refreshEmbeddingBackendInfo();
    }

    /* JADX INFO: renamed from: lambda$addEmbeddingCreationControls$20$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m12x65f8ad0e(View view) {
        refreshEmbeddingBackendInfo();
    }

    /* JADX INFO: renamed from: lambda$addEmbeddingCreationControls$21$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m13xe3d0690f(View view) {
        runCreateEmbedding();
    }

    private void refreshEmbeddingBackendInfo() {
        if (this.embeddingBackendInfo == null || this.textEmbedder == null) {
            return;
        }
        this.embeddingBackendInfo.setText(this.textEmbedder.status());
    }

    private void runCreateEmbedding() {
        if (this.newEmbeddingText == null || this.textEmbedder == null) {
            return;
        }
        final String text = this.newEmbeddingText.getText().toString().trim();
        final String nickname = this.newEmbeddingNickname == null ? "" : this.newEmbeddingNickname.getText().toString().trim();
        if (text.isEmpty()) {
            this.status.setText("Enter an ARDY motion prompt to embed on the phone.");
            return;
        }
        this.createEmbeddingButton.setEnabled(false);
        this.status.setText("Creating ARDY LLM2Vec embedding on phone...");
        this.worker.execute(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda33
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m49lambda$runCreateEmbedding$24$aicleoardymobileMainActivity(text, nickname);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runCreateEmbedding$24$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m49lambda$runCreateEmbedding$24$aicleoardymobileMainActivity(String text, String nickname) {
        try {
            OnDeviceTextEmbedder.EmbeddingResult result = this.textEmbedder.embed(text);
            final EmbeddingRecord saved = this.store.saveGenerated(text, nickname, result.vector, result.encoder);
            this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda1
                @Override // java.lang.Runnable
                public final void run() {
                    this.f$0.m47lambda$runCreateEmbedding$22$aicleoardymobileMainActivity(saved);
                }
            });
        } catch (Throwable error) {
            this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda2
                @Override // java.lang.Runnable
                public final void run() {
                    this.f$0.m48lambda$runCreateEmbedding$23$aicleoardymobileMainActivity(error);
                }
            });
        }
    }

    /* JADX INFO: renamed from: lambda$runCreateEmbedding$22$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m47lambda$runCreateEmbedding$22$aicleoardymobileMainActivity(EmbeddingRecord saved) {
        this.createEmbeddingButton.setEnabled(true);
        this.newEmbeddingText.setText("");
        if (this.newEmbeddingNickname != null) {
            this.newEmbeddingNickname.setText("");
        }
        this.status.setText("Saved on-phone embedding: " + saved.label());
        loadEmbeddings(saved.key);
    }

    /* JADX INFO: renamed from: lambda$runCreateEmbedding$23$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m48lambda$runCreateEmbedding$23$aicleoardymobileMainActivity(Throwable error) {
        this.createEmbeddingButton.setEnabled(true);
        refreshEmbeddingBackendInfo();
        this.status.setText("On-phone embedding failed: " + error.getClass().getSimpleName() + " - " + error.getMessage());
    }

    private void runSampler(boolean qnn) {
        EmbeddingRecord record = selectedEmbedding();
        if (this.sampler == null) {
            this.status.setText("ARDY sampler is not available.");
            return;
        }
        if (record == null || !record.hasVector()) {
            this.status.setText("Select a real cached LLM2Vec embedding first.");
            return;
        }
        syncTimelineInputs();
        ArdyRoute route = currentRoute();
        EmbeddingRecord[] schedule = buildEmbeddingSchedule(record);
        String scheduleSummary = embeddingScheduleSummary(schedule);
        final ArdySampleSettings settings = new ArdySampleSettings(this.sampleSteps, this.sampleSeed, this.rolloutBatches, this.textGuidance, this.constraintGuidance, qnn, route, schedule, scheduleSummary, buildVrmSettings());
        this.status.setText(String.format(Locale.US, "Sampling ARDY on %s: %s, %d x %d-frame batch(es), %d DDIM steps, seed %d...", qnn ? "QNN session" : "CPU", settings.route.name, Integer.valueOf(settings.rolloutBatches), Integer.valueOf(batchFrames()), Integer.valueOf(settings.steps), Integer.valueOf(settings.seed)));
        this.worker.execute(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda11
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m57lambda$runSampler$26$aicleoardymobileMainActivity(settings);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runSampler$26$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m57lambda$runSampler$26$aicleoardymobileMainActivity(ArdySampleSettings settings) {
        try {
            final ArdySampleResult result = this.sampler.sample(settings);
            this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda38
                @Override // java.lang.Runnable
                public final void run() {
                    this.f$0.m56lambda$runSampler$25$aicleoardymobileMainActivity(result);
                }
            });
        } catch (Throwable error) {
            fail("ARDY sample failed", error);
        }
    }

    /* JADX INFO: renamed from: lambda$runSampler$25$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m56lambda$runSampler$25$aicleoardymobileMainActivity(ArdySampleResult result) {
        this.skinView.setGeneratedMotion(result);
        this.hasGeneratedMotion = true;
        this.playing = true;
        this.skinView.setPlaying(true);
        refreshPlayButton();
        this.status.setText(result.message);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void refreshRouteControls() {
        ArdyRoute route = currentRoute();
        if (this.routeInfo != null) {
            this.routeInfo.setText(route.describe());
        }
        if (this.skinView != null) {
            this.skinView.setRouteOverlay(route);
        }
    }

    private void refreshRuntimeControls() {
        if (this.stepsValue != null) {
            this.stepsValue.setText(String.valueOf(this.sampleSteps));
        }
        if (this.textGuidanceValue != null) {
            this.textGuidanceValue.setText(String.format(Locale.US, "%.1f", Float.valueOf(this.textGuidance)));
        }
        if (this.constraintGuidanceValue != null) {
            this.constraintGuidanceValue.setText(String.format(Locale.US, "%.1f", Float.valueOf(this.constraintGuidance)));
        }
        if (this.seedValue != null) {
            this.seedValue.setText(String.valueOf(this.sampleSeed));
        }
        refreshPlayButton();
    }

    private void refreshPlayButton() {
        String str;
        if (this.playButton == null) {
            return;
        }
        this.playButton.setEnabled(this.hasGeneratedMotion);
        Button button = this.playButton;
        if (this.hasGeneratedMotion) {
            str = this.playing ? "Pause generated rollout" : "Resume generated rollout";
        } else {
            str = "No generated rollout loaded";
        }
        button.setText(str);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void setModelProfile(int index, boolean reportStatus) {
        if (index < 0 || index >= ArdyModelProfile.ALL.length) {
            return;
        }
        this.modelIndex = index;
        this.currentProfile = ArdyModelProfile.ALL[index];
        this.onnxProbe = new ArdyOnnxProbe(this, this.currentProfile);
        try {
            this.sampler = new ArdyMobileSampler(this, this.currentProfile);
            if (reportStatus && this.status != null) {
                this.status.setText("Selected ARDY " + this.currentProfile.label + ".");
            }
        } catch (Throwable error) {
            this.sampler = null;
            if (this.status != null) {
                this.status.setText("ARDY " + this.currentProfile.label + " sampler init failed: " + error.getClass().getSimpleName() + " - " + error.getMessage());
            }
        }
        refreshRolloutLengthControl();
        refreshAdditionalEmbeddingRows();
        updateModelInfo();
        refreshVrmControls();
    }

    private void updateModelInfo() {
        if (this.modelInfo == null || this.skinView == null || this.onnxProbe == null) {
            return;
        }
        this.modelInfo.setText(this.skinView.summary() + "\nSelected ARDY model: " + this.currentProfile.label + "\nONNX Runtime providers: " + this.onnxProbe.providers() + "\nPhone model dir: " + this.onnxProbe.modelDirectory() + (this.sampler == null ? "\nSampler unavailable" : "\n" + this.sampler.summary()));
    }

    private void addVrmRetargetControls(LinearLayout panel) {
        Drawer vrm = drawer("VRM Retargeting", true);
        this.vrmInfo = text("", 12, Color.rgb(195, 207, 221));
        vrm.body.addView(this.vrmInfo);
        LinearLayout toggleRow = row();
        this.vrmRetargetButton = button("Disable VRM retarget");
        this.vrmRetargetButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda26
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m14lambda$addVrmRetargetControls$27$aicleoardymobileMainActivity(view);
            }
        });
        toggleRow.addView(this.vrmRetargetButton, rowButtonParams());
        this.vrmModelButton = button("Hide VRM model");
        this.vrmModelButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda27
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m15lambda$addVrmRetargetControls$28$aicleoardymobileMainActivity(view);
            }
        });
        toggleRow.addView(this.vrmModelButton, rowButtonParams());
        vrm.body.addView(toggleRow);
        LinearLayout visibilityRow = row();
        this.vrmSkeletonButton = button("Hide VRM skeleton");
        this.vrmSkeletonButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda28
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m16lambda$addVrmRetargetControls$29$aicleoardymobileMainActivity(view);
            }
        });
        visibilityRow.addView(this.vrmSkeletonButton, rowButtonParams());
        this.ardyMeshButton = button("Show ARDY source mesh");
        this.ardyMeshButton.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda29
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m17lambda$addVrmRetargetControls$30$aicleoardymobileMainActivity(view);
            }
        });
        visibilityRow.addView(this.ardyMeshButton, rowButtonParams());
        vrm.body.addView(visibilityRow);
        vrm.body.addView(label("Leg Mode"));
        this.vrmLegModeSpinner = spinner(new String[]{"Locked legs", "Feet locked", "Unlocked legs"});
        this.vrmLegModeSpinner.setSelection(this.vrmLegMode);
        this.vrmLegModeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { // from class: ai.cleo.ardymobile.MainActivity.4
            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                MainActivity.this.vrmLegMode = MainActivity.clampInt(position, 0, 2);
                MainActivity.this.refreshVrmControls();
            }

            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        vrm.body.addView(this.vrmLegModeSpinner);
        this.vrmStrengthValue = addSlider(vrm.body, "Retarget strength", 0, 150, Math.round(this.vrmStrength * 100.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda30
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m18lambda$addVrmRetargetControls$31$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.vrmRootScaleValue = addSlider(vrm.body, "Root X/Z scale", 0, 150, Math.round(this.vrmRootXzScale * 100.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda31
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m19lambda$addVrmRetargetControls$32$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.vrmHeightValue = addSlider(vrm.body, "Height offset", -30, 30, Math.round(this.vrmHeightOffset * 100.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda32
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m20lambda$addVrmRetargetControls$33$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.vrmSleeveValue = addSlider(vrm.body, "Sleeve barrier strength", 0, 100, Math.round(this.vrmSleeveStrength * 100.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda34
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m21lambda$addVrmRetargetControls$34$aicleoardymobileMainActivity(i, textView);
            }
        });
        this.vrmSleeveWidthValue = addSlider(vrm.body, "Sleeve barrier width", 5, 30, Math.round(this.vrmSleeveWidth * 100.0f), new SliderBinding() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda35
            @Override // ai.cleo.ardymobile.MainActivity.SliderBinding
            public final void onValue(int i, TextView textView) {
                this.f$0.m22lambda$addVrmRetargetControls$35$aicleoardymobileMainActivity(i, textView);
            }
        });
        panel.addView(vrm.container);
        refreshVrmControls();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$27$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m14lambda$addVrmRetargetControls$27$aicleoardymobileMainActivity(View view) {
        this.vrmRetargetEnabled = !this.vrmRetargetEnabled;
        refreshVrmControls();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$28$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m15lambda$addVrmRetargetControls$28$aicleoardymobileMainActivity(View view) {
        this.vrmModelVisible = !this.vrmModelVisible;
        refreshVrmControls();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$29$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m16lambda$addVrmRetargetControls$29$aicleoardymobileMainActivity(View view) {
        this.vrmSkeletonVisible = !this.vrmSkeletonVisible;
        refreshVrmControls();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$30$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m17lambda$addVrmRetargetControls$30$aicleoardymobileMainActivity(View view) {
        this.ardyMeshVisible = !this.ardyMeshVisible;
        refreshVrmControls();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$31$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m18lambda$addVrmRetargetControls$31$aicleoardymobileMainActivity(int value, TextView label) {
        this.vrmStrength = value / 100.0f;
        label.setText(String.format(Locale.US, "%.2f", Float.valueOf(this.vrmStrength)));
        refreshVrmInfoText();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$32$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m19lambda$addVrmRetargetControls$32$aicleoardymobileMainActivity(int value, TextView label) {
        this.vrmRootXzScale = value / 100.0f;
        label.setText(String.format(Locale.US, "%.2f", Float.valueOf(this.vrmRootXzScale)));
        refreshVrmInfoText();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$33$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m20lambda$addVrmRetargetControls$33$aicleoardymobileMainActivity(int value, TextView label) {
        this.vrmHeightOffset = value / 100.0f;
        label.setText(String.format(Locale.US, "%+.2fm", Float.valueOf(this.vrmHeightOffset)));
        refreshVrmInfoText();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$34$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m21lambda$addVrmRetargetControls$34$aicleoardymobileMainActivity(int value, TextView label) {
        this.vrmSleeveStrength = value / 100.0f;
        label.setText(String.format(Locale.US, "%.2f", Float.valueOf(this.vrmSleeveStrength)));
        refreshVrmInfoText();
    }

    /* JADX INFO: renamed from: lambda$addVrmRetargetControls$35$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m22lambda$addVrmRetargetControls$35$aicleoardymobileMainActivity(int value, TextView label) {
        this.vrmSleeveWidth = value / 100.0f;
        label.setText(String.format(Locale.US, "%.2fm", Float.valueOf(this.vrmSleeveWidth)));
        refreshVrmInfoText();
    }

    private VrmRetargetSettings buildVrmSettings() {
        return new VrmRetargetSettings(this.vrmRetargetEnabled, this.vrmLegMode, this.vrmStrength, this.vrmRootXzScale, this.vrmHeightOffset, this.vrmSleeveStrength, this.vrmSleeveWidth);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void refreshVrmControls() {
        if (this.vrmRetargetButton != null) {
            this.vrmRetargetButton.setText(this.vrmRetargetEnabled ? "Disable VRM retarget" : "Enable VRM retarget");
        }
        if (this.vrmSkeletonButton != null) {
            this.vrmSkeletonButton.setText(this.vrmSkeletonVisible ? "Hide VRM skeleton" : "Show VRM skeleton");
        }
        if (this.vrmModelButton != null) {
            this.vrmModelButton.setText(this.vrmModelVisible ? "Hide VRM model" : "Show VRM model");
        }
        if (this.ardyMeshButton != null) {
            this.ardyMeshButton.setText(this.ardyMeshVisible ? "Hide ARDY source mesh" : "Show ARDY source mesh");
        }
        if (this.skinView != null) {
            this.skinView.setShowVrmSkeleton(this.vrmSkeletonVisible);
            this.skinView.setShowVrmModel(this.vrmModelVisible);
            this.skinView.setShowArdyMesh(this.ardyMeshVisible);
        }
        refreshVrmInfoText();
    }

    private void refreshVrmInfoText() {
        if (this.vrmInfo == null) {
            return;
        }
        VrmRetargetSettings settings = buildVrmSettings();
        this.vrmInfo.setText(String.format(Locale.US, "%s | legs %s | strength %.2f | root %.2fx | height %+.2fm | sleeve %.2f / %.2fm", settings.enabled ? "enabled" : "disabled", settings.legModeName(), Float.valueOf(settings.strength), Float.valueOf(settings.rootXzScale), Float.valueOf(settings.rootHeightOffset), Float.valueOf(settings.sleeveBarrierStrength), Float.valueOf(settings.sleeveBarrierWidth)));
    }

    private void installKeyboardScrollAssist(final ScrollView scroll) {
        scroll.setClipToPadding(false);
        scroll.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda39
            @Override // android.view.ViewTreeObserver.OnGlobalLayoutListener
            public final void onGlobalLayout() {
                this.f$0.m41x8e0d4aa0(scroll);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$installKeyboardScrollAssist$36$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m41x8e0d4aa0(ScrollView scroll) {
        Rect visible = new Rect();
        scroll.getRootView().getWindowVisibleDisplayFrame(visible);
        int keyboard = Math.max(0, scroll.getRootView().getHeight() - visible.bottom);
        int bottomPadding = this.scrollAssistBaseBottomPadding + (keyboard > dp(80) ? dp(48) + keyboard : 0);
        if (this.mainScrollContent != null && this.mainScrollContent.getPaddingBottom() != bottomPadding) {
            this.mainScrollContent.setPadding(this.mainScrollContent.getPaddingLeft(), this.mainScrollContent.getPaddingTop(), this.mainScrollContent.getPaddingRight(), bottomPadding);
        }
        updateKeyboardCompactHeights(keyboard);
        this.lastKeyboardHeight = keyboard;
        if (keyboard > dp(80) && (getCurrentFocus() instanceof EditText)) {
            scrollFocusedInputIntoView(keyboard);
        }
    }

    private void scrollFocusedInputIntoView() {
        this.handler.postDelayed(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda52
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m58x9261c6fa();
            }
        }, 60L);
        this.handler.postDelayed(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda53
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m59x103982fb();
            }
        }, 220L);
        this.handler.postDelayed(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda54
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m60x8e113efc();
            }
        }, 420L);
        this.handler.postDelayed(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda55
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m61x5e9b6712();
            }
        }, 700L);
    }

    /* JADX INFO: renamed from: lambda$scrollFocusedInputIntoView$37$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m58x9261c6fa() {
        scrollFocusedInputIntoView(this.lastKeyboardHeight);
    }

    /* JADX INFO: renamed from: lambda$scrollFocusedInputIntoView$38$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m59x103982fb() {
        scrollFocusedInputIntoView(this.lastKeyboardHeight);
    }

    /* JADX INFO: renamed from: lambda$scrollFocusedInputIntoView$39$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m60x8e113efc() {
        scrollFocusedInputIntoView(this.lastKeyboardHeight);
    }

    /* JADX INFO: renamed from: lambda$scrollFocusedInputIntoView$40$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m61x5e9b6712() {
        scrollFocusedInputIntoView(this.lastKeyboardHeight);
    }

    private void scrollFocusedInputIntoView(int keyboardHeight) {
        if (this.mainScroll == null) {
            return;
        }
        View focus = getCurrentFocus();
        if ((focus instanceof EditText) && this.mainScrollContent != null) {
            Rect rect = new Rect();
            focus.getDrawingRect(rect);
            this.mainScrollContent.offsetDescendantRectToMyCoords(focus, rect);
            int effectiveHeight = this.mainScroll.getHeight();
            if (keyboardHeight > dp(80)) {
                int visibleBelowScrollTop = (this.mainScroll.getRootView().getHeight() - keyboardHeight) - this.mainScroll.getTop();
                effectiveHeight = Math.min(effectiveHeight, visibleBelowScrollTop);
            }
            int effectiveHeight2 = Math.max(dp(150), effectiveHeight);
            int scrollY = this.mainScroll.getScrollY();
            int margin = dp(34);
            int visibleTop = scrollY + margin;
            int visibleBottom = (scrollY + effectiveHeight2) - margin;
            int target = scrollY;
            if (rect.bottom > visibleBottom) {
                target += rect.bottom - visibleBottom;
            }
            if (rect.top < visibleTop) {
                target = rect.top - margin;
            }
            this.mainScroll.smoothScrollTo(0, Math.max(0, target));
        }
    }

    private void updateKeyboardCompactHeights(int keyboardHeight) {
        int iDp;
        int iDp2;
        boolean compact = keyboardHeight > dp(80) && (getCurrentFocus() instanceof EditText);
        ArdySkinView ardySkinView = this.skinView;
        if (compact) {
            iDp = dp(110);
        } else {
            iDp = dp(380);
        }
        setExactHeight(ardySkinView, iDp);
        RouteEditorView routeEditorView = this.routeEditor;
        if (compact) {
            iDp2 = dp(120);
        } else {
            iDp2 = dp(280);
        }
        setExactHeight(routeEditorView, iDp2);
        if (compact) {
            this.handler.postDelayed(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda43
                @Override // java.lang.Runnable
                public final void run() {
                    this.f$0.m62x450b059f();
                }
            }, 90L);
        }
    }

    /* JADX INFO: renamed from: lambda$updateKeyboardCompactHeights$41$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m62x450b059f() {
        scrollFocusedInputIntoView(this.lastKeyboardHeight);
    }

    private void setExactHeight(View view, int height) {
        ViewGroup.LayoutParams params;
        if (view != null && (params = view.getLayoutParams()) != null && params.height != height) {
            params.height = height;
            view.setLayoutParams(params);
        }
    }

    private void addRolloutLengthControl(LinearLayout parent) {
        LinearLayout titleRow = row();
        titleRow.addView(text("Length", 12, Color.rgb(126, 214, 168)), new LinearLayout.LayoutParams(0, -2, 1.0f));
        this.rolloutLengthValue = text("", 12, Color.rgb(235, 239, 244));
        this.rolloutLengthValue.setGravity(5);
        titleRow.addView(this.rolloutLengthValue, new LinearLayout.LayoutParams(dp(190), -2));
        parent.addView(titleRow);
        this.rolloutLengthSlider = new SeekBar(this);
        this.rolloutLengthSlider.setPadding(0, 0, 0, dp(8));
        this.rolloutLengthSlider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() { // from class: ai.cleo.ardymobile.MainActivity.5
            @Override // android.widget.SeekBar.OnSeekBarChangeListener
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                MainActivity.this.rolloutBatches = progress + 1;
                if (fromUser) {
                    MainActivity.this.rolloutLengthTouched = true;
                }
                MainActivity.this.refreshRolloutLengthLabel();
                MainActivity.this.refreshAdditionalEmbeddingRows();
            }

            @Override // android.widget.SeekBar.OnSeekBarChangeListener
            public void onStartTrackingTouch(SeekBar seekBar) {
            }

            @Override // android.widget.SeekBar.OnSeekBarChangeListener
            public void onStopTrackingTouch(SeekBar seekBar) {
            }
        });
        parent.addView(this.rolloutLengthSlider, new LinearLayout.LayoutParams(-1, -2));
        refreshRolloutLengthControl();
    }

    private void refreshRolloutLengthControl() {
        int max = maxRolloutBatches();
        if (!this.rolloutLengthTouched) {
            this.rolloutBatches = defaultRolloutBatches();
        }
        this.rolloutBatches = clampInt(this.rolloutBatches, 1, max);
        if (this.rolloutLengthSlider != null) {
            this.rolloutLengthSlider.setMax(Math.max(0, max - 1));
            int progress = this.rolloutBatches - 1;
            if (this.rolloutLengthSlider.getProgress() != progress) {
                this.rolloutLengthSlider.setProgress(progress);
            }
        }
        refreshRolloutLengthLabel();
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void refreshRolloutLengthLabel() {
        if (this.rolloutLengthValue == null) {
            return;
        }
        int frames = this.rolloutBatches * batchFrames();
        this.rolloutLengthValue.setText(String.format(Locale.US, "%d x %d frames  %.2fs", Integer.valueOf(this.rolloutBatches), Integer.valueOf(batchFrames()), Float.valueOf(frames / Math.max(1.0f, this.sampler == null ? this.currentProfile.fps : this.sampler.fps()))));
    }

    private int defaultRolloutBatches() {
        return clampInt(Math.round(64.0f / Math.max(1, batchFrames())), 1, maxRolloutBatches());
    }

    private int maxRolloutBatches() {
        return this.sampler == null ? this.currentProfile.maxFullBatches() : this.sampler.maxFullBatches();
    }

    private int batchFrames() {
        return this.sampler != null ? this.sampler.genHorizonFrames() : this.currentProfile.genHorizonFrames;
    }

    private void stepPrimaryEmbedding(int direction) {
        if (this.cached.isEmpty()) {
            return;
        }
        int current = this.cachedSpinner.getSelectedItemPosition();
        if (current < 0) {
            current = 0;
        }
        int next = (current + direction) % this.cached.size();
        if (next < 0) {
            next += this.cached.size();
        }
        this.cachedSpinner.setSelection(next);
        this.status.setText("Selected embedding: " + this.cached.get(next).label());
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void ensureTrailingBlankEmbeddingRow() {
        if (this.additionalEmbeddingContainer == null || this.updatingEmbeddingUi) {
            return;
        }
        for (int i = this.additionalEmbeddingRows.size() - 2; i >= 0; i--) {
            AdditionalEmbeddingRow row = this.additionalEmbeddingRows.get(i);
            AdditionalEmbeddingRow next = this.additionalEmbeddingRows.get(i + 1);
            if (row.embeddingIndex < 0 && next.embeddingIndex < 0) {
                removeAdditionalEmbeddingRow(row, false);
            }
        }
        if (this.additionalEmbeddingRows.isEmpty() || this.additionalEmbeddingRows.get(this.additionalEmbeddingRows.size() - 1).embeddingIndex >= 0) {
            addAdditionalEmbeddingRow(-1, Math.min(this.additionalEmbeddingRows.size(), Math.max(0, this.rolloutBatches - 1)));
        }
    }

    private void addAdditionalEmbeddingRow(int embeddingIndex, int batchIndex) {
        final AdditionalEmbeddingRow item = new AdditionalEmbeddingRow();
        item.embeddingIndex = embeddingIndex;
        item.batchIndex = clampInt(batchIndex, 0, Math.max(0, this.rolloutBatches - 1));
        item.container = new LinearLayout(this);
        item.container.setOrientation(1);
        item.container.setPadding(0, dp(4), 0, dp(6));
        LinearLayout embeddingControls = row();
        item.previous = button("Prev");
        item.previous.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda23
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m9x403f81a8(item, view);
            }
        });
        embeddingControls.addView(item.previous, new LinearLayout.LayoutParams(dp(72), -2));
        item.embeddingSpinner = spinner(optionalEmbeddingLabels());
        item.embeddingSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { // from class: ai.cleo.ardymobile.MainActivity.6
            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                item.embeddingIndex = position - 1;
                if (!MainActivity.this.updatingEmbeddingUi) {
                    MainActivity.this.ensureTrailingBlankEmbeddingRow();
                }
            }

            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        embeddingControls.addView(item.embeddingSpinner, new LinearLayout.LayoutParams(0, -2, 1.0f));
        item.next = button("Next");
        item.next.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda24
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m10xbe173da9(item, view);
            }
        });
        embeddingControls.addView(item.next, new LinearLayout.LayoutParams(dp(72), -2));
        item.container.addView(embeddingControls);
        LinearLayout batchControls = row();
        batchControls.addView(text("Batch", 12, Color.rgb(176, 186, 198)), new LinearLayout.LayoutParams(dp(56), -2));
        item.batchSpinner = spinner(batchLabels());
        item.batchSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() { // from class: ai.cleo.ardymobile.MainActivity.7
            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                item.batchIndex = position;
            }

            @Override // android.widget.AdapterView.OnItemSelectedListener
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        batchControls.addView(item.batchSpinner, new LinearLayout.LayoutParams(0, -2, 1.0f));
        item.remove = button("Remove");
        item.remove.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda25
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                this.f$0.m11x3beef9aa(item, view);
            }
        });
        batchControls.addView(item.remove, new LinearLayout.LayoutParams(dp(104), -2));
        item.container.addView(batchControls);
        this.additionalEmbeddingRows.add(item);
        this.additionalEmbeddingContainer.addView(item.container);
        boolean wasUpdating = this.updatingEmbeddingUi;
        this.updatingEmbeddingUi = true;
        bindAdditionalEmbeddingRow(item);
        this.updatingEmbeddingUi = wasUpdating;
    }

    /* JADX INFO: renamed from: lambda$addAdditionalEmbeddingRow$42$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m9x403f81a8(AdditionalEmbeddingRow item, View view) {
        stepAdditionalEmbedding(item, -1);
    }

    /* JADX INFO: renamed from: lambda$addAdditionalEmbeddingRow$43$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m10xbe173da9(AdditionalEmbeddingRow item, View view) {
        stepAdditionalEmbedding(item, 1);
    }

    /* JADX INFO: renamed from: lambda$addAdditionalEmbeddingRow$44$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m11x3beef9aa(AdditionalEmbeddingRow item, View view) {
        removeAdditionalEmbeddingRow(item, true);
    }

    private void removeAdditionalEmbeddingRow(AdditionalEmbeddingRow item, boolean ensureBlank) {
        this.additionalEmbeddingRows.remove(item);
        if (this.additionalEmbeddingContainer != null) {
            this.additionalEmbeddingContainer.removeView(item.container);
        }
        if (ensureBlank) {
            ensureTrailingBlankEmbeddingRow();
        }
    }

    private void stepAdditionalEmbedding(AdditionalEmbeddingRow item, int direction) {
        int count = this.cached.size() + 1;
        if (count <= 1) {
            return;
        }
        int selected = ((item.embeddingIndex + 1) + direction) % count;
        if (selected < 0) {
            selected += count;
        }
        item.embeddingIndex = selected - 1;
        item.embeddingSpinner.setSelection(selected);
        ensureTrailingBlankEmbeddingRow();
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void refreshAdditionalEmbeddingRows() {
        if (this.additionalEmbeddingContainer == null) {
            return;
        }
        this.updatingEmbeddingUi = true;
        for (AdditionalEmbeddingRow row : this.additionalEmbeddingRows) {
            bindAdditionalEmbeddingRow(row);
        }
        this.updatingEmbeddingUi = false;
        ensureTrailingBlankEmbeddingRow();
    }

    private void bindAdditionalEmbeddingRow(AdditionalEmbeddingRow row) {
        int embeddingIndex = row.embeddingIndex;
        int batchIndex = row.batchIndex;
        bindSpinner(row.embeddingSpinner, optionalEmbeddingLabels());
        row.embeddingIndex = clampInt(embeddingIndex, -1, this.cached.size() - 1);
        row.embeddingSpinner.setSelection(row.embeddingIndex + 1);
        bindSpinner(row.batchSpinner, batchLabels());
        row.batchIndex = clampInt(batchIndex, 0, Math.max(0, this.rolloutBatches - 1));
        row.batchSpinner.setSelection(row.batchIndex);
    }

    private ArrayList<String> optionalEmbeddingLabels() {
        ArrayList<String> labels = new ArrayList<>();
        labels.add("No additional embedding");
        for (EmbeddingRecord record : this.cached) {
            labels.add(record.label());
        }
        return labels;
    }

    private ArrayList<String> presetLabels() {
        ArrayList<String> labels = new ArrayList<>();
        for (ArdyRoute preset : this.presets) {
            labels.add(preset.name);
        }
        return labels;
    }

    private ArrayList<String> batchLabels() {
        ArrayList<String> labels = new ArrayList<>();
        float fps = this.sampler == null ? this.currentProfile.fps : this.sampler.fps();
        int frames = batchFrames();
        for (int i = 0; i < Math.max(1, this.rolloutBatches); i++) {
            float start = (i * frames) / fps;
            float end = ((i + 1) * frames) / fps;
            labels.add(String.format(Locale.US, "Batch %02d  %.2fs-%.2fs", Integer.valueOf(i + 1), Float.valueOf(start), Float.valueOf(end)));
        }
        return labels;
    }

    private EmbeddingRecord[] buildEmbeddingSchedule(EmbeddingRecord primary) {
        int batches = clampInt(this.rolloutBatches, 1, maxRolloutBatches());
        EmbeddingRecord[] schedule = new EmbeddingRecord[batches];
        EmbeddingRecord[] changes = new EmbeddingRecord[batches];
        changes[0] = primary;
        for (AdditionalEmbeddingRow row : this.additionalEmbeddingRows) {
            if (row.embeddingIndex >= 0 && row.embeddingIndex < this.cached.size() && row.batchIndex >= 0 && row.batchIndex < batches) {
                changes[row.batchIndex] = this.cached.get(row.embeddingIndex);
            }
        }
        EmbeddingRecord current = primary;
        for (int i = 0; i < batches; i++) {
            if (changes[i] != null) {
                current = changes[i];
            }
            schedule[i] = current;
        }
        return schedule;
    }

    private String embeddingScheduleSummary(EmbeddingRecord[] schedule) {
        if (schedule == null || schedule.length == 0 || schedule[0] == null) {
            return "none";
        }
        StringBuilder builder = new StringBuilder();
        builder.append("batch 1 ").append(schedule[0].label());
        for (int i = 1; i < schedule.length; i++) {
            if (schedule[i] != null && schedule[i] != schedule[i - 1]) {
                builder.append("; batch ").append(i + 1).append(" ").append(schedule[i].label());
            }
        }
        return builder.toString();
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void rebuildTimeline() {
        if (this.timeline == null || this.routeEditor == null) {
            return;
        }
        this.rebuildingTimeline = true;
        this.timeline.removeAllViews();
        ArrayList<RouteEditorView.Point> points = this.routeEditor.snapshotPoints();
        for (int i = 0; i < points.size(); i++) {
            RouteEditorView.Point point = points.get(i);
            LinearLayout row = row();
            TextView name = text(String.format(Locale.US, "%02d", Integer.valueOf(i + 1)), 13, Color.rgb(238, 196, 99));
            row.addView(name, new LinearLayout.LayoutParams(dp(34), -2));
            final EditText time = new EditText(this);
            time.setSingleLine(true);
            time.setTextColor(Color.rgb(235, 239, 244));
            time.setTextSize(13.0f);
            time.setInputType(8194);
            time.setText(String.format(Locale.US, "%.2f", Float.valueOf(point.time)));
            time.setOnFocusChangeListener(new View.OnFocusChangeListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda47
                @Override // android.view.View.OnFocusChangeListener
                public final void onFocusChange(View view, boolean z) {
                    this.f$0.m44lambda$rebuildTimeline$45$aicleoardymobileMainActivity(view, z);
                }
            });
            row.addView(time, new LinearLayout.LayoutParams(dp(74), -2));
            TextView coords = text(String.format(Locale.US, "x %.2f   z %.2f", Float.valueOf(point.x), Float.valueOf(point.z)), 13, Color.rgb(176, 186, 198));
            row.addView(coords, new LinearLayout.LayoutParams(0, -2, 1.0f));
            final int index = i;
            Button set = button("Set");
            set.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda48
                @Override // android.view.View.OnClickListener
                public final void onClick(View view) {
                    this.f$0.m45lambda$rebuildTimeline$46$aicleoardymobileMainActivity(time, index, view);
                }
            });
            row.addView(set, new LinearLayout.LayoutParams(dp(72), -2));
            Button remove = button("X");
            remove.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda49
                @Override // android.view.View.OnClickListener
                public final void onClick(View view) {
                    this.f$0.m46lambda$rebuildTimeline$47$aicleoardymobileMainActivity(index, view);
                }
            });
            row.addView(remove, new LinearLayout.LayoutParams(dp(54), -2));
            this.timeline.addView(row);
        }
        this.rebuildingTimeline = false;
    }

    /* JADX INFO: renamed from: lambda$rebuildTimeline$45$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m44lambda$rebuildTimeline$45$aicleoardymobileMainActivity(View view, boolean hasFocus) {
        if (hasFocus) {
            scrollFocusedInputIntoView();
        }
    }

    /* JADX INFO: renamed from: lambda$rebuildTimeline$46$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m45lambda$rebuildTimeline$46$aicleoardymobileMainActivity(EditText time, int index, View view) {
        Float parsed = parseFloat(time.getText().toString());
        if (parsed != null) {
            this.routeEditor.updateTime(index, parsed.floatValue());
        }
    }

    /* JADX INFO: renamed from: lambda$rebuildTimeline$47$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m46lambda$rebuildTimeline$47$aicleoardymobileMainActivity(int index, View view) {
        this.routeEditor.removePoint(index);
    }

    private void syncTimelineInputs() {
        if (this.timeline == null || this.routeEditor == null) {
            return;
        }
        ArrayList<Float> parsedTimes = new ArrayList<>();
        for (int i = 0; i < this.timeline.getChildCount(); i++) {
            View child = this.timeline.getChildAt(i);
            if (child instanceof LinearLayout) {
                LinearLayout row = (LinearLayout) child;
                if (row.getChildCount() >= 2 && (row.getChildAt(1) instanceof EditText)) {
                    EditText input = (EditText) row.getChildAt(1);
                    Float parsed = parseFloat(input.getText().toString());
                    if (parsed != null) {
                        parsedTimes.add(parsed);
                    }
                }
            }
        }
        if (!parsedTimes.isEmpty()) {
            float[] values = new float[parsedTimes.size()];
            for (int i2 = 0; i2 < values.length; i2++) {
                values[i2] = parsedTimes.get(i2).floatValue();
            }
            this.routeEditor.updateTimes(values);
        }
    }

    private ArdyRoute currentRoute() {
        return this.routeEditor == null ? ArdyRoute.stationary() : this.routeEditor.route();
    }

    private void runModelCheck() {
        this.status.setText("Checking phone ARDY model files...");
        this.worker.execute(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda44
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m55lambda$runModelCheck$49$aicleoardymobileMainActivity();
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runModelCheck$49$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m55lambda$runModelCheck$49$aicleoardymobileMainActivity() {
        final ArdyOnnxProbe.ProbeResult result = this.onnxProbe.checkModelFiles();
        this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda37
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m54lambda$runModelCheck$48$aicleoardymobileMainActivity(result);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runModelCheck$48$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m54lambda$runModelCheck$48$aicleoardymobileMainActivity(ArdyOnnxProbe.ProbeResult result) {
        this.status.setText(result.message);
    }

    private void runLoadProbe(final boolean qnn) {
        this.status.setText((qnn ? "QNN" : "CPU") + " ARDY ONNX session load started...");
        this.worker.execute(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda36
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m53lambda$runLoadProbe$51$aicleoardymobileMainActivity(qnn);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runLoadProbe$51$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m53lambda$runLoadProbe$51$aicleoardymobileMainActivity(boolean qnn) {
        final ArdyOnnxProbe.ProbeResult result = this.onnxProbe.loadSessions(qnn);
        this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda0
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m52lambda$runLoadProbe$50$aicleoardymobileMainActivity(result);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runLoadProbe$50$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m52lambda$runLoadProbe$50$aicleoardymobileMainActivity(ArdyOnnxProbe.ProbeResult result) {
        this.status.setText(result.message);
    }

    private void runDenoiserProbe(final boolean qnn) {
        final EmbeddingRecord record = selectedEmbedding();
        if (record == null || !record.hasVector()) {
            this.status.setText("Select a real cached LLM2Vec embedding first.");
        } else {
            this.status.setText((qnn ? "QNN" : "CPU") + " ARDY denoiser forward started with " + record.key + "...");
            this.worker.execute(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda45
                @Override // java.lang.Runnable
                public final void run() {
                    this.f$0.m51lambda$runDenoiserProbe$53$aicleoardymobileMainActivity(qnn, record);
                }
            });
        }
    }

    /* JADX INFO: renamed from: lambda$runDenoiserProbe$53$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m51lambda$runDenoiserProbe$53$aicleoardymobileMainActivity(boolean qnn, EmbeddingRecord record) {
        final ArdyOnnxProbe.ProbeResult result = this.onnxProbe.runDenoiser(qnn, record.vector);
        this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda40
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m50lambda$runDenoiserProbe$52$aicleoardymobileMainActivity(result);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$runDenoiserProbe$52$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m50lambda$runDenoiserProbe$52$aicleoardymobileMainActivity(ArdyOnnxProbe.ProbeResult result) {
        this.status.setText(result.message);
    }

    private EmbeddingRecord selectedEmbedding() {
        int index = this.cachedSpinner.getSelectedItemPosition();
        if (index >= 0 && index < this.cached.size()) {
            return this.cached.get(index);
        }
        if (this.cached.isEmpty()) {
            return null;
        }
        return this.cached.get(0);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public String metricText() {
        Debug.MemoryInfo memory = new Debug.MemoryInfo();
        Debug.getMemoryInfo(memory);
        return String.format(Locale.US, "%s | PSS %.0f MB", this.skinView.frameSummary(), Double.valueOf(((double) memory.getTotalPss()) / 1024.0d));
    }

    private void fail(final String label, final Throwable error) {
        this.handler.post(new Runnable() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda51
            @Override // java.lang.Runnable
            public final void run() {
                this.f$0.m40lambda$fail$54$aicleoardymobileMainActivity(label, error);
            }
        });
    }

    /* JADX INFO: renamed from: lambda$fail$54$ai-cleo-ardymobile-MainActivity, reason: not valid java name */
    /* synthetic */ void m40lambda$fail$54$aicleoardymobileMainActivity(String label, Throwable error) {
        this.status.setText(label + ": " + error.getClass().getSimpleName() + " - " + error.getMessage());
    }

    private static ArrayList<String> labels(ArrayList<EmbeddingRecord> records, String empty) {
        ArrayList<String> labels = new ArrayList<>();
        if (records.isEmpty()) {
            labels.add(empty);
        } else {
            for (EmbeddingRecord record : records) {
                labels.add(record.label());
            }
        }
        return labels;
    }

    private void bindSpinner(Spinner spinner, ArrayList<String> values) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter((SpinnerAdapter) adapter);
    }

    private Spinner spinner(String[] values) {
        ArrayList<String> list = new ArrayList<>();
        for (String value : values) {
            list.add(value);
        }
        return spinner(list);
    }

    private Spinner spinner(ArrayList<String> values) {
        Spinner spinner = new Spinner(this);
        bindSpinner(spinner, values);
        spinner.setPadding(0, dp(4), 0, dp(8));
        return spinner;
    }

    private TextView label(String value) {
        TextView view = text(value, 12, Color.rgb(126, 214, 168));
        view.setPadding(0, dp(14), 0, dp(4));
        return view;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0.0f, 1.08f);
        return view;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setAllCaps(false);
        button.setGravity(17);
        return button;
    }

    private TextView addSlider(LinearLayout parent, String title, final int min, int max, int initial, final SliderBinding binding) {
        int clamped = Math.max(min, Math.min(max, initial));
        LinearLayout titleRow = row();
        TextView name = text(title, 12, Color.rgb(126, 214, 168));
        titleRow.addView(name, new LinearLayout.LayoutParams(0, -2, 1.0f));
        final TextView value = text("", 12, Color.rgb(235, 239, 244));
        value.setGravity(5);
        titleRow.addView(value, new LinearLayout.LayoutParams(dp(72), -2));
        parent.addView(titleRow);
        SeekBar slider = new SeekBar(this);
        slider.setMax(Math.max(0, max - min));
        slider.setProgress(clamped - min);
        slider.setPadding(0, 0, 0, dp(8));
        binding.onValue(clamped, value);
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() { // from class: ai.cleo.ardymobile.MainActivity.8
            @Override // android.widget.SeekBar.OnSeekBarChangeListener
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                binding.onValue(min + progress, value);
            }

            @Override // android.widget.SeekBar.OnSeekBarChangeListener
            public void onStartTrackingTouch(SeekBar seekBar) {
            }

            @Override // android.widget.SeekBar.OnSeekBarChangeListener
            public void onStopTrackingTouch(SeekBar seekBar) {
            }
        });
        parent.addView(slider, new LinearLayout.LayoutParams(-1, -2));
        return value;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(0);
        row.setGravity(16);
        row.setPadding(0, dp(3), 0, dp(3));
        return row;
    }

    private LinearLayout.LayoutParams rowButtonParams() {
        return new LinearLayout.LayoutParams(0, -2, 1.0f);
    }

    private Drawer drawer(final String title, boolean open) {
        final Drawer drawer = new Drawer();
        drawer.container = new LinearLayout(this);
        drawer.container.setOrientation(1);
        drawer.header = button((open ? "Hide " : "Show ") + title);
        drawer.body = new LinearLayout(this);
        drawer.body.setOrientation(1);
        drawer.body.setVisibility(open ? 0 : 8);
        drawer.header.setOnClickListener(new View.OnClickListener() { // from class: ai.cleo.ardymobile.MainActivity$$ExternalSyntheticLambda46
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                MainActivity.lambda$drawer$55(drawer, title, view);
            }
        });
        drawer.container.addView(drawer.header);
        drawer.container.addView(drawer.body);
        return drawer;
    }

    static /* synthetic */ void lambda$drawer$55(Drawer drawer, String title, View view) {
        boolean show = drawer.body.getVisibility() != 0;
        drawer.body.setVisibility(show ? 0 : 8);
        drawer.header.setText((show ? "Hide " : "Show ") + title);
    }

    private Float parseFloat(String value) {
        try {
            return Float.valueOf(Float.parseFloat(value.trim()));
        } catch (Throwable th) {
            return null;
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /* JADX INFO: Access modifiers changed from: private */
    static final class Drawer {
        LinearLayout body;
        LinearLayout container;
        Button header;

        private Drawer() {
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    static final class AdditionalEmbeddingRow {
        int batchIndex;
        Spinner batchSpinner;
        LinearLayout container;
        int embeddingIndex;
        Spinner embeddingSpinner;
        Button next;
        Button previous;
        Button remove;

        private AdditionalEmbeddingRow() {
            this.embeddingIndex = -1;
        }
    }
}
