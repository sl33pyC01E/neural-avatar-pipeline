#include "features.h"
#include <fstream>
int main(int argc,char** argv){
  if(argc!=3)return 2;
  std::ifstream in(argv[1],std::ios::binary|std::ios::ate);size_t size=in.tellg();in.seekg(0);
  std::vector<float> audio(size/sizeof(float));in.read(reinterpret_cast<char*>(audio.data()),size);
  auto mel=cleo::WhisperFeatures()(audio);
  std::ofstream out(argv[2],std::ios::binary);out.write(reinterpret_cast<const char*>(mel.data()),mel.size()*sizeof(float));
}
