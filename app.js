/* ============================================================
   CONTROLE DE CARGAS — app.js
   Supabase + html5-qrcode + SheetJS + Web Audio API
   ============================================================ */

// ─── Supabase ─────────────────────────────────────────────────────────────────
let sb = null;

function initSB(url, key) {
  try {
    sb = window.supabase.createClient(url, key);
    return true;
  } catch { return false; }
}

// ─── Audio (Web Audio API) ───────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function beep(type) {
  try {
    if (!audioCtx) audioCtx = new AudioCtx();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      // Two short high beeps
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
    } else {
      // Low buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    }

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.65);
  } catch (e) { console.warn('Audio error:', e); }
}

// ─── State ────────────────────────────────────────────────────────────────────
let cameraScanner   = null;  // html5-qrcode instance (conferência)
let cadScanner      = null;  // html5-qrcode instance (cadastro)
let cameraActive    = false;
let currentCameraId = null;
let allCameras      = [];
let lastScanCode    = '';
let lastScanTime    = 0;
let scanCooldown    = false;

const TIPOS = ['PAC', 'SEDEX', 'PAC MINI'];
let clientesSugeridos = [];

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Set default dates to today
  const hoje = todayISO();
  document.getElementById('inpData').value = hoje;

  // Inicializa data selecionada na consulta como hoje
  window._consultaDataSelecionada = hoje;

  // Inicializa o calendário da consulta
  inicializarCalendario();

  // Relatório por cliente: período padrão dos últimos 30 dias
  const trintaDiasAtras = new Date();
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
  document.getElementById('relDataInicio').value = trintaDiasAtras.toISOString().slice(0, 10);
  document.getElementById('relDataFim').value = hoje;

  // Etiquetas: liberação cai por padrão no dia seguinte
  document.getElementById('etqDataPrevista').value = amanhaISO();
  document.getElementById('etqCodigos').addEventListener('input', atualizarContadorEtiquetas);

  // Seletores de cliente com busca e barra de rolagem (abrem sempre para baixo)
  SELECTS_CLIENTE.forEach(id => criarSelectBusca(document.getElementById(id)));

  // Enter key on manual scan
  document.getElementById('inpManual').addEventListener('keydown', e => {
    if (e.key === 'Enter') conferirManual();
  });

  // Volta para o último modo de cadastro usado (um objeto / em lote)
  setModoCadastro(localStorage.getItem('cc_modo_cadastro') || 'unico');

  // Sem senha: conecta e carrega os dados direto
  iniciarApp();
});

function iniciarApp() {
  const cfg = loadCfg();
  if (cfg) {
    setDbStatus('connecting');
    if (initSB(cfg.url, cfg.key)) verificarConexao();
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
function loadCfg() {
  const url = localStorage.getItem('cc_sb_url') || 'https://nouskkxjabjciadoseco.supabase.co';
  const key = localStorage.getItem('cc_sb_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vdXNra3hqYWJqY2lhZG9zZWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjEzMDYsImV4cCI6MjA5MTI5NzMwNn0.W_WMDTgb3d_0_gJksKc5Z8GIylyooUtJ8_utkPqzQXU';
  return { url, key };
}

function salvarConfig() {
  const url = document.getElementById('cfgUrl').value.trim();
  const key = document.getElementById('cfgKey').value.trim();
  if (!url || !key) { showToast('⚠️ Preencha URL e Chave.'); return; }
  localStorage.setItem('cc_sb_url', url);
  localStorage.setItem('cc_sb_key', key);
  setDbStatus('connecting');
  if (!initSB(url, key)) { setDbStatus('disconnected'); return; }
  verificarConexao();
  closeModal('modalConfig');
}

function openConfig() {
  const cfg = loadCfg();
  if (cfg) {
    document.getElementById('cfgUrl').value = cfg.url;
    document.getElementById('cfgKey').value = cfg.key;
  }
  openModal('modalConfig');
}

async function verificarConexao() {
  try {
    const { error } = await sb.from('cargas').select('id').limit(1);
    if (error) throw error;
    setDbStatus('connected');
    carregarTudo();
  } catch (e) {
    setDbStatus('disconnected');
    showToast('⚠️ Falha na conexão com o Supabase.');
    console.warn(e.message);
  }
}

function setDbStatus(status) {
  const el = document.getElementById('dbStatusLabel');
  el.className = 'brand-sub ' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : '');
  el.textContent = status === 'connected' ? '● Conectado' : status === 'connecting' ? '● Conectando...' : '○ Sem conexão';
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.getElementById(tabId).style.display = 'block';

  // Load data when switching tabs
  if (tabId === 'tabCadastro')    { carregarListaHoje(); if (modoCadastro === 'lote') carregarEtiquetas(); }
  if (tabId === 'tabConferencia') { carregarLogHoje(); carregarPendentesAnteriores(); }
  if (tabId === 'tabConsulta')    carregarConsulta();
}

// ─── Load all initial data ────────────────────────────────────────────────────
function carregarTudo() {
  carregarListaHoje();
  carregarClientesSugeridos();
  carregarLogHoje();
  carregarPendentesAnteriores();
}

// ─── Clientes (lista fechada) ─────────────────────────────────────────────────
async function carregarClientesSugeridos() {
  if (!sb) return;
  // Tenta a lista fechada (tabela clientes). Se a tabela não existir,
  // deriva a lista dos clientes que já aparecem nos objetos cadastrados.
  const { data, error } = await sb
    .from('clientes')
    .select('nome')
    .order('nome');
  if (!error && data) {
    clientesSugeridos = data.map(r => r.nome);
  } else {
    clientesSugeridos = await clientesDeCargas();
  }
  popularSelectsClientes();
}

// Lista de clientes distintos extraída dos objetos já cadastrados (fallback)
async function clientesDeCargas() {
  // O Supabase devolve no máximo 1000 linhas por consulta: busca em páginas,
  // senão clientes que só aparecem depois da linha 1000 somem da lista.
  const PAGINA = 1000;
  const mapa = new Map(); // chave em minúsculas → nome como foi digitado
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await sb
      .from('cargas')
      .select('cliente')
      .order('created_at', { ascending: false }) // grafia mais recente prevalece
      .range(de, de + PAGINA - 1);
    if (error || !data) break;
    data.forEach(r => {
      const nome = (r.cliente || '').trim();
      if (nome && !mapa.has(nome.toLowerCase())) mapa.set(nome.toLowerCase(), nome);
    });
    if (data.length < PAGINA) break;
  }
  return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Popula os seletores fechados de cliente (cadastro e edição), preservando a seleção atual
function popularSelectsClientes() {
  const options = clientesSugeridos.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

  const selCadastro = document.getElementById('inpCliente');
  if (selCadastro) {
    const atual = selCadastro.value;
    selCadastro.innerHTML = `<option value="" disabled ${atual ? '' : 'selected'}>Selecione um cliente cadastrado...</option>` + options;
    if (atual && clientesSugeridos.includes(atual)) selCadastro.value = atual;
  }

  const selEdicao = document.getElementById('editCliente');
  if (selEdicao) {
    const atual = selEdicao.value;
    selEdicao.innerHTML = `<option value="" disabled>Selecione um cliente cadastrado...</option>` + options;
    if (atual && clientesSugeridos.includes(atual)) selEdicao.value = atual;
  }

  const selRelatorio = document.getElementById('relCliente');
  if (selRelatorio) {
    const atual = selRelatorio.value;
    selRelatorio.innerHTML = `<option value="">Selecione um cliente...</option>` + options;
    if (atual && clientesSugeridos.includes(atual)) selRelatorio.value = atual;
  }

  const selEtiquetas = document.getElementById('etqCliente');
  if (selEtiquetas) {
    const atual = selEtiquetas.value;
    selEtiquetas.innerHTML = `<option value="" disabled ${atual ? '' : 'selected'}>Selecione um cliente cadastrado...</option>` + options;
    if (atual && clientesSugeridos.includes(atual)) selEtiquetas.value = atual;
  }

  // Atualiza o rótulo/lista dos seletores com busca
  SELECTS_CLIENTE.forEach(id => document.getElementById(id)?._sbAtualizar?.());
}

// ─── Seletor de cliente com busca ─────────────────────────────────────────────
// O <select> nativo abre a lista do jeito do navegador (às vezes para cima,
// cobrindo a tela inteira). Este componente mostra a lista sempre para baixo,
// com barra de rolagem e campo de busca. O <select> original continua no DOM,
// escondido, guardando o valor — então o resto do código não muda.
const SELECTS_CLIENTE = ['inpCliente', 'editCliente', 'relCliente', 'etqCliente'];

function criarSelectBusca(select) {
  const wrap = document.createElement('div');
  wrap.className = 'sb-wrap';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('sb-nativo');
  select.tabIndex = -1;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'form-select sb-trigger';

  const panel = document.createElement('div');
  panel.className = 'sb-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <input type="text" class="form-input sb-busca" placeholder="Buscar cliente..." autocomplete="off"/>
    <div class="sb-lista"></div>`;
  wrap.append(btn, panel);

  const busca = panel.querySelector('.sb-busca');
  const lista = panel.querySelector('.sb-lista');
  let destaque = 0;

  const atualizarLabel = () => {
    const opt = select.selectedOptions[0];
    btn.textContent = opt ? opt.textContent : '';
    btn.classList.toggle('sb-placeholder', !select.value);
  };

  // Mantém o rótulo em dia quando o código define select.value diretamente
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); atualizarLabel(); },
  });

  const itensVisiveis = () => [...lista.querySelectorAll('.sb-opcao')];

  const renderLista = () => {
    const termo = busca.value.trim().toLowerCase();
    const opts  = [...select.options].filter(o => o.value && o.textContent.toLowerCase().includes(termo));
    destaque = termo ? 0 : Math.max(opts.findIndex(o => o.value === select.value), 0);
    lista.innerHTML = opts.length
      ? opts.map((o, i) => `<div class="sb-opcao${o.value === select.value ? ' selecionado' : ''}${i === destaque ? ' destaque' : ''}" data-valor="${escHtml(o.value)}">${escHtml(o.textContent)}</div>`).join('')
      : '<div class="sb-vazio">Nenhum cliente encontrado.</div>';
    lista.querySelector('.destaque')?.scrollIntoView({ block: 'nearest' });
  };

  const moverDestaque = passo => {
    const itens = itensVisiveis();
    if (!itens.length) return;
    itens[destaque]?.classList.remove('destaque');
    destaque = (destaque + passo + itens.length) % itens.length;
    itens[destaque].classList.add('destaque');
    itens[destaque].scrollIntoView({ block: 'nearest' });
  };

  const abrir  = () => { panel.hidden = false; busca.value = ''; renderLista(); busca.focus(); };
  const fechar = () => { panel.hidden = true; };

  const escolher = valor => {
    select.value = valor;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fechar();
    btn.focus();
  };

  btn.addEventListener('click', () => (panel.hidden ? abrir() : fechar()));
  busca.addEventListener('input', renderLista);
  busca.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown')    { e.preventDefault(); moverDestaque(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moverDestaque(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault(); // não envia o formulário
      const item = itensVisiveis()[destaque];
      if (item) escolher(item.dataset.valor);
    }
    else if (e.key === 'Escape')  { e.preventDefault(); fechar(); btn.focus(); }
  });
  lista.addEventListener('mousedown', e => {
    const item = e.target.closest('.sb-opcao');
    if (!item) return;
    e.preventDefault();
    escolher(item.dataset.valor);
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) fechar(); });

  select._sbAtualizar = () => { atualizarLabel(); if (!panel.hidden) renderLista(); };
  atualizarLabel();
}

// Retorna o nome canônico cadastrado (comparação sem diferenciar maiúsc/minúsc)
// ou null se o cliente não estiver na lista fechada.
function resolverCliente(nome) {
  const alvo = (nome || '').trim().toLowerCase();
  if (!alvo) return null;
  return clientesSugeridos.find(c => c.toLowerCase() === alvo) || null;
}

// ─── Cadastro de cliente (modal) ──────────────────────────────────────────────
function abrirCadastroCliente() {
  document.getElementById('inpNovoCliente').value = '';
  openModal('modalCadastrarCliente');
  setTimeout(() => document.getElementById('inpNovoCliente').focus(), 100);
}

async function salvarCliente(e) {
  e.preventDefault();
  if (!sb) { showToast('⚠️ Configure o Supabase primeiro.'); return; }

  const nome = document.getElementById('inpNovoCliente').value.trim();
  if (!nome) { showToast('⚠️ Digite o nome do cliente.'); return; }

  if (resolverCliente(nome)) { showToast('⚠️ Este cliente já está cadastrado.'); return; }

  const btn = document.getElementById('btnSalvarCliente');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const { error } = await sb.from('clientes').insert({ nome });

  btn.disabled = false;
  btn.textContent = 'Cadastrar';

  // Se a tabela 'clientes' não existe, segue no modo local (sem travar o fluxo).
  // O cliente fica disponível agora e passa a persistir assim que houver um objeto dele.
  const tabelaInexistente = error && (error.code === 'PGRST205' ||
    /schema cache|public\.clientes|find the table/i.test(error.message || ''));

  if (error && !tabelaInexistente) {
    // Outro erro (ex.: violação do índice único em cadastro simultâneo)
    showToast('❌ Erro ao cadastrar cliente: ' + error.message);
    return;
  }

  clientesSugeridos.push(nome);
  clientesSugeridos.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  popularSelectsClientes();
  closeModal('modalCadastrarCliente');
  showToast('✅ Cliente cadastrado!');

  // Se veio do formulário de cadastro de objeto, já preenche o campo
  const inpCli = document.getElementById('inpCliente');
  if (inpCli) inpCli.value = nome;
  document.getElementById('inpNovoCliente').value = '';
}

// ─── Renomear / mesclar cliente ───────────────────────────────────────────────
// Corrige divergências (ex.: "EMPRESA A" e "EMPRESA A (filial)" cadastrados
// por engano como clientes diferentes) renomeando de uma vez TODOS os objetos
// do cliente antigo. Se o novo nome já existir, os objetos passam a ficar
// unificados sob esse nome (mesclagem).
function abrirRenomearCliente(nomeAntigo) {
  document.getElementById('renomeAntigoNome').value = nomeAntigo;
  document.getElementById('renomeAntigoLabel').textContent = nomeAntigo;
  document.getElementById('renomeNovoNome').value = nomeAntigo;
  document.getElementById('listaClientesRenome').innerHTML =
    clientesSugeridos.map(c => `<option value="${escHtml(c)}"></option>`).join('');
  openModal('modalRenomearCliente');
  setTimeout(() => document.getElementById('renomeNovoNome').focus(), 100);
}

async function confirmarRenomearCliente(e) {
  e.preventDefault();
  if (!sb) { showToast('⚠️ Configure o Supabase primeiro.'); return; }

  const antigo = document.getElementById('renomeAntigoNome').value;
  const novo   = document.getElementById('renomeNovoNome').value.trim();

  if (!novo) { showToast('⚠️ Digite o nome correto do cliente.'); return; }
  if (novo === antigo) { showToast('Nada para alterar — o nome já é esse.'); return; }

  const mesclando = clientesSugeridos.some(c => c.toLowerCase() === novo.toLowerCase() && c !== antigo);
  const confirmMsg = mesclando
    ? `Confirma MESCLAR todos os objetos de "${antigo}" para o cliente já existente "${novo}"?\n\nIsso atualiza o histórico completo (todas as datas).`
    : `Confirma renomear todos os objetos de "${antigo}" para "${novo}"?\n\nIsso atualiza o histórico completo (todas as datas).`;
  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btnConfirmarRenomear');
  btn.disabled = true;
  btn.textContent = 'Atualizando...';

  // Atualiza todos os objetos cadastrados com o nome antigo (correspondência exata)
  const { error } = await sb.from('cargas').update({ cliente: novo }).eq('cliente', antigo);

  // Melhor esforço: sincroniza a tabela 'clientes' se ela existir (ignora erros,
  // pois a tabela pode não existir ou o nome novo já ter uma linha própria)
  try {
    const { error: upErr } = await sb.from('clientes').update({ nome: novo }).eq('nome', antigo);
    if (upErr) await sb.from('clientes').delete().eq('nome', antigo);
  } catch { /* tabela 'clientes' pode não existir — segue sem ela */ }

  btn.disabled = false;
  btn.textContent = 'Confirmar';

  if (error) {
    showToast('❌ Erro ao atualizar cliente: ' + error.message);
    return;
  }

  closeModal('modalRenomearCliente');
  showToast(mesclando ? `✅ Objetos mesclados em "${novo}"!` : `✅ Cliente renomeado para "${novo}"!`);

  await carregarClientesSugeridos();
  carregarListaHoje();
  if (document.getElementById('tabConsulta').style.display !== 'none') carregarConsulta();
}

// ─── CADASTRO ─────────────────────────────────────────────────────────────────
async function cadastrarObjeto(e) {
  e.preventDefault();
  if (!sb) { showToast('⚠️ Configure o Supabase primeiro.'); openModal('modalConfig'); return; }

  const codigo  = document.getElementById('inpCodigo').value.trim().toUpperCase();
  const tipo    = document.getElementById('inpTipo').value;
  const data    = document.getElementById('inpData').value;

  // Cliente precisa estar na lista fechada (resolve a grafia cadastrada)
  const cliente = resolverCliente(document.getElementById('inpCliente').value);

  if (!codigo || !cliente || !tipo || !data) {
    if (codigo && tipo && data && !cliente) {
      showToast('⚠️ Cliente não cadastrado. Use o botão 👤 para cadastrar.');
    } else {
      showToast('⚠️ Preencha todos os campos.');
    }
    return;
  }

  const btn = document.getElementById('btnCadastrar');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  // Bloqueio TOTAL: verifica duplicidade em qualquer data antes de inserir
  const { data: existente } = await sb
    .from('cargas')
    .select('id, cliente, data_agendada')
    .eq('codigo_rastreio', codigo)
    .limit(1);

  if (existente && existente.length > 0) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 5v14M5 12h14"/></svg> Cadastrar Objeto`;
    showToast(`⚠️ Código já cadastrado para ${existente[0].cliente} (data ${formatDateBR(existente[0].data_agendada)}).`);
    return;
  }

  // INSERT — a constraint UNIQUE no banco é uma rede de segurança extra contra race condition
  const { error } = await sb.from('cargas').insert({
    codigo_rastreio: codigo,
    cliente,
    tipo_servico: tipo,
    data_agendada: data,
  });

  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 5v14M5 12h14"/></svg> Cadastrar Objeto`;

  if (error) {
    // 23505 = unique_violation (rastreio duplicado na mesma data)
    if (error.code === '23505') {
      showToast('⚠️ Rastreio ' + codigo + ' já cadastrado para esta data!');
    } else {
      showToast('❌ Erro ao cadastrar: ' + error.message);
    }
    return;
  }

  showToast('✅ Objeto cadastrado!');
  document.getElementById('inpCodigo').value  = '';
  document.getElementById('inpCliente').value = '';
  document.getElementById('inpTipo').value    = '';
  document.getElementById('inpData').value    = todayISO();

  carregarListaHoje();
}

async function carregarListaHoje() {
  const container = document.getElementById('listaHoje');
  const badge     = document.getElementById('badgeHoje');
  if (!sb) {
    container.innerHTML = '<div class="empty-card"><span>Sem conexão com o banco.</span></div>';
    return;
  }

  const { data, error } = await sb
    .from('cargas')
    .select('*')
    .eq('data_agendada', todayISO())
    .order('created_at', { ascending: false });

  if (error || !data) { container.innerHTML = '<div class="empty-card"><span>Erro ao carregar.</span></div>'; return; }

  badge.textContent = data.length;
  if (!data.length) {
    container.innerHTML = '<div class="empty-card"><span>Nenhum objeto cadastrado para hoje.</span></div>';
    return;
  }

  container.innerHTML = data.map(r => cargaCardHTML(r, true)).join('');
}

function cargaCardHTML(r, showDel = false) {
  const st = r.recebido ? 'recebido' : 'pendente';
  const badgeCls = r.recebido ? 'badge-green' : 'badge-amber';
  let badgeTxt = r.recebido ? '✓ Recebido' : '⏳ Aguardando';

  if (r.recebido && r.data_recebimento) {
    const diaRecebido = r.data_recebimento.slice(0, 10); // YYYY-MM-DD
    const dataCurta = diaRecebido.slice(8, 10) + '/' + diaRecebido.slice(5, 7);
    if (diaRecebido > r.data_agendada)      badgeTxt = `⏰ Recebido ${dataCurta}`; // atrasado
    else if (diaRecebido < r.data_agendada) badgeTxt = `⚡ Recebido ${dataCurta}`; // antecipado
    else                                    badgeTxt = `✓ Recebido ${dataCurta}`; // no prazo
  }
  return `<div class="carga-card ${st}">
    <div class="carga-info">
      <div class="carga-code">${escHtml(r.codigo_rastreio)}</div>
      <div class="carga-cliente">${escHtml(r.cliente)}</div>
      <div class="carga-meta">
        <span class="tipo-pill">${escHtml(r.tipo_servico)}</span>
        ${formatDateBR(r.data_agendada)}
      </div>
    </div>
    <span class="badge ${badgeCls} carga-status">${badgeTxt}</span>
    ${showDel ? `<button class="edit-btn" onclick="abrirEdicaoCarga('${r.id}')" title="Editar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
    </button>` : ''}
  </div>`;
}

async function abrirEdicaoCarga(id) {
  if (!sb) return;
  showLoading(true, 'Carregando...');
  const { data, error } = await sb.from('cargas').select('*').eq('id', id).single();
  showLoading(false);
  
  if (error || !data) {
    showToast('❌ Erro ao buscar dados do objeto.');
    return;
  }
  
  document.getElementById('editId').value = data.id;
  document.getElementById('editCodigo').value = data.codigo_rastreio;
  document.getElementById('editCliente').value = data.cliente;
  document.getElementById('editTipo').value = data.tipo_servico;
  document.getElementById('editData').value = data.data_agendada;
  
  openModal('modalEditarCarga');
}

async function salvarEdicao(e) {
  e.preventDefault();
  if (!sb) return;

  const id = document.getElementById('editId').value;
  const codigo = document.getElementById('editCodigo').value.trim().toUpperCase();
  const tipo = document.getElementById('editTipo').value;
  const data = document.getElementById('editData').value;
  const cliente = resolverCliente(document.getElementById('editCliente').value);

  if (!codigo || !cliente || !tipo || !data) {
    if (codigo && tipo && data && !cliente) {
      showToast('⚠️ Cliente não cadastrado. Use o botão 👤 para cadastrar.');
    } else {
      showToast('⚠️ Preencha todos os campos.');
    }
    return;
  }

  const btn = document.getElementById('btnSalvarEdicao');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  // Duplicidade global, ignorando o próprio registro
  const { data: dup } = await sb
    .from('cargas')
    .select('id, cliente, data_agendada')
    .eq('codigo_rastreio', codigo)
    .neq('id', id)
    .limit(1);

  if (dup && dup.length > 0) {
    btn.disabled = false;
    btn.textContent = 'Salvar';
    showToast(`⚠️ Já existe outro objeto com este código para ${dup[0].cliente} (data ${formatDateBR(dup[0].data_agendada)}).`);
    return;
  }

  const { error } = await sb.from('cargas').update({
    codigo_rastreio: codigo,
    cliente: cliente,
    tipo_servico: tipo,
    data_agendada: data
  }).eq('id', id);

  btn.disabled = false;
  btn.textContent = 'Salvar';

  if (error) {
    showToast('❌ Erro ao atualizar: ' + error.message);
    return;
  }

  showToast('✅ Objeto atualizado!');
  closeModal('modalEditarCarga');
  
  carregarListaHoje();
  if (document.getElementById('tabConsulta').style.display !== 'none') {
    carregarConsulta();
  }
}

async function confirmarExclusaoEdicao() {
  const id = document.getElementById('editId').value;
  if (!id) return;
  
  if (!confirm('Deseja realmente EXCLUIR este registro definitivamente?')) return;
  
  closeModal('modalEditarCarga');
  showLoading(true, 'Excluindo...');
  await sb.from('cargas').delete().eq('id', id);
  showLoading(false);
  
  carregarListaHoje();
  if (document.getElementById('tabConsulta').style.display !== 'none') {
    carregarConsulta();
  }
  showToast('🗑️ Registro excluído.');
}

// ─── SCANNER PARA CADASTRO (modal) ───────────────────────────────────────────
function openScannerCadastro() {
  openModal('modalScanCadastro');
  setTimeout(() => {
    const config = { fps: 12, qrbox: { width: 240, height: 120 }, aspectRatio: 1.5 };
    cadScanner = new Html5Qrcode('scannerCadastroViewport');
    cadScanner.start({ facingMode: 'environment' }, config, (code) => {
      document.getElementById('inpCodigo').value = code.toUpperCase();
      fecharScannerCadastro();
      showToast('📷 Código: ' + code.toUpperCase());
    }, () => {}).catch(console.warn);
  }, 300);
}

function fecharScannerCadastro() {
  if (cadScanner) {
    cadScanner.stop().catch(() => {}).finally(() => {
      cadScanner = null;
      closeModal('modalScanCadastro');
    });
  } else { closeModal('modalScanCadastro'); }
}

// ─── MODO DE CADASTRO (um objeto / em lote) ──────────────────────────────────
let modoCadastro = 'unico';

function setModoCadastro(modo) {
  modoCadastro = modo === 'lote' ? 'lote' : 'unico';
  localStorage.setItem('cc_modo_cadastro', modoCadastro);

  const lote = modoCadastro === 'lote';
  document.getElementById('modoUnico').style.display = lote ? 'none' : 'block';
  document.getElementById('modoLote').style.display  = lote ? 'block' : 'none';
  document.getElementById('modoBtnUnico').classList.toggle('active', !lote);
  document.getElementById('modoBtnLote').classList.toggle('active', lote);
  document.querySelector('#tabCadastro .panel-title').textContent = lote ? 'Cadastrar em Lote' : 'Cadastrar Objeto';
  document.getElementById('cadastroDesc').textContent = lote
    ? 'Lance as etiquetas que o cliente avisou. Elas só entram na bipagem depois de liberadas.'
    : 'Registre um novo objeto aguardado para entrega.';

  if (lote) carregarEtiquetas(); else carregarListaHoje();
}

// ─── ETIQUETAS DO DIA ─────────────────────────────────────────────────────────
// Substitui a planilha do atendimento: as etiquetas que o cliente avisou vão
// sendo lançadas durante o dia e ficam "aguardando". Só depois que o Operacional
// fecha o dia e as etiquetas são vendidas elas são LIBERADAS e viram cargas.
let etiquetasCache = [];
let etqScanner = null;
let etqScanCount = 0;

// Extrai rastreios de um texto colado de qualquer jeito (WhatsApp, vírgula, lista)
function extrairCodigos(texto) {
  const achados = (texto || '').toUpperCase().match(/[A-Z]{2}\d{9}[A-Z]{2}/g) || [];
  return [...new Set(achados)];
}

function amanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function atualizarContadorEtiquetas() {
  const el = document.getElementById('etqContador');
  if (!el) return;
  const n = extrairCodigos(document.getElementById('etqCodigos').value).length;
  el.textContent = n ? `${n} código(s) encontrado(s)` : '';
  el.className = 'form-hint' + (n ? ' etq-contador-ok' : '');
}

async function lancarEtiquetas(e) {
  e.preventDefault();
  if (!sb) { showToast('⚠️ Configure o Supabase primeiro.'); return; }

  const cliente = resolverCliente(document.getElementById('etqCliente').value);
  const tipo    = document.getElementById('etqTipo').value;
  const codigos = extrairCodigos(document.getElementById('etqCodigos').value);

  if (!cliente || !tipo) { showToast('⚠️ Selecione o cliente e o tipo de serviço.'); return; }
  if (!codigos.length)   { showToast('⚠️ Nenhum código de rastreio encontrado no texto.'); return; }

  const btn = document.getElementById('btnLancarEtiquetas');
  btn.disabled = true;
  btn.textContent = 'Lançando...';
  showLoading(true, 'Conferindo os códigos...');

  // Já lançados e ainda aguardando
  const jaLancados = new Set();
  const jaCadastrados = new Map(); // código → "cliente (data)"
  for (let i = 0; i < codigos.length; i += 150) {
    const parte = codigos.slice(i, i + 150);
    const { data: etq } = await sb
      .from('etiquetas').select('codigo_rastreio').eq('status', 'aguardando').in('codigo_rastreio', parte);
    (etq || []).forEach(r => jaLancados.add(r.codigo_rastreio));

    const { data: cgs } = await sb
      .from('cargas').select('codigo_rastreio, cliente, data_agendada').in('codigo_rastreio', parte);
    (cgs || []).forEach(r => jaCadastrados.set(r.codigo_rastreio, `${r.cliente} (${formatDateBR(r.data_agendada)})`));
  }

  const novos = codigos.filter(c => !jaLancados.has(c) && !jaCadastrados.has(c));

  let erro = null;
  for (let i = 0; i < novos.length; i += 200) {
    const { error } = await sb.from('etiquetas').insert(
      novos.slice(i, i + 200).map(c => ({ codigo_rastreio: c, cliente, tipo_servico: tipo }))
    );
    if (error) { erro = error; break; }
  }

  showLoading(false);
  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 5v14M5 12h14"/></svg> Lançar Etiquetas`;

  if (erro) {
    showToast(erro.code === 'PGRST205'
      ? '❌ A tabela "etiquetas" ainda não existe no banco. Rode o comando SQL primeiro.'
      : '❌ Erro ao lançar: ' + erro.message);
    return;
  }

  const ignorados = codigos.length - novos.length;
  showToast(`✅ ${novos.length} etiqueta(s) lançada(s)${ignorados ? ` • ${ignorados} ignorada(s) por já existirem` : ''}.`);

  if (jaCadastrados.size) {
    const exemplos = [...jaCadastrados.entries()].slice(0, 3).map(([c, onde]) => `${c} → ${onde}`).join('\n');
    alert(`${jaCadastrados.size} código(s) já estão cadastrados no Controle de Cargas e foram ignorados:\n\n${exemplos}${jaCadastrados.size > 3 ? '\n...' : ''}`);
  }

  // Mantém cliente e data; limpa só os códigos, para o próximo lote ser direto
  document.getElementById('etqCodigos').value = '';
  atualizarContadorEtiquetas();
  carregarEtiquetas();
}

async function carregarEtiquetas() {
  const el    = document.getElementById('listaEtiquetas');
  const badge = document.getElementById('badgeEtiquetas');
  const acoes = document.getElementById('etqAcoes');
  if (!el) return;
  if (!sb) { el.innerHTML = '<div class="empty-card"><span>Sem conexão com o banco.</span></div>'; return; }

  const { data, error } = await sb
    .from('etiquetas')
    .select('*')
    .eq('status', 'aguardando')
    .order('created_at', { ascending: true });

  if (error) {
    etiquetasCache = [];
    badge.textContent = '0';
    acoes.style.display = 'none';
    el.innerHTML = error.code === 'PGRST205'
      ? '<div class="empty-card"><span>A tabela "etiquetas" ainda não existe no banco. Rode o comando SQL para ativar esta aba.</span></div>'
      : '<div class="empty-card"><span>Erro ao carregar etiquetas.</span></div>';
    return;
  }

  etiquetasCache = data || [];
  badge.textContent = etiquetasCache.length;
  acoes.style.display = etiquetasCache.length ? 'block' : 'none';

  const campoData = document.getElementById('etqDataPrevista');
  if (campoData && !campoData.value) campoData.value = amanhaISO();

  if (!etiquetasCache.length) {
    el.innerHTML = '<div class="empty-card"><span>Nenhuma etiqueta aguardando liberação.</span></div>';
    return;
  }

  // Agrupa por cliente, mantendo a ordem de lançamento
  const porCliente = {};
  etiquetasCache.forEach(r => (porCliente[r.cliente] = porCliente[r.cliente] || []).push(r));

  const hoje = todayISO();
  el.innerHTML = Object.keys(porCliente)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(cliente => {
      const itens = porCliente[cliente];

      // Resumo por tipo: "12 PAC • 3 SEDEX"
      const porTipo = {};
      itens.forEach(r => porTipo[r.tipo_servico] = (porTipo[r.tipo_servico] || 0) + 1);
      const resumoTipos = Object.entries(porTipo).map(([t, n]) => `${n} ${t}`).join(' • ');

      // Aviso de etiqueta parada de dias anteriores
      const diasParados = itens
        .map(r => Math.floor((new Date(hoje) - new Date(r.created_at.slice(0, 10))) / 86400000))
        .reduce((a, b) => Math.max(a, b), 0);
      const avisoParado = diasParados > 0
        ? `<span class="badge badge-red" title="Lançada há ${diasParados} dia(s) e ainda não liberada">⏰ ${diasParados}d parada</span>`
        : '';

      return `
        <details class="client-group" open>
          <summary class="client-summary">
            <div class="client-info">
              <span style="font-size: 1.05rem">👤</span>
              <span>${escHtml(cliente)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              ${avisoParado}
              <span class="badge badge-amber">${itens.length}</span>
              <span class="client-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
            </div>
          </summary>
          <div class="client-content">
            <div class="etq-barra">
              <span class="etq-resumo">${escHtml(resumoTipos)}</span>
              <div class="etq-botoes">
                <button class="btn btn-ghost btn-xs" data-cliente="${escHtml(cliente)}" onclick="copiarCodigosEtiquetas(this.dataset.cliente)">📋 Copiar códigos</button>
                <button class="btn btn-primary btn-xs" data-cliente="${escHtml(cliente)}" onclick="liberarEtiquetas(this.dataset.cliente)">✅ Liberar</button>
              </div>
            </div>
            ${itens.map(r => `
              <div class="etq-item">
                <span class="log-code">${escHtml(r.codigo_rastreio)}</span>
                <span class="tipo-pill">${escHtml(r.tipo_servico)}</span>
                <button class="edit-btn" onclick="excluirEtiqueta('${r.id}')" title="Excluir etiqueta lançada">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
              </div>`).join('')}
          </div>
        </details>`;
    }).join('');
}

async function excluirEtiqueta(id) {
  if (!confirm('Excluir esta etiqueta lançada?')) return;
  const { error } = await sb.from('etiquetas').delete().eq('id', id);
  if (error) { showToast('❌ Erro ao excluir: ' + error.message); return; }
  showToast('🗑️ Etiqueta excluída.');
  carregarEtiquetas();
}

function copiarCodigosEtiquetas(cliente) {
  const codigos = etiquetasCache.filter(r => r.cliente === cliente).map(r => r.codigo_rastreio);
  if (!codigos.length) return;
  navigator.clipboard.writeText(codigos.join('\n'))
    .then(() => showToast(`📋 ${codigos.length} código(s) copiado(s).`))
    .catch(() => showToast('❌ Não foi possível copiar.'));
}

// Libera as etiquetas (de um cliente ou de todos): elas viram cargas de verdade
// com a data prevista escolhida e passam a valer para a bipagem.
async function liberarEtiquetas(cliente) {
  if (!sb) return;

  const data = document.getElementById('etqDataPrevista').value;
  if (!data) { showToast('⚠️ Informe a data prevista de chegada.'); return; }

  const alvo = cliente ? etiquetasCache.filter(r => r.cliente === cliente) : etiquetasCache;
  if (!alvo.length) { showToast('Nada para liberar.'); return; }

  const quem = cliente ? `de ${cliente}` : 'de TODOS os clientes';
  if (!confirm(`Liberar ${alvo.length} etiqueta(s) ${quem} para a bipagem do dia ${formatDateBR(data)}?`)) return;

  showLoading(true, 'Liberando...');

  // Ignora o que já estiver no Controle de Cargas (evita duplicar)
  const codigos = alvo.map(r => r.codigo_rastreio);
  const existentes = new Set();
  for (let i = 0; i < codigos.length; i += 150) {
    const { data: cgs } = await sb
      .from('cargas').select('codigo_rastreio').in('codigo_rastreio', codigos.slice(i, i + 150));
    (cgs || []).forEach(r => existentes.add(r.codigo_rastreio));
  }

  const novos = alvo.filter(r => !existentes.has(r.codigo_rastreio));

  for (let i = 0; i < novos.length; i += 200) {
    const { error } = await sb.from('cargas').insert(
      novos.slice(i, i + 200).map(r => ({
        codigo_rastreio: r.codigo_rastreio,
        cliente: r.cliente,
        tipo_servico: r.tipo_servico,
        data_agendada: data,
      }))
    );
    if (error) {
      showLoading(false);
      showToast('❌ Erro ao liberar: ' + error.message);
      return;
    }
  }

  // Marca como liberadas (inclusive as que já existiam em cargas)
  const ids = alvo.map(r => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    await sb.from('etiquetas')
      .update({ status: 'liberado', data_prevista: data, liberado_em: new Date().toISOString() })
      .in('id', ids.slice(i, i + 200));
  }

  showLoading(false);
  const jaExistiam = alvo.length - novos.length;
  showToast(`✅ ${novos.length} objeto(s) liberado(s) para ${formatDateBR(data)}${jaExistiam ? ` • ${jaExistiam} já estavam cadastrados` : ''}.`);

  carregarEtiquetas();
  carregarListaHoje();
}

// ─── SCANNER DE ETIQUETAS (bipagem contínua no lançamento) ───────────────────
function abrirScannerEtiquetas() {
  etqScanCount = 0;
  document.getElementById('etqScanContador').textContent = '0 bipadas';
  openModal('modalScanEtiquetas');
  setTimeout(() => {
    const config = { fps: 12, qrbox: { width: 240, height: 120 }, aspectRatio: 1.5 };
    etqScanner = new Html5Qrcode('scannerEtiquetasViewport');
    etqScanner.start({ facingMode: 'environment' }, config, (code) => {
      const limpo = code.trim().toUpperCase();
      const campo = document.getElementById('etqCodigos');
      if (extrairCodigos(campo.value).includes(limpo)) return; // já está na lista
      campo.value = (campo.value.trim() + '\n' + limpo).trim();
      etqScanCount++;
      document.getElementById('etqScanContador').textContent = `${etqScanCount} bipadas`;
      atualizarContadorEtiquetas();
      beep('success');
    }, () => {}).catch(console.warn);
  }, 300);
}

function fecharScannerEtiquetas() {
  if (etqScanner) {
    etqScanner.stop().catch(() => {}).finally(() => {
      etqScanner = null;
      closeModal('modalScanEtiquetas');
    });
  } else { closeModal('modalScanEtiquetas'); }
}

// ─── CONFERÊNCIA — CÂMERA ────────────────────────────────────────────────────
async function toggleCamera() {
  if (cameraActive) {
    await pararCamera();
  } else {
    await iniciarCamera();
  }
}

async function iniciarCamera() {
  const btn = document.getElementById('btnIniciarCamera');
  btn.textContent = 'Carregando...';
  btn.disabled = true;

  try {
    allCameras = await Html5Qrcode.getCameras();
    if (!allCameras?.length) throw new Error('Nenhuma câmera encontrada.');

    // Prefer back camera for mobile
    const backCam = allCameras.find(c => /back|rear|traseira|environment/i.test(c.label));
    currentCameraId = backCam ? backCam.id : allCameras[0].id;

    const config = { fps: 12, qrbox: { width: 250, height: 120 }, aspectRatio: 1.5 };
    cameraScanner = new Html5Qrcode('scannerViewport');
    await cameraScanner.start(currentCameraId, config, onCodeScanned, () => {});

    cameraActive = true;
    btn.textContent = 'Parar Câmera';
    btn.disabled = false;
    btn.className = 'btn btn-danger';
    document.getElementById('btnTrocarCamera').style.display = allCameras.length > 1 ? 'flex' : 'none';

    setFeedback('idle', '📷', 'Pronto para escanear', 'Posicione o código na câmera');

  } catch (err) {
    btn.textContent = 'Iniciar Câmera';
    btn.disabled = false;
    btn.className = 'btn btn-outline';
    setFeedback('err', '🚫', 'Câmera indisponível', err.message || 'Verifique as permissões.');
    showToast('❌ ' + (err.message || 'Erro ao acessar câmera'));
  }
}

async function pararCamera() {
  if (cameraScanner) {
    try { await cameraScanner.stop(); } catch {}
    cameraScanner = null;
  }
  cameraActive = false;
  const btn = document.getElementById('btnIniciarCamera');
  btn.textContent = 'Iniciar Câmera';
  btn.className = 'btn btn-outline';
  document.getElementById('btnTrocarCamera').style.display = 'none';
  setFeedback('idle', '📷', 'Pronto para escanear', 'Inicie a câmera para conferir');
}

async function trocarCamera() {
  if (!allCameras.length || !cameraScanner) return;
  const idx  = allCameras.findIndex(c => c.id === currentCameraId);
  const next = allCameras[(idx + 1) % allCameras.length];
  currentCameraId = next.id;

  try {
    await cameraScanner.stop();
    const config = { fps: 12, qrbox: { width: 250, height: 120 }, aspectRatio: 1.5 };
    await cameraScanner.start(currentCameraId, config, onCodeScanned, () => {});
  } catch (e) { showToast('Erro ao trocar câmera.'); }
}

// ─── On code scanned ─────────────────────────────────────────────────────────
async function onCodeScanned(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const now  = Date.now();
  if (scanCooldown || (code === lastScanCode && now - lastScanTime < 3000)) return;

  scanCooldown  = true;
  lastScanCode  = code;
  lastScanTime  = now;
  setTimeout(() => { scanCooldown = false; }, 2500);

  await processarConferencia(code);
}

async function conferirManual() {
  const code = document.getElementById('inpManual').value.trim().toUpperCase();
  if (!code) return;
  document.getElementById('inpManual').value = '';
  await processarConferencia(code);
}

// Registra TODA leitura no histórico (inclusive as que deram erro), para depois
// ser possível saber se um objeto chegou a ser lido mesmo sem virar recebido.
// Se a tabela 'bipes' ainda não existir no banco, apenas ignora.
async function registrarBipe(codigo, resultado, cliente = null, mensagem = null) {
  if (!sb) return;
  try {
    await sb.from('bipes').insert({ codigo_rastreio: codigo, cliente, resultado, mensagem });
  } catch { /* histórico é best effort: nunca atrapalha a conferência */ }
}

async function processarConferencia(code) {
  if (!sb) { showToast('⚠️ Configure o Supabase.'); openModal('modalConfig'); return; }

  // Busca o rastreio em qualquer data ainda pendente (não só hoje)
  const { data, error } = await sb
    .from('cargas')
    .select('*')
    .eq('codigo_rastreio', code)
    .eq('recebido', false)
    .order('data_agendada', { ascending: true })
    .limit(1);

  if (error) {
    registrarBipe(code, 'erro', null, 'Erro na consulta ao banco');
    showToast('❌ Erro na consulta.');
    return;
  }

  if (!data || !data.length) {
    // Não encontrado como pendente — verifica se já foi recebido antes
    const { data: jaRecebido } = await sb
      .from('cargas')
      .select('cliente, data_recebimento')
      .eq('codigo_rastreio', code)
      .eq('recebido', true)
      .order('data_recebimento', { ascending: false })
      .limit(1);

    if (jaRecebido && jaRecebido.length) {
      beep('error');
      const dtReceb = formatDateBR(jaRecebido[0].data_recebimento?.slice(0,10) || '');
      setFeedback('err', '⚠️', 'Etiqueta já conferida!', `Possível objeto duplicado — esta etiqueta foi recebida em ${dtReceb} para ${jaRecebido[0].cliente}`);
      registrarBipe(code, 'duplicado', jaRecebido[0].cliente, `já recebida em ${dtReceb}`);
      logEntry({ code, ok: false, msg: `⚠️ etiqueta duplicada? (já recebida em ${dtReceb})` });
      showToast(`⚠️ ${code} — ETIQUETA JÁ CONFERIDA (recebida ${dtReceb} • ${jaRecebido[0].cliente}). Possível duplicada!`);
    } else {
      beep('error');
      setFeedback('err', '❌', 'Não Cadastrado!', `Código: ${code} — Nenhum registro encontrado.`);
      registrarBipe(code, 'nao_cadastrado', null, 'Nenhum registro encontrado');
      logEntry({ code, ok: false, msg: 'Não cadastrado' });
      showToast(`❌ ${code} — SEM REGISTRO no sistema`);
    }
    return;
  }

  const carga = data[0];
  const hoje  = todayISO();

  // Situação em relação à data prevista (datas ISO comparam corretamente)
  let situacao = 'hoje';
  if (carga.data_agendada > hoje)      situacao = 'antecipado'; // chegou antes do previsto
  else if (carga.data_agendada < hoje) situacao = 'atrasado';   // chegou depois do previsto

  // Marca como recebido
  const { error: upErr } = await sb
    .from('cargas')
    .update({ recebido: true, data_recebimento: new Date().toISOString() })
    .eq('id', carga.id);

  if (upErr) {
    registrarBipe(code, 'erro', carga.cliente, 'Falha ao marcar como recebido');
    showToast('❌ Erro ao atualizar.');
    return;
  }

  registrarBipe(code, 'ok', carga.cliente, situacao);
  beep('success');
  const dataBR = formatDateBR(carga.data_agendada);
  if (situacao === 'antecipado') {
    setFeedback('success', '⚡', 'Antecipado!', `${carga.cliente} — previsto ${dataBR}, chegou antes`);
    logEntry({ code, ok: true, msg: `${carga.cliente} • ⚡ antecipado (prev. ${dataBR})` });
    showToast(`⚡ ${code} — ${carga.cliente} ANTECIPADO (previsto ${dataBR})`);
  } else if (situacao === 'atrasado') {
    setFeedback('success', '⏰', 'Atrasado!', `${carga.cliente} — previsto ${dataBR}, chegou depois`);
    logEntry({ code, ok: true, msg: `${carga.cliente} • ⏰ atrasado (prev. ${dataBR})` });
    showToast(`⏰ ${code} — ${carga.cliente} ATRASADO (previsto ${dataBR})`);
  } else {
    setFeedback('success', '✅', 'Recebido com Sucesso!', `${carga.cliente} — ${carga.tipo_servico}`);
    logEntry({ code, ok: true, msg: carga.cliente });
    showToast(`✅ ${code} — ${carga.cliente} confirmado!`);
  }

  // Atualiza log e o aviso de pendentes de dias anteriores
  carregarLogHoje();
  carregarPendentesAnteriores();
}

// ─── Pendentes de dias anteriores ─────────────────────────────────────────────
// Aviso do que ficou sem bipe em dias passados (ex.: hoje é 23/09 e ainda falta
// 1 objeto do dia 22/09). Mostra por padrão os últimos 15 dias, para não poluir
// com cadastros muito antigos que nunca chegaram.
const PEND_DIAS_PADRAO = 15;
let pendentesVerTudo = false;

function alternarPendentesVerTudo() {
  pendentesVerTudo = !pendentesVerTudo;
  carregarPendentesAnteriores();
}

async function carregarPendentesAnteriores() {
  const el = document.getElementById('pendentesAnteriores');
  if (!el) return;
  if (!sb) { el.innerHTML = ''; return; }

  const hoje = todayISO();
  const limite = new Date();
  limite.setDate(limite.getDate() - PEND_DIAS_PADRAO);
  const desde = limite.toISOString().slice(0, 10);

  let query = sb
    .from('cargas')
    .select('codigo_rastreio, cliente, tipo_servico, data_agendada')
    .eq('recebido', false)
    .lt('data_agendada', hoje)
    .order('data_agendada', { ascending: false });
  if (!pendentesVerTudo) query = query.gte('data_agendada', desde);

  const { data, error } = await query;
  if (error) { el.innerHTML = ''; return; }

  // Quantos existem no total (para oferecer o "ver todos")
  const { count: totalGeral } = await sb
    .from('cargas')
    .select('id', { count: 'exact', head: true })
    .eq('recebido', false)
    .lt('data_agendada', hoje);

  const rows = data || [];
  const antigos = (totalGeral || 0) - rows.length;

  if (!rows.length) {
    el.innerHTML = pendentesVerTudo || !antigos
      ? `<div class="pend-ok">✅ Nenhum objeto pendente de dias anteriores.</div>`
      : `<div class="pend-ok">✅ Nada pendente nos últimos ${PEND_DIAS_PADRAO} dias.
           <button class="btn btn-ghost btn-xs" onclick="alternarPendentesVerTudo()">Ver ${antigos} antigo(s)</button>
         </div>`;
    return;
  }

  // Agrupa por data e, dentro dela, por cliente
  const porData = {};
  rows.forEach(r => {
    const dia = r.data_agendada;
    porData[dia] = porData[dia] || {};
    porData[dia][r.cliente] = porData[dia][r.cliente] || [];
    porData[dia][r.cliente].push(r);
  });

  const grupos = Object.keys(porData).sort().reverse().map(dia => {
    const clientes = Object.keys(porData[dia]).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const qtdDia = clientes.reduce((s, c) => s + porData[dia][c].length, 0);
    const blocos = clientes.map(cliente => `
      <div class="pend-cliente">
        <div class="pend-cliente-nome">👤 ${escHtml(cliente)} <span class="badge badge-amber">${porData[dia][cliente].length}</span></div>
        ${porData[dia][cliente].map(r => `
          <div class="pend-item">
            <span class="log-code">${escHtml(r.codigo_rastreio)}</span>
            <span class="tipo-pill">${escHtml(r.tipo_servico)}</span>
          </div>`).join('')}
      </div>`).join('');
    return `
      <div class="pend-dia">
        <div class="pend-dia-head">📅 ${formatDateBR(dia)} <span class="badge badge-red">${qtdDia} sem bipe</span></div>
        ${blocos}
      </div>`;
  }).join('');

  el.innerHTML = `
    <details class="pend-card" open>
      <summary class="pend-summary">
        <span>⚠️ Pendentes de dias anteriores</span>
        <span class="badge badge-red">${rows.length}</span>
      </summary>
      <div class="pend-conteudo">
        ${grupos}
        ${antigos > 0 && !pendentesVerTudo
          ? `<button class="btn btn-ghost btn-xs" onclick="alternarPendentesVerTudo()">Ver também ${antigos} de mais de ${PEND_DIAS_PADRAO} dias</button>`
          : ''}
        ${pendentesVerTudo
          ? `<button class="btn btn-ghost btn-xs" onclick="alternarPendentesVerTudo()">Mostrar só os últimos ${PEND_DIAS_PADRAO} dias</button>`
          : ''}
      </div>
    </details>`;
}

// ─── Feedback Panel ───────────────────────────────────────────────────────────
let feedbackTimer = null;
function setFeedback(type, icon, title, sub) {
  const panel = document.getElementById('scanFeedback');
  panel.className = `scan-feedback scan-${type === 'success' ? 'success' : type === 'err' ? 'error' : 'idle'}`;
  document.getElementById('scanIcon').textContent    = icon;
  document.getElementById('scanTitle').textContent   = title;
  document.getElementById('scanSub').textContent     = sub;

  if (type !== 'idle') {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      setFeedback('idle', '📷', 'Pronto para escanear', cameraActive ? 'Mire a câmera no código' : 'Inicie a câmera');
    }, 3500);
  }
}

// ─── Log de Bipes ─────────────────────────────────────────────────────────────
const logMemory = [];  // in-memory log for current session

function logEntry(entry) {
  logMemory.unshift({ ...entry, time: new Date() });
  renderLogHoje();
}

async function carregarLogHoje() {
  if (!sb) { renderLogHoje(); return; }

  // Limites do dia no fuso local (o banco guarda a hora em UTC)
  const hoje  = todayISO();
  const start = new Date(`${hoje}T00:00:00`).toISOString();
  const end   = new Date(`${hoje}T23:59:59.999`).toISOString();

  const { data } = await sb
    .from('cargas')
    .select('codigo_rastreio, cliente, tipo_servico, data_agendada, data_recebimento')
    .eq('recebido', true)
    .gte('data_recebimento', start)
    .lte('data_recebimento', end)
    .order('data_recebimento', { ascending: false });

  // Leituras do dia que NÃO viraram recebimento (não cadastrado, duplicada, falha)
  const { data: erros } = await sb
    .from('bipes')
    .select('codigo_rastreio, cliente, resultado, mensagem, created_at')
    .neq('resultado', 'ok')
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: false });

  const el = document.getElementById('logHoje');
  if (!data?.length && !erros?.length && !logMemory.length) {
    el.innerHTML = '<div class="empty-card"><span>Nenhuma conferência hoje.</span></div>';
    return;
  }

  // Selo para objeto lido hoje que estava previsto para outro dia
  const seloOutroDia = r => {
    if (!r.data_agendada || r.data_agendada === hoje) return '';
    const curta = r.data_agendada.slice(8, 10) + '/' + r.data_agendada.slice(5, 7);
    return r.data_agendada < hoje
      ? `<span class="badge badge-amber log-badge" title="Estava previsto para ${formatDateBR(r.data_agendada)}">⏰ de ${curta}</span>`
      : `<span class="badge badge-blue log-badge" title="Está previsto para ${formatDateBR(r.data_agendada)}">⚡ para ${curta}</span>`;
  };

  const rotuloErro = {
    nao_cadastrado: '❌ Não cadastrado',
    duplicado:      '⚠️ Etiqueta já conferida',
    erro:           '❌ Falha ao salvar',
  };

  // Recebidos e leituras com erro na mesma linha do tempo
  const linhas = [
    ...(data || []).map(r => ({
      tempo: r.data_recebimento,
      html: `
        <div class="log-item ok">
          <span class="log-icon">✅</span>
          <span class="log-code">${escHtml(r.codigo_rastreio)}</span>
          <span class="log-cliente">${escHtml(r.cliente)}</span>
          ${seloOutroDia(r)}
          <span class="log-time">${formatTime(r.data_recebimento)}</span>
        </div>`,
    })),
    ...(erros || []).map(b => ({
      tempo: b.created_at,
      html: `
        <div class="log-item err">
          <span class="log-icon">${b.resultado === 'duplicado' ? '⚠️' : '❌'}</span>
          <span class="log-code">${escHtml(b.codigo_rastreio)}</span>
          <span class="log-cliente">${escHtml(b.cliente || b.mensagem || '')}</span>
          <span class="badge badge-red log-badge">${rotuloErro[b.resultado] || b.resultado}</span>
          <span class="log-time">${formatTime(b.created_at)}</span>
        </div>`,
    })),
  ].sort((a, b) => new Date(b.tempo) - new Date(a.tempo));

  const html = linhas.map(l => l.html).join('');

  // Resumo: bipes do dia, quantos vieram de outra data e quantas leituras falharam
  const outroDia = (data || []).filter(r => r.data_agendada && r.data_agendada !== hoje);
  const resumo = linhas.length
    ? `<div class="log-resumo">
         <span>${(data || []).length} recebido(s) hoje</span>
         <span class="log-resumo-sep">•</span>
         <span>${(data || []).length - outroDia.length} previsto(s) para hoje</span>
         ${outroDia.length ? `<span class="log-resumo-sep">•</span><span class="log-resumo-alerta">⏰ ${outroDia.length} de outro dia</span>` : ''}
         ${erros?.length ? `<span class="log-resumo-sep">•</span><span class="log-resumo-erro">❌ ${erros.length} leitura(s) sem registro</span>` : ''}
       </div>`
    : '';

  el.innerHTML = (resumo + html) || '<div class="empty-card"><span>Nenhuma conferência hoje.</span></div>';
}

function renderLogHoje() {
  const el = document.getElementById('logHoje');
  if (!logMemory.length) { el.innerHTML = '<div class="empty-card"><span>Nenhuma conferência nesta sessão.</span></div>'; return; }
  el.innerHTML = logMemory.map(e => `
    <div class="log-item ${e.ok ? 'ok' : 'err'}">
      <span class="log-icon">${e.ok ? '✅' : '❌'}</span>
      <span class="log-code">${escHtml(e.code)}</span>
      <span class="log-cliente">${escHtml(e.msg)}</span>
      <span class="log-time">${formatTime(e.time)}</span>
    </div>`).join('');
}

// ─── CONSULTA ─────────────────────────────────────────────────────────────────
let consultaData = [];
let consultaPendentes = [];   // objetos sem bipe de dias ANTERIORES à data consultada
let diasComDados = new Set(); // datas que têm objetos (para o calendário)

// Quantos dias para trás a consulta procura pendências de outros dias
const CONSULTA_PEND_DIAS = 30;

async function carregarConsulta() {
  const data  = window._consultaDataSelecionada || '';
  const el    = document.getElementById('consultaResultados');
  const pills = document.getElementById('summaryPills');

  if (!data) { el.innerHTML = '<div class="empty-card"><span>Selecione uma data.</span></div>'; pills.style.display = 'none'; return; }
  if (!sb) { el.innerHTML = '<div class="empty-card"><span>Sem conexão com o banco.</span></div>'; return; }

  showLoading(true, 'Carregando...');
  const { data: rows, error } = await sb
    .from('cargas')
    .select('*')
    .eq('data_agendada', data)
    .order('cliente');
  showLoading(false);

  if (error) { el.innerHTML = '<div class="empty-card"><span>Erro ao consultar.</span></div>'; return; }

  consultaData = rows || [];

  // Pendências de dias anteriores (ex.: consultando 23/09, ainda falta 1 do 22/09)
  const limite = new Date(`${data}T00:00:00`);
  limite.setDate(limite.getDate() - CONSULTA_PEND_DIAS);
  const desde = `${limite.getFullYear()}-${String(limite.getMonth()+1).padStart(2,'0')}-${String(limite.getDate()).padStart(2,'0')}`;

  const { data: pend } = await sb
    .from('cargas')
    .select('*')
    .eq('recebido', false)
    .lt('data_agendada', data)
    .gte('data_agendada', desde)
    .order('data_agendada', { ascending: false });

  consultaPendentes = pend || [];
  renderConsulta();
}

async function carregarDiasComDados(ano, mes) {
  if (!sb) return;
  const inicio = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const fim    = `${ano}-${String(mes).padStart(2,'0')}-31`;
  const { data } = await sb
    .from('cargas')
    .select('data_agendada')
    .gte('data_agendada', inicio)
    .lte('data_agendada', fim);
  if (data) {
    diasComDados = new Set(data.map(r => r.data_agendada));
  }
}

function renderConsulta() {
  const el       = document.getElementById('consultaResultados');
  const pills    = document.getElementById('summaryPills');
  const filtCli  = document.getElementById('filtroCliente').value.toLowerCase().trim();

  let rows = consultaData;
  if (filtCli) rows = rows.filter(r => r.cliente.toLowerCase().includes(filtCli));

  const presentes = rows.filter(r => r.recebido);
  const faltando  = rows.filter(r => !r.recebido);

  document.getElementById('pillTotal').textContent    = rows.length;
  document.getElementById('pillPresente').textContent = presentes.length;
  document.getElementById('pillFaltando').textContent  = faltando.length;
  pills.style.display = rows.length ? 'grid' : 'none';

  if (!rows.length) {
    el.innerHTML = '<div class="empty-card"><span>Nenhum objeto para esta data.</span></div>';
    return;
  }

  // Agrupa por cliente e calcula o status (OK = todos os objetos do dia recebidos)
  const map = {};
  rows.forEach(it => {
    const c = it.cliente || 'Sem Cliente';
    if (!map[c]) map[c] = [];
    map[c].push(it);
  });

  const grupos = Object.keys(map).map(cliente => {
    const items     = map[cliente];
    const recebidos = items.filter(i => i.recebido).length;
    // Dentro do cliente, quem ainda não veio aparece primeiro
    items.sort((a, b) => (a.recebido === b.recebido)
      ? a.codigo_rastreio.localeCompare(b.codigo_rastreio)
      : (a.recebido ? 1 : -1));
    return { cliente, items, recebidos, total: items.length, ok: recebidos === items.length };
  });

  // Clientes com pendência primeiro; os OK por último. Dentro, ordem alfabética.
  grupos.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.cliente.localeCompare(b.cliente, 'pt-BR');
  });

  const clientesOk = grupos.filter(g => g.ok).length;

  // Pendências de dias anteriores, por cliente (respeitando o filtro digitado)
  const pendentes = filtCli
    ? consultaPendentes.filter(r => r.cliente.toLowerCase().includes(filtCli))
    : consultaPendentes;
  const pendPorCliente = {};
  pendentes.forEach(r => {
    (pendPorCliente[r.cliente] = pendPorCliente[r.cliente] || []).push(r);
  });

  const blocoPendencias = (cliente) => {
    const itens = pendPorCliente[cliente];
    if (!itens?.length) return '';
    return `
      <div class="pend-antes">
        <div class="pend-antes-head">⏰ Pendente de dia(s) anterior(es) — não conta no total deste dia</div>
        ${itens.map(r => cargaCardHTML(r, true)).join('')}
      </div>`;
  };

  const seloPendencias = (cliente) => {
    const itens = pendPorCliente[cliente];
    if (!itens?.length) return '';
    const dias = [...new Set(itens.map(r => formatDateBR(r.data_agendada)))];
    return `<span class="badge badge-red" title="Sem bipe desde ${dias.join(', ')}">⏰ ${itens.length} de ${dias[0]}${dias.length > 1 ? ' +' : ''}</span>`;
  };

  const renderClientGroup = (g) => {
    const statusBadge = g.ok
      ? `<span class="badge badge-green">✅ OK</span>`
      : `<span class="badge badge-amber">⚠️ Faltam ${g.total - g.recebidos}</span>`;
    return `
      <details class="client-group" ${g.ok ? '' : 'open'}>
        <summary class="client-summary">
          <div class="client-info">
            <span style="font-size: 1.05rem">👤</span>
            <span>${escHtml(g.cliente)}</span>
            <button class="edit-btn" data-cliente="${escHtml(g.cliente)}" onclick="event.stopPropagation(); event.preventDefault(); abrirRenomearCliente(this.dataset.cliente)" title="Renomear / mesclar cliente">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            ${seloPendencias(g.cliente)}
            ${statusBadge}
            <span class="badge badge-blue">${g.recebidos}/${g.total}</span>
            <span class="client-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>
        </summary>
        <div class="client-content">
          ${g.items.map(r => cargaCardHTML(r, !r.recebido)).join('')}
          ${blocoPendencias(g.cliente)}
        </div>
      </details>
    `;
  };

  // Bloco do topo: tudo que ainda não veio nesta data, agrupado por cliente
  const faltantes = rows.filter(r => !r.recebido);
  let html = '';
  if (faltantes.length) {
    const porCliente = {};
    faltantes.forEach(r => (porCliente[r.cliente] = porCliente[r.cliente] || []).push(r));
    const blocos = Object.keys(porCliente)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map(cliente => `
        <div class="falta-cliente">
          <div class="falta-cliente-nome">👤 ${escHtml(cliente)} <span class="badge badge-amber">${porCliente[cliente].length}</span></div>
          <div class="falta-itens">
            ${porCliente[cliente].map(r => `
              <div class="falta-item">
                <span class="log-code">${escHtml(r.codigo_rastreio)}</span>
                <span class="tipo-pill">${escHtml(r.tipo_servico)}</span>
              </div>`).join('')}
          </div>
        </div>`).join('');

    html += `
      <details class="falta-card" open>
        <summary class="falta-summary">
          <span>⏳ Faltando nesta data</span>
          <span class="badge badge-red">${faltantes.length}</span>
        </summary>
        <div class="falta-conteudo">${blocos}</div>
      </details>`;
  } else {
    html += `<div class="pend-ok">✅ Nada faltando nesta data — todos os objetos foram bipados.</div>`;
  }

  html += `<div class="group-header">👥 Clientes OK: ${clientesOk}/${grupos.length}</div>`;
  html += grupos.map(renderClientGroup).join('');

  // Clientes que não têm objeto neste dia, mas têm pendência de dias anteriores
  const clientesDoDia = new Set(grupos.map(g => g.cliente));
  const soPendencia = Object.keys(pendPorCliente)
    .filter(c => !clientesDoDia.has(c))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  if (soPendencia.length) {
    html += `<div class="group-header faltando">⏰ Pendências de outros dias</div>`;
    html += soPendencia.map(cliente => `
      <details class="client-group">
        <summary class="client-summary">
          <div class="client-info">
            <span style="font-size: 1.05rem">👤</span>
            <span>${escHtml(cliente)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            ${seloPendencias(cliente)}
            <span class="client-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>
        </summary>
        <div class="client-content">
          ${pendPorCliente[cliente].map(r => cargaCardHTML(r, true)).join('')}
        </div>
      </details>`).join('');
  }

  el.innerHTML = html;
}

// ─── EXPORTAR RELATÓRIO EXCEL ─────────────────────────────────────────────────
function exportarRelatorio() {
  // Usa a data selecionada no calendário customizado
  const data = window._consultaDataSelecionada || '';

  if (!consultaData.length) {
    showToast('⚠️ Nenhum dado para exportar. Selecione uma data com registros.');
    return;
  }

  if (!window.XLSX) {
    showToast('❌ Biblioteca Excel não carregada. Recarregue a página.');
    return;
  }

  const presentes = consultaData.filter(r => r.recebido);
  const faltando  = consultaData.filter(r => !r.recebido);

  const wb = XLSX.utils.book_new();

  function toSheet(rows, label) {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Código de Rastreio': r.codigo_rastreio,
      'Cliente':            r.cliente,
      'Tipo de Serviço':    r.tipo_servico,
      'Data Agendada':      formatDateBR(r.data_agendada),
      'Recebido':           r.recebido ? 'Sim' : 'Não',
      'Data Recebimento':   r.data_recebimento ? formatDateTime(r.data_recebimento) : '',
      'Status':             label,
    })));
    ws['!cols'] = [
      {wch:22},{wch:30},{wch:12},{wch:16},{wch:10},{wch:22},{wch:12}
    ];
    return ws;
  }

  // Aba combinada com todos os registros
  const allRows = [
    ...presentes.map(r => ({ ...r, _group: 'PRESENTE' })),
    ...faltando.map(r =>  ({ ...r, _group: 'FALTANDO' })),
  ];

  const wsAll = XLSX.utils.json_to_sheet(allRows.map(r => ({
    'Status':             r._group,
    'Código de Rastreio': r.codigo_rastreio,
    'Cliente':            r.cliente,
    'Tipo de Serviço':    r.tipo_servico,
    'Data Agendada':      formatDateBR(r.data_agendada),
    'Recebido':           r.recebido ? 'Sim' : 'Não',
    'Data Recebimento':   r.data_recebimento ? formatDateTime(r.data_recebimento) : '—',
  })));
  wsAll['!cols'] = [{wch:12},{wch:22},{wch:30},{wch:12},{wch:16},{wch:10},{wch:22}];
  XLSX.utils.book_append_sheet(wb, wsAll, 'Relatório Completo');

  if (presentes.length) XLSX.utils.book_append_sheet(wb, toSheet(presentes, 'PRESENTE'), 'Presentes');
  if (faltando.length)  XLSX.utils.book_append_sheet(wb, toSheet(faltando,  'FALTANDO'),  'Faltando');

  const filename = `conferencia_${data || 'sem-data'}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast('📥 Relatório exportado!');
}


// ─── CALENDÁRIO DA CONSULTA ───────────────────────────────────────────────────
let _calAno, _calMes;

function inicializarCalendario() {
  const hoje = new Date();
  _calAno = hoje.getFullYear();
  _calMes = hoje.getMonth() + 1; // 1-indexed
  renderCalendario();
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('calWrapper');
    if (wrapper && !wrapper.contains(e.target)) fecharCalendario();
  });
}

function toggleCalendario() {
  const panel = document.getElementById('calPanel');
  if (!panel) return;
  const aberto = panel.style.display !== 'none';
  if (aberto) {
    fecharCalendario();
  } else {
    panel.style.display = 'block';
    document.getElementById('calTrigger').classList.add('open');
    // Carrega dias com dados do mês atual
    carregarDiasComDados(_calAno, _calMes).then(renderCalendario);
  }
}

function fecharCalendario() {
  const panel = document.getElementById('calPanel');
  if (panel) panel.style.display = 'none';
  const trigger = document.getElementById('calTrigger');
  if (trigger) trigger.classList.remove('open');
}

function mudarMesCalendario(dir) {
  _calMes += dir;
  if (_calMes > 12) { _calMes = 1; _calAno++; }
  if (_calMes < 1)  { _calMes = 12; _calAno--; }
  carregarDiasComDados(_calAno, _calMes).then(renderCalendario);
}

function selecionarDiaCalendario(ano, mes, dia) {
  const iso = `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  window._consultaDataSelecionada = iso;

  const [y, m, d] = iso.split('-');
  const date = new Date(ano, mes - 1, dia);
  const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const label = `${d}/${m}/${y} — ${diasSemana[date.getDay()]}`;

  const el = document.getElementById('calValorExibido');
  if (el) el.textContent = label;

  fecharCalendario();
  carregarConsulta();
}

function renderCalendario() {
  const el = document.getElementById('calDias');
  const header = document.getElementById('calMesAno');
  if (!el || !header) return;

  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  header.textContent = meses[_calMes - 1] + ' ' + _calAno;

  const hojeStr = todayISO();
  const selecionado = window._consultaDataSelecionada || '';

  const primeiroDia = new Date(_calAno, _calMes - 1, 1).getDay();
  const diasNoMes   = new Date(_calAno, _calMes, 0).getDate();
  const diasNoAnterior = new Date(_calAno, _calMes - 1, 0).getDate();

  let html = '';

  // Dias do mês anterior
  for (let i = primeiroDia - 1; i >= 0; i--) {
    html += `<div class="cal-dia outro-mes">${diasNoAnterior - i}</div>`;
  }

  // Dias do mês atual
  for (let d = 1; d <= diasNoMes; d++) {
    const iso = `${_calAno}-${String(_calMes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    let cls = 'cal-dia';
    if (iso === selecionado) cls += ' selecionado';
    else if (iso === hojeStr) cls += ' hoje';
    if (diasComDados.has(iso) && iso !== selecionado) cls += ' tem-dados';
    html += `<div class="${cls}" onclick="selecionarDiaCalendario(${_calAno},${_calMes},${d})">${d}</div>`;
  }

  // Completar última linha
  const total = primeiroDia + diasNoMes;
  const resto = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= resto; d++) {
    html += `<div class="cal-dia outro-mes">${d}</div>`;
  }

  el.innerHTML = html;
}

// ─── RELATÓRIO POR CLIENTE ────────────────────────────────────────────────────
let relatorioData = [];

async function carregarRelatorioCliente() {
  const cliente = document.getElementById('relCliente').value;
  const el      = document.getElementById('relResultados');
  const pills   = document.getElementById('relPills');

  if (!cliente) {
    el.innerHTML = '<div class="empty-card"><span>Selecione um cliente para ver o histórico.</span></div>';
    pills.style.display = 'none';
    relatorioData = [];
    return;
  }
  if (!sb) { el.innerHTML = '<div class="empty-card"><span>Sem conexão com o banco.</span></div>'; return; }

  const inicio = document.getElementById('relDataInicio').value;
  const fim    = document.getElementById('relDataFim').value;

  showLoading(true, 'Carregando histórico...');
  let query = sb.from('cargas').select('*').eq('cliente', cliente).order('data_agendada', { ascending: false });
  if (inicio) query = query.gte('data_agendada', inicio);
  if (fim)    query = query.lte('data_agendada', fim);
  const { data, error } = await query;
  showLoading(false);

  if (error) { el.innerHTML = '<div class="empty-card"><span>Erro ao consultar.</span></div>'; return; }

  relatorioData = data || [];
  renderRelatorioCliente();
}

function renderRelatorioCliente() {
  const el    = document.getElementById('relResultados');
  const pills = document.getElementById('relPills');
  const rows  = relatorioData;

  const presentes = rows.filter(r => r.recebido);
  const faltando  = rows.filter(r => !r.recebido);

  document.getElementById('relPillTotal').textContent    = rows.length;
  document.getElementById('relPillPresente').textContent = presentes.length;
  document.getElementById('relPillFaltando').textContent = faltando.length;
  pills.style.display = rows.length ? 'grid' : 'none';

  if (!rows.length) {
    el.innerHTML = '<div class="empty-card"><span>Nenhum objeto encontrado neste período.</span></div>';
    return;
  }

  // Agrupa por mês/ano da data agendada
  const map = {};
  rows.forEach(r => {
    const mes = (r.data_agendada || '').slice(0, 7); // YYYY-MM
    if (!map[mes]) map[mes] = [];
    map[mes].push(r);
  });

  const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                       'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const meses = Object.keys(map).sort().reverse();

  el.innerHTML = meses.map((mes, idx) => {
    const [ano, mesNum] = mes.split('-');
    const label = `${mesesNomes[parseInt(mesNum, 10) - 1]} ${ano}`;
    const items = map[mes];
    const recebidosNoMes = items.filter(i => i.recebido).length;
    return `
      <details class="client-group" ${idx === 0 ? 'open' : ''}>
        <summary class="client-summary">
          <div class="client-info">
            <span style="font-size: 1.05rem">📅</span>
            <span>${escHtml(label)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="badge badge-blue">${recebidosNoMes}/${items.length}</span>
            <span class="client-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>
        </summary>
        <div class="client-content">
          ${items.map(r => cargaCardHTML(r, !r.recebido)).join('')}
        </div>
      </details>
    `;
  }).join('');
}

async function relatorioVerTudo() {
  document.getElementById('relDataInicio').value = '';
  document.getElementById('relDataFim').value = '';
  await carregarRelatorioCliente();
}

function exportarRelatorioCliente() {
  const cliente = document.getElementById('relCliente').value;
  if (!cliente) { showToast('⚠️ Selecione um cliente primeiro.'); return; }
  if (!relatorioData.length) { showToast('Nenhum dado para exportar.'); return; }

  const ws = XLSX.utils.json_to_sheet(relatorioData.map(r => ({
    'Código de Rastreio': r.codigo_rastreio,
    'Tipo de Serviço':    r.tipo_servico,
    'Data Agendada':      formatDateBR(r.data_agendada),
    'Recebido':           r.recebido ? 'Sim' : 'Não',
    'Data Recebimento':   r.data_recebimento ? formatDateTime(r.data_recebimento) : '—',
  })));
  ws['!cols'] = [{wch:22},{wch:12},{wch:16},{wch:10},{wch:22}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Histórico');

  const filename = `relatorio_${cliente.replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast('📥 Relatório exportado!');
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeModalBg(e, id) { if (e.target.id === id) closeModal(id); }

// ─── Toast ────────────────────────────────────────────────────────────────────
let _tTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  if (_tTimer) clearTimeout(_tTimer);
  _tTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function showLoading(show, msg = 'Carregando...') {
  document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
  document.getElementById('loadingMsg').textContent = msg;
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function formatTime(val) {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

