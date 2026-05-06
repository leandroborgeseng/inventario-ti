-- Permite registrar equipamento físico presente mas sem obter série/IP (ex.: não liga).

ALTER TABLE computadores DROP CONSTRAINT IF EXISTS computadores_status_inventario_check;

ALTER TABLE computadores
  ADD CONSTRAINT computadores_status_inventario_check
  CHECK (
    status_inventario IS NULL
    OR status_inventario IN ('PRESENTE', 'AUSENTE', 'PRESENTE_SEM_FUNCIONAMENTO')
  );
