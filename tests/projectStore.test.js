const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  resolveInside,
} = require('../src/server/projectStore');

test('resolveInside allows normalized relative paths', () => {
  const baseDir = path.join(os.tmpdir(), 'suorrable-test-project');
  const resolved = resolveInside(baseDir, './src\\main.tsx');

  assert.equal(resolved, path.join(baseDir, 'src', 'main.tsx'));
});

test('resolveInside rejects directory traversal', () => {
  const baseDir = path.join(os.tmpdir(), 'suorrable-test-project');

  assert.throws(() => resolveInside(baseDir, '../outside.js'), /escapes project directory/);
});

test('resolveInside rejects absolute paths and drive paths', () => {
  const baseDir = path.join(os.tmpdir(), 'suorrable-test-project');

  assert.throws(() => resolveInside(baseDir, path.resolve(os.tmpdir(), 'outside.js')), /Unsafe generated file path/);
  assert.throws(() => resolveInside(baseDir, 'C:/outside.js'), /Unsafe generated file path/);
});
