-- ============================================================
-- CONTROLE DE CARGAS — Supabase Schema
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS cargas (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo_rastreio  TEXT NOT NULL,
  cliente          TEXT NOT NULL,
  tipo_servico     TEXT NOT NULL CHECK (tipo_servico IN ('PAC', 'SEDEX', 'PAC MINI')),
  data_agendada    DATE NOT NULL,
  recebido         BOOLEAN DEFAULT false,
  data_recebimento TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_cargas_data       ON cargas(data_agendada);
CREATE INDEX IF NOT EXISTS idx_cargas_recebido   ON cargas(recebido);
CREATE INDEX IF NOT EXISTS idx_cargas_codigo     ON cargas(codigo_rastreio);
CREATE INDEX IF NOT EXISTS idx_cargas_cliente    ON cargas(cliente);

-- RLS
ALTER TABLE cargas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_select" ON cargas FOR SELECT USING (true);
CREATE POLICY "public_insert" ON cargas FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update" ON cargas FOR UPDATE USING (true);
CREATE POLICY "public_delete" ON cargas FOR DELETE USING (true);
