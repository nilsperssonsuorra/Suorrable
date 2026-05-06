const { HOST, PORT, assertRequiredEnv } = require('./config');
const { createApp } = require('./app');
const { ensureGeneratedProjectsDir } = require('./projectStore');

async function startServer() {
  assertRequiredEnv();
  await ensureGeneratedProjectsDir();

  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`Server listening at http://${HOST}:${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error(`FATAL ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  startServer,
};
