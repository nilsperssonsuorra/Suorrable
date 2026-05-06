const path = require('path');

require('dotenv').config({ quiet: true });

const ROOT_DIR = path.resolve(__dirname, '../..');
const GENERATED_PROJECTS_DIR = path.join(ROOT_DIR, 'generated');

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX_COMMAND = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const config = {
  ROOT_DIR,
  GENERATED_PROJECTS_DIR,
  PROJECT_ID_PATTERN,
  NPM_COMMAND,
  NPX_COMMAND,
  HOST: process.env.HOST || '127.0.0.1',
  PORT: Number(process.env.PORT || 3000),
  QUALITY_MODEL_NAME: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  INSTALL_TIMEOUT_MS: 120000,
  BUILD_TIMEOUT_MS: 60000,
  DEPLOY_TIMEOUT_MS: 180000,
  MAX_FIX_ATTEMPTS: 1,
  PROJECT_METADATA_FILE: '.suorrable.json',
  PROJECT_CONVERSATION_FILE: 'conversation.json',
  REQUIRED_GENERATED_FILES: ['package.json', 'index.html'],
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  VERCEL_TOKEN: process.env.VERCEL_TOKEN,
  VERCEL_SCOPE: process.env.VERCEL_SCOPE,
};

function assertRequiredEnv() {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not defined in the .env file.');
  }
}

module.exports = {
  ...config,
  assertRequiredEnv,
};
