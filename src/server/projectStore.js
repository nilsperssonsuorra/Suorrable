const fs = require('fs').promises;
const path = require('path');
const {
  GENERATED_PROJECTS_DIR,
  PROJECT_CONVERSATION_FILE,
  PROJECT_ID_PATTERN,
  PROJECT_METADATA_FILE,
} = require('./config');

async function ensureGeneratedProjectsDir() {
  await fs.mkdir(GENERATED_PROJECTS_DIR, { recursive: true });
}

function resolveInside(baseDir, requestedPath) {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new Error('Invalid empty file path.');
  }

  const normalizedPath = requestedPath.replace(/\\/g, '/').trim();
  if (normalizedPath.includes('\0') || path.isAbsolute(normalizedPath) || /^[a-zA-Z]:/.test(normalizedPath)) {
    throw new Error(`Unsafe generated file path rejected: ${requestedPath}`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, normalizedPath);
  const relativePath = path.relative(resolvedBase, resolvedTarget);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Generated file path escapes project directory: ${requestedPath}`);
  }

  return resolvedTarget;
}

function getGeneratedProjectPath(projectId) {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Invalid project id.');
  }

  return path.join(GENERATED_PROJECTS_DIR, projectId);
}

async function readProjectMetadata(projectPath) {
  const metadataPath = path.join(projectPath, PROJECT_METADATA_FILE);
  return JSON.parse(await fs.readFile(metadataPath, 'utf8'));
}

async function updateProjectMetadata(projectPath, updates) {
  let existing = {};
  try {
    existing = await readProjectMetadata(projectPath);
  } catch {
    existing = {};
  }

  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );

  const metadata = {
    ...existing,
    ...cleanUpdates,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(projectPath, PROJECT_METADATA_FILE), JSON.stringify(metadata, null, 2));
  return metadata;
}

async function readProjectConversation(projectPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectPath, PROJECT_CONVERSATION_FILE), 'utf8'));
  } catch {
    return [];
  }
}

async function appendProjectConversation(projectPath, entry) {
  const conversation = await readProjectConversation(projectPath);
  const savedEntry = {
    ...entry,
    createdAt: entry.createdAt || new Date().toISOString(),
  };

  conversation.push(savedEntry);
  await fs.writeFile(
    path.join(projectPath, PROJECT_CONVERSATION_FILE),
    JSON.stringify(conversation, null, 2)
  );
  return savedEntry;
}

async function listProjects() {
  await ensureGeneratedProjectsDir();
  const entries = await fs.readdir(GENERATED_PROJECTS_DIR, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !PROJECT_ID_PATTERN.test(entry.name)) continue;

    const projectPath = getGeneratedProjectPath(entry.name);
    try {
      projects.push(await readProjectMetadata(projectPath));
    } catch {
      // Ignore incomplete generated folders.
    }
  }

  return projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function resetGeneratedWorkspace(projectPath) {
  await fs.mkdir(projectPath, { recursive: true });
  const entries = await fs.readdir(projectPath, { withFileTypes: true });

  await Promise.all(entries.map(async entry => {
    if (entry.name === PROJECT_METADATA_FILE || entry.name.startsWith('_debug_ai_response_attempt_')) {
      return;
    }

    await fs.rm(path.join(projectPath, entry.name), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }));
}

async function cleanupFailedBuildArtifacts(projectPath) {
  await Promise.all([
    fs.rm(path.join(projectPath, 'node_modules'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    fs.rm(path.join(projectPath, 'dist'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  ]);
}

async function deleteProject(projectId) {
  const projectPath = getGeneratedProjectPath(projectId);
  await fs.rm(projectPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 150,
  });
}

async function duplicateProject(sourceProjectId, targetProjectId) {
  const sourcePath = getGeneratedProjectPath(sourceProjectId);
  const targetPath = getGeneratedProjectPath(targetProjectId);

  await fs.access(sourcePath);
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    filter: source => {
      const basename = path.basename(source);
      return basename !== 'node_modules' && basename !== '.vercel';
    },
  });

  const sourceMetadata = await readProjectMetadata(sourcePath);
  const duplicatedMetadata = await updateProjectMetadata(targetPath, {
    ...sourceMetadata,
    projectId: targetProjectId,
    title: sourceMetadata.title ? `${sourceMetadata.title} copy` : undefined,
    prompt: sourceMetadata.prompt ? `${sourceMetadata.prompt} copy` : sourceMetadata.prompt,
    sourceProjectId,
    createdAt: new Date().toISOString(),
    deployStatus: null,
    deploymentUrl: null,
    deploymentTarget: null,
    deploymentScope: null,
    deploymentLinked: null,
    deployedAt: null,
    deployError: null,
    deployHistory: [],
  });

  return duplicatedMetadata;
}

module.exports = {
  appendProjectConversation,
  cleanupFailedBuildArtifacts,
  deleteProject,
  duplicateProject,
  ensureGeneratedProjectsDir,
  getGeneratedProjectPath,
  listProjects,
  readProjectConversation,
  readProjectMetadata,
  resetGeneratedWorkspace,
  resolveInside,
  updateProjectMetadata,
};
