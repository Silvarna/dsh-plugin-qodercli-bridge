require('./verify-host.cjs');
(async()=>{
 const {createServer}=require('node:http');const {once}=require('node:events');
 const {createRequestHandler}=await import('./index.js');
 const server=createServer(createRequestHandler({executable:'H:/.dsh/tools/qoder-cn/qoderclicn.exe',configDir:'H:/.dsh/tools/qoder-cn/config',model:'auto'},'test-token'));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const tools=[{type:'function',function:{name:'bridge_echo',description:'Echo supplied text',parameters:{type:'object',properties:{text:{type:'string'}},required:['text']}}}];
 const messages=[{role:'user',content:'Call bridge_echo with text TOOL_PROTOCOL_OK. You must request the external tool before giving a final answer.'}];
 async function request(){
  const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`,{method:'POST',headers:{authorization:'Bearer test-token','content-type':'application/json'},body:JSON.stringify({model:process.env.TEST_MODEL||'auto',messages,tools,stream:true})});
  const text=await r.text();if(!r.ok)throw new Error(text);
  const events=text.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));
  return events[0].choices[0].delta;
 }
 try{
  const first=await request();const call=first.tool_calls?.[0];
  if(call?.function?.name!=='bridge_echo'||typeof call.function.arguments!=='string')throw new Error('Expected structured tool call');
  if(JSON.parse(call.function.arguments).text!=='TOOL_PROTOCOL_OK')throw new Error('Invalid arguments');
  console.log('HTTP SSE structured tool call: PASS');
  messages.push({...first,role:'assistant',tool_calls:first.tool_calls.map(({index,...call})=>call)},{role:'tool',tool_call_id:call.id,content:'TOOL_PROTOCOL_OK'},{role:'user',content:'Now reply with TOOL_PROTOCOL_OK only. No further tools.'});
  const second=await request();if(second.tool_calls?.length||!second.content?.includes('TOOL_PROTOCOL_OK'))throw new Error('Tool result round trip failed');
  console.log('HTTP SSE tool result round trip: PASS');
 }finally{server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
