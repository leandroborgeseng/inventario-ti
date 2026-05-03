const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');

async function main() {
  const users = await query(
    `SELECT usuario, nome, perfil, secretaria, ativo, criado_em
     FROM usuarios
     ORDER BY perfil, usuario`
  );

  console.log(`Usuários cadastrados: ${users.rowCount}`);
  for (const user of users.rows) {
    console.log(`- ${user.usuario} | ${user.perfil} | ${user.ativo ? 'ativo' : 'inativo'} | ${user.secretaria || 'todas'}`);
  }

  if (process.env.RESET_USER && process.env.RESET_PASSWORD) {
    const senhaHash = await bcrypt.hash(process.env.RESET_PASSWORD, 12);
    const result = await query(
      `UPDATE usuarios
       SET senha_hash = $1,
           ativo = true
       WHERE usuario = $2
       RETURNING usuario`,
      [senhaHash, process.env.RESET_USER]
    );

    if (result.rowCount === 0) {
      console.log(`Usuário ${process.env.RESET_USER} não encontrado para reset.`);
    } else {
      console.log(`Senha atualizada para o usuário ${process.env.RESET_USER}.`);
    }
  }

  if (process.env.LOGIN_USER && process.env.LOGIN_PASSWORD) {
    const result = await query(
      `SELECT usuario, senha_hash, ativo
       FROM usuarios
       WHERE usuario = $1`,
      [process.env.LOGIN_USER]
    );
    const user = result.rows[0];

    if (!user) {
      console.log(`Teste de login: usuário ${process.env.LOGIN_USER} não existe.`);
      return;
    }

    const ok = user.ativo && await bcrypt.compare(process.env.LOGIN_PASSWORD, user.senha_hash);
    console.log(`Teste de login para ${process.env.LOGIN_USER}: ${ok ? 'OK' : 'FALHOU'}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
