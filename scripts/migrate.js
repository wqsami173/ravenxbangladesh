require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      'name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );
    const folder = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.readdirSync(folder).filter((name) => name.endsWith('.sql')).sort();
    for (const name of files) {
      const found = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (found.rowCount) {
        console.log('Already applied:', name);
        continue;
      }
      await client.query('BEGIN');
      try {
        const sql = fs.readFileSync(path.join(folder, name), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log('Applied:', name);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});

