import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runCli, buildPrompt, parseReply,invokeQoder } from './transport.js';
test('keeps conversation roles and external tool results', () => {
  const messages = [{ role: 'system', content: 'test' }, { role: 'tool', tool_call_id: 'call_1', content: '42' }];
  assert.deepEqual(JSON.parse(buildPrompt({ messages }).split('\n').at(-2)).messages, messages);
});
test('validates external tool calls and argument JSON', () => {
  const tools = [{ function: { name: 'read_file' } }];
  const raw = JSON.stringify({ content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] });
  assert.equal(parseReply(raw, tools).tool_calls[0].function.name, 'read_file');
  assert.throws(() => parseReply(raw, []), /unknown/);
  assert.throws(() => parseReply('{broken JSON'), /invalid bridge JSON/);
  assert.equal(parseReply('Direct answer').content, 'Direct answer');
});
test('rejects image input instead of silently dropping it', () => {
  assert.throws(() => buildPrompt({ messages: [{ content: [{ type: 'image_url' }] }] }), /text only/);
});
test('executes without shell interpretation and reports process failures', async () => {
  assert.equal(await runCli(process.execPath, ['-e', 'console.log(process.argv[1])', 'a & echo unsafe']), 'a & echo unsafe');
  await assert.rejects(runCli(process.execPath, ['-e', 'process.exit(7)']), /code 7/);
});
test('terminates timed out and cancelled subprocesses', async () => {
  await assert.rejects(runCli(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 50 }), /timed out/);
  const controller = new AbortController();
  const pending = runCli(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});
test('pipes large Unicode prompts intact without putting them in arguments', async () => {
  const input = '系统提示与工具定义🔧\n'.repeat(16000);
  assert.ok(input.length > 28000);
  const expected = createHash('sha256').update(input).digest('hex');
  const result = await runCli(process.execPath, ['-e', "let chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>console.log(require('crypto').createHash('sha256').update(Buffer.concat(chunks)).digest('hex')));"], { input });
  assert.equal(result, expected);
});
test('unwraps screenshot tool syntax and serializes object arguments for DSH',()=>{
  const result=parseReply('<tool_call>'+JSON.stringify({content:'检查文件',tool_calls:[{id:'call_00',type:'function',function:{name:'glob',arguments:{path:'H:\\.dsh',pattern:'*.json'}}}]})+'</parameter></function></tool_call>',[{function:{name:'glob'}}]);
  assert.equal(result.tool_calls[0].function.arguments,JSON.stringify({path:'H:\\.dsh',pattern:'*.json'}));
  assert.equal(result.content,'检查文件');
});
test('malformed tool syntax is rejected rather than displayed as a completed answer',()=>{
  assert.throws(()=>parseReply('<tool_call>{broken}</tool_call>'),/invalid bridge JSON/);
  assert.throws(()=>parseReply('I will call <function=glob>'),/unsupported tool syntax/);
});
test('requests protocol repair before returning a tool call',async()=>{
  let count=0;
  const body={messages:[{role:'user',content:'test'}],tools:[{function:{name:'glob'}}]};
  const result=await invokeQoder('unused',[],body,{},async(exe,args,options)=>{
    count++;if(count===1)return '<tool_call>{broken}</tool_call>';
    assert.ok(options.input.includes('previous_response'));
    return JSON.stringify({content:null,tool_calls:[{id:'x',type:'function',function:{name:'glob',arguments:{path:'H:\\.dsh'}}}]});
  });
  assert.equal(count,2);assert.equal(result.tool_calls[0].function.name,'glob');
});
