export const modelPipelines={
  'gpu-npu':{backend:'llama-hexagon',llamaEncoder:'gpu',label:'GPU encode → NPU decode'},
  'gpu-gpu':{backend:'llama-opencl',llamaEncoder:'gpu',label:'GPU encode → GPU decode'},
  'gpu-cpu':{backend:'llama-cpu',llamaEncoder:'gpu',label:'GPU encode → CPU decode'},
  'cpu-cpu':{backend:'llama-cpu',llamaEncoder:'cpu',label:'CPU encode → CPU decode'}
};
export function migrateModelSettings(saved){
  // Old releases stored independent devices and LiteRT choices. Start the new
  // four-pairing policy at its requested default, preserving budgets/model choice.
  const result={...saved};
  if(!modelPipelines[result['chat-pipeline']])result['chat-pipeline']='gpu-npu';
  delete result['chat-backend'];delete result['chat-llama-encoder'];return result;
}
