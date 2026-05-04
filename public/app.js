const STATUS = {
  PRESENTE: 'PRESENTE',
  AUSENTE: 'AUSENTE'
};

let currentUser = null;
let secretarias = [];
let currentSecretaria = null;
let currentFilter = 'todos';
let currentSetorFilter = 'todos';
let currentSearch = '';
let currentComputadores = [];

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
  setorFilterCount: document.getElementById('setor-filter-count'),
  adminUsersPanel: document.getElementById('admin-users-panel'),
  adminUsersList: document.getElementById('admin-users-list'),
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

  elements.patrimonioSearch.addEventListener('input', debounce(async () => {
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
    const button = event.target.closest('button[data-status]');
    if (!button) {
      return;
    }

    const card = button.closest('.computer-card');
    const machineNameInput = card.querySelector('input[data-field="nome_maquina"]');
    const machineIpInput = card.querySelector('input[data-field="ip_maquina"]');
    const observationInput = card.querySelector('input[data-field="observacao"]');

    await saveComputer(button.dataset.id, {
      status_inventario: button.dataset.status,
      nome_maquina: machineNameInput.value,
      ip_maquina: machineIpInput.value,
      observacao: observationInput.value
    }, card);
  });

  elements.computerList.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-field]');
    if (!input) {
      return;
    }

    const card = input.closest('.computer-card');
    const status = card.dataset.status || null;
    const machineNameInput = card.querySelector('input[data-field="nome_maquina"]');
    const machineIpInput = card.querySelector('input[data-field="ip_maquina"]');
    const observationInput = card.querySelector('input[data-field="observacao"]');

    await saveComputer(card.dataset.id, {
      status_inventario: status,
      nome_maquina: machineNameInput.value,
      ip_maquina: machineIpInput.value,
      observacao: observationInput.value
    }, card);
  });

  elements.adminUsersList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-reset-user-id]');
    if (!button) {
      return;
    }

    const row = button.closest('.admin-user-row');
    const input = row.querySelector('input[data-temp-password]');
    const state = row.querySelector('.save-state');
    const senhaTemporaria = input.value.trim();

    if (senhaTemporaria.length < 8) {
      window.alert('Informe uma senha temporária com pelo menos 8 caracteres.');
      input.focus();
      return;
    }

    state.textContent = 'Resetando...';
    try {
      await api(`/api/admin/users/${button.dataset.resetUserId}/reset-password`, {
        method: 'PATCH',
        body: { senha_temporaria: senhaTemporaria }
      });
      input.value = '';
      state.textContent = 'Senha resetada';
      await loadAdminUsers();
    } catch (error) {
      state.textContent = '';
      window.alert(error.message);
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
  elements.exportHint.textContent = 'As alterações são salvas no banco imediatamente, com usuário e data.';
  elements.adminUsersPanel.classList.toggle('hidden', currentUser.perfil !== 'admin');

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
  elements.adminUsersList.innerHTML = data.users.map((user) => `
    <div class="admin-user-row">
      <div>
        <strong>${escapeHtml(user.nome)}</strong>
        <p class="muted">${escapeHtml(user.usuario)}</p>
        <span class="badge">${user.must_change_password ? 'Troca obrigatória pendente' : 'Senha definida'}</span>
      </div>
      <label>
        <span class="field-label">Senha temporária</span>
        <input type="text" data-temp-password placeholder="Nova senha temporária">
      </label>
      <div>
        <button class="btn-primary" type="button" data-reset-user-id="${user.id}">Resetar senha</button>
        <span class="save-state muted"></span>
      </div>
    </div>
  `).join('');
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
  renderSecretaria();
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

  const ownComputers = currentComputadores.filter((item) => !item.fora_secretaria);
  const externalComputers = currentComputadores.filter((item) => item.fora_secretaria);
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

function renderComputerCard(item) {
  const statusClass = item.fora_secretaria
    ? 'external-secretaria'
    : item.status_inventario ? item.status_inventario.toLowerCase() : 'pendente';
  const presentActive = item.status_inventario === STATUS.PRESENTE ? 'aria-pressed="true"' : '';
  const absentActive = item.status_inventario === STATUS.AUSENTE ? 'aria-pressed="true"' : '';
  const otherSecretariaWarning = item.fora_secretaria
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
          <span class="field-value">${escapeHtml(item.status_inventario || 'PENDENTE')}</span>
        </div>
        <div>
          <span class="field-label">Nome da máquina</span>
          <span class="field-value">${escapeHtml(item.nome_maquina || 'Não informado')}</span>
        </div>
        <div>
          <span class="field-label">IP da máquina</span>
          <span class="field-value">${escapeHtml(item.ip_maquina || 'Não informado')}</span>
        </div>
      </div>
      <div class="actions-row">
        <button class="btn-present" type="button" data-id="${item.id}" data-status="${STATUS.PRESENTE}" ${presentActive}>PRESENTE</button>
        <button class="btn-absent" type="button" data-id="${item.id}" data-status="${STATUS.AUSENTE}" ${absentActive}>AUSENTE</button>
        <input type="text" data-field="nome_maquina" value="${escapeHtml(item.nome_maquina || '')}" placeholder="Nome da Máquina">
        <input type="text" data-field="ip_maquina" value="${escapeHtml(item.ip_maquina || '')}" placeholder="IP da Máquina">
        <input type="text" data-field="observacao" value="${escapeHtml(item.observacao || '')}" placeholder="Observação opcional">
        <span class="save-state muted"></span>
      </div>
    </article>
  `;
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
    await loadHome();
    if (currentSecretaria) {
      await loadComputadores();
    }
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

function debounce(callback, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}
