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

  // Load clientes suggestion on input
  document.getElementById('inpCliente').addEventListener('input', atualizarDatalist);

  // Enter key on manual scan
  document.getElementById('inpManual').addEventListener('keydown', e => {
    if (e.key === 'Enter') conferirManual();
  });

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
  if (tabId === 'tabCadastro')    carregarListaHoje();
  if (tabId === 'tabConferencia') carregarLogHoje();
  if (tabId === 'tabConsulta')    carregarConsulta();
}

// ─── Load all initial data ────────────────────────────────────────────────────
function carregarTudo() {
  carregarListaHoje();
  carregarClientesSugeridos();
  carregarLogHoje();
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
  atualizarDatalist();
}

// Lista de clientes distintos extraída dos objetos já cadastrados (fallback)
async function clientesDeCargas() {
  const { data } = await sb.from('cargas').select('cliente');
  if (!data) return [];
  const mapa = new Map(); // chave em minúsculas → nome como foi digitado
  data.forEach(r => {
    const nome = (r.cliente || '').trim();
    if (nome && !mapa.has(nome.toLowerCase())) mapa.set(nome.toLowerCase(), nome);
  });
  return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function atualizarDatalist() {
  const dl  = document.getElementById('listaClientes');
  const val = document.getElementById('inpCliente').value.toLowerCase();
  const filtered = clientesSugeridos.filter(c => c.toLowerCase().includes(val));
  dl.innerHTML = filtered.slice(0, 20).map(c => `<option value="${escHtml(c)}"></option>`).join('');
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
  const atual = document.getElementById('inpCliente');
  document.getElementById('inpNovoCliente').value = atual ? atual.value.trim() : '';
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
  atualizarDatalist();
  closeModal('modalCadastrarCliente');
  showToast('✅ Cliente cadastrado!');

  // Se veio do formulário de cadastro de objeto, já preenche o campo
  const inpCli = document.getElementById('inpCliente');
  if (inpCli) inpCli.value = nome;
  document.getElementById('inpNovoCliente').value = '';
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
  const badgeTxt = r.recebido ? '✓ Recebido' : '⏳ Aguardando';
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

  if (error) { showToast('❌ Erro na consulta.'); return; }

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
      setFeedback('err', '⚠️', 'Já Conferido!', `${code} — ${jaRecebido[0].cliente} (recebido em ${dtReceb})`);
      logEntry({ code, ok: false, msg: 'Já recebido' });
      showToast(`⚠️ ${code} — Já foi conferido anteriormente`);
    } else {
      beep('error');
      setFeedback('err', '❌', 'Não Cadastrado!', `Código: ${code} — Nenhum registro encontrado.`);
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

  if (upErr) { showToast('❌ Erro ao atualizar.'); return; }

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

  // Atualiza log
  carregarLogHoje();
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

  const start = todayISO() + 'T00:00:00';
  const end   = todayISO() + 'T23:59:59';

  const { data } = await sb
    .from('cargas')
    .select('codigo_rastreio, cliente, tipo_servico, data_recebimento')
    .eq('recebido', true)
    .gte('data_recebimento', start)
    .lte('data_recebimento', end)
    .order('data_recebimento', { ascending: false });

  const el = document.getElementById('logHoje');
  if (!data?.length && !logMemory.length) {
    el.innerHTML = '<div class="empty-card"><span>Nenhuma conferência hoje.</span></div>';
    return;
  }

  const html = (data || []).map(r => `
    <div class="log-item ok">
      <span class="log-icon">✅</span>
      <span class="log-code">${escHtml(r.codigo_rastreio)}</span>
      <span style="font-size:.8rem;color:var(--text-2);flex:1">${escHtml(r.cliente)}</span>
      <span class="log-time">${formatTime(r.data_recebimento)}</span>
    </div>`).join('');

  el.innerHTML = html || '<div class="empty-card"><span>Nenhuma conferência hoje.</span></div>';
}

function renderLogHoje() {
  const el = document.getElementById('logHoje');
  if (!logMemory.length) { el.innerHTML = '<div class="empty-card"><span>Nenhuma conferência nesta sessão.</span></div>'; return; }
  el.innerHTML = logMemory.map(e => `
    <div class="log-item ${e.ok ? 'ok' : 'err'}">
      <span class="log-icon">${e.ok ? '✅' : '❌'}</span>
      <span class="log-code">${escHtml(e.code)}</span>
      <span style="font-size:.8rem;color:var(--text-2);flex:1">${escHtml(e.msg)}</span>
      <span class="log-time">${formatTime(e.time)}</span>
    </div>`).join('');
}

// ─── CONSULTA ─────────────────────────────────────────────────────────────────
let consultaData = [];
let diasComDados = new Set(); // datas que têm objetos (para o calendário)

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
    return { cliente, items, recebidos, total: items.length, ok: recebidos === items.length };
  });

  // Clientes com pendência primeiro; os OK por último. Dentro, ordem alfabética.
  grupos.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.cliente.localeCompare(b.cliente, 'pt-BR');
  });

  const clientesOk = grupos.filter(g => g.ok).length;

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
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
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
        </div>
      </details>
    `;
  };

  let html = `<div class="group-header">👥 Clientes OK: ${clientesOk}/${grupos.length}</div>`;
  html += grupos.map(renderClientGroup).join('');

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
