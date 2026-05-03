const { Pool } = require('pg');

require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL não definido. Configure o PostgreSQL antes de iniciar a aplicação.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
};
