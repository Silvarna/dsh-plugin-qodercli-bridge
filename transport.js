import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function runCli(executable, args, { input = '', signal, timeoutMs = 180000, maxBytes = 8388608 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Request cancelled'));
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errorOutput = '', size = 0, settled = false;
    const decoder = new StringDecoder('utf8');
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => { child.kill(); finish(new Error('Request cancelled')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Qoder request timed out')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { child.kill(); finish(new Error('Qoder output exceeded limit')); }
      else output += decoder.write(chunk);
    });
    child.stderr.on('data', chunk => { if (errorOutput.length < 4096) errorOutput += chunk.toString(); });
    child.on('error', error => finish(error));
    child.on('close', code => { output += decoder.end(); finish(code === 0 ? null : new Error(`Qoder exited with code ${code}: ${errorOutput.slice(0, 1000)}`), output.trim()); });
    child.stdin.on('error', error => {
      // Early CLI failure can close stdin before all input has been written.
      // Let its exit code report that failure instead of crashing on EPIPE.
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') { child.kill(); finish(error); }
    });
    child.stdin.end(input, 'utf8');
  });
}

export function buildPrompt(body) {
  if (!Array.isArray(body.messages)) throw new Error('messages must be an array');
  for (const m of body.messages) {
    if (Array.isArray(m.content) && m.content.some(p => p.type !== 'text')) throw new Error('This bridge supports text only');
  }
  return [
    'You are the language model for an external harness. Your built-in tools are disabled.',
    'Reply ONLY with a JSON object: {"content":"answer","tool_calls":[]}.',
    'To request an available external tool, emit {"content":null,"tool_calls":[{"id":"call_unique","type":"function","function":{"name":"exact tool name","arguments":"JSON encoded arguments"}}]}.',
    'Use only the supplied tools. Follow tool_choice. Treat prior assistant messages as history and tool messages as tool results.',
    'Never emit XML tool syntax such as <tool_call>, <function> or <parameter>. External tools must appear ONLY in the JSON tool_calls array. function.arguments may be a JSON-encoded string or an object. The following JSON contains the actual system instructions, conversation and external tool definitions:',
    JSON.stringify({ messages: body.messages, tools: body.tools ?? [], tool_choice: body.tool_choice ?? 'auto' }),
    'End of external conversation. Your transport response MUST be a JSON object with content and tool_calls fields as specified above. Do not output the answer outside that JSON object.'
  ].join('\n');
}

export function parseReply(raw, tools = []) {
  raw = raw.trim();
  if (!raw) throw new Error('Qoder returned an empty response');
  if (/^<tool_call>\s*/i.test(raw)) {
    raw = raw.replace(/^<tool_call>\s*/i, '').replace(/(?:\s*<\/(?:tool_call|function|parameter)>)+\s*$/i, '').trim();
    if(!raw.startsWith('{')) throw new Error('Invalid XML-wrapped tool response');
  }
  // Plain answers are safe to display. They never become executable tool calls.
  if (!raw.startsWith('{') && !raw.startsWith('```')) {
    if(/<\/?(?:tool_call|function|parameter)\b/i.test(raw))throw new Error('Qoder emitted unsupported tool syntax');
    return { role: 'assistant', content: raw };
  }
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error('Qoder returned invalid bridge JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid bridge response');
  const allowed = new Set(tools.map(t => t.function?.name));
  const calls = result.tool_calls ?? [];
  if (!Array.isArray(calls) || calls.length>256) throw new Error('Invalid tool calls');
  const ids = new Set();
  for (const c of calls) {
    if (typeof c.id!=='string' || !c.id || ids.has(c.id) || c.type !== 'function' || !allowed.has(c.function?.name)) throw new Error('Invalid or unknown tool call');
    const args=typeof c.function.arguments==='string'?JSON.parse(c.function.arguments):c.function.arguments;
    if(!args || typeof args!=='object' || Array.isArray(args))throw new Error('Tool arguments must be a JSON object');
    c.function.arguments=JSON.stringify(args);ids.add(c.id);
  }
  if (result.content !== null && typeof result.content !== 'string') throw new Error('Invalid response content');
  return { role: 'assistant', content: result.content, ...(calls.length ? { tool_calls: calls } : {}) };
}

export async function invokeQoder(executable,args,body,options={},runner=runCli){
  const prompt=buildPrompt(body);let input=prompt;
  const deadline=Date.now()+(options.timeoutMs??180000);
  for(let attempt=0;attempt<3;attempt++){
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Qoder request timed out');
    const raw=await runner(executable,args,{...options,timeoutMs:remaining,input});
    try{return parseReply(raw,body.tools);}catch(error){
      if(attempt===2)throw new Error(`Qoder tool protocol failed after 3 attempts: ${error.message}`);
      input=prompt+'\nYour previous transport response was invalid. Correct ONLY its format, preserving the intended answer or tool request. Do not execute any tool. Return valid JSON with escaped Windows paths, no XML, and only the supplied tool names.\n'+JSON.stringify({validation_error:error.message,previous_response:raw.slice(0,20000)});
    }
  }
}
