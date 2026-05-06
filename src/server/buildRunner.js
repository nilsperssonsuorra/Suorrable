const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const {
  BUILD_TIMEOUT_MS,
  INSTALL_TIMEOUT_MS,
  NPM_COMMAND,
} = require('./config');
const { createChildProcessEnv } = require('./processEnv');

function formatProcessLog(data) {
  return String(data)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n');
}

function runNpmCommand(args, projectPath, timeout, onDataChunk) {
  return new Promise((resolve, reject) => {
    const child = execFile(NPM_COMMAND, args, {
      cwd: projectPath,
      shell: process.platform === 'win32',
      timeout,
      maxBuffer: 1024 * 1024 * 10,
      env: createChildProcessEnv({
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_ignore_scripts: 'true',
      }),
    });

    let stderr = '';
    child.stderr.on('data', data => {
      stderr += data;
      if (onDataChunk) onDataChunk(data);
    });
    child.stdout.on('data', data => {
      if (onDataChunk) onDataChunk(data);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `${NPM_COMMAND} ${args.join(' ')} failed with exit code ${code}.`));
      }
    });
  });
}

function isPeerDependencyResolutionError(error) {
  const message = String(error && error.message ? error.message : error);
  return /\bERESOLVE\b/i.test(message) && /peer/i.test(message);
}

async function installAndBuildProject(projectPath, sendEvent) {
  sendEvent({ status: 'installing', message: 'Installing dependencies...' });

  try {
    await runNpmCommand(['install'], projectPath, INSTALL_TIMEOUT_MS, data => {
      const message = formatProcessLog(data);
      if (message) sendEvent({ event: 'build-log', stage: 'install', message });
    });
  } catch (error) {
    if (isPeerDependencyResolutionError(error)) {
      console.warn('[INSTALL STDERR] Peer dependency resolution failed. Retrying with --legacy-peer-deps.');
      sendEvent({
        event: 'build-log',
        stage: 'install',
        message: 'Peer dependency conflict detected. Retrying install with npm legacy peer resolution...',
      });

      try {
        await runNpmCommand(['install', '--legacy-peer-deps'], projectPath, INSTALL_TIMEOUT_MS, data => {
          const message = formatProcessLog(data);
          if (message) sendEvent({ event: 'build-log', stage: 'install', message });
        });
      } catch (retryError) {
        console.error(`[INSTALL STDERR] ${retryError.message}`);
        throw new Error(`NPM install failed: ${retryError.message}`);
      }
    } else {
      console.error(`[INSTALL STDERR] ${error.message}`);
      throw new Error(`NPM install failed: ${error.message}`);
    }
  }

  sendEvent({ status: 'building', message: 'Build starting...' });

  try {
    await runNpmCommand(['run', 'build'], projectPath, BUILD_TIMEOUT_MS, data => {
      const message = formatProcessLog(data);
      if (message) sendEvent({ event: 'build-log', stage: 'build', message });
    });
    await fs.access(path.join(projectPath, 'dist', 'index.html'));
    sendEvent({ status: 'complete', message: 'Build successful!' });
  } catch (error) {
    console.error(`[BUILD STDERR] ${error.message}`);
    const buildError = new Error('Build failed.');
    buildError.buildErrorLog = error.message;
    throw buildError;
  }
}

module.exports = {
  installAndBuildProject,
  isPeerDependencyResolutionError,
};
