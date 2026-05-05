const { Pool } = require('pg');

require('dotenv').config();

const connectionString = (process.env.DATABASE_URL || '').trim();

/** SSL quando explícito na URL (?sslmode=require) ou DATABASE_SSL=true. */
function sslFromEnvAndUrl(cs) {
  const flag = process.env.DATABASE_SSL;
  if (flag === 'true') {
    return { rejectUnauthorized: false };
  }
  if (flag === 'false') {
    return undefined;
  }

  try {
    const normalized = /^postgres:\/\//.test(cs)
      ? `postgresql://${cs.slice('postgres://'.length)}`
      : cs;
    const url = new URL(normalized);

    const mode = String(url.searchParams.get('sslmode') || '')
      .toLowerCase();

    if (mode === 'require' || mode === 'verify-ca' || mode === 'verify-full') {
      return { rejectUnauthorized: false };
    }
  } catch {
    // URL inválida ou variável só host
  }

  return undefined;
}

if (!connectionString) {
  console.warn('DATABASE_URL não definido. Configure o PostgreSQL antes de iniciar a aplicação.');
}

const pool = new Pool({
  connectionString: connectionString || undefined,
  ssl: sslFromEnvAndUrl(connectionString)
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
};
