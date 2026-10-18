import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNodeRuntime } from './node-runtime.mjs';

test('uses the current supported runtime without probing other executables', () => {
  assert.equal(selectNodeRuntime({env:{},executable:'/current/node',version:'v24.0.0',probe:()=>assert.fail('unexpected probe')}),'/current/node');
});
test('Node 16 selects the available bundled Node 24 before loading TypeScript', () => {
  const bundled=join('/test-home','.cache','codex-runtimes','codex-primary-runtime','dependencies','node','bin','node');
  const selected=selectNodeRuntime({env:{PATH:'/old'},home:'/test-home',platform:'darwin',executable:'/old/node',version:'v16.20.2',probe:path=>path===bundled?'v24.19.0':'v16.20.2'});
  assert.equal(selected,bundled);
});
test('respects an explicit runtime and reports invalid overrides', () => {
  assert.equal(selectNodeRuntime({env:{WUSAN_NODE_BINARY:'/custom/node'},probe:()=> 'v24.1.0'}),'/custom/node');
  assert.throws(()=>selectNodeRuntime({env:{WUSAN_NODE_BINARY:'/missing/node'},probe:()=>''}),/WUSAN_NODE_BINARY/);
});
test('falls back to PATH and reports an actionable error when no runtime is supported', () => {
  const options={env:{PATH:'/new'},home:'/empty',platform:'darwin',executable:'/old/node',version:'v16.20.2'};
  assert.equal(selectNodeRuntime({...options,probe:path=>path==='/new/node'?'v24.1.0':''}),'/new/node');
  assert.throws(()=>selectNodeRuntime({...options,probe:()=> 'v16.20.2'}),/Node.js 24.*v16.20.2/);
});
test('runner forwards arguments and exit codes', () => {
  const runner=fileURLToPath(new URL('./run.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[runner,'-e','console.log(process.argv[1]);process.exit(7);','value with spaces'],{encoding:'utf8'});
  assert.equal(result.status,7);assert.equal(result.stdout.trim(),'value with spaces');
});
