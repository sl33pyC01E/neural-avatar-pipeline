#include <jni.h>
#include <ctranslate2/models/whisper.h>
#include <memory>
#include <string>
#include <unordered_map>
#include "features.h"

namespace {
struct Engine {
  ctranslate2::models::Whisper model;
  cleo::WhisperFeatures features;
  explicit Engine(const std::string& path):model(path,ctranslate2::Device::CPU,ctranslate2::ComputeType::INT8_FLOAT32,{0},false,{2,1,-1}){}
};
void error(JNIEnv* env,const std::exception& e){env->ThrowNew(env->FindClass("java/io/IOException"),e.what());}
std::string bytes(const std::vector<std::string>& tokens){
  std::unordered_map<int,unsigned char> reverse;int extra=0;
  for(int b=0;b<256;b++){bool direct=(b>=33&&b<=126)||(b>=161&&b<=172)||(b>=174);reverse[direct?b:256+extra++]=b;}
  std::string result;
  for(const auto& token:tokens){
    if(token.rfind("<|",0)==0&&token.size()>=4&&token.substr(token.size()-2)=="|>")continue;
    for(size_t i=0;i<token.size();){
      unsigned char lead=token[i++];int cp=lead,n=0;
      if(lead>=0xf0){cp=lead&7;n=3;}else if(lead>=0xe0){cp=lead&15;n=2;}else if(lead>=0xc0){cp=lead&31;n=1;}
      while(n--){if(i==token.size())throw std::runtime_error("Invalid token UTF-8");cp=(cp<<6)|(token[i++]&63);}
      auto it=reverse.find(cp);if(it==reverse.end())throw std::runtime_error("Unexpected Whisper vocabulary character");result+=static_cast<char>(it->second);
    }
  }
  return result;
}
}
extern "C" JNIEXPORT jlong JNICALL Java_ai_cleo_ardyavatarvalidation_WhisperXRuntime_nativeLoad(JNIEnv* env,jclass,jstring path){
  const char* raw=env->GetStringUTFChars(path,nullptr);if(!raw)return 0;
  std::string value(raw);env->ReleaseStringUTFChars(path,raw);
  try{return reinterpret_cast<jlong>(new Engine(value));}catch(const std::exception& e){error(env,e);return 0;}
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_ai_cleo_ardyavatarvalidation_WhisperXRuntime_nativeTranscribe(JNIEnv* env,jclass,jlong handle,jfloatArray samples){
  try{
    if(!handle)throw std::runtime_error("WhisperX is unloaded");auto& engine=*reinterpret_cast<Engine*>(handle);
    std::vector<float> audio(env->GetArrayLength(samples));env->GetFloatArrayRegion(samples,0,audio.size(),audio.data());
    auto mel=engine.features(audio);ctranslate2::StorageView input({1,80,3000},mel);
    ctranslate2::models::WhisperOptions options;options.beam_size=1;options.return_scores=true;options.return_no_speech_prob=true;
    std::vector<std::vector<std::string>> prompts={{"<|startoftranscript|>","<|notimestamps|>"}};
    auto result=engine.model.generate(input,prompts,options).front().get();
    std::string text;
    if(!(result.no_speech_prob>.6f&&!result.scores.empty()&&result.scores[0]<-1.f)&&!result.sequences.empty())text=bytes(result.sequences[0]);
    jbyteArray output=env->NewByteArray(text.size());if(output)env->SetByteArrayRegion(output,0,text.size(),reinterpret_cast<const jbyte*>(text.data()));return output;
  }catch(const std::exception& e){error(env,e);return nullptr;}
}
extern "C" JNIEXPORT void JNICALL Java_ai_cleo_ardyavatarvalidation_WhisperXRuntime_nativeClose(JNIEnv*,jclass,jlong handle){delete reinterpret_cast<Engine*>(handle);}
