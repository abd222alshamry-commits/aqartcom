// Optional native CPU smoke test. This is not a browser/WebGPU certification.
// Uses pre-downloaded files only; never downloads a model during this test.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),K=require('../sol-knowledge.js');
import {AutoModelForCausalLM,Qwen2Tokenizer,env} from '@huggingface/transformers';
const directory=new URL('./sol-model-cache/strong/',import.meta.url).pathname;
env.allowRemoteModels=false;env.useFSCache=false;
globalThis.fetch=async()=>{throw Error('Network forbidden during Sol smoke test');};
// Minimal tokenizer metadata for this isolated native check. Production uses the pinned original tokenizer_config.json.
const tokenizer=new Qwen2Tokenizer(JSON.parse(fs.readFileSync(directory+'tokenizer.json','utf8')),{eos_token:'<|im_end|>',pad_token:'<|endoftext|>'});
const model=await AutoModelForCausalLM.from_pretrained(directory,{dtype:'q8',device:'cpu',local_files_only:true,session_options:{intraOpNumThreads:2}});
const question='كيف أضيف فندقًا في الموقع؟',memory=K.cleanMemory();
const messages=K.messages(question,K.retrieve(question,null,memory),null,memory);
const prompt=messages.map(m=>'<|im_start|>'+m.role+'\n'+m.content+'<|im_end|>\n').join('')+'<|im_start|>assistant\n<think>\n\n</think>\n\n';
const inputs=tokenizer(prompt),start=Date.now();
const output=await model.generate({...inputs,max_new_tokens:96,do_sample:false});
const answer=tokenizer.decode(output.tolist()[0].slice(inputs.input_ids.dims[1]),{skip_special_tokens:true});
console.log(JSON.stringify({device:'native CPU',offline:true,milliseconds:Date.now()-start,answer}));
if(!/[\u0600-\u06ff]/.test(answer))throw Error('Expected an Arabic answer');
await model.dispose();
