const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');

const INVENTARIO_PATH = path.join(__dirname, 'inventario_computadores.json');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const CREDENCIAIS_PATH = path.join(__dirname, 'usuarios_criados.json');
const ATUALIZAR_SENHAS = process.env.RESET_PASSWORDS === 'true';

/** Sobrescreve status físico no banco pelo JSON (usa null no JSON como “pendente”). */
const REPLACE_STATUS_FROM_JSON =
  process.env.IMPORT_REPLACE_STATUS_FROM_JSON === 'true';

function parseDataAquisicao(valor) {
  if (!valor) {
    return null;
  }

  const texto = String(valor).trim();
  const formatoIso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const formatoBr = /^(\d{2})\/(\d{2})\/(\d{4})$/;

  if (formatoIso.test(texto)) {
    return texto;
  }

  const matchBr = texto.match(formatoBr);
  if (!matchBr) {
    throw new Error(`Data de aquisição inválida: ${texto}`);
  }

  const [, dia, mes, ano] = matchBr;
  return `${ano}-${mes}-${dia}`;
}

function normalizarStatusInventario(valor) {
  if (valor == null || String(valor).trim() === '') {
    return null;
  }

  const s = String(valor).trim().toUpperCase();
  if (s === 'PRESENTE' || s === 'AUSENTE') {
    return s;
  }

  throw new Error(
    `status_inventario inválido (${JSON.stringify(valor)}). Use PRESENTE, AUSENTE ou omita/null.`
  );
}

function listaComputadoresSecretaria(secretariaNome, entrada) {
  if (Array.isArray(entrada)) {
    return entrada;
  }

  console.warn(
    `[importar] Secretaria "${secretariaNome}" não é um array válido — ignoramos (${typeof entrada}).`
  );

  return [];
}

async function main() {
  const dbUrl = typeof process.env.DATABASE_URL === 'string'
    ? process.env.DATABASE_URL.trim()
    : '';

  if (!dbUrl) {
    console.error(
      '[importar] DATABASE_URL vazio ou ausente. Na Railway referencie o PostgreSQL ao serviço web para injetar a URL.'
    );
    throw new Error('DATABASE_URL obrigatório');
  }

  console.log('[importar] PostgreSQL configurado:', dbUrl.includes('@') ? '[redacted URL]' : dbUrl.slice(0, 12));

  const schema = await fs.readFile(SCHEMA_PATH, 'utf8');
  await query(schema);
  console.log('[importar] schema.sql aplicado.');

  const raw = await fs.readFile(INVENTARIO_PATH, 'utf8');
  const data = JSON.parse(raw);

  const inv = data?.inventario;
  if (!inv || typeof inv.secretarias !== 'object' || inv.secretarias === null) {
    throw new Error(
      'JSON inválido: falta objeto inventario.secretarias ou não é um objeto.'
    );
  }

  const secretarias = inv.secretarias;
  const nomeSecretarias = Object.keys(secretarias);
  let totalJson = nomeSecretarias.reduce((acc, nome) => {
    const lst = listaComputadoresSecretaria(nome, secretarias[nome]);

    return acc + lst.length;
  }, 0);

  console.log(
    `[importar] secretarias=${nomeSecretarias.length} computadores no JSON=${totalJson} REPLACE_STATUS_FROM_JSON=${REPLACE_STATUS_FROM_JSON}`
  );

  const credenciaisCriadas = [];

  const adminPassword = process.env.ADMIN_PASSWORD || gerarSenha();
  const adminResultado = await criarUsuario({
    nome: 'Administrador',
    usuario: 'admin',
    senha: adminPassword,
    secretaria: null,
    perfil: 'admin',
    atualizarSenha: Boolean(process.env.ADMIN_PASSWORD) && ATUALIZAR_SENHAS,
    mustChangePassword: false
  });

  if (adminResultado) {
    credenciaisCriadas.push({
      nome: 'Administrador',
      usuario: 'admin',
      senha: adminPassword,
      perfil: 'admin',
      acao: adminResultado
    });
  }

  let upsertsOk = 0;

  for (const [secretaria, entradaComputadores] of Object.entries(secretarias)) {
    const computadoresLista = listaComputadoresSecretaria(
      secretaria,
      entradaComputadores
    );

    const usuario = gerarUsuarioSecretaria(secretaria);
    const senha = process.env.DEFAULT_SECRETARIA_PASSWORD || gerarSenha();
    const resultado = await criarUsuario({
      nome: secretaria,
      usuario,
      senha,
      secretaria,
      perfil: 'secretaria',
      atualizarSenha: Boolean(process.env.DEFAULT_SECRETARIA_PASSWORD) &&
        ATUALIZAR_SENHAS,
      mustChangePassword: true
    });

    if (resultado) {
      credenciaisCriadas.push({
        nome: secretaria,
        usuario,
        senha,
        perfil: 'secretaria',
        acao: resultado
      });
    }

    for (const computadorRaw of computadoresLista) {
      const computador = computadorRaw && typeof computadorRaw === 'object'
        ? computadorRaw
        : null;

      if (!computador) {
        console.warn('[importar] Item ignorado (não objeto) em:', secretaria);
        continue;
      }

      const placa = computador.placa != null ? String(computador.placa).trim() : '';

      if (!placa) {
        console.warn('[importar] Registro sem placa ignorado:', secretaria, computador);
        continue;
      }

      const statusSql = REPLACE_STATUS_FROM_JSON
        ? 'status_inventario = EXCLUDED.status_inventario,'
        : '';

      await query(
        `INSERT INTO computadores (
          placa,
          bem_patrimonial,
          tipo,
          setor,
          dt_aquisicao,
          conservacao,
          secretaria,
          status_inventario,
          numero_serie,
          nome_maquina,
          ip_maquina,
          observacao
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (placa) DO UPDATE SET
          bem_patrimonial = EXCLUDED.bem_patrimonial,
          tipo = EXCLUDED.tipo,
          setor = EXCLUDED.setor,
          dt_aquisicao = EXCLUDED.dt_aquisicao,
          conservacao = EXCLUDED.conservacao,
          secretaria = EXCLUDED.secretaria,
          ${statusSql}
          nome_maquina = COALESCE(NULLIF(computadores.nome_maquina, ''), EXCLUDED.nome_maquina),
          ip_maquina = COALESCE(NULLIF(computadores.ip_maquina, ''), EXCLUDED.ip_maquina),
          numero_serie = COALESCE(NULLIF(computadores.numero_serie, ''), EXCLUDED.numero_serie),
          observacao = COALESCE(NULLIF(computadores.observacao, ''), EXCLUDED.observacao)`,
        [
          placa,
          computador.bem_patrimonial || '',
          computador.tipo || '',
          computador.setor || '',
          parseDataAquisicao(computador.dt_aquisicao),
          computador.conservacao || '',
          secretaria,
          normalizarStatusInventario(computador.status_inventario),
          computador.numero_serie ? String(computador.numero_serie) : '',
          computador.nome_maquina ? String(computador.nome_maquina) : '',
          computador.ip_maquina ? String(computador.ip_maquina) : '',
          computador.observacao || ''
        ]
      );

      upsertsOk += 1;
    }
  }

  const countRows = await query('SELECT COUNT(*)::bigint AS total FROM computadores');
  console.log('[importar] Linhas/processadas UPSERT=', upsertsOk, '| COUNT(computadores)=', Number(countRows.rows[0]?.total ?? 0));

  if (credenciaisCriadas.length) {
    try {
      await fs.writeFile(CREDENCIAIS_PATH, JSON.stringify(credenciaisCriadas, null, 2));
      console.log(`Credenciais criadas em ${CREDENCIAIS_PATH}`);
    } catch (err) {
      console.warn(
        'Não foi possível gravar usuarios_criados.json (comum em pré-deploy na nuvem).',
        err && err.code ? `[${err.code}]` : err.message || err
      );
    }
  } else {
    console.log('Nenhum usuário novo criado. As credenciais existentes foram preservadas.');
  }

  console.log('Importação concluída.');
}

async function criarUsuario({ nome, usuario, senha, secretaria, perfil, atualizarSenha, mustChangePassword }) {
  const senhaHash = await bcrypt.hash(senha, 12);
  const result = await query(
    `INSERT INTO usuarios (nome, usuario, senha_hash, secretaria, perfil, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (usuario) DO NOTHING
     RETURNING id`,
    [nome, usuario, senhaHash, secretaria, perfil, mustChangePassword]
  );

  if (result.rowCount > 0) {
    return 'criado';
  }

  if (!atualizarSenha) {
    return null;
  }

  await query(
    `UPDATE usuarios
     SET senha_hash = $1,
         nome = $2,
         secretaria = $3,
         perfil = $4,
         ativo = true,
         must_change_password = $5
     WHERE usuario = $6`,
    [senhaHash, nome, secretaria, perfil, mustChangePassword, usuario]
  );

  return 'senha_atualizada';
}

function gerarUsuarioSecretaria(secretaria) {
  return secretaria
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48);
}

function gerarSenha() {
  return crypto.randomBytes(6).toString('base64url');
}

main()
  .catch((error) => {
    console.error('[importar]', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
