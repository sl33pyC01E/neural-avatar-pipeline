# Cleopatra 0.8.4 (21): browser targeting

The reported symptom was a box repeatedly appearing in an apparently unrelated
location. The previous raw prediction and image were not retained, so no specific
model output has been replayed and the original cause remains unconfirmed.

Google's [Gemma 4 image guide](https://ai.google.dev/gemma/docs/capabilities/vision/image)
demonstrates `box_2d: [top, left, bottom, right]` on a 0–1000 grid. Our old browser
prompt requested `box: [left, top, right, bottom]`. The overlay and tap agreed
with each other, but the mismatch with Gemma's documented convention was a likely
source of incorrect targeting. There is no evidence that the model's encoder
itself was rotating the image.

## Coordinate and capture path

- The prompt and parser now require Gemma's `box_2d` YXYX order. A single
  `BrowserTarget` projection supplies native viewport pixels to both the overlay
  and the touch event. Each axis scales by its own screenshot dimension.
- Legacy `box`, nonnumeric, reversed, out-of-range, fractional 0–1 and subpixel
  targets fail with an explanation. No heuristic axis swaps or silent clamping.
- [PixelCopy](https://developer.android.com/reference/android/view/PixelCopy)
  copies the displayed window rectangle at the WebView's window location, into
  a same-size bitmap. A visual-state callback and two animation frames precede
  capture after clearing the overlay. No software-draw fallback is used.
- Layout position/size, page navigation, scrolling and zoom changes invalidate
  the captured geometry. A stale prediction is discarded and captured again
  before either a preview or a tap is accepted. Arbitrary DOM animations are not
  frozen by this check.
- Browser status and streamed answer/reasoning have fixed, scrollable space, so
  their contents cannot resize the native viewport while Gemma is working.
- The PNG bytes are passed directly to LiteRT's `Content.ImageBytes`; the app
  adds no rotation, crop or resize between the inspection image and model input.
  LiteRT still performs its own model-specific vision preprocessing. The user's
  existing model, context, reasoning and image-token settings remain in effect.

## Inspecting a result

In debug tab 8, **Inspect target** pauses the loop and opens the latest image,
with the proposed box and tap center drawn on it. The selectable JSON includes
raw answer, reasoning, selected model/backend/context/image-token budget,
captured viewport geometry, parsed action, projected pixel coordinates and
execution/rejection state. A screenshot waiting for a response has no target.

Only the latest image and JSON are kept in the app's private `cache/browser-debug`
directory. Each new capture replaces them; Clear in the inspector deletes them.
Android may reclaim cache storage. A SHA-256 association prevents displaying
metadata against a different screenshot if a write was interrupted. Nothing is
uploaded by this diagnostic.

## Verification and limits

- `check_browser_target.py`: 52 production parser/prompt/geometry assertions,
  including an asymmetric target, four corners in portrait/landscape/wide views,
  nonzero window/document offsets, stale geometry and invalid coordinates.
- `check_model_chat.py`: existing real-SDK tool protocol/grammar checks with the
  updated browser contract.
- `check_desktop_web.mjs`: CPU SwiftShader, real VRM and a fake native bridge;
  streamed text and expanded reasoning leave browser bounds unchanged; Inspect
  routes correctly; controls and response remain visible at 360×520. Existing
  Main/input/avatar checks also pass.
- Android debug assembly and lint: zero errors, 11 existing warnings. Packaged
  web files, model payload hashes, JNI callback ABI and APK signature verified.

These checks do not exercise native PixelCopy, WebView touches, the inspection
dialog or Gemma's actual visual predictions on the phone. Installation is allowed;
the user launches and tests. A correctly mapped but incorrect model prediction
will still miss; the inspector now provides evidence to distinguish that from a
capture or coordinate problem.
