const assert = require('node:assert/strict');
const test = require('node:test');
const { createVercelLinkArgs, createVercelProjectName, extractDeploymentUrl } = require('../src/server/deployRunner');

test('extractDeploymentUrl returns the latest vercel app URL', () => {
  const output = [
    'Inspect: https://first-preview.vercel.app',
    'Production: https://final-site.vercel.app',
  ].join('\n');

  assert.equal(extractDeploymentUrl(output), 'https://final-site.vercel.app');
});

test('extractDeploymentUrl strips ansi escapes and trailing punctuation', () => {
  const output = '\u001b[32mhttps://demo.vercel.app,\u001b[39m';

  assert.equal(extractDeploymentUrl(output), 'https://demo.vercel.app');
});

test('extractDeploymentUrl returns null when no vercel URL exists', () => {
  assert.equal(extractDeploymentUrl('Deployment complete, no URL here.'), null);
});

test('createVercelProjectName creates readable slugs from project metadata', () => {
  assert.equal(
    createVercelProjectName({ title: 'Space Company Landing Page!' }),
    'space-company-landing-page'
  );
  assert.equal(
    createVercelProjectName({ prompt: 'A modern Tetris game with neon blocks' }),
    'a-modern-tetris-game-with-neon-blocks'
  );
});

test('createVercelProjectName falls back to a stable suorrable name', () => {
  assert.equal(
    createVercelProjectName({ projectId: 'abcdef12-3456-4567-8123-abcdefabcdef' }),
    'suorrable-abcdef12'
  );
});

test('createVercelLinkArgs uses supported project flag for new links', () => {
  assert.deepEqual(
    createVercelLinkArgs(null, 'demo-project', ['--token', 'secret']),
    ['link', '--yes', '--project', 'demo-project', '--token', 'secret']
  );
});

test('createVercelLinkArgs keeps existing links without forcing a project', () => {
  assert.deepEqual(
    createVercelLinkArgs({ projectId: 'prj_123' }, 'demo-project', ['--token', 'secret']),
    ['link', '--yes', '--token', 'secret']
  );
});
