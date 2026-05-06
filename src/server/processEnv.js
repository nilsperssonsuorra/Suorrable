const SAFE_ENV_KEYS = [
  'APPDATA',
  'CI',
  'ComSpec',
  'HOME',
  'LOCALAPPDATA',
  'NODE_ENV',
  'NUMBER_OF_PROCESSORS',
  'PATH',
  'PATHEXT',
  'Path',
  'PROCESSOR_ARCHITECTURE',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
];

function createChildProcessEnv(extra = {}) {
  const env = {};

  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  return {
    ...env,
    ...extra,
  };
}

module.exports = {
  createChildProcessEnv,
};
