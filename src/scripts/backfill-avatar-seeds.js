/**
 * backfill-avatar-seeds.js
 *
 * One-shot script that assigns avatar seeds to all existing users
 * who currently have avatarSeed = null.
 *
 * Usage:
 *   node src/scripts/backfill-avatar-seeds.js
 *
 * The script:
 *   1. Fetches every user without a seed.
 *   2. Calls the avatar engine for a fresh unique seed per user.
 *   3. Updates each user record in the database.
 *   4. Logs progress and a final summary.
 *
 * It is intentionally sequential (one request at a time) to avoid
 * hammering the avatar engine worker.
 */

require('dotenv').config();
const prisma = require('../config/db');

const AVATAR_ENGINE_URL = 'https://avatar-engine.vatsal-bharkhada.workers.dev/avatar';
const DELAY_MS = 100; // Small delay between requests to be a polite client

/** Pause for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a unique avatar seed from the engine. Returns null on failure. */
async function fetchSeed() {
  try {
    const res = await fetch(AVATAR_ENGINE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svg = await res.text();
    const match = svg.match(/data-seed="([^"]+)"/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('🔍  Looking for users without an avatar seed...\n');

  const users = await prisma.user.findMany({
    where: { avatarSeed: null },
    select: { id: true, username: true },
  });

  if (users.length === 0) {
    console.log('✅  All users already have an avatar seed. Nothing to do.');
    return;
  }

  console.log(`Found ${users.length} user(s) without a seed. Starting backfill...\n`);

  let succeeded = 0;
  let failed = 0;

  for (const user of users) {
    process.stdout.write(`  → ${user.username} (${user.id}) ... `);

    const seed = await fetchSeed();

    if (!seed) {
      console.log('⚠️  Could not fetch seed — skipping.');
      failed++;
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { avatarSeed: seed },
    });

    console.log(`✓  seed: ${seed}`);
    succeeded++;

    // Small pause between requests
    if (succeeded + failed < users.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n─────────────────────────────────────');
  console.log('Backfill complete.');
  console.log(`  ✅  Updated : ${succeeded}`);
  if (failed > 0) {
    console.log(`  ⚠️  Skipped : ${failed} (avatar engine unreachable for these users)`);
    console.log('     Re-run the script to retry skipped users.');
  }
  console.log('─────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error('\n❌  Unexpected error:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
