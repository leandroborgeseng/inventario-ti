const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const STATUS_VALIDOS = new Set(['PRESENTE', 'AUSENTE']);

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new PgSession({
    pool,
    createTableIfMissing: true
  }),
  name: 'inventario.sid',
  secret: process.env.SESSION_SECRET || 'troque-este-segredo-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  const result = await query(
    `SELECT id, nome, usuario, senha_hash, secretaria, perfil, must_change_password
     FROM usuarios
     WHERE usuario = $1 AND ativo = true`,
    [usuario]
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  req.session.user = sanitizeUser(user);
  return res.json({ user: req.session.user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('inventario.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { senha_atual, nova_senha } = req.body || {};

  if (!senha_atual || !nova_senha) {
    return res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
  }

  if (String(nova_senha).length < 8) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  }

  const result = await query(
    `SELECT id, senha_hash
     FROM usuarios
     WHERE id = $1 AND ativo = true`,
    [req.session.user.id]
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(senha_atual, user.senha_hash))) {
    return res.status(401).json({ error: 'Senha atual inválida.' });
  }

  const senhaHash = await bcrypt.hash(nova_senha, 12);
  await query(
    `UPDATE usuarios
     SET senha_hash = $1,
         must_change_password = false
     WHERE id = $2`,
    [senhaHash, req.session.user.id]
  );

  req.session.user.must_change_password = false;
  return res.json({ user: req.session.user });
});

app.get('/api/admin/users', requireAuth, requirePasswordReady, requireAdmin, async (req, res) => {
  const result = await query(
    `SELECT id, nome, usuario, secretaria, perfil, ativo, must_change_password
     FROM usuarios
     WHERE perfil = 'secretaria'
     ORDER BY nome`
  );

  res.json({ users: result.rows });
});

app.patch('/api/admin/users/:id/reset-password', requireAuth, requirePasswordReady, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { senha_temporaria } = req.body || {};

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Usuário inválido.' });
  }

  if (!senha_temporaria || String(senha_temporaria).length < 8) {
    return res.status(400).json({ error: 'A senha temporária deve ter pelo menos 8 caracteres.' });
  }

  const senhaHash = await bcrypt.hash(senha_temporaria, 12);
  const result = await query(
    `UPDATE usuarios
     SET senha_hash = $1,
         must_change_password = true,
         ativo = true
     WHERE id = $2 AND perfil = 'secretaria'
     RETURNING id, nome, usuario, secretaria, perfil, ativo, must_change_password`,
    [senhaHash, id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Usuário de secretaria não encontrado.' });
  }

  return res.json({ user: result.rows[0] });
});

app.get('/api/secretarias', requireAuth, requirePasswordReady, async (req, res) => {
  const params = [];
  let where = '';

  if (req.session.user.perfil !== 'admin') {
    params.push(req.session.user.secretaria);
    where = 'WHERE secretaria = $1 OR preenchido_por_secretaria = $1';
  }

  const result = await query(
    `SELECT
      secretaria,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status_inventario = 'PRESENTE')::int AS presentes,
      COUNT(*) FILTER (WHERE status_inventario = 'AUSENTE')::int AS ausentes,
      COUNT(*) FILTER (WHERE status_inventario IS NULL)::int AS pendentes
    FROM computadores
    ${where}
    GROUP BY secretaria
    ORDER BY secretaria`,
    params
  );

  res.json({
    secretarias: result.rows.map((row) => ({
      ...row,
      verificados: row.presentes + row.ausentes,
      percentual: row.total ? Math.round(((row.presentes + row.ausentes) / row.total) * 100) : 0
    }))
  });
});

app.get('/api/secretarias/:secretaria/computadores', requireAuth, requirePasswordReady, async (req, res) => {
  const { secretaria } = req.params;
  const { status, setor, busca } = req.query;
  const params = [];
  const where = [];
  const isAdmin = req.session.user.perfil === 'admin';
  const hasBusca = Boolean(String(busca || '').trim());

  if (isAdmin) {
    params.push(secretaria);
    where.push(`secretaria = $${params.length}`);
  } else if (hasBusca) {
    // A busca por placa patrimonial precisa consultar a base inteira.
    params.push(`%${String(busca).trim()}%`);
    where.push(`placa ILIKE $${params.length}`);
  } else {
    params.push(secretaria);
    where.push(`secretaria = $${params.length}`);
    params.push(req.session.user.secretaria);
    where.push(`(secretaria = $${params.length} OR preenchido_por_secretaria = $${params.length})`);
  }

  if (!hasBusca && status === 'pendentes') {
    where.push('status_inventario IS NULL');
  } else if (!hasBusca && status === 'presentes') {
    params.push('PRESENTE');
    where.push(`status_inventario = $${params.length}`);
  } else if (!hasBusca && status === 'ausentes') {
    params.push('AUSENTE');
    where.push(`status_inventario = $${params.length}`);
  }

  if (!hasBusca && setor && setor !== 'todos') {
    params.push(setor);
    where.push(`COALESCE(NULLIF(TRIM(setor), ''), 'Sem setor') = $${params.length}`);
  }

  const result = await query(
    `SELECT
      id,
      placa,
      bem_patrimonial,
      setor,
      to_char(dt_aquisicao, 'YYYY-MM-DD') AS dt_aquisicao,
      conservacao,
      secretaria,
      status_inventario,
      numero_serie,
      nome_maquina,
      ip_maquina,
      observacao,
      atualizado_em,
      preenchido_por_secretaria,
      CASE
        WHEN $${params.length + 1}::text IS NULL THEN false
        ELSE secretaria <> $${params.length + 1}
      END AS fora_secretaria
    FROM computadores
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE WHEN status_inventario IS NULL THEN 0 ELSE 1 END,
      setor NULLS LAST,
      placa`,
    [...params, isAdmin ? null : req.session.user.secretaria]
  );

  res.json({ computadores: result.rows });
});

app.get('/api/secretarias/:secretaria/setores', requireAuth, requirePasswordReady, async (req, res) => {
  const params = [req.params.secretaria];
  let visibility = '';

  if (req.session.user.perfil !== 'admin') {
    params.push(req.session.user.secretaria);
    visibility = 'AND (secretaria = $2 OR preenchido_por_secretaria = $2)';
  }

  const result = await query(
    `SELECT COALESCE(NULLIF(TRIM(setor), ''), 'Sem setor') AS setor
     FROM computadores
     WHERE secretaria = $1
     ${visibility}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  res.json({ setores: result.rows.map((row) => row.setor) });
});

app.patch('/api/computadores/:id', requireAuth, requirePasswordReady, async (req, res) => {
  const id = Number(req.params.id);
  const {
    status_inventario,
    nome_maquina = '',
    ip_maquina = '',
    observacao = ''
  } = req.body || {};

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Computador inválido.' });
  }

  if (status_inventario !== null && !STATUS_VALIDOS.has(status_inventario)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `SELECT *
       FROM computadores
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    const current = currentResult.rows[0];

    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Computador não encontrado.' });
    }

    if (!canUpdateComputer(req.session.user, current)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Acesso negado para esta secretaria.' });
    }

    const preenchidoPorSecretaria = req.session.user.perfil === 'secretaria'
      ? req.session.user.secretaria
      : current.preenchido_por_secretaria;
    const novoNomeMaquina = String(nome_maquina || '').trim();
    const novoIpMaquina = String(ip_maquina || '').trim();
    const novaObservacao = String(observacao || '').trim();

    const updatedResult = await client.query(
      `UPDATE computadores
       SET status_inventario = $1,
           nome_maquina = $2,
           ip_maquina = $3,
           observacao = $4,
           preenchido_por_secretaria = $5,
           atualizado_por = $6,
           atualizado_em = now()
       WHERE id = $7
       RETURNING
         id,
         placa,
         bem_patrimonial,
         setor,
         to_char(dt_aquisicao, 'YYYY-MM-DD') AS dt_aquisicao,
         conservacao,
         secretaria,
         status_inventario,
         numero_serie,
         nome_maquina,
         ip_maquina,
         observacao,
         atualizado_em,
         preenchido_por_secretaria`,
      [status_inventario, novoNomeMaquina, novoIpMaquina, novaObservacao, preenchidoPorSecretaria, req.session.user.id, id]
    );

    await client.query(
      `INSERT INTO historico_alteracoes (
        computador_id,
        usuario_id,
        status_anterior,
        status_novo,
        numero_serie_anterior,
        numero_serie_novo,
        nome_maquina_anterior,
        nome_maquina_novo,
        ip_maquina_anterior,
        ip_maquina_novo,
        observacao_anterior,
        observacao_nova
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        req.session.user.id,
        current.status_inventario,
        status_inventario,
        current.numero_serie || '',
        current.numero_serie || '',
        current.nome_maquina || '',
        novoNomeMaquina,
        current.ip_maquina || '',
        novoIpMaquina,
        current.observacao || '',
        novaObservacao
      ]
    );

    await client.query('COMMIT');
    return res.json({ computador: updatedResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ error: 'Erro ao salvar alteração.' });
  } finally {
    client.release();
  }
});

app.get('/api/exportar', requireAuth, requirePasswordReady, async (req, res) => {
  const params = [];
  let where = '';

  if (req.session.user.perfil !== 'admin') {
    params.push(req.session.user.secretaria);
    where = 'WHERE c.secretaria = $1 OR c.preenchido_por_secretaria = $1';
  }

  const result = await query(
    `SELECT
      c.placa,
      c.bem_patrimonial,
      c.setor,
      to_char(c.dt_aquisicao, 'YYYY-MM-DD') AS dt_aquisicao,
      c.conservacao,
      c.secretaria,
      c.status_inventario,
      c.numero_serie,
      c.nome_maquina,
      c.ip_maquina,
      c.observacao,
      c.preenchido_por_secretaria,
      c.atualizado_em,
      u.usuario AS atualizado_por_usuario,
      u.nome AS atualizado_por_nome
    FROM computadores c
    LEFT JOIN usuarios u ON u.id = c.atualizado_por
    ${where}
    ORDER BY c.secretaria, c.setor, c.placa`,
    params
  );

  const secretarias = {};
  for (const row of result.rows) {
    if (!secretarias[row.secretaria]) {
      secretarias[row.secretaria] = [];
    }

    secretarias[row.secretaria].push({
      placa: row.placa,
      bem_patrimonial: row.bem_patrimonial,
      setor: row.setor,
      dt_aquisicao: row.dt_aquisicao,
      conservacao: row.conservacao,
      status_inventario: row.status_inventario,
      numero_serie: row.numero_serie || '',
      nome_maquina: row.nome_maquina || '',
      ip_maquina: row.ip_maquina || '',
      observacao: row.observacao || '',
      preenchido_por_secretaria: row.preenchido_por_secretaria || null,
      atualizado_por_usuario: row.atualizado_por_usuario || null,
      atualizado_por_nome: row.atualizado_por_nome || null,
      atualizado_em: row.atualizado_em
    });
  }

  const payload = {
    exportado_em: new Date().toISOString(),
    exportado_por: req.session.user.usuario,
    inventario: {
      total_maquinas: result.rowCount,
      total_secretarias: Object.keys(secretarias).length,
      secretarias
    }
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="inventario_resultados_${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function ensureSchema() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
}

async function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }

  const result = await query(
    `SELECT id, nome, usuario, secretaria, perfil, must_change_password
     FROM usuarios
     WHERE id = $1 AND ativo = true`,
    [req.session.user.id]
  );
  const user = result.rows[0];

  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }

  req.session.user = sanitizeUser(user);
  return next();
}

function requirePasswordReady(req, res, next) {
  if (req.session.user.must_change_password) {
    return res.status(403).json({ error: 'Troque sua senha antes de continuar.', must_change_password: true });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (req.session.user.perfil !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  return next();
}

function canUpdateComputer(user) {
  return user.perfil === 'admin' || user.perfil === 'secretaria';
}

function sanitizeUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    usuario: user.usuario,
    secretaria: user.secretaria,
    perfil: user.perfil,
    must_change_password: user.must_change_password
  };
}

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Inventário TI rodando na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Erro ao preparar banco de dados:', error);
    process.exit(1);
  });
