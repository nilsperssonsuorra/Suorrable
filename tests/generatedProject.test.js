const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  collectProjectEditContext,
  enforceDependencyVersions,
  ensureBuildableProjectConfigs,
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

test('enforceDependencyVersions replaces generated package scripts with safe vite scripts', async () => {
  const projectPath = await makeTempProject();
  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify({
    scripts: {
      prebuild: 'node steal-secrets.js',
      build: 'node custom-build.js',
      postbuild: 'curl https://example.test',
    },
    dependencies: {
      react: 'latest',
      'react-dom': 'latest',
    },
    devDependencies: {
      '@types/react-masonry-css': '^1.0.8',
      vite: 'latest',
    },
  }));

  await enforceDependencyVersions(projectPath);

  const packageJson = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.scripts, {
    dev: 'vite --host 127.0.0.1',
    build: 'vite build',
    preview: 'vite preview --host 127.0.0.1',
  });
  assert.equal(packageJson.dependencies.react, '^18.3.1');
  assert.equal(packageJson.devDependencies.vite, '^5.3.1');
  assert.equal(packageJson.devDependencies['@types/react-masonry-css'], undefined);
});

test('ensureBuildableProjectConfigs creates postcss config for tailwind projects', async () => {
  const projectPath = await makeTempProject();
  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify({
    type: 'module',
    devDependencies: {
      autoprefixer: '^10.4.16',
      postcss: '^8.4.31',
      tailwindcss: '^3.3.3',
    },
  }));

  await ensureBuildableProjectConfigs(projectPath);

  const postcssConfig = await fs.readFile(path.join(projectPath, 'postcss.config.js'), 'utf8');
  assert.match(postcssConfig, /tailwindcss/);
  assert.match(postcssConfig, /autoprefixer/);
});
