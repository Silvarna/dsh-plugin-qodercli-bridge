import z from '@deepseek-ai/schemastery';
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { runCli, invokeQoder } from './transport.js';
import { parseModels, modelId } from './models.js';

export const name = 'llm-qoder-cn';
export const inject = ['llm'];
export const Config = z.object({
  executable: z.string().default('H:\\.dsh\\tools\\qoder-cn\\qoderclicn.exe').volatile(),
  configDir: z.string().default('H:\\.dsh\\tools\\qoder-cn\\config').volatile(),
  model: z.string().default('auto').volatile(),
});
class QoderAdapter extends PiAiAdapter {
  async listModels(...args) { return (await super.listModels(...args)).filter(model=>model.id!=='qoder-cn'); }
}
export function createRequestHandler(refs, token) {
  const value = key => typeof refs[key]?.get === 'function' ? refs[key].get() : refs[key];
  return async (req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { res.writeHead(401).end(); return; }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1048576) throw new Error('Request too large'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const selectedModel = body.model && body.model !== 'qoder-cn' ? body.model : value('model');
      const args = ['--config-dir', value('configDir'), '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--model', selectedModel, '--input-format', 'text', '-p'];
      const reply = await invokeQoder(value('executable'), args, body, {signal:controller.signal});
      if (body.tool_choice === 'none' && reply.tool_calls?.length) throw new Error('Qoder requested a tool while tool_choice is none');
      if (body.tool_choice?.function?.name && (!reply.tool_calls?.length || reply.tool_calls.some(c => c.function.name !== body.tool_choice.function.name))) throw new Error('Qoder did not follow required tool_choice');
      const id = `chatcmpl-${randomBytes(8).toString('hex')}`;
      const finish_reason = reply.tool_calls?.length ? 'tool_calls' : 'stop';
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const event = (delta, finish) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        const delta = { ...reply };
        if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map((call, index) => ({ index, ...call }));
        res.end(event(delta, null) + event({}, finish_reason) + 'data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', choices: [{ index: 0, message: reply, finish_reason }] }));
      }
    } catch (error) {
      if (!res.destroyed) res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } }));
    }
  };
}
export function apply(ctx, refs) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(createRequestHandler(refs, token));
  let release;
  let stopped = false, refreshTimer;
  server.listen(0, '127.0.0.1', () => {
    const providerId = 'qoder-cn';
    const descriptor = { provider: providerId, api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { maxTokensField: 'max_tokens' } };
    let models = [{ ...descriptor, id: 'qoder-cn', name: 'Qoder CN' },{...descriptor,id:'auto',name:'Auto'}];
    const provider = createProvider({ id: providerId, name: 'Qoder CN', models, api: openAICompletionsApi(), auth: { apiKey: { name: 'Local bridge', async resolve() { return { auth: { apiKey: token }, source: 'local' }; } } } });
    let profile = { provider: providerId, displayName: 'Qoder CN', streamIdleTimeoutMs: 200000, retryPolicy: resolveRetryPolicy(undefined, name), configuredMaxTokens: new Map(), modelErrors: new Map(), maxRequestImageBytes: 20971520, requestImagePixelBudget: 4194304, requestImageMaxBytes: 1048576, piProvider: {...provider,getModels:()=>models} };
    let profiles = new Map([[providerId, profile]]);
    const adapter = new QoderAdapter({ profiles: () => profiles, resolveApiKey: async () => token, auth: { credentials: { async read() {}, async list() { return []; }, async modify() { throw new Error('Use Qoder login'); }, async delete() {} }, authContext: { async env() {}, async fileExists() { return false; } } } });
    release = ctx.llm.registerAdapter([providerId], adapter);
    ctx.emit('llm/adapters-updated');
    const config = key => typeof refs[key]?.get === 'function' ? refs[key].get() : refs[key];
    const refresh = async () => {
      try {
        const names = parseModels(await runCli(config('executable'), ['--config-dir',config('configDir'),'--list-models'],{timeoutMs:30000}));
        if(stopped || !names.length) return;
        models = [{...descriptor,id:'qoder-cn',name:'Qoder CN'},...names.map(n=>({...descriptor,id:modelId(n),name:n}))];
        profile = {...profile}; profiles = new Map([[providerId,profile]]);
        ctx.emit('llm/adapters-updated');
      } catch(error) { if(!stopped)ctx.logger.error(`Qoder model discovery: ${error.message}`); }
    };
    void refresh();refreshTimer=setInterval(refresh,300000);refreshTimer.unref();
  });
  server.on('error', error => ctx.logger.error(error));
  ctx.effect(() => () => { stopped=true;clearInterval(refreshTimer);release?.(); server.closeAllConnections(); server.close(); });
}
