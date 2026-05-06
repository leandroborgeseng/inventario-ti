const STATUS = {
  PRESENTE: 'PRESENTE',
  PRESENTE_SEM_FUNCIONAMENTO: 'PRESENTE_SEM_FUNCIONAMENTO',
  AUSENTE: 'AUSENTE'
};

let currentUser = null;
let secretarias = [];
let currentSecretaria = null;
let currentFilter = 'todos';
let currentSetorFilter = 'todos';
let currentSearch = '';
let currentComputadores = [];
let lastExternalAlertKey = '';
let adminUsers = [];
let selectedAdminUser = null;

const elements = {
  subtitle: document.getElementById('app-subtitle'),
  loginView: document.getElementById('login-view'),
  loginForm: document.getElementById('login-form'),
  loginUser: document.getElementById('login-user'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  changePasswordView: document.getElementById('change-password-view'),
  changePasswordForm: document.getElementById('change-password-form'),
  currentPassword: document.getElementById('current-password'),
  newPassword: document.getElementById('new-password'),
  confirmPassword: document.getElementById('confirm-password'),
  changePasswordError: document.getElementById('change-password-error'),
  homeView: document.getElementById('home-view'),
  secretariaView: document.getElementById('secretaria-view'),
  secretariaGrid: document.getElementById('secretaria-grid'),
  globalProgress: document.getElementById('global-progress'),
  exportHint: document.getElementById('export-hint'),
  logoutButton: document.getElementById('logout-button'),
  backButton: document.getElementById('back-button'),
  secretariaTitle: document.getElementById('secretaria-title'),
  secretariaProgress: document.getElementById('secretaria-progress'),
  secretariaProgressBar: document.getElementById('secretaria-progress-bar'),
  computerList: document.getElementById('computer-list'),
  setorFilter: document.getElementById('setor-filter'),
  patrimonioSearch: document.getElementById('patrimonio-search'),
  patrimonioSearchButton: document.getElementById('patrimonio-search-button'),
  setorFilterCount: document.getElementById('setor-filter-count'),
  adminUsersPanel: document.getElementById('admin-users-panel'),
  adminUserSelect: document.getElementById('admin-user-select'),
  adminResetHint: document.getElementById('admin-reset-hint'),
  adminPasswordModal: document.getElementById('admin-password-modal'),
  adminPasswordModalClose: document.getElementById('admin-password-modal-close'),
  adminPasswordCancel: document.getElementById('admin-password-cancel'),
  adminPasswordForm: document.getElementById('admin-password-form'),
  adminPasswordTarget: document.getElementById('admin-password-target'),
  adminTempPassword: document.getElementById('admin-temp-password'),
  adminPasswordState: document.getElementById('admin-password-state'),
  filterButtons: document.querySelectorAll('.filter-btn')
};

init();

async function init() {
  bindEvents();

  try {
    const { user } = await api('/api/me');
    currentUser = user;
    if (currentUser.must_change_password) {
      showChangePassword();
      return;
    }
    await loadHome();
  } catch (error) {
    showLogin();
  }
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.loginError.textContent = '';

    try {
      const { user } = await api('/api/login', {
        method: 'POST',
        body: {
          usuario: elements.loginUser.value.trim(),
          senha: elements.loginPassword.value
        }
      });
      currentUser = user;
      elements.loginPassword.value = '';
      if (currentUser.must_change_password) {
        showChangePassword();
        return;
      }
      await loadHome();
    } catch (error) {
      elements.loginError.textContent = error.message;
    }
  });

  elements.changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.changePasswordError.textContent = '';

    if (elements.newPassword.value !== elements.confirmPassword.value) {
      elements.changePasswordError.textContent = 'A confirmação não confere com a nova senha.';
      return;
    }

    try {
      const { user } = await api('/api/change-password', {
        method: 'POST',
        body: {
          senha_atual: elements.currentPassword.value,
          nova_senha: elements.newPassword.value
        }
      });
      currentUser = user;
      elements.changePasswordForm.reset();
      await loadHome();
    } catch (error) {
      elements.changePasswordError.textContent = error.message;
    }
  });

  elements.logoutButton.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    currentUser = null;
    currentSecretaria = null;
    currentSearch = '';
    secretarias = [];
    currentComputadores = [];
    elements.changePasswordForm.reset();
    showLogin();
  });

  elements.backButton.addEventListener('click', () => {
    currentSecretaria = null;
    currentFilter = 'todos';
    currentSetorFilter = 'todos';
    currentSearch = '';
    renderHome();
  });

  elements.setorFilter.addEventListener('change', async () => {
    currentSetorFilter = elements.setorFilter.value;
    await loadComputadores();
  });

  elements.patrimonioSearchButton.addEventListener('click', runPatrimonioSearch);
  elements.patrimonioSearch.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    await runPatrimonioSearch();
  });

  elements.patrimonioSearch.addEventListener('search', debounce(async () => {
    currentSearch = elements.patrimonioSearch.value.trim();
    await loadComputadores();
  }, 250));

  elements.filterButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      currentFilter = button.dataset.filter;
      elements.filterButtons.forEach((item) => item.classList.toggle('active', item === button));
      await loadComputadores();
    });
  });

  elements.computerList.addEventListener('click', async (event) => {
    const choice = event.target.closest('button[data-status-choice]');
    if (choice) {
      const card = choice.closest('.computer-card');
      card.querySelectorAll('button[data-status-choice]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn === choice));
      });
      return;
    }

    const saveBtn = event.target.closest('button[data-save-computer]');
    if (!saveBtn) {
      return;
    }

    const card = saveBtn.closest('.computer-card');
    const payload = validateAndBuildComputerPayload(card);
    if (!payload) {
      return;
    }

    await saveComputer(card.dataset.id, payload, card);
  });

  elements.adminUserSelect.addEventListener('change', () => {
    if (!elements.adminUserSelect.value) {
      return;
    }

    openAdminPasswordModal(elements.adminUserSelect.value);
  });

  elements.adminPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!selectedAdminUser) {
      closeAdminPasswordModal();
      return;
    }

    const senhaTemporaria = elements.adminTempPassword.value.trim();

    if (senhaTemporaria.length < 8) {
      window.alert('Informe uma senha temporária com pelo menos 8 caracteres.');
      elements.adminTempPassword.focus();
      return;
    }

    elements.adminPasswordState.textContent = 'Resetando...';
    try {
      await api(`/api/admin/users/${selectedAdminUser.id}/reset-password`, {
        method: 'PATCH',
        body: { senha_temporaria: senhaTemporaria }
      });
      const secretaria = selectedAdminUser.nome;
      await loadAdminUsers();
      closeAdminPasswordModal();
      elements.adminResetHint.textContent = `Senha temporária de ${secretaria} resetada. No próximo acesso, o usuário será obrigado a trocar.`;
    } catch (error) {
      elements.adminPasswordState.textContent = '';
      window.alert(error.message);
    }
  });

  elements.adminPasswordModalClose.addEventListener('click', closeAdminPasswordModal);
  elements.adminPasswordCancel.addEventListener('click', closeAdminPasswordModal);
  elements.adminPasswordModal.addEventListener('click', (event) => {
    if (event.target === elements.adminPasswordModal) {
      closeAdminPasswordModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.adminPasswordModal.classList.contains('hidden')) {
      closeAdminPasswordModal();
    }
  });
}

async function loadHome() {
  const data = await api('/api/secretarias');
  secretarias = data.secretarias;
  renderHome();
  if (currentUser.perfil === 'admin') {
    await loadAdminUsers();
  }
}

function showLogin() {
  elements.loginView.classList.remove('hidden');
  elements.changePasswordView.classList.add('hidden');
  elements.homeView.classList.add('hidden');
  elements.secretariaView.classList.add('hidden');
  elements.backButton.classList.add('hidden');
  elements.logoutButton.classList.add('hidden');
  elements.subtitle.textContent = 'Faça login para iniciar.';
}

function showChangePassword() {
  elements.loginView.classList.add('hidden');
  elements.changePasswordView.classList.remove('hidden');
  elements.homeView.classList.add('hidden');
  elements.secretariaView.classList.add('hidden');
  elements.backButton.classList.add('hidden');
  elements.logoutButton.classList.remove('hidden');
  elements.subtitle.textContent = `${currentUser.nome} (${currentUser.usuario})`;
}

function renderHome() {
  const total = secretarias.reduce((sum, item) => sum + item.total, 0);
  const verificados = secretarias.reduce((sum, item) => sum + item.verificados, 0);

  elements.loginView.classList.add('hidden');
  elements.changePasswordView.classList.add('hidden');
  elements.homeView.classList.remove('hidden');
  elements.secretariaView.classList.add('hidden');
  elements.backButton.classList.add('hidden');
  elements.logoutButton.classList.remove('hidden');
  elements.subtitle.textContent = `${currentUser.nome} (${currentUser.usuario})`;
  elements.globalProgress.textContent = `${verificados} / ${total} computadores verificados`;
  elements.exportHint.textContent = 'Use o botão Salvar em cada card para gravar no banco (usuário e data são registrados).';
  elements.adminUsersPanel.classList.toggle('hidden', currentUser.perfil !== 'admin');
  elements.adminUsersPanel.open = false;

  elements.secretariaGrid.innerHTML = secretarias.map((secretaria) => `
    <article class="secretaria-card" tabindex="0" role="button" data-secretaria="${escapeHtml(secretaria.secretaria)}">
      <strong>${escapeHtml(secretaria.secretaria)}</strong>
      <p>${secretaria.verificados} / ${secretaria.total} confirmados</p>
      <div class="progress" aria-label="${secretaria.percentual}% concluído">
        <div class="progress-bar" style="width: ${secretaria.percentual}%"></div>
      </div>
      <p class="muted">${secretaria.pendentes} pendente(s), ${secretaria.presentes} presente(s), ${secretaria.ausentes} ausente(s)</p>
    </article>
  `).join('');

  elements.secretariaGrid.querySelectorAll('.secretaria-card').forEach((card) => {
    const open = () => openSecretaria(card.dataset.secretaria);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

async function loadAdminUsers() {
  const data = await api('/api/admin/users');
  adminUsers = data.users;
  elements.adminUserSelect.disabled = adminUsers.length === 0;
  elements.adminUserSelect.innerHTML = [
    '<option value="">Selecione uma secretaria</option>',
    ...adminUsers.map((user) => `
      <option value="${user.id}">
        ${escapeHtml(user.nome)} (${escapeHtml(user.usuario)})${user.must_change_password ? ' - troca pendente' : ''}
      </option>
    `)
  ].join('');

  if (adminUsers.length === 0) {
    elements.adminResetHint.textContent = 'Nenhum usuário de secretaria encontrado.';
  }
}

function openAdminPasswordModal(userId) {
  selectedAdminUser = adminUsers.find((user) => String(user.id) === String(userId));

  if (!selectedAdminUser) {
    return;
  }

  elements.adminPasswordForm.reset();
  elements.adminPasswordState.textContent = '';
  elements.adminPasswordTarget.textContent = `${selectedAdminUser.nome} (${selectedAdminUser.usuario})`;
  elements.adminPasswordModal.classList.remove('hidden');
  elements.adminTempPassword.focus();
}

function closeAdminPasswordModal() {
  elements.adminPasswordModal.classList.add('hidden');
  elements.adminPasswordForm.reset();
  elements.adminPasswordState.textContent = '';
  elements.adminUserSelect.value = '';
  selectedAdminUser = null;
}

async function openSecretaria(nome) {
  currentSecretaria = nome;
  currentFilter = 'todos';
  currentSetorFilter = 'todos';
  currentSearch = '';
  elements.patrimonioSearch.value = '';
  elements.filterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === currentFilter);
  });
  await loadSetores();
  await loadComputadores();
}

async function loadSetores() {
  const data = await api(`/api/secretarias/${encodeURIComponent(currentSecretaria)}/setores`);
  elements.setorFilter.innerHTML = [
    '<option value="todos">Todos os setores</option>',
    ...data.setores.map((setor) => `<option value="${escapeHtml(setor)}">${escapeHtml(setor)}</option>`)
  ].join('');
  elements.setorFilter.value = currentSetorFilter;
}

async function loadComputadores() {
  const params = new URLSearchParams({
    status: currentFilter,
    setor: currentSetorFilter,
    busca: currentSearch
  });
  const data = await api(`/api/secretarias/${encodeURIComponent(currentSecretaria)}/computadores?${params}`);
  currentComputadores = data.computadores;
  showExternalSecretariaAlert();
  renderSecretaria();
}

async function runPatrimonioSearch() {
  currentSearch = elements.patrimonioSearch.value.trim();
  lastExternalAlertKey = '';
  await loadComputadores();
}

function showExternalSecretariaAlert() {
  const externalComputers = currentComputadores.filter(isExternalSecretaria);
  if (!currentSearch || !externalComputers.length) {
    return;
  }

  const alertKey = externalComputers.map((item) => item.placa).join('|');
  if (alertKey === lastExternalAlertKey) {
    return;
  }

  lastExternalAlertKey = alertKey;
  window.alert('Patrimônio localizado em outra secretaria. O card ficará destacado em vermelho forte, mas você pode preencher as informações.');
}

function renderSecretaria() {
  const secretariaSummary = secretarias.find((item) => item.secretaria === currentSecretaria);
  const total = secretariaSummary?.total || currentComputadores.length;
  const verificados = secretariaSummary?.verificados || 0;
  const percentual = secretariaSummary?.percentual || 0;

  elements.homeView.classList.add('hidden');
  elements.secretariaView.classList.remove('hidden');
  elements.backButton.classList.remove('hidden');
  elements.logoutButton.classList.remove('hidden');
  elements.subtitle.textContent = currentSecretaria;
  elements.secretariaTitle.textContent = currentSecretaria;
  elements.secretariaProgress.textContent = `${verificados} de ${total} verificados`;
  elements.secretariaProgressBar.style.width = `${percentual}%`;
  elements.setorFilterCount.textContent = `${currentComputadores.length} computador(es) exibido(s) com os filtros atuais.`;

  if (!currentComputadores.length) {
    elements.computerList.innerHTML = '<div class="panel empty">Nenhum computador encontrado para este filtro.</div>';
    return;
  }

  const ownComputers = currentComputadores.filter((item) => !isExternalSecretaria(item));
  const externalComputers = currentComputadores.filter(isExternalSecretaria);
  const sections = [];

  if (ownComputers.length) {
    sections.push(ownComputers.map((item) => renderComputerCard(item)).join(''));
  }

  if (externalComputers.length) {
    sections.push(`
      <div class="external-section">
        <h3>Patrimônios localizados em outra secretaria</h3>
        <p class="muted">Esses equipamentos foram encontrados pela pesquisa global ou já foram preenchidos por esta secretaria.</p>
      </div>
      ${externalComputers.map((item) => renderComputerCard(item)).join('')}
    `);
  }

  elements.computerList.innerHTML = sections.join('');
}

function statusToCardClass(status) {
  if (!status) {
    return 'pendente';
  }

  return String(status).toLowerCase().replace(/_/g, '-');
}

function formatStatusInventario(status) {
  if (status === STATUS.PRESENTE_SEM_FUNCIONAMENTO) {
    return 'PRESENTE (sem funcionamento)';
  }

  return status || 'PENDENTE';
}

function renderComputerCard(item) {
  const statusClass = isExternalSecretaria(item)
    ? 'external-secretaria'
    : statusToCardClass(item.status_inventario);
  const presentActive = item.status_inventario === STATUS.PRESENTE ? 'aria-pressed="true"' : '';
  const presentPartialActive =
    item.status_inventario === STATUS.PRESENTE_SEM_FUNCIONAMENTO ? 'aria-pressed="true"' : '';
  const absentActive = item.status_inventario === STATUS.AUSENTE ? 'aria-pressed="true"' : '';
  const otherSecretariaWarning = isExternalSecretaria(item)
    ? `<div class="warning-box">Localizado em outra secretaria: <strong>${escapeHtml(item.secretaria)}</strong>. Você pode preencher as informações; depois ele continuará aparecendo para sua secretaria em uma seção separada.</div>`
    : '';

  return `
    <article class="computer-card ${statusClass}" data-id="${item.id}" data-status="${escapeHtml(item.status_inventario || '')}">
      ${otherSecretariaWarning}
      <div class="computer-main">
        <div>
          <span class="field-label">Placa patrimonial</span>
          <strong class="field-value">${escapeHtml(item.placa || 'Sem placa')}</strong>
        </div>
        <div>
          <span class="field-label">Bem patrimonial</span>
          <span class="field-value">${escapeHtml(item.bem_patrimonial || '-')}</span>
        </div>
        <div>
          <span class="field-label">Estado</span>
          <span class="field-value">${escapeHtml(item.conservacao || '-')}</span>
        </div>
        <div>
          <span class="field-label">Setor</span>
          <span class="field-value">${escapeHtml(item.setor || '-')}</span>
        </div>
        <div>
          <span class="field-label">Data de aquisição</span>
          <span class="field-value">${formatDate(item.dt_aquisicao)}</span>
        </div>
        <div>
          <span class="field-label">Status</span>
          <span class="field-value">${escapeHtml(formatStatusInventario(item.status_inventario))}</span>
        </div>
        <div>
          <span class="field-label">Nome da máquina</span>
          <span class="field-value">${escapeHtml(item.nome_maquina || 'Não informado')}</span>
        </div>
        <div>
          <span class="field-label">IP da máquina</span>
          <span class="field-value">${escapeHtml(item.ip_maquina || 'Não informado')}</span>
        </div>
        <div>
          <span class="field-label">Número de série</span>
          <span class="field-value">${escapeHtml(item.numero_serie || 'Não informado')}</span>
        </div>
      </div>
      <div class="actions-row">
        <button class="btn-present" type="button" data-status-choice data-status="${STATUS.PRESENTE}" ${presentActive}>Presente (funcionando)</button>
        <button class="btn-present-partial" type="button" data-status-choice data-status="${STATUS.PRESENTE_SEM_FUNCIONAMENTO}" ${presentPartialActive}>Presente (sem funcionamento)</button>
        <button class="btn-absent" type="button" data-status-choice data-status="${STATUS.AUSENTE}" ${absentActive}>Ausente</button>
        <label class="inventory-input">
          <span class="field-label">Número de série (obrigatório só se “Presente (funcionando)”)</span>
          <input type="text" data-field="numero_serie" value="${escapeHtml(item.numero_serie || '')}" placeholder="Ex.: ABC123456">
        </label>
        <label class="inventory-input required-field">
          <span class="field-label">Nome da máquina *</span>
          <input type="text" data-field="nome_maquina" value="${escapeHtml(item.nome_maquina || '')}" placeholder="Nome ou identificação (ex.: patrimônio)">
        </label>
        <label class="inventory-input">
          <span class="field-label">IP da máquina</span>
          <input type="text" data-field="ip_maquina" value="${escapeHtml(item.ip_maquina || '')}" placeholder="IP da Máquina">
        </label>
        <details class="obs-collapsible">
          <summary class="obs-summary">
            Observação opcional${(item.observacao || '').trim() ? ' <span class="obs-pill">com texto</span>' : ''}
          </summary>
          <label class="inventory-input obs-collapsible-body">
            <span class="field-label">Observação</span>
            <input type="text" data-field="observacao" value="${escapeHtml(item.observacao || '')}" placeholder="Observação opcional">
          </label>
        </details>
        <button class="btn-primary btn-save-card" type="button" data-save-computer>Salvar</button>
        <span class="save-state muted"></span>
      </div>
    </article>
  `;
}

function getSelectedInventoryStatus(card) {
  const pressed = card.querySelector('button[data-status-choice][aria-pressed="true"]');
  return pressed ? pressed.dataset.status : null;
}

function validateAndBuildComputerPayload(card) {
  const status = getSelectedInventoryStatus(card);
  const serialInput = card.querySelector('input[data-field="numero_serie"]');
  const machineNameInput = card.querySelector('input[data-field="nome_maquina"]');
  const machineIpInput = card.querySelector('input[data-field="ip_maquina"]');
  const observationInput = card.querySelector('input[data-field="observacao"]');

  if (!status) {
    window.alert('Selecione se o equipamento está presente (funcionando), presente sem funcionamento ou ausente.');
    const firstChoice = card.querySelector('button[data-status-choice]');
    if (firstChoice) {
      firstChoice.focus();
    }
    return null;
  }

  const nomeMaquina = machineNameInput.value.trim();
  if (!nomeMaquina) {
    window.alert('Informe o nome da máquina (ou uma identificação, ex. placa patrimonial).');
    machineNameInput.focus();
    return null;
  }

  const numeroSerie = serialInput.value.trim();
  if (status === STATUS.PRESENTE && !numeroSerie) {
    window.alert('Para “Presente (funcionando)”, informe o número de série. Se o equipamento não liga ou não há série, use “Presente (sem funcionamento)” ou “Ausente”.');
    serialInput.focus();
    return null;
  }

  return {
    status_inventario: status,
    numero_serie: numeroSerie,
    nome_maquina: nomeMaquina,
    ip_maquina: machineIpInput.value.trim(),
    observacao: observationInput.value.trim()
  };
}

async function refreshSecretariaSummaries() {
  const data = await api('/api/secretarias');
  secretarias = data.secretarias;

  if (!currentSecretaria) {
    return;
  }

  const secretariaSummary = secretarias.find((item) => item.secretaria === currentSecretaria);
  const total = secretariaSummary?.total ?? 0;
  const verificados = secretariaSummary?.verificados ?? 0;
  const percentual = secretariaSummary?.percentual ?? 0;
  elements.secretariaProgress.textContent = `${verificados} de ${total} verificados`;
  elements.secretariaProgressBar.style.width = `${percentual}%`;
}

async function saveComputer(id, payload, card) {
  const saveState = card.querySelector('.save-state');
  saveState.textContent = 'Salvando...';

  try {
    await api(`/api/computadores/${id}`, {
      method: 'PATCH',
      body: payload
    });
    saveState.textContent = 'Salvo';
    await refreshSecretariaSummaries();
    await loadComputadores();
  } catch (error) {
    saveState.textContent = '';
    window.alert(error.message);
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || 'Erro ao comunicar com o servidor.');
  }

  return data;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const [year, month, day] = value.split('-');
  if (!year || !month || !day) {
    return escapeHtml(value);
  }

  return `${day}/${month}/${year}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isExternalSecretaria(item) {
  return item.fora_secretaria === true || item.fora_secretaria === 'true';
}

function debounce(callback, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}
