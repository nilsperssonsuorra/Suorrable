const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const {
  HOST,
  MAX_FIX_ATTEMPTS,
  ROOT_DIR,
  VERCEL_SCOPE,
  VERCEL_TOKEN,
} = require('./config');
const { deployProjectToVercel } = require('./deployRunner');
const { installAndBuildProject } = require('./buildRunner');
const {
  collectProjectEditContext,
  enforceDependencyVersions,
  ensureBuildableProjectConfigs,
  parseAndWriteFiles,
  removePlanningTags,
} = require('./generatedProject');
const { attemptToFixError, streamPromptResponse } = require('./gemini');
const {
  appendProjectConversation,
  cleanupFailedBuildArtifacts,
  deleteProject,
  duplicateProject,
  getGeneratedProjectPath,
  listProjects,
  readProjectConversation,
  readProjectMetadata,
  resetGeneratedWorkspace,
  updateProjectMetadata,
} = require('./projectStore');
const { checkRuntimeErrorsWithJSDOM } = require('./runtimeCheck');

function isPrivateIpv4(hostname) {
  const parts = String(hostname || '').split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isUnspecifiedHost(hostname) {
  return hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]';
}

function isAllowedCorsOrigin(origin, host = HOST) {
  if (!origin) return true;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const originHost = url.hostname.replace(/^\[|\]$/g, '');
  const configuredHost = String(host || '').replace(/^\[|\]$/g, '');

  if (originHost === 'localhost' || originHost === '127.0.0.1' || originHost === '::1') return true;
  if (configuredHost && !isUnspecifiedHost(configuredHost) && originHost === configuredHost) return true;
  if (isUnspecifiedHost(configuredHost) && isPrivateIpv4(originHost)) return true;

  return false;
}

function handleCorsOrigin(origin, callback) {
  callback(null, isAllowedCorsOrigin(origin) ? true : false);
}

function setGeneratedPreviewHeaders(res) {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function handleGeneratedPreviewPreflight(req, res) {
  setGeneratedPreviewHeaders(res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || 'Content-Type'
  );
  res.status(204).end();
}

function createApp() {
  const app = express();

  const extractClarificationQuestion = responseText => {
    const match = responseText.match(/<question>([\s\S]*?)<\/question>/i);
    return match ? match[1].trim() : null;
  };

  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(ROOT_DIR, 'dist')));
  app.use(cors({
    origin: handleCorsOrigin,
  }));

  app.use('/generated/:projectId/dist', (req, res, next) => {
    setGeneratedPreviewHeaders(res);

    if (req.method === 'OPTIONS') {
      handleGeneratedPreviewPreflight(req, res);
      return;
    }

    let distPath;
    try {
      distPath = path.join(getGeneratedProjectPath(req.params.projectId), 'dist');
    } catch {
      res.status(400).send('Invalid project id.');
      return;
    }

    express.static(distPath, {
      dotfiles: 'deny',
      fallthrough: false,
    })(req, res, next);
  });

  const buildPromptForMode = async (prompt, projectPath, isNewProject, metadata = {}) => {
    if (isNewProject) return prompt;

    const editContext = await collectProjectEditContext(projectPath, {
      prompt,
      recentFiles: Array.isArray(metadata.files) ? metadata.files : [],
    });
    await updateProjectMetadata(projectPath, {
      lastContextChars: editContext.length,
    });
    return [
      'This is an update to an existing generated project.',
      'Return only the files that need to change.',
      'Every returned file must still be a complete file and must start with `// FILE: path/to/file.ext`.',
      'Do not return unchanged files.',
      'Use the file tree to understand the project. Selected file contents are included below; if you need to change a file, return its complete updated contents.',
      '',
      'User requested change:',
      prompt,
      '',
      'Current project edit context:',
      '```',
      editContext,
      '```',
    ].join('\n');
  };

  app.post('/api/chat', async (req, res) => {
    let { prompt, history, projectId } = req.body;
    if (!prompt) return res.status(400).send({ error: 'Prompt is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = data => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        console.error('Error writing to stream:', error);
      }
    };

    let fixAttempts = 0;
    let currentFullResponseText = '';
    let projectPath;

    try {
      const isNewProject = !projectId;
      if (isNewProject) projectId = uuidv4();

      projectPath = getGeneratedProjectPath(projectId);
      await fs.mkdir(projectPath, { recursive: true });
      let existingMetadata = {};
      if (!isNewProject) {
        try {
          existingMetadata = await readProjectMetadata(projectPath);
        } catch {
          existingMetadata = {};
        }
      }
      await updateProjectMetadata(projectPath, {
        projectId,
        prompt,
        mode: isNewProject ? 'full' : 'update',
        status: isNewProject ? 'generating' : 'updating',
        createdAt: isNewProject ? new Date().toISOString() : undefined,
        previewPath: null,
        lastError: null,
      });
      await appendProjectConversation(projectPath, {
        role: 'user',
        content: prompt,
      });

      const promptForModel = await buildPromptForMode(prompt, projectPath, isNewProject, existingMetadata);
      const conversationHistory = Array.isArray(history) ? history : [];
      currentFullResponseText = await streamPromptResponse(promptForModel, conversationHistory, sendEvent);
      const clarificationQuestion = extractClarificationQuestion(currentFullResponseText);
      if (clarificationQuestion) {
        await updateProjectMetadata(projectPath, {
          status: 'waiting-for-clarification',
          clarificationQuestion,
        });
        await appendProjectConversation(projectPath, {
          role: 'assistant',
          type: 'question',
          content: clarificationQuestion,
          raw: currentFullResponseText,
        });
        sendEvent({
          event: 'question',
          projectId,
          question: clarificationQuestion,
          fullResponse: currentFullResponseText,
        });
        return;
      }

      sendEvent({ event: 'code-generated', fullResponse: currentFullResponseText });
      conversationHistory.push({ role: 'user', parts: [{ text: prompt }] });

      while (fixAttempts <= MAX_FIX_ATTEMPTS) {
        try {
          if (
            conversationHistory.length > 0 &&
            conversationHistory[conversationHistory.length - 1].role === 'model'
          ) {
            conversationHistory.pop();
          }
          conversationHistory.push({ role: 'model', parts: [{ text: currentFullResponseText }] });

          const debugFilePath = path.join(projectPath, `_debug_ai_response_attempt_${fixAttempts + 1}.txt`);
          await fs.writeFile(
            debugFilePath,
            `--- RAW AI RESPONSE (ATTEMPT ${fixAttempts + 1}) ---\n\n${currentFullResponseText}`
          );
          console.log(`[DEBUG] Raw AI response for attempt ${fixAttempts + 1} saved to ${debugFilePath}`);

          await updateProjectMetadata(projectPath, { status: 'writing-files', attempt: fixAttempts + 1 });
          if (isNewProject) {
            await resetGeneratedWorkspace(projectPath);
          }

          const writtenFiles = await parseAndWriteFiles(
            removePlanningTags(currentFullResponseText),
            projectPath,
            { requireFullProject: isNewProject }
          );
          await updateProjectMetadata(projectPath, { status: 'installing', files: writtenFiles });

          await enforceDependencyVersions(projectPath);
          await ensureBuildableProjectConfigs(projectPath);
          await installAndBuildProject(projectPath, sendEvent);

          await updateProjectMetadata(projectPath, { status: 'verifying' });
          await checkRuntimeErrorsWithJSDOM(projectId, sendEvent);
          break;
        } catch (error) {
          console.error(`[BUILD-FIX-LOOP] Attempt ${fixAttempts + 1} failed. Error: ${error.message}`);
          await updateProjectMetadata(projectPath, {
            status: 'fixing',
            attempt: fixAttempts + 1,
            lastError: error.buildErrorLog || error.message,
          });

          if (fixAttempts < MAX_FIX_ATTEMPTS) {
            fixAttempts++;
            currentFullResponseText = await attemptToFixError(
              conversationHistory,
              error.buildErrorLog || error.message,
              projectPath,
              sendEvent,
              { requireFullProject: isNewProject }
            );
            sendEvent({ event: 'code-generated', fullResponse: currentFullResponseText });
          } else {
            await cleanupFailedBuildArtifacts(projectPath);
            await updateProjectMetadata(projectPath, {
              status: 'failed',
              lastError: error.buildErrorLog || error.message,
            });
            throw new Error(`The build failed after ${MAX_FIX_ATTEMPTS + 1} attempts. Last error: ${error.message}`);
          }
        }
      }

      const previewPath = `/generated/${projectId}/dist/index.html`;
      await updateProjectMetadata(projectPath, {
        status: 'ready',
        previewPath,
        lastError: null,
      });
      await appendProjectConversation(projectPath, {
        role: 'assistant',
        type: 'code',
        content: currentFullResponseText,
        previewPath,
      });
      sendEvent({ event: 'done', projectId, previewPath });
    } catch (error) {
      console.error('Error in /api/chat:', error);
      sendEvent({ event: 'error', message: error.message || 'An unknown error occurred.' });
    } finally {
      res.end();
    }
  });

  app.get('/api/projects', async (req, res) => {
    try {
      res.json(await listProjects());
    } catch (error) {
      res.status(500).json({ error: 'Could not list projects.' });
    }
  });

  app.get('/api/projects/:projectId', async (req, res) => {
    try {
      const projectPath = getGeneratedProjectPath(req.params.projectId);
      const metadata = await readProjectMetadata(projectPath);
      res.json(metadata);
    } catch {
      res.status(404).json({ error: 'Project not found.' });
    }
  });

  app.get('/api/projects/:projectId/conversation', async (req, res) => {
    try {
      const projectPath = getGeneratedProjectPath(req.params.projectId);
      res.json(await readProjectConversation(projectPath));
    } catch {
      res.status(404).json({ error: 'Conversation not found.' });
    }
  });

  app.patch('/api/projects/:projectId', async (req, res) => {
    try {
      const projectPath = getGeneratedProjectPath(req.params.projectId);
      const title = String(req.body && req.body.title ? req.body.title : '').trim();

      if (title.length === 0 || title.length > 80) {
        return res.status(400).json({ error: 'Project name must be between 1 and 80 characters.' });
      }

      const metadata = await updateProjectMetadata(projectPath, { title });
      res.json(metadata);
    } catch (error) {
      res.status(404).json({ error: error.message || 'Project not found.' });
    }
  });

  app.delete('/api/projects/:projectId', async (req, res) => {
    try {
      await deleteProject(req.params.projectId);
      res.json({ deleted: true, projectId: req.params.projectId });
    } catch (error) {
      res.status(404).json({ error: error.message || 'Project not found.' });
    }
  });

  app.post('/api/projects/:projectId/duplicate', async (req, res) => {
    try {
      const newProjectId = uuidv4();
      const metadata = await duplicateProject(req.params.projectId, newProjectId);
      res.json(metadata);
    } catch (error) {
      res.status(404).json({ error: error.message || 'Project not found.' });
    }
  });

  app.get('/api/deploy/config', (req, res) => {
    res.json({
      provider: 'vercel',
      tokenConfigured: Boolean(VERCEL_TOKEN),
      scope: VERCEL_SCOPE || null,
      projectNameHint: 'Generated from the Suorrable project title or prompt on first deploy.',
    });
  });

  app.post('/api/projects/:projectId/deploy', async (req, res) => {
    const sendEvent = data => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        console.error('Error writing deploy stream:', error);
      }
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const projectPath = getGeneratedProjectPath(req.params.projectId);
      const metadata = await readProjectMetadata(projectPath);

      if (metadata.status !== 'ready') {
        sendEvent({ event: 'error', message: 'Project must be ready before deployment.' });
        return;
      }

      try {
        await fs.access(path.join(projectPath, 'dist', 'index.html'));
      } catch {
        sendEvent({ event: 'error', message: 'Project build output is missing. Build the project before deploying.' });
        return;
      }

      const production = Boolean(req.body && req.body.production);
      await updateProjectMetadata(projectPath, {
        deployStatus: 'deploying',
        deploymentTarget: production ? 'production' : 'preview',
        deployError: null,
      });
      sendEvent({
        event: 'status',
        status: 'deploying',
        target: production ? 'production' : 'preview',
        message: production ? 'Preparing production deployment...' : 'Preparing preview deployment...',
      });

      const result = await deployProjectToVercel(projectPath, {
        metadata,
        production,
        onEvent: event => sendEvent({ event: 'status', ...event }),
        onLog: (chunk, stream) => sendEvent({ event: 'deploy-log', stream, message: chunk }),
      });

      const deployHistory = Array.isArray(metadata.deployHistory) ? metadata.deployHistory : [];
      const deployRecord = {
        deploymentUrl: result.deploymentUrl,
        target: result.production ? 'production' : 'preview',
        scope: result.scope,
        deployedAt: new Date().toISOString(),
      };
      const updatedMetadata = await updateProjectMetadata(projectPath, {
        deployStatus: 'deployed',
        deploymentUrl: result.deploymentUrl,
        deploymentTarget: result.production ? 'production' : 'preview',
        deploymentScope: result.scope,
        deploymentLinked: true,
        vercelProjectName: result.vercelProjectName,
        vercelProjectLinkedBeforeDeploy: result.vercelProjectLinkedBeforeDeploy,
        deployedAt: deployRecord.deployedAt,
        deployHistory: [deployRecord, ...deployHistory].slice(0, 10),
        deployError: null,
      });

      sendEvent({
        event: 'done',
        deploymentUrl: result.deploymentUrl,
        production: result.production,
        metadata: updatedMetadata,
      });
    } catch (error) {
      try {
        const projectPath = getGeneratedProjectPath(req.params.projectId);
        await updateProjectMetadata(projectPath, {
          deployStatus: 'failed',
          deployError: error.message,
        });
      } catch {
        // Ignore metadata update failures when returning deploy errors.
      }

      sendEvent({ event: 'error', message: error.message || 'Deployment failed.' });
    } finally {
      res.end();
    }
  });

  app.get(/^(?!\/(api|generated)).*$/, (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'dist', 'index.html'));
  });

  return app;
}

module.exports = {
  handleCorsOrigin,
  handleGeneratedPreviewPreflight,
  createApp,
  isAllowedCorsOrigin,
  setGeneratedPreviewHeaders,
};
