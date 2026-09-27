# Cleopatra 0.8.5 (22): prompt tree and browser format

Settings → Prompt tree (also in Models → Prompt tree & disk prefix cache) exposes 84 editable entries, grouped by Main, debug
avatar, chat, media input, browser and tool descriptions. Each entry shows its
trigger, current text and required template variables. Search covers IDs,
wording and triggers. Save writes an override; Reset restores and saves the
current application default. Unsaved edits are retained until saved or discarded.
Storage failures keep the draft visible. Opening the editor does not load models.

The native Activity is the sole writer of `files/prompt-tree.json`. Android's
AtomicFile commits complete versions; optimistic revision checks reject stale
editor saves. The separate model process reads a fresh immutable snapshot per
request instead of relying on cross-process SharedPreferences. No prompts or
browser captures are uploaded. This file persists app restarts and APK updates.

The same snapshot supplies model instructions, tool-description wording, dynamic
scene/goal templates, media defaults, successful tool replies and browser recovery
messages. Template substitution is single-pass: user text containing template-like
characters is not expanded a second time. Required variables cannot be removed
or renamed. Native tool names, argument types/ranges, validation errors and action
implementations remain code contracts. Pocket receives spoken text, LAM receives
audio, and Ardy receives its selected embedding rather than extra hidden chat
instructions. The model's bundled tokenizer/chat-format template is unchanged.

Main and debug avatar prepared conversations include the effective system and
tool-description fingerprints in their keys. Tab 7 checks its system fingerprint.
Editing those nodes starts a fresh conversation for that module on its next
request; engine weights remain resident. Per-turn or browser edits do not discard
Main's prepared prefix. In-flight generations finish with their original snapshot.
Opening Settings pauses/hides the native browser; Resume captures a new step with
the latest saved prompts. Native browser visibility also respects open settings
across Android pause/resume.

## Observed browser failure and change

Read-only inspection of the phone's latest v21 diagnostic found this response:

```text
click: [357, 498, 564, 944], click the search icon
```

It is shorthand rather than a JSON object. The browser's default system prompt
now explicitly requires an object with `action` and puts explanations inside
fields. Goal/history/image dimensions are in a separate editable user template.
No numeric click example is included to invite a copied target.

With reasoning off, the browser supplies a seven-action JSON schema through the
installed SDK's `ResponseFormat.json` API and enables its constraint provider.
The schema restricts action names, fields, coordinate count and numeric ranges;
the native validator still checks semantic geometry and stale viewports. Extra
text is never trimmed away or executed opportunistically.

An upstream [reasoning + response-format issue](https://github.com/google-ai-edge/LiteRT-LM/issues/3463)
reports malformed results and native failures. With reasoning enabled, the first
turn keeps the user's reasoning setting and uses validation. If either mode
produces an invalid action, there is at most one correction turn in the same
conversation/image context. That correction uses strict JSON with thinking off.
No action executes before successful validation. A second invalid action pauses
with an explanation. Native runtime errors are surfaced instead of retrying a
possibly damaged session.

Inspect target now retains the effective system/turn/correction prompts, saved
revision, raw attempts, validation errors and output mode in addition to the
captured image, model settings and projected target. Each screenshot starts a new conversation. LiteRT reports that limit; llama.cpp
can restore the saved system prefix and reports the runtime's actual reused-token count.
See [QAT runtime and disk cache](MODELS_QAT_CACHE.md).

## Checks and limits

- 443 host assertions cover all 84 nodes: persistence representation, defaults,
  revisions, scope-specific invalidation, template escaping, schema description
  edits, runtime catalog insertion and the observed malformed response.
- 52 coordinate checks and existing real-SDK tool/streaming checks pass.
- CPU-rendered browser with fake native bridge checks edit/save/reload/reset,
  search, draft protection, failed saves and no model loading from the editor;
  the existing Main/avatar/browser layout checks pass.
- Android compilation, lint, APK payload/signature checks and install receipt are
  recorded under `validation/*v22*`.

Native AtomicFile behavior, the Android dialog/browser visibility handoff and
constrained Gemma generation still require the user's phone test. No phone app
launch, generation, audio playback or UI automation was performed by the agent.
