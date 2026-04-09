# 📦 Controle de Carga

Sistema web para **conferência de objetos por cliente**, com leitura de planilhas Excel e persistência no Supabase.

---

## 🚀 Como configurar

### 1. Supabase (banco de dados)

1. Acesse [supabase.com](https://supabase.com) e faça login
2. Crie um **New Project**
3. Vá em **SQL Editor** e cole o conteúdo de `supabase-schema.sql` → clique em **Run**
4. Vá em **Settings → API** e anote:
   - **Project URL** (ex: `https://abcdefgh.supabase.co`)
   - **anon public** key

### 2. GitHub Pages (hospedagem)

1. Crie um repositório no GitHub, ex: `controle-de-carga`
2. Faça upload dos arquivos: `index.html`, `style.css`, `app.js`
3. Vá em **Settings → Pages**
4. Em **Source**, selecione `Deploy from a branch` → `main` → `/ (root)`
5. Clique em **Save** — o site ficará disponível em `https://seu-usuario.github.io/controle-de-carga`

### 3. Configurar as credenciais no app

1. Abra o site
2. Clique em **Configurar** (canto superior direito)
3. Cole a **URL** e a **Anon Key** do Supabase
4. Clique em **Conectar** — o status ficará verde ✓

---

## 📋 Como usar

### Importar planilha
1. Arraste um arquivo `.xlsx` ou `.xls` para a área de upload
2. O sistema detecta automaticamente as colunas
3. Os dados são salvos no Supabase

### Planilha esperada
| Cliente | Objeto / NF | Descrição | Data Prevista | Status |
|---------|-------------|-----------|---------------|--------|
| EMPRESA A | NF-1234 | Caixas de papelão | 10/04/2026 | Pendente |
| EMPRESA B | NF-5678 | Eletrônicos | 11/04/2026 | Recebido |

> **Dica:** O cabeçalho pode ter nomes diferentes — o sistema tenta detectar automaticamente. Caso não consiga, exibe um mapeamento manual.

### Marcar como recebido
- Clique no botão de status de cada item para alternar entre **Aguardando** e **Recebido**
- O status é salvo automaticamente no banco

### Filtros
- Busca por nome do cliente ou número do objeto
- Filtro por cliente específico
- Filtro por status (Aguardando / Recebido)

### Exportar
- Clique em **Exportar** para baixar um `.xlsx` com os status atualizados

---

## 🗂️ Estrutura de arquivos

```
controle-de-carga/
├── index.html          ← Interface principal
├── style.css           ← Estilos (dark mode)
├── app.js              ← Lógica + integração Supabase
├── supabase-schema.sql ← Script SQL para criar as tabelas
├── exemplo-carga.xlsx  ← Planilha de exemplo para teste
└── README.md           ← Este guia
```

---

## 🔒 Segurança

- As credenciais do Supabase ficam salvas **apenas no navegador** (`localStorage`)
- A chave `anon` é pública por design — o acesso é controlado pelas políticas **Row Level Security** no Supabase
- Para uso interno de empresa, as políticas permitem leitura e escrita sem autenticação
- Para ambientes com múltiplos usuários, recomenda-se habilitar autenticação no Supabase

---

## ⚙️ Tecnologias

| Tecnologia | Uso |
|-----------|-----|
| HTML/CSS/JS puro | Frontend sem framework |
| [SheetJS](https://sheetjs.com/) | Leitura de arquivos Excel |
| [Supabase JS SDK](https://supabase.com/docs/reference/javascript) | Banco de dados PostgreSQL |
| GitHub Pages | Hospedagem gratuita |
