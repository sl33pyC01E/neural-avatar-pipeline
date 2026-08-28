// Minimal Audio2Face v3 -> ARKit blendshape bridge for Face Animation Lab.
#include "audio2face/audio2face.h"
#include "audio2x/cuda_utils.h"

#include <algorithm>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

struct Destroyer {
  template <typename T> void operator()(T* value) const { value->Destroy(); }
};
template <typename T> using UniquePtr = std::unique_ptr<T, Destroyer>;

const char* kNames[] = {
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft",
  "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft", "eyeBlinkRight",
  "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight",
  "eyeSquintRight", "eyeWideRight", "jawForward", "jawLeft", "jawRight",
  "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft",
  "mouthRight", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft",
  "mouthFrownRight", "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft",
  "mouthStretchRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower",
  "mouthShrugUpper", "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft",
  "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight", "browDownLeft",
  "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft",
  "noseSneerRight", "tongueOut"
};

bool check(std::error_code error, const char* operation) {
  if (!error) return true;
  std::cerr << operation << ": " << error.message() << '\n';
  return false;
}

std::vector<float> readFloat32(const char* path) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input) return {};
  const auto bytes = input.tellg();
  input.seekg(0);
  std::vector<float> audio(static_cast<std::size_t>(bytes) / sizeof(float));
  input.read(reinterpret_cast<char*>(audio.data()), static_cast<std::streamsize>(audio.size() * sizeof(float)));
  return audio;
}

struct Results {
  std::mutex mutex;
  std::vector<std::vector<float>> frames;
};

void callback(void* userdata, const nva2f::IBlendshapeExecutor::HostResults& result, std::error_code error) {
  if (error) return;
  auto& output = *static_cast<Results*>(userdata);
  std::lock_guard<std::mutex> lock(output.mutex);
  output.frames.emplace_back(result.weights.Data(), result.weights.Data() + result.weights.Size());
}

bool writeJson(const char* path, const std::vector<std::vector<float>>& frames) {
  std::ofstream output(path, std::ios::binary);
  if (!output) return false;
  output << "{\"fps\":60,\"names\":[";
  for (std::size_t i = 0; i < std::size(kNames); ++i) {
    if (i) output << ',';
    output << '\"' << kNames[i] << '\"';
  }
  output << "],\"frames\":[" << std::setprecision(7);
  for (std::size_t frameIndex = 0; frameIndex < frames.size(); ++frameIndex) {
    if (frameIndex) output << ',';
    output << '[';
    const auto& frame = frames[frameIndex];
    const auto count = std::min<std::size_t>(frame.size(), std::size(kNames));
    for (std::size_t i = 0; i < count; ++i) {
      if (i) output << ',';
      output << std::clamp(frame[i], 0.0f, 1.0f);
    }
    output << ']';
  }
  output << "]}";
  return true;
}

} // namespace

int main(int argc, char** argv) {
  if (argc != 4) {
    std::cerr << "Usage: a2f-web-bridge model.json input.f32 output.json\n";
    return 2;
  }
  if (!check(nva2x::SetCudaDeviceIfNeeded(0), "select CUDA device")) return 1;

  UniquePtr<nva2f::IBlendshapeExecutorBundle> bundle(
    nva2f::ReadDiffusionBlendshapeSolveExecutorBundle(
      1, argv[1], nva2f::IGeometryExecutor::ExecutionOption::Skin,
      false, 0, true, nullptr, nullptr));
  if (!bundle) {
    std::cerr << "Unable to load the Audio2Face diffusion model\n";
    return 1;
  }

  auto audio = readFloat32(argv[2]);
  if (audio.empty()) {
    std::cerr << "Input must contain 16 kHz mono float32 PCM\n";
    return 1;
  }

  Results results;
  auto& executor = bundle->GetExecutor();
  if (!check(executor.SetResultsCallback(callback, &results), "set callback")) return 1;

  auto& emotion = bundle->GetEmotionAccumulator(0);
  std::vector<float> neutralEmotion(emotion.GetEmotionSize(), 0.0f);
  if (!check(emotion.Accumulate(0, nva2x::HostTensorFloatConstView{neutralEmotion.data(), neutralEmotion.size()}, bundle->GetCudaStream().Data()), "set emotion")) return 1;
  if (!check(emotion.Close(), "close emotion")) return 1;

  auto& accumulator = bundle->GetAudioAccumulator(0);
  if (!check(accumulator.Accumulate(nva2x::HostTensorFloatConstView{audio.data(), audio.size()}, bundle->GetCudaStream().Data()), "accumulate audio")) return 1;
  if (!check(accumulator.Close(), "close audio")) return 1;

  while (nva2x::GetNbReadyTracks(executor) > 0) {
    if (!check(executor.Execute(nullptr), "execute Audio2Face")) return 1;
  }
  if (!check(executor.Wait(0), "wait for Audio2Face")) return 1;
  if (!check(bundle->GetCudaStream().Synchronize(), "synchronize Audio2Face")) return 1;

  if (!writeJson(argv[3], results.frames)) {
    std::cerr << "Unable to write output JSON\n";
    return 1;
  }
  std::cout << "Generated " << results.frames.size() << " Audio2Face frames\n";
  return 0;
}
