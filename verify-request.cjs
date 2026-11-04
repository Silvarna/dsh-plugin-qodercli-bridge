require('./verify-host.cjs');
(async()=>{
  const {createServer}=require('node:http');
  const {once}=require('node:events');
  const {createRequestHandler}=await import('./index.js');
  // Use the plain config shape which exposed the missing volatile schema flag.
  const config={executable:'H:/.dsh/tools/qoder-cn/qoderclicn.exe',configDir:'H:/.dsh/tools/qoder-cn/config',model:'auto'};
  const server=createServer(createRequestHandler(config,'test-token'));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const padding = '背景资料无需复述 background context.\n'.repeat(2400);
    const body={model:process.env.TEST_MODEL || 'qoder-cn',messages:[{role:'system',content:padding},{role:'user',content:'Reply exactly CONFIG_FIX_OK.'}],stream:true};
    if(JSON.stringify(body).length<=32768)throw new Error('Regression fixture must exceed Windows command-line limit');
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{authorization:'Bearer test-token','content-type':'application/json'},body:JSON.stringify(body)});
    const text=await response.text();
    if(response.status!==200||!text.includes('CONFIG_FIX_OK')||!text.includes('[DONE]'))throw new Error(`Bridge request failed: ${response.status} ${text}`);
    console.log('Full HTTP request with plain configuration and >32K Unicode prompt: PASS');
  } finally {server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
