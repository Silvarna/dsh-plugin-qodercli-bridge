const {registerHooks}=require('node:module');
const {pathToFileURL}=require('node:url');
const root=pathToFileURL('H:/Program Files/DeepSeek Harness/resources/app.asar/dsh/entry.js').href;
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@deepseek-ai/')||specifier.startsWith('@earendil-works/'))return next(specifier,{...context,parentURL:root});
  return next(specifier,context);
}});
(async()=>{
  const plugin=await import('./index.js');
  let cleanup,registered=false;
  let adapter;
  const ctx={llm:{registerAdapter(ids,a){registered=true;adapter=a;console.log('Registered',ids);return()=>{};}},emit(){if(adapter)Promise.resolve(adapter.listModels('qoder-cn')).then(models=>console.log('Model snapshot',JSON.stringify(models))).catch(e=>{console.error(e);process.exitCode=1;});},logger:{error(e){console.error(e);process.exitCode=1;}},effect(fn){cleanup=fn();}};
  plugin.apply(ctx,{executable:{get:()=> 'H:/.dsh/tools/qoder-cn/qoderclicn.exe'},configDir:{get:()=> 'H:/.dsh/tools/qoder-cn/config'},model:{get:()=> 'auto'}});
  setTimeout(()=>{cleanup();if(!registered)process.exitCode=1;},process.env.VERIFY_MODELS?8000:500);
})().catch(e=>{console.error(e);process.exitCode=1;});
