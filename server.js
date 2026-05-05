const { startServer } = require('./src/server');

startServer().catch(error => {
  console.error(`FATAL ERROR: ${error.message}`);
  process.exit(1);
});
