# Inventário TI

Sistema web para inventário físico de computadores por secretaria, com login, PostgreSQL e histórico de alterações.

## Rodar localmente

1. Instale as dependências:

```bash
npm install
```

2. Crie um `.env` baseado no `.env.example` e informe `DATABASE_URL`.

3. Importe o JSON inicial:

```bash
npm run importar
```

O importador cria `usuarios_criados.json` com os usuários e senhas gerados. Esse arquivo fica ignorado pelo Git.

Se os usuários já existirem e você precisar aplicar novamente as senhas definidas em `ADMIN_PASSWORD` e `DEFAULT_SECRETARIA_PASSWORD`, rode:

```bash
RESET_PASSWORDS=true npm run importar
```

4. Inicie o sistema:

```bash
npm start
```

Acesse `http://localhost:3000`.

## Railway

1. Crie um projeto no Railway.
2. Adicione um banco PostgreSQL.
3. Configure as variáveis `DATABASE_URL`, `SESSION_SECRET` e `ADMIN_PASSWORD`.
4. Faça o deploy do projeto.
5. Execute `npm run importar` uma vez para carregar `inventario_computadores.json` e criar os usuários.

Cada usuário de secretaria visualiza apenas sua própria secretaria. O usuário `admin` visualiza todas.
