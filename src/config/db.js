const { PrismaClient } = require('@prisma/client');

/**
 * Prisma client singleton.
 *
 * In development, hot-reloading (nodemon) would create a new PrismaClient
 * on every restart, potentially exhausting database connections. We attach
 * the instance to `globalThis` to reuse it across reloads.
 */
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
