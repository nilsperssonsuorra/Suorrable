const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const {
  DEPLOY_TIMEOUT_MS,
  NPX_COMMAND,
  VERCEL_SCOPE,
  VERCEL_TOKEN,
} = require('./config');
const { createChildProcessEnv } = require('./processEnv');

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function redactSensitiveOutput(value) {
  let output = stripAnsi(value);
  if (VERCEL_TOKEN) {
    output = output.split(VERCEL_TOKEN).join('[redacted-token]');
  }
  return output;
}

function extractDeploymentUrl(output) {
  const cleanOutput = stripAnsi(output);
  const matches = cleanOutput.match(/https:\/\/[^\s]+?\.vercel\.app(?:\/[^\s]*)?/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].replace(/[),.;]+$/, '');
}

function createVercelProjectName(metadata = {}) {
  const source = String(
    metadata.vercelProjectName ||
    metadata.title ||
    metadata.prompt ||
    `suorrable-${String(metadata.projectId || '').slice(0, 8)}`
  );
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 52)
    .replace(/-+$/g, '');

  return slug || `suorrable-${String(metadata.projectId || 'project').slice(0, 8)}`;
}

async function readLinkedVercelProject(projectPath) {
  try {
    const fileContent = await fs.readFile(path.join(projectPath, '.vercel', 'project.json'), 'utf8');
    const project = JSON.parse(fileContent);
    return {
      orgId: project.orgId || null,
      projectId: project.projectId || null,
    };
  } catch {
    return null;
  }
}

function runVercelCommand(projectPath, args, options = {}) {
  const { onLog } = options;

  return new Promise((resolve, reject) => {
    const child = execFile(NPX_COMMAND, ['--yes', 'vercel', ...args], {
      cwd: projectPath,
      shell: process.platform === 'win32',
      timeout: DEPLOY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 10,
      env: createChildProcessEnv(),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      const chunk = redactSensitiveOutput(data);
      stdout += chunk;
      if (onLog) onLog(chunk, 'stdout');
    });
    child.stderr.on('data', data => {
      const chunk = redactSensitiveOutput(data);
      stderr += chunk;
      if (onLog) onLog(chunk, 'stderr');
    });
    child.on('error', reject);
    child.on('close', code => {
      const cleanStdout = redactSensitiveOutput(stdout).trim();
      const cleanStderr = redactSensitiveOutput(stderr).trim();
      const cleanOutput = [cleanStdout, cleanStderr].filter(Boolean).join('\n').trim();
      if (code === 0) {
        resolve({
          stdout: cleanStdout,
          stderr: cleanStderr,
          output: cleanOutput,
        });
        return;
      }

      reject(new Error(cleanOutput || `Vercel command failed with exit code ${code}.`));
    });
  });
}

function deployProjectToVercel(projectPath, options = {}) {
  const {
    metadata = {},
    onEvent,
    onLog,
    production = false,
  } = options;

  if (!VERCEL_TOKEN) {
    throw new Error('VERCEL_TOKEN is not configured. Add it to .env before deploying.');
  }

  const scopeArgs = VERCEL_SCOPE ? ['--scope', VERCEL_SCOPE] : [];
  const commonArgs = ['--token', VERCEL_TOKEN, ...scopeArgs];
  const deployArgs = ['deploy', '--yes', ...commonArgs];
  const vercelProjectName = createVercelProjectName(metadata);

  if (production) {
    deployArgs.push('--prod');
  }

  if (onEvent) {
    onEvent({
      stage: 'linking',
      message: 'Linking generated project to Vercel...',
    });
  }

  return readLinkedVercelProject(projectPath)
    .then(existingLink => {
      const linkArgs = existingLink
        ? ['link', '--yes', ...commonArgs]
        : ['link', '--yes', '--name', vercelProjectName, ...commonArgs];

      return runVercelCommand(projectPath, linkArgs, { onLog })
        .then(linkResult => ({ linkResult, linkedBeforeDeploy: Boolean(existingLink) }));
    })
    .then(({ linkResult, linkedBeforeDeploy }) => {
      if (onEvent) {
        onEvent({
          stage: 'deploying',
          message: production ? 'Deploying to Vercel production...' : 'Creating Vercel preview deployment...',
        });
      }

      return runVercelCommand(projectPath, deployArgs, { onLog })
      .then(deployResult => {
        const deploymentUrl = extractDeploymentUrl(deployResult.stdout) || extractDeploymentUrl(deployResult.output);

        if (!deploymentUrl) {
          throw new Error(deployResult.output || 'Vercel deploy succeeded but no deployment URL was found.');
        }

        return {
          deploymentUrl,
          production,
          scope: VERCEL_SCOPE || null,
          vercelProjectLinkedBeforeDeploy: linkedBeforeDeploy,
          vercelProjectName,
          output: deployResult.output,
          linkOutput: linkResult.output,
        };
      });
    });
}

module.exports = {
  createVercelProjectName,
  deployProjectToVercel,
  extractDeploymentUrl,
};
