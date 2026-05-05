const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  collectProjectEditContext,
  parseAndWriteFiles,
  removePlanningTags,
} = require('../src/server/generatedProject');

async function makeTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'suorrable-generated-'));
}

test('parseAndWriteFiles writes file blocks and returns changed paths', async () => {
  const projectPath = await makeTempProject();
  const response = [
    '// FILE: package.json',
    '{"scripts":{"build":"vite build"}}',
    '// FILE: index.html',
    '<div id="root"></div>',
    '// FILE: src/main.tsx',
    'console.log("ready");',
  ].join('\n');

  const written = await parseAndWriteFiles(response, projectPath);

  assert.deepEqual(written.sort(), ['index.html', 'package.json', 'src/main.tsx']);
  assert.equal(await fs.readFile(path.join(projectPath, 'src', 'main.tsx'), 'utf8'), 'console.log("ready");');
});

test('parseAndWriteFiles rejects incomplete full projects', async () => {
  const projectPath = await makeTempProject();

  await assert.rejects(
    parseAndWriteFiles('// FILE: src/main.tsx\nconsole.log("missing package");', projectPath),
    /missing required file/
  );
});

test('removePlanningTags removes model-only planning wrappers', () => {
  const cleaned = removePlanningTags('<plan>Do things</plan>\n<loc>10</loc>\n// FILE: index.html\n<html></html>');

  assert.equal(cleaned, '// FILE: index.html\n<html></html>');
});

test('collectProjectEditContext excludes vercel state from source context', async () => {
  const projectPath = await makeTempProject();
  await fs.mkdir(path.join(projectPath, '.vercel'), { recursive: true });
  await fs.writeFile(path.join(projectPath, '.vercel', 'project.json'), '{"projectId":"secret"}');
  await fs.writeFile(path.join(projectPath, 'index.html'), '<div>visible</div>');

  const context = await collectProjectEditContext(projectPath, { prompt: 'index' });

  assert.match(context, /index\.html/);
  assert.doesNotMatch(context, /\.vercel/);
  assert.doesNotMatch(context, /secret/);
});
