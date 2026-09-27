# Cleopatra 0.8.2 · Gemma response failure

The user's 0.8.1 test reached `mainSend` with E2B GPU, 8K context and 280 visual
tokens. The model process remained alive. The saved `CleoGemma` log identifies
LiteRT status 3: it rejected this native tool call because `neutral` was emitted
as an unquoted string:

```
call:act{face:{eyes:1.0,head:1.0,mouth:1.0},gesture:neutral}
```

Evidence: `validation/gemma-response-failure-v18.json`, collected with read-only
ADB logs and the app's saved stage receipt. The prior generic IOException hid
the nested parser error. Main's system prompt also demonstrated invalid
unquoted pseudo-code; this was a plausible contributing prompt defect.

Version 19 wraps creation of Main/debug-avatar conversations in
`ExperimentalFlags.enableConversationConstrainedDecoding=true`. The actual
0.17.1 SDK snapshots this flag during creation. The wrapper restores the previous
value even if creation fails, preserving ordinary chat/browser behavior.
The bundled ARM64 runtime contains the Gemma constraint provider, with the
build-disabled branch absent; the APK check now verifies this packaging property.

Main's examples now describe intent in prose, request native tool formatting,
and discourage redundant neutral/default control calls. Existing Java validators
still enforce frame restrictions, bounds and the cached embedding catalog.
The model can speak normally without a tool call. Unparseable calls are never
repaired into executable actions by guessing arguments.

The UI now distinguishes an invalid avatar control from other nested errors,
without exposing the parser dump. New chat clears the failed state and rebuilds
the conversational prefix while retaining loaded engines.

Host validation: production flag scope exercised against the real Kotlin SDK,
including failure/restoration; observed nested parser failure classified;
existing 38 invalid avatar inputs rejected; both actual model templates checked;
Java compile/lint; APK payload, grammar-provider and signature checks. CPU
SwiftShader/fake-bridge flow also verifies New chat recovery without model reload.
Receipts: `validation/gemma-protocol-tool-fix-v19.json`,
`validation/gemma-e*b-template-v19.json`, `validation/desktop-tool-fix-v19/result.json`,
`validation/apk-tool-fix-v19.json`, `validation/installation-tool-fix-v19.json`.

No assistant-initiated phone launch, inference or audio test. These checks verify
configuration/validation/UI wiring, not native constrained generation or its
phone latency; the user's next response test verifies that path.

Runtime references: [SDK flag snapshot at conversation creation](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/kotlin/java/com/google/ai/edge/litertlm/Engine.kt#L145),
[Gemma native constraint provider](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/runtime/conversation/model_data_processor/gemma4_data_processor.cc).
