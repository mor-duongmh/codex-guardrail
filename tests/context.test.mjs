// tests/context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContext, ContextError } from '../lib/context.mjs';

const fixture = (n) =>
  readFileSync(new URL(`./fixtures/codex-events/${n}.json`, import.meta.url), 'utf8');

test('stdin rỗng thì ném ContextError (fail-closed)', () => {
  assert.throws(() => buildContext('', {}), ContextError);
  assert.throws(() => buildContext('   ', {}), ContextError);
});

test('JSON hỏng thì ném ContextError', () => {
  assert.throws(() => buildContext('{ "tool_name": ', {}), ContextError);
});

test('payload JSON hợp lệ nhưng không phải object (scalar/mảng/null) thì ném ContextError — không TypeError, không im lặng đoán', () => {
  for (const raw of ['null', 'true', '42', '"str"', '[]', '{}']) {
    assert.throws(() => buildContext(raw, {}), ContextError, `raw=${raw} phải ném ContextError`);
  }
});

test('object hợp lệ nhưng thiếu hook_event_name thì ném ContextError, không mặc định "unknown"', () => {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd: '/tmp/demo-repo', tool_input: { command: 'ls' } });
  assert.throws(() => buildContext(payload, {}), ContextError);
});

test('payload Bash thật (pre-bash-simple) cho ra event, tool và command', () => {
  const ctx = buildContext(fixture('pre-bash-simple'), {});
  assert.equal(ctx.event, 'PreToolUse');
  assert.equal(ctx.tool, 'Bash');
  assert.equal(ctx.command, 'ls -la');
});

test('payload Bash nối lệnh bằng && (pre-bash-chained) giữ nguyên command gốc', () => {
  const ctx = buildContext(fixture('pre-bash-chained'), {});
  assert.equal(ctx.tool, 'Bash');
  assert.ok(ctx.command.includes('&&'), 'command phải giữ nguyên chuỗi, chưa tách');
  assert.ok(ctx.command.includes('rm -- xoa.txt'));
});

test('payload apply_patch thật (Add File) trích đúng file đích từ tool_input.command', () => {
  const ctx = buildContext(fixture('pre-apply-patch-add'), {});
  assert.equal(ctx.tool, 'apply_patch');
  assert.deepEqual(ctx.patchFiles, ['/home/dev/repo/hello.txt']);
});

test('payload apply_patch thật (Update File) trích đúng file đích từ tool_input.command', () => {
  const ctx = buildContext(fixture('pre-apply-patch-update'), {});
  assert.equal(ctx.tool, 'apply_patch');
  assert.deepEqual(ctx.patchFiles, ['/home/dev/repo/sua.txt']);
});

test('apply_patch (Add File) không rò patch envelope vào ctx.command — envelope chỉ có ở patchBody', () => {
  const ctx = buildContext(fixture('pre-apply-patch-add'), {});
  assert.equal(ctx.command, null);
  // hồi quy: patchFiles và patchBody không bị ảnh hưởng bởi việc null hoá command
  assert.deepEqual(ctx.patchFiles, ['/home/dev/repo/hello.txt']);
  assert.ok(typeof ctx.patchBody === 'string' && ctx.patchBody.includes('Add File'));
});

test('apply_patch (Update File) không rò patch envelope vào ctx.command — envelope chỉ có ở patchBody', () => {
  const ctx = buildContext(fixture('pre-apply-patch-update'), {});
  assert.equal(ctx.command, null);
  // hồi quy: patchFiles và patchBody không bị ảnh hưởng bởi việc null hoá command
  assert.deepEqual(ctx.patchFiles, ['/home/dev/repo/sua.txt']);
  assert.ok(typeof ctx.patchBody === 'string' && ctx.patchBody.includes('Update File'));
});

test('Bash thật (pre-bash-simple, pre-bash-chained) vẫn có ctx.command là chuỗi lệnh — null hoá apply_patch không lan sang nhánh Bash', () => {
  const simple = buildContext(fixture('pre-bash-simple'), {});
  assert.equal(simple.command, 'ls -la');

  const chained = buildContext(fixture('pre-bash-chained'), {});
  assert.equal(typeof chained.command, 'string');
  assert.ok(chained.command.includes('&&'));
});

test('payload PostToolUse thật (post-bash-simple) trích được stdout từ tool_response dạng chuỗi thô', () => {
  const ctx = buildContext(fixture('post-bash-simple'), {});
  assert.equal(ctx.event, 'PostToolUse');
  assert.equal(ctx.tool, 'Bash');
  assert.ok(typeof ctx.stdout === 'string', 'ctx.stdout phải là chuỗi, không được null');
  assert.ok(ctx.stdout.includes('a.txt'));
});

test('payload SessionStart thật (không có tool_name/tool_input) dựng ctx an toàn, không văng lỗi', () => {
  const ctx = buildContext(fixture('session-start'), {});
  assert.equal(ctx.event, 'SessionStart');
  assert.equal(ctx.tool, 'unknown');
  assert.equal(ctx.command, null);
  assert.deepEqual(ctx.patchFiles, []);
  assert.equal(ctx.stdout, null);
});

test('escape đọc từ env, phân tách bằng dấu phẩy', () => {
  const ctx = buildContext(fixture('pre-bash-simple'),
    { CODEX_GUARDRAIL_ALLOW: 'infra.deny-binary, git.no-verify' });
  assert.ok(ctx.escapes.has('infra.deny-binary'));
  assert.ok(ctx.escapes.has('git.no-verify'));
  assert.equal(ctx.escapes.size, 2);
});

test('không có env thì escapes rỗng', () => {
  assert.equal(buildContext(fixture('pre-bash-simple'), {}).escapes.size, 0);
});

test('trích file đích từ header apply_patch dạng patch (nhiều file)', () => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: '/tmp/demo-repo',
    tool_input: { patch: '*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n' },
  });
  assert.deepEqual(buildContext(payload, {}).patchFiles.sort(), ['src/a.ts', 'src/b.ts']);
});

test('trích file đích từ unified diff, bỏ /dev/null', () => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: '/tmp/demo-repo',
    tool_input: { diff: '--- a/src/a.ts\n+++ b/src/a.ts\n--- x\n+++ /dev/null\n' },
  });
  assert.deepEqual(buildContext(payload, {}).patchFiles, ['src/a.ts']);
});

test('filesFromPatch bắt đủ bốn verb: Add, Update, Delete, Move (cả "Move File:" và "Move to:")', () => {
  const wrap = (cmd) => JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: '/tmp/demo-repo',
    tool_input: { command: cmd },
  });

  assert.deepEqual(
    buildContext(wrap('*** Begin Patch\n*** Add File: src/a.ts\n+hi\n*** End Patch'), {}).patchFiles,
    ['src/a.ts']
  );
  assert.deepEqual(
    buildContext(wrap('*** Begin Patch\n*** Update File: src/b.ts\n@@\n-x\n+y\n*** End Patch'), {}).patchFiles,
    ['src/b.ts']
  );
  assert.deepEqual(
    buildContext(wrap('*** Begin Patch\n*** Delete File: src/c.ts\n*** End Patch'), {}).patchFiles,
    ['src/c.ts']
  );
  assert.deepEqual(
    buildContext(wrap('*** Begin Patch\n*** Move File: src/d.ts\n*** End Patch'), {}).patchFiles,
    ['src/d.ts']
  );
});

test('filesFromPatch bắt "Move to:" (cú pháp rename thật của apply_patch) — Update File + Move to ra cả hai path', () => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: '/tmp/demo-repo',
    tool_input: {
      command: '*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-x\n+y\n*** End Patch',
    },
  });
  assert.deepEqual(buildContext(payload, {}).patchFiles.sort(), ['src/new.ts', 'src/old.ts']);
});
