import { buildApp } from './app.js';
import { config } from './config/index.js';
import { initializeQueues, shutdownQueues } from './queue/scheduler.js';

async function main() {
  const app = await buildApp();

  // Initialize job queues (optional - can be disabled for development)
  const enableQueues = process.env.ENABLE_QUEUES !== 'false';
  if (enableQueues) {
    try {
      await initializeQueues();
      console.log('📋 Job queues initialized');
    } catch (err) {
      console.warn('⚠️  Failed to initialize queues (Redis may not be available):', err);
    }
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);

    try {
      await shutdownQueues();
      await app.close();
      console.log('Server shut down successfully');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({
      port: config.API_PORT,
      host: config.API_HOST,
    });

    console.log(`
🚀 Aggragif API Server running!

   Local:    http://localhost:${config.API_PORT}
   Health:   http://localhost:${config.API_PORT}/health

   Environment: ${config.NODE_ENV}
`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
