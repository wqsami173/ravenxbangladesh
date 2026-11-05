require('dotenv').config();

const { Pool } = require('pg');

async function main() {
  const targetEmail = String(process.argv[2] || '').trim().toLowerCase();
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!process.env.ADMIN_SETUP_SECRET) throw new Error('Set ADMIN_SETUP_SECRET before promoting an admin.');
  if (!targetEmail || targetEmail !== adminEmail) {
    throw new Error('Pass the configured ADMIN_EMAIL as the only argument.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(
      'UPDATE users SET role=$1, updated_at=NOW() ' +
      'WHERE LOWER(email)=LOWER($2) AND password_hash IS NOT NULL ' +
      'RETURNING id, name, email, role',
      ['admin', targetEmail]
    );
    if (!result.rowCount) throw new Error('Create and sign into the configured admin account before promotion.');
    console.log('Admin role assigned to:', result.rows[0].email);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


