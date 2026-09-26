// Whisper's 16 kHz / 80-bin Slaney log-mel frontend.
// Equations follow OpenAI Whisper (MIT) and faster-whisper (MIT).
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <stdexcept>
#include <vector>

namespace cleo {
class WhisperFeatures {
  using C = std::complex<float>;
  std::array<C,400> roots;
  std::array<float,400> window;
  std::array<std::array<float,201>,80> filters{};
  void fft(const float* input, int stride, C* output, int n) const {
    if(n==1){output[0]=*input;return;}
    int radix=n%2==0?2:5, m=n/radix;
    std::array<C,400> inner;
    for(int r=0;r<radix;r++)fft(input+r*stride,stride*radix,inner.data()+r*m,m);
    for(int k=0;k<n;k++){
      C value{};
      for(int r=0;r<radix;r++)value+=inner[r*m+k%m]*roots[(r*k*(400/n))%400];
      output[k]=value;
    }
  }
public:
  WhisperFeatures(){
    constexpr double pi=3.14159265358979323846;
    for(int i=0;i<400;i++){roots[i]=C(std::cos(-2*pi*i/400),std::sin(-2*pi*i/400));window[i]=.5-.5*std::cos(2*pi*i/400);}
    std::array<double,82> hz;
    double maxmel=15+std::log(8.0)/(std::log(6.4)/27);
    for(int i=0;i<82;i++){double mel=maxmel*i/81;hz[i]=mel<15?mel*(200.0/3):1000*std::exp((mel-15)*std::log(6.4)/27);}
    for(int b=0;b<80;b++)for(int k=0;k<=200;k++){
      double f=k*40.0;
      filters[b][k]=std::max(0.0,std::min((f-hz[b])/(hz[b+1]-hz[b]),(hz[b+2]-f)/(hz[b+2]-hz[b+1])))*2/(hz[b+2]-hz[b]);
    }
  }
  std::vector<float> operator()(const std::vector<float>& audio)const{
    if(audio.empty()||audio.size()>480000)throw std::invalid_argument("Whisper chunks must contain 1..480000 samples");
    std::vector<float> mel(80*3000,-10.f);
    std::array<float,400> frame;std::array<C,400> spectrum;float maximum=-10.f;
    for(int t=0;t<3000;t++){
      if(t*160-200>=static_cast<int>(audio.size()))break;
      for(int i=0;i<400;i++){
        int sample=t*160+i-200;
        if(sample<0)sample=-sample;
        if(sample>=480000)sample=959998-sample;
        frame[i]=(sample<static_cast<int>(audio.size())?audio[sample]:0.f)*window[i];
      }
      fft(frame.data(),1,spectrum.data(),400);
      for(int b=0;b<80;b++){
        double sum=0;
        for(int k=0;k<=200;k++)sum+=std::norm(spectrum[k])*filters[b][k];
        float value=std::log10(std::max(sum,1e-10));mel[b*3000+t]=value;maximum=std::max(maximum,value);
      }
    }
    for(float& value:mel)value=(std::max(value,maximum-8.f)+4.f)/4.f;
    return mel;
  }
};
}
