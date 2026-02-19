// renderer.js — Woosh Browser UI Logic

const ipc = window.ipc;

// Elements
const addressbar      = document.getElementById('addressbar');
const btnBack         = document.getElementById('btn-back');
const btnForward      = document.getElementById('btn-forward');
const btnReload       = document.getElementById('btn-reload');
const btnHome         = document.getElementById('btn-home');
const btnNewTab       = document.getElementById('btn-new-tab');
const btnMinimize     = document.getElementById('btn-minimize');
const btnMaximize     = document.getElementById('btn-maximize');
const btnClose        = document.getElementById('btn-close');
const spinner         = document.getElementById('loading-spinner');
const lockIcon        = document.getElementById('lock-icon');
const tabsContainer   = document.getElementById('tabs-container');

let activeTabId = null;
let tabsData = {}; // id -> { title, url }

// ─── Tab rendering ───────────────────────────────────────────
function renderTab(id, title, isActive) {
  const existing = document.getElementById(`tab-${id}`);
  if (existing) {
    existing.querySelector('.tab-title').textContent = title || 'New Tab';
    if (isActive) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      existing.classList.add('active');
    }
    return;
  }

  const tab = document.createElement('div');
  tab.className = 'tab' + (isActive ? ' active' : '');
  tab.id = `tab-${id}`;
  tab.innerHTML = `
    <span class="tab-title">${title || 'New Tab'}</span>
    <button class="tab-close" data-id="${id}" title="Close tab">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
      </svg>
    </button>
  `;

  tab.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    ipc.send('switch-tab', id);
  });

  tab.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    ipc.send('close-tab', id);
  });

  tabsContainer.appendChild(tab);
}

function setActiveTab(id) {
  activeTabId = id;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const el = document.getElementById(`tab-${id}`);
  if (el) el.classList.add('active');
}

// ─── Navigation ───────────────────────────────────────────────
function navigate(input) {
  const url = input.trim();
  ipc.send('navigate', url || 'woosh://home');
  addressbar.blur();
}

addressbar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate(addressbar.value);
  if (e.key === 'Escape') addressbar.blur();
});

addressbar.addEventListener('focus', () => {
  setTimeout(() => addressbar.select(), 50);
});

btnBack.addEventListener('click', () => ipc.send('go-back'));
btnForward.addEventListener('click', () => ipc.send('go-forward'));
btnReload.addEventListener('click', () => ipc.send('reload'));
btnHome.addEventListener('click', () => {
  ipc.send('navigate', 'woosh://home');
  addressbar.value = 'woosh://home';
});

btnNewTab.addEventListener('click', () => ipc.send('new-tab'));

btnMinimize.addEventListener('click', () => ipc.send('minimize-window'));
btnMaximize.addEventListener('click', () => ipc.send('maximize-window'));
btnClose.addEventListener('click', () => ipc.send('close-window'));

// ─── IPC Events from main process ────────────────────────────

ipc.on('tab-created', (e, { id, url, title }) => {
  tabsData[id] = { url, title };
  renderTab(id, title, true);
  setActiveTab(id);
  addressbar.value = url === 'woosh://home' ? 'woosh://home' : url;
  updateLockIcon(url);
});

ipc.on('tab-updated', (e, { id, url, title }) => {
  tabsData[id] = { url, title };
  const el = document.getElementById(`tab-${id}`);
  if (el) el.querySelector('.tab-title').textContent = title || 'New Tab';
});

ipc.on('tab-closed', (e, id) => {
  const el = document.getElementById(`tab-${id}`);
  if (el) el.remove();
  delete tabsData[id];
});

ipc.on('tab-switched', (e, id) => {
  setActiveTab(id);
  const tab = tabsData[id];
  if (tab) {
    addressbar.value = tab.url === 'woosh://home' ? 'woosh://home' : tab.url;
    updateLockIcon(tab.url);
  }
});

ipc.on('url-changed', (e, url) => {
  if (document.activeElement !== addressbar) {
    addressbar.value = url === 'woosh://home' ? 'woosh://home' : url;
  }
  if (activeTabId && tabsData[activeTabId]) {
    tabsData[activeTabId].url = url;
  }
  updateLockIcon(url);
});

ipc.on('page-loading', (e, isLoading) => {
  spinner.classList.toggle('hidden', !isLoading);
  btnReload.classList.toggle('loading', isLoading);
});

ipc.on('title-changed', (e, title) => {
  document.title = title + ' — Woosh';
  if (activeTabId) {
    const el = document.getElementById(`tab-${activeTabId}`);
    if (el) el.querySelector('.tab-title').textContent = title || 'New Tab';
    if (tabsData[activeTabId]) tabsData[activeTabId].title = title;
  }
});

function updateLockIcon(url) {
  if (url && url.startsWith('https://')) {
    lockIcon.classList.add('secure');
    lockIcon.title = 'Secure connection';
  } else {
    lockIcon.classList.remove('secure');
    lockIcon.title = url && url.startsWith('woosh://') ? 'Woosh page' : 'Not secure';
  }
}

// ─── On load: sync any tabs that already exist ────────────────
// The first tab is created in main.js before the UI is ready,
// so we ask for the current tab list as soon as the page loads.
window.addEventListener('DOMContentLoaded', async () => {
  const tabs = await ipc.invoke('get-tabs');
  const activeId = await ipc.invoke('get-active-tab');
  tabs.forEach(t => {
    tabsData[t.id] = { url: t.url, title: t.title };
    renderTab(t.id, t.title || 'New Tab', t.id === activeId);
  });
  if (activeId) setActiveTab(activeId);
});

// ─── Keyboard shortcuts ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
    e.preventDefault();
    addressbar.focus();
    addressbar.select();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault();
    ipc.send('reload');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 't') {
    e.preventDefault();
    ipc.send('new-tab');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    if (activeTabId) ipc.send('close-tab', activeTabId);
  }
  if (e.altKey && e.key === 'ArrowLeft') ipc.send('go-back');
  if (e.altKey && e.key === 'ArrowRight') ipc.send('go-forward');
});