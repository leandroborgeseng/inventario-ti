const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');

const INVENTARIO_PATH = path.join(__dirname, 'inventario_computadores.json');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const CREDENCIAIS_PATH = path.join(__dirname, 'usuarios_criados.json');

async function main() {
  const schema = await fs.readFile(SCHEMA_PATH, 'utf8');
  await query(schema);

  const raw = await fs.readFile(INVENTARIO_PATH, 'utf8');
  const data = JSON.parse(raw);
  const secretarias = data?.inventario?.secretarias || {};
  const credenciaisCriadas = [];

  const adminPassword = process.env.ADMIN_PASSWORD || gerarSenha();
  const adminCriado = await criarUsuario({
    nome: 'Administrador',
    usuario: 'admin',
    senha: adminPassword,
    secretaria: null,
    perfil: 'admin'
  });

  if (adminCriado) {
    credenciaisCriadas.push({
      nome: 'Administrador',
      usuario: 'admin',
      senha: adminPassword,
      perfil: 'admin'
    });
  }

  for (const [secretaria, computadores] of Object.entries(secretarias)) {
    const usuario = gerarUsuarioSecretaria(secretaria);
    const senha = process.env.DEFAULT_SECRETARIA_PASSWORD || gerarSenha();
    const criado = await criarUsuario({
      nome: secretaria,
      usuario,
      senha,
      secretaria,
      perfil: 'secretaria'
    });

    if (criado) {
      credenciaisCriadas.push({ nome: secretaria, usuario, senha, perfil: 'secretaria' });
    }

    for (const computador of computadores) {
      await query(
        `INSERT INTO computadores (
          placa,
          bem_patrimonial,
          setor,
          dt_aquisicao,
          conservacao,
          secretaria,
          status_inventario,
          numero_serie,
          observacao
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (placa) DO UPDATE SET
          bem_patrimonial = EXCLUDED.bem_patrimonial,
          setor = EXCLUDED.setor,
          dt_aquisicao = EXCLUDED.dt_aquisicao,
          conservacao = EXCLUDED.conservacao,
          secretaria = EXCLUDED.secretaria`,
        [
          computador.placa,
          computador.bem_patrimonial || '',
          computador.setor || '',
          computador.dt_aquisicao || null,
          computador.conservacao || '',
          secretaria,
          computador.status_inventario || null,
          computador.numero_serie || '',
          computador.observacao || ''
        ]
      );
    }
  }

  if (credenciaisCriadas.length) {
    await fs.writeFile(CREDENCIAIS_PATH, JSON.stringify(credenciaisCriadas, null, 2));
    console.log(`Credenciais criadas em ${CREDENCIAIS_PATH}`);
  } else {
    console.log('Nenhum usuário novo criado. As credenciais existentes foram preservadas.');
  }

  console.log('Importação concluída.');
}

async function criarUsuario({ nome, usuario, senha, secretaria, perfil }) {
  const senhaHash = await bcrypt.hash(senha, 12);
  const result = await query(
    `INSERT INTO usuarios (nome, usuario, senha_hash, secretaria, perfil)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (usuario) DO NOTHING
     RETURNING id`,
    [nome, usuario, senhaHash, secretaria, perfil]
  );

  return result.rowCount > 0;
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
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
