CREATE TABLE IF NOT EXISTS usuarios (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  secretaria TEXT,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin', 'secretaria')),
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT true;

UPDATE usuarios
SET must_change_password = false
WHERE perfil = 'admin';

CREATE TABLE IF NOT EXISTS computadores (
  id BIGSERIAL PRIMARY KEY,
  placa TEXT NOT NULL UNIQUE,
  bem_patrimonial TEXT NOT NULL,
  setor TEXT,
  dt_aquisicao DATE,
  conservacao TEXT,
  secretaria TEXT NOT NULL,
  status_inventario TEXT CHECK (status_inventario IN ('PRESENTE', 'AUSENTE')),
  numero_serie TEXT NOT NULL DEFAULT '',
  nome_maquina TEXT NOT NULL DEFAULT '',
  ip_maquina TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  preenchido_por_secretaria TEXT,
  atualizado_por BIGINT REFERENCES usuarios(id),
  atualizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE computadores
  ADD COLUMN IF NOT EXISTS numero_serie TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nome_maquina TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ip_maquina TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preenchido_por_secretaria TEXT;

CREATE INDEX IF NOT EXISTS idx_computadores_secretaria ON computadores(secretaria);
CREATE INDEX IF NOT EXISTS idx_computadores_preenchido_por_secretaria ON computadores(preenchido_por_secretaria);
CREATE INDEX IF NOT EXISTS idx_computadores_setor ON computadores(secretaria, setor);
CREATE INDEX IF NOT EXISTS idx_computadores_status ON computadores(secretaria, status_inventario);

CREATE TABLE IF NOT EXISTS historico_alteracoes (
  id BIGSERIAL PRIMARY KEY,
  computador_id BIGINT NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
  status_anterior TEXT,
  status_novo TEXT,
  numero_serie_anterior TEXT,
  numero_serie_novo TEXT,
  nome_maquina_anterior TEXT,
  nome_maquina_novo TEXT,
  ip_maquina_anterior TEXT,
  ip_maquina_novo TEXT,
  observacao_anterior TEXT,
  observacao_nova TEXT,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE historico_alteracoes
  ADD COLUMN IF NOT EXISTS numero_serie_anterior TEXT,
  ADD COLUMN IF NOT EXISTS numero_serie_novo TEXT,
  ADD COLUMN IF NOT EXISTS nome_maquina_anterior TEXT,
  ADD COLUMN IF NOT EXISTS nome_maquina_novo TEXT,
  ADD COLUMN IF NOT EXISTS ip_maquina_anterior TEXT,
  ADD COLUMN IF NOT EXISTS ip_maquina_novo TEXT;

CREATE INDEX IF NOT EXISTS idx_historico_computador ON historico_alteracoes(computador_id);
CREATE INDEX IF NOT EXISTS idx_historico_usuario ON historico_alteracoes(usuario_id);
