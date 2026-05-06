const assert = require('node:assert/strict');
const test = require('node:test');
const { createChildProcessEnv } = require('../src/server/processEnv');

test('createChildProcessEnv excludes API keys and deploy tokens from generated child processes', () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalVercelToken = process.env.VERCEL_TOKEN;

  try {
    process.env.GEMINI_API_KEY = 'secret-gemini-key';
    process.env.VERCEL_TOKEN = 'secret-vercel-token';

    const env = createChildProcessEnv({ npm_config_ignore_scripts: 'true' });

    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.VERCEL_TOKEN, undefined);
    assert.equal(env.npm_config_ignore_scripts, 'true');
  } finally {
    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }

    if (originalVercelToken === undefined) {
      delete process.env.VERCEL_TOKEN;
    } else {
      process.env.VERCEL_TOKEN = originalVercelToken;
    }
  }
});
