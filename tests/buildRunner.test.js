const assert = require('node:assert/strict');
const test = require('node:test');
const { isPeerDependencyResolutionError } = require('../src/server/buildRunner');

test('isPeerDependencyResolutionError detects npm peer dependency ERESOLVE errors', () => {
  const error = new Error([
    'npm error code ERESOLVE',
    'npm error ERESOLVE unable to resolve dependency tree',
    'npm error Could not resolve dependency:',
    'npm error peer three@">= 0.168.0 < 0.185.0" from postprocessing@6.39.1',
  ].join('\n'));

  assert.equal(isPeerDependencyResolutionError(error), true);
});

test('isPeerDependencyResolutionError ignores non-peer install failures', () => {
  assert.equal(isPeerDependencyResolutionError(new Error('npm error code E404 Not Found')), false);
  assert.equal(isPeerDependencyResolutionError(new Error('npm error code EACCES permission denied')), false);
});
