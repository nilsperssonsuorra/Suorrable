const fs = require('fs').promises;
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { fileURLToPath, pathToFileURL } = require('url');
const { getGeneratedProjectPath } = require('./projectStore');

class LocalDistResourceLoader extends ResourceLoader {
  constructor(rootDir) {
    super();
    this.rootDir = path.resolve(rootDir);
  }

  fetch(url, options) {
    let filePath;

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'file:') {
        console.warn(`[JSDOM CHECK] Blocked non-local resource: ${url}`);
        return null;
      }
      filePath = path.resolve(fileURLToPath(parsedUrl));
    } catch {
      console.warn(`[JSDOM CHECK] Blocked unreadable resource URL: ${url}`);
      return null;
    }

    const relativePath = path.relative(this.rootDir, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      console.warn(`[JSDOM CHECK] Blocked resource outside dist: ${url}`);
      return null;
    }

    return super.fetch(url, options);
  }
}

function getErrorText(error) {
  if (!error) return '';
  return String(error.stack || error.message || error);
}

function isNonFatalJSDOMError(error) {
  const text = getErrorText(error);

  return [
    'Could not parse CSS stylesheet',
    'Could not load link',
    'Could not load img',
    'Could not load script',
  ].some(pattern => text.includes(pattern));
}

async function checkRuntimeErrorsWithJSDOM(projectId, sendEvent) {
  console.log(`[JSDOM CHECK] Verifying project ${projectId}...`);
  sendEvent({ event: 'status', status: 'testing', message: 'Verifying code execution...' });

  const projectDistPath = path.join(getGeneratedProjectPath(projectId), 'dist');
  const indexPath = path.join(projectDistPath, 'index.html');
  const html = await fs.readFile(indexPath, 'utf-8');
  const errors = [];
  const warnings = [];
  const virtualConsole = new VirtualConsole();

  virtualConsole.on('error', error => {
    errors.push(getErrorText(error));
  });
  virtualConsole.on('jsdomError', error => {
    const message = getErrorText(error);
    if (isNonFatalJSDOMError(error)) {
      warnings.push(message);
    } else {
      errors.push(message);
    }
  });

  return new Promise((resolve, reject) => {
    try {
      new JSDOM(html, {
        runScripts: 'dangerously',
        resources: new LocalDistResourceLoader(projectDistPath),
        url: pathToFileURL(indexPath).href,
        virtualConsole,
        beforeParse(window) {
          window.fetch = () => Promise.reject(new Error('Network access is disabled during verification.'));
        },
      });

      setTimeout(() => {
        if (errors.length > 0) {
          console.error(`[JSDOM CHECK] Detected errors for project ${projectId}:`, errors);
          const runtimeError = new Error('Runtime errors found in the preview.');
          runtimeError.buildErrorLog = `Runtime errors detected during JSDOM verification:\n- ${errors.join('\n- ')}`;
          reject(runtimeError);
          return;
        }

        if (warnings.length > 0) {
          console.warn(`[JSDOM CHECK] Non-fatal verifier warnings for project ${projectId}:`, warnings);
          sendEvent({
            event: 'status',
            status: 'verified-with-warnings',
            message: 'Code verification passed with browser-compatibility warnings.',
          });
          resolve();
          return;
        }

        console.log(`[JSDOM CHECK] Project ${projectId} verified successfully.`);
        sendEvent({ event: 'status', status: 'verified', message: 'Code verification passed.' });
        resolve();
      }, 1500);
    } catch (error) {
      const initError = new Error('JSDOM failed to initialize.');
      initError.buildErrorLog = error.stack;
      reject(initError);
    }
  });
}

module.exports = {
  checkRuntimeErrorsWithJSDOM,
};
