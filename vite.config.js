import { defineConfig, loadEnv } from 'vite';

function formatProxyHost(host) {
  const cleanHost = String(host || '127.0.0.1').replace(/^\[|\]$/g, '');

  if (cleanHost === '0.0.0.0' || cleanHost === '::') {
    return '127.0.0.1';
  }

  return cleanHost.includes(':') ? `[${cleanHost}]` : cleanHost;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendHost = formatProxyHost(env.HOST || process.env.HOST || '127.0.0.1');
  const backendPort = env.PORT || process.env.PORT || '3000';
  const backendTarget = `http://${backendHost}:${backendPort}`;

  return {
    server: {
      watch: {
        ignored: [
          '**/generated/**',
        ],
      },
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/generated': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
