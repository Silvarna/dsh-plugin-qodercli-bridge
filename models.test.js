import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModels,modelId} from './models.js';
test('parses CLI model catalog without headers, duplicates or diagnostics',()=>{
  assert.deepEqual(parseModels('MODEL\r\nAuto\r\nFast\r\nQwen3.8-Flash\r\nQwen3.8-Flash\nNot logged in. Run login\n'),['Auto','Fast','Qwen3.8-Flash']);
  assert.equal(modelId('Auto'),'auto');assert.equal(modelId('Fast'),'fast');assert.equal(modelId('DeepSeek-V4-Pro'),'DeepSeek-V4-Pro');
});
