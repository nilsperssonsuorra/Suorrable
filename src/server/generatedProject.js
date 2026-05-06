const fs = require('fs').promises;
const path = require('path');
const { REQUIRED_GENERATED_FILES } = require('./config');
const { resolveInside } = require('./projectStore');

const ALLOWED_GENERATED_TYPE_PACKAGES = new Set([
  '@types/node',
  '@types/react',
  '@types/react-dom',
]);

function cleanFileContent(content) {
  if (typeof content !== 'string') return '';

  const trimmedContent = content.trim();
  if (trimmedContent.startsWith('```') && trimmedContent.endsWith('```')) {
    const lines = trimmedContent.split('\n');
    return lines.slice(1, -1).join('\n');
  }

  return content;
}

function removePlanningTags(responseText) {
  return responseText
    .replace(/<plan>[\s\S]*?<\/plan>/, '')
    .replace(/<loc>[\s\S]*?<\/loc>/, '')
    .trim();
}

async function parseAndWriteFiles(responseText, projectPath, options = {}) {
  const { requireFullProject = true } = options;
  console.log('[PARSER] Starting to parse AI response and write files...');
  const writePromises = [];
  const writtenFiles = new Set();
  const fileMarkers = Array.from(responseText.matchAll(/^\/\/\s*FILE:\s*(.+?)\s*$/gm));

  for (let i = 0; i < fileMarkers.length; i++) {
    const marker = fileMarkers[i];
    const filePath = marker[1].trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    const contentStart = marker.index + marker[0].length;
    const contentEnd = i + 1 < fileMarkers.length ? fileMarkers[i + 1].index : responseText.length;
    const fileContent = cleanFileContent(responseText.slice(contentStart, contentEnd).replace(/^\r?\n/, ''));

    if (!filePath || writtenFiles.has(filePath)) continue;

    const absoluteFilePath = resolveInside(projectPath, filePath);
    const directoryPath = path.dirname(absoluteFilePath);
    const writePromise = fs.mkdir(directoryPath, { recursive: true })
      .then(() => fs.writeFile(absoluteFilePath, fileContent))
      .then(() => writtenFiles.add(filePath));
    writePromises.push(writePromise);
  }

  await Promise.all(writePromises);

  if (writtenFiles.size === 0) {
    throw new Error('Code parsing failed. The AI response did not contain any valid `// FILE:` blocks.');
  }

  if (requireFullProject) {
    const missingFiles = REQUIRED_GENERATED_FILES.filter(filePath => !writtenFiles.has(filePath));
    const hasEntryPoint = Array.from(writtenFiles).some(filePath => (
      /^src\/main\.(tsx|ts|jsx|js)$/i.test(filePath.replace(/\\/g, '/'))
    ));

    if (missingFiles.length > 0 || !hasEntryPoint) {
      const requiredSummary = [
        ...missingFiles,
        ...(hasEntryPoint ? [] : ['src/main.tsx']),
      ].join(', ');
      throw new Error(`Generated project is missing required file(s): ${requiredSummary}.`);
    }
  }

  console.log(`[PARSER] Finished writing ${writtenFiles.size} files.`);
  return Array.from(writtenFiles);
}

async function enforceDependencyVersions(projectPath) {
  console.log('[CONFIG] Enforcing stable dependency versions...');
  const packageJsonPath = path.join(projectPath, 'package.json');

  try {
    const fileContent = await fs.readFile(packageJsonPath, 'utf8');
    const jsonMatch = fileContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No valid JSON object found in package.json.');

    const packageJson = JSON.parse(jsonMatch[0]);
    const stableDependencies = { react: '^18.3.1', 'react-dom': '^18.3.1' };
    const stableDevDependencies = {
      vite: '^5.3.1',
      '@vitejs/plugin-react': '^4.3.1',
      '@types/react': '^18.3.3',
      '@types/react-dom': '^18.3.0',
      typescript: '^5.5.3',
    };

    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.devDependencies = packageJson.devDependencies || {};
    packageJson.scripts = {
      dev: 'vite --host 127.0.0.1',
      build: 'vite build',
      preview: 'vite preview --host 127.0.0.1',
    };

    for (const packageName of Object.keys(packageJson.devDependencies)) {
      if (packageName.startsWith('@types/') && !ALLOWED_GENERATED_TYPE_PACKAGES.has(packageName)) {
        delete packageJson.devDependencies[packageName];
      }
    }

    for (const [pkg, version] of Object.entries(stableDependencies)) {
      if (packageJson.dependencies[pkg]) packageJson.dependencies[pkg] = version;
    }

    for (const [pkg, version] of Object.entries(stableDevDependencies)) {
      if (packageJson.devDependencies[pkg]) packageJson.devDependencies[pkg] = version;
    }

    packageJson.devDependencies.vite = packageJson.devDependencies.vite || stableDevDependencies.vite;
    packageJson.devDependencies['@vitejs/plugin-react'] =
      packageJson.devDependencies['@vitejs/plugin-react'] || stableDevDependencies['@vitejs/plugin-react'];

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('[CONFIG] Successfully updated package.json.');
  } catch (error) {
    throw new Error(`Could not update package.json: ${error.message}`);
  }
}

async function ensureBuildableProjectConfigs(projectPath) {
  console.log('[CONFIG] Enforcing standard build configurations...');

  let packageJson = {};
  try {
    packageJson = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'));
  } catch {
    packageJson = {};
  }

  const viteConfigContent = [
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    '',
    "export default defineConfig({ plugins: [react()], base: './', build: { outDir: 'dist' } });",
  ].join('\n');

  await fs.writeFile(path.join(projectPath, 'vite.config.ts'), viteConfigContent);

  const allDependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  if (allDependencies.tailwindcss) {
    const postcssConfigContent = [
      'export default {',
      '  plugins: {',
      '    tailwindcss: {},',
      '    autoprefixer: {},',
      '  },',
      '};',
      '',
    ].join('\n');

    await fs.writeFile(path.join(projectPath, 'postcss.config.js'), postcssConfigContent);
  }

  const tsConfigPath = path.join(projectPath, 'tsconfig.json');
  try {
    await fs.access(tsConfigPath);
  } catch {
    const tsConfigContent = {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        noFallthroughCasesInSwitch: true,
      },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    };
    await fs.writeFile(tsConfigPath, JSON.stringify(tsConfigContent, null, 2));
  }

  const tsConfigNodePath = path.join(projectPath, 'tsconfig.node.json');
  try {
    await fs.access(tsConfigNodePath);
  } catch {
    const tsConfigNodeContent = {
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowSyntheticDefaultImports: true,
        strict: true,
      },
      include: ['vite.config.ts'],
    };
    await fs.writeFile(tsConfigNodePath, JSON.stringify(tsConfigNodeContent, null, 2));
  }
}

async function getFileContextForError(errorLog, projectPath) {
  const fileMatch = errorLog.match(/[/\\]?src[/\\][\w./-]+\.(tsx|ts|jsx|js)/);
  if (!fileMatch) return null;

  const relativePath = fileMatch[0].replace(/^[/\\]/, '');
  const absolutePath = resolveInside(projectPath, relativePath);

  try {
    const fileContent = await fs.readFile(absolutePath, 'utf8');
    console.log(`[FIXER] Found and read problematic file: ${relativePath}`);
    return { filePath: relativePath, fileContent };
  } catch (error) {
    console.warn(`[FIXER] Could not read file from error log: ${absolutePath}`, error.message);
    return null;
  }
}

function tokenizePrompt(prompt) {
  return new Set(
    String(prompt || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3)
  );
}

async function collectProjectFiles(projectPath) {
  const ignoredDirectories = new Set(['node_modules', 'dist', '.git', '.vercel']);
  const ignoredFiles = new Set(['package-lock.json', '.suorrable.json']);
  const allowedExtensions = new Set([
    '.css',
    '.html',
    '.js',
    '.jsx',
    '.json',
    '.md',
    '.ts',
    '.tsx',
  ]);
  const files = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('_debug_ai_response_attempt_')) continue;
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(projectPath, absolutePath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (ignoredFiles.has(entry.name)) continue;
      if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;

      const stats = await fs.stat(absolutePath);
      const content = await fs.readFile(absolutePath, 'utf8');
      files.push({
        path: relativePath,
        content,
        mtimeMs: stats.mtimeMs,
      });
    }
  }

  await walk(projectPath);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function buildFileTree(files) {
  return files.map(file => file.path).join('\n');
}

function scoreFileForPrompt(file, promptTokens, recentFiles) {
  const normalizedPath = file.path.toLowerCase();
  let score = 0;

  if (file.path === 'package.json') score += 100;
  if (/^src\/main\.(tsx|ts|jsx|js)$/i.test(file.path)) score += 90;
  if (/^src\/app\.(tsx|ts|jsx|js)$/i.test(file.path)) score += 85;
  if (file.path === 'index.html') score += 60;
  if (recentFiles.has(file.path)) score += 50;
  if (/\.(css|scss)$/i.test(file.path)) score += 25;
  if (/config\.(js|ts)$/i.test(file.path)) score += 20;

  for (const token of promptTokens) {
    if (normalizedPath.includes(token)) score += 18;
    if (file.content.toLowerCase().includes(token)) score += 8;
  }

  return score;
}

async function collectProjectEditContext(projectPath, options = {}) {
  const {
    prompt = '',
    recentFiles = [],
    maxFileChars = 12000,
    maxTotalChars = 60000,
  } = options;

  const files = await collectProjectFiles(projectPath);
  const promptTokens = tokenizePrompt(prompt);
  const recentFileSet = new Set(recentFiles);
  const fileTree = buildFileTree(files);
  const selected = new Map();

  for (const file of files) {
    const score = scoreFileForPrompt(file, promptTokens, recentFileSet);
    if (score > 0) selected.set(file.path, { ...file, score });
  }

  if (selected.size === 0 && files.length <= 12) {
    for (const file of files) selected.set(file.path, { ...file, score: 1 });
  }

  const sortedFiles = Array.from(selected.values())
    .sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));

  let totalChars = 0;
  const includedBlocks = [];
  for (const file of sortedFiles) {
    const content = file.content.length > maxFileChars
      ? `${file.content.slice(0, maxFileChars)}\n/* File truncated for context. */`
      : file.content;
    const block = `// FILE: ${file.path}\n${content}`;
    if (totalChars + block.length > maxTotalChars) break;
    includedBlocks.push(block);
    totalChars += block.length;
  }

  return [
    'Project file tree:',
    fileTree || '(no source files found)',
    '',
    'Selected file contents:',
    includedBlocks.join('\n\n') || '(no file contents selected)',
  ].join('\n');
}

async function collectProjectSourceSnapshot(projectPath) {
  return collectProjectEditContext(projectPath);
}

module.exports = {
  collectProjectEditContext,
  collectProjectSourceSnapshot,
  enforceDependencyVersions,
  ensureBuildableProjectConfigs,
  getFileContextForError,
  parseAndWriteFiles,
  removePlanningTags,
};
