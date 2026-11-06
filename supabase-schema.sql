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

-- ============================================================
-- CLIENTES — cadastro fixo de clientes (lista fechada)
-- Evita duplicidade tipo "Empresa A" vs "empresa a".
-- O índice único é case-insensitive (LOWER), então
-- "Empresa A" e "EMPRESA A" são tratados como o mesmo cliente.
-- ============================================================

CREATE TABLE IF NOT EXISTS clientes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_nome_lower ON clientes (LOWER(nome));

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cli_select" ON clientes FOR SELECT USING (true);
CREATE POLICY "cli_insert" ON clientes FOR INSERT WITH CHECK (true);
CREATE POLICY "cli_update" ON clientes FOR UPDATE USING (true);
CREATE POLICY "cli_delete" ON clientes FOR DELETE USING (true);

-- ============================================================
-- ETIQUETAS — etiquetas que o cliente avisou que vai trazer
-- Substitui a planilha do atendimento: o pessoal vai lançando
-- durante o dia e, depois que o Operacional fecha o dia e as
-- etiquetas são vendidas, elas são LIBERADAS e viram cargas.
-- Enquanto estão 'aguardando' não aparecem na bipagem.
-- ============================================================

CREATE TABLE IF NOT EXISTS etiquetas (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo_rastreio  TEXT NOT NULL,
  cliente          TEXT NOT NULL,
  tipo_servico     TEXT NOT NULL CHECK (tipo_servico IN ('PAC', 'SEDEX', 'PAC MINI')),
  status           TEXT NOT NULL DEFAULT 'aguardando',  -- aguardando | liberado
  data_prevista    DATE,
  liberado_em      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_etiquetas_status  ON etiquetas(status);
CREATE INDEX IF NOT EXISTS idx_etiquetas_codigo  ON etiquetas(codigo_rastreio);

ALTER TABLE etiquetas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etq_select" ON etiquetas FOR SELECT USING (true);
CREATE POLICY "etq_insert" ON etiquetas FOR INSERT WITH CHECK (true);
CREATE POLICY "etq_update" ON etiquetas FOR UPDATE USING (true);
CREATE POLICY "etq_delete" ON etiquetas FOR DELETE USING (true);

-- ============================================================
-- BIPES — histórico permanente de TODAS as leituras
-- Guarda também as que deram erro (não cadastrado, etiqueta
-- duplicada, falha ao salvar). Serve para descobrir depois se
-- um objeto chegou a ser lido mesmo sem ficar como recebido.
-- ============================================================

CREATE TABLE IF NOT EXISTS bipes (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo_rastreio  TEXT NOT NULL,
  cliente          TEXT,
  resultado        TEXT NOT NULL,   -- ok | nao_cadastrado | duplicado | erro
  mensagem         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bipes_data      ON bipes(created_at);
CREATE INDEX IF NOT EXISTS idx_bipes_codigo    ON bipes(codigo_rastreio);
CREATE INDEX IF NOT EXISTS idx_bipes_resultado ON bipes(resultado);

ALTER TABLE bipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bipes_select" ON bipes FOR SELECT USING (true);
CREATE POLICY "bipes_insert" ON bipes FOR INSERT WITH CHECK (true);

-- Semeia a tabela de clientes a partir dos clientes que já existem
-- em cargas (executa sem erro mesmo se rodar mais de uma vez).
INSERT INTO clientes (nome)
SELECT DISTINCT cliente FROM cargas
WHERE cliente IS NOT NULL AND TRIM(cliente) <> ''
ON CONFLICT (LOWER(nome)) DO NOTHING;
