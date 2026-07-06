const http = require('http');
const app = require('./src/app');
const env = require('./src/config/env');
const prisma = require('./src/config/db');
const { initializeSocket } = require('./src/sockets');

/**
 * Server Bootstrap
 *
 * Creates an HTTP server, attaches Socket.IO, connects to the
 * database, and starts listening for requests.
 */

// Create HTTP server from the Express app
const server = http.createServer(app);

// Attach Socket.IO to the HTTP server
const io = initializeSocket(server);

// Make io accessible if needed elsewhere
app.set('io', io);

/**
 * Start the server after verifying the database connection.
 */
async function start() {
  try {
    // Verify database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Start listening
    server.listen(env.PORT, () => {
      console.log(`\n🚀 Server running on http://localhost:${env.PORT}`);
      console.log(`📡 Socket.IO ready for connections`);
      console.log(`🌍 Environment: ${env.NODE_ENV}`);
      console.log(`🔗 CORS origin: ${env.CORS_ORIGIN}\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Close Socket.IO connections
  io.close(() => {
    console.log('🔌 Socket.IO connections closed');
  });

  // Close HTTP server
  server.close(() => {
    console.log('🛑 HTTP server closed');
  });

  // Disconnect from database
  await prisma.$disconnect();
  console.log('💤 Database disconnected');

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled rejection:', err);
  shutdown('UNHANDLED_REJECTION');
});

// Start the server
start();
