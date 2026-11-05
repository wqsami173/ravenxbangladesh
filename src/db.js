const { Pool } = require('pg');

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('PostgreSQL pool error', { code: error.code || 'UNKNOWN' });
});

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function requireDatabase(res) {
  if (hasDatabaseUrl) return true;
  res.status(503).json({ error: 'Database is not configured. Set DATABASE_URL and run npm run migrate.' });
  return false;
}

module.exports = { pool, withTransaction, requireDatabase, hasDatabaseUrl };

