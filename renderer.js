// renderer.js — Woosh Browser UI Logic

const ipc = window.ipc;

// Elements
const addressbar      = document.getElementById('addressbar');
const btnBack         = document.getElementById('btn-back');
const btnForward      = document.getElementById('btn-forward');
const btnReload       = document.getElementById('btn-reload');
const btnHome         = document.getElementById('btn-home');
const btnNewTab       = document.getElementById('btn-new-tab');
const btnBookmark     = document.getElementById('btn-bookmark');
const btnShield       = document.getElementById('btn-shield');
const shieldCount     = document.getElementById('shield-count');
const btnMinimize     = document.getElementById('btn-minimize');
const btnMaximize     = document.getElementById('btn-maximize');
const btnClose        = document.getElementById('btn-close');
const spinner         = document.getElementById('loading-spinner');
const lockIcon        = document.getElementById('lock-icon');
const tabsContainer   = document.getElementById('tabs-container');
const bookmarksList   = document.getElementById('bookmarks-list');
const bookmarksEmpty  = document.getElementById('bookmarks-empty');
const contextMenu     = document.getElementById('bookmark-context-menu');
const ctxRemove       = document.getElementById('ctx-remove');

let activeTabId = null;
let tabsData = {};
let currentUrl = '';
let contextMenuUrl = null;

// ─── Favicon helper ───────────────────────────────────────────
function getFaviconUrl(url) {
  try { return new URL(url).origin + '/favicon.ico'; }
  catch(e) { return null; }
}

function makeFaviconEl(url, size = 14) {
  const wrap = document.createElement('div');
  wrap.className = 'tab-favicon';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  if (!url || url.startsWith('woosh://')) {
    wrap.textContent = '🚀';
    wrap.style.fontSize = '10px';
    return wrap;
  }

  const faviconUrl = getFaviconUrl(url);
  if (faviconUrl) {
    const img = new Image();
    img.style.cssText = `width:${size}px;height:${size}px;object-fit:cover;border-radius:3px`;
    img.onload = () => { wrap.innerHTML = ''; wrap.appendChild(img); };
    img.onerror = () => {
      try { wrap.textContent = new URL(url).hostname[0].toUpperCase(); } catch(e) { wrap.textContent = '?'; }
      wrap.style.cssText += ';font-size:9px;font-weight:700;color:#fff;background:linear-gradient(135deg,#8b6cf7,#f06bbd);display:flex;align-items:center;justify-content:center;border-radius:3px';
    };
    img.src = faviconUrl;
  }
  return wrap;
}

// ─── Tab rendering ───────────────────────────────────────────
function renderTab(id, title, isActive, url = '') {
  const existing = document.getElementById(`tab-${id}`);
  if (existing) {
    existing.querySelector('.tab-title').textContent = title || 'New Tab';
    if (isActive) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      existing.classList.add('active');
    }
    // Update favicon if URL changed
    const existingFav = existing.querySelector('.tab-favicon');
    if (existingFav && url) {
      const newFav = makeFaviconEl(url);
      existing.replaceChild(newFav, existingFav);
    }
    return;
  }

  const tab = document.createElement('div');
  tab.className = 'tab' + (isActive ? ' active' : '');
  tab.id = `tab-${id}`;

  const favicon = makeFaviconEl(url);
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = title || 'New Tab';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.dataset.id = id;
  closeBtn.title = 'Close tab';
  closeBtn.innerHTML = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>`;

  tab.appendChild(favicon);
  tab.appendChild(titleSpan);
  tab.appendChild(closeBtn);

  tab.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    ipc.send('switch-tab', id);
  });

  closeBtn.addEventListener('click', (e) => {
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

// ─── Bookmarks ────────────────────────────────────────────────
async function renderBookmarks() {
  const bookmarks = await ipc.invoke('get-bookmarks');
  bookmarksList.innerHTML = '';

  if (bookmarks.length === 0) {
    bookmarksEmpty.classList.add('visible');
    return;
  }

  bookmarksEmpty.classList.remove('visible');

  bookmarks.forEach(b => {
    const item = document.createElement('button');
    item.className = 'bookmark-item';
    item.title = b.title + '\n' + b.url;

    // Favicon
    const fav = document.createElement('div');
    fav.className = 'bookmark-favicon';
    try {
      const domain = new URL(b.url).hostname;
      fav.textContent = domain[0].toUpperCase();
    } catch(e) { fav.textContent = '?'; }

    const img = new Image();
    img.onload = () => { fav.innerHTML = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover'; fav.appendChild(img); };
    try { img.src = new URL(b.url).origin + '/favicon.ico'; } catch(e) {}

    // Label — show just the domain name to keep it compact
    const label = document.createElement('span');
    label.className = 'bookmark-label';
    try {
      label.textContent = new URL(b.url).hostname.replace('www.', '');
    } catch(e) { label.textContent = b.title || b.url; }

    item.appendChild(fav);
    item.appendChild(label);

    // Left click: navigate
    item.addEventListener('click', () => {
      ipc.send('navigate', b.url);
    });

    // Right click: show context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenuUrl = b.url;
      contextMenu.style.left = e.clientX + 'px';
      contextMenu.style.top = e.clientY + 'px';
      contextMenu.classList.add('visible');
    });

    bookmarksList.appendChild(item);
  });
}

async function updateBookmarkStar(url) {
  if (!url || url.startsWith('woosh://')) {
    btnBookmark.classList.remove('bookmarked');
    return;
  }
  const isBookmarked = await ipc.invoke('is-bookmarked', url);
  btnBookmark.classList.toggle('bookmarked', isBookmarked);
}

// Star button — add or remove bookmark
btnBookmark.addEventListener('click', async () => {
  if (!currentUrl || currentUrl.startsWith('woosh://')) return;

  const isBookmarked = await ipc.invoke('is-bookmarked', currentUrl);

  if (isBookmarked) {
    await ipc.invoke('remove-bookmark', currentUrl);
    btnBookmark.classList.remove('bookmarked');
  } else {
    const title = document.title.replace(' — Woosh', '') || currentUrl;
    await ipc.invoke('add-bookmark', { title, url: currentUrl, favicon: getFaviconUrl(currentUrl) });
    btnBookmark.classList.add('bookmarked');

    // Little pop animation
    btnBookmark.style.transform = 'scale(1.3)';
    setTimeout(() => { btnBookmark.style.transform = ''; }, 200);
  }

  renderBookmarks();
});

// Context menu — remove bookmark
ctxRemove.addEventListener('click', async () => {
  if (contextMenuUrl) {
    await ipc.invoke('remove-bookmark', contextMenuUrl);
    contextMenu.classList.remove('visible');
    contextMenuUrl = null;
    renderBookmarks();
    updateBookmarkStar(currentUrl);
  }
});

// Hide context menu on click elsewhere
document.addEventListener('click', () => contextMenu.classList.remove('visible'));

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
btnShield.addEventListener('click', () => ipc.send('navigate', 'woosh://privacy'));
btnMinimize.addEventListener('click', () => ipc.send('minimize-window'));
btnMaximize.addEventListener('click', () => ipc.send('maximize-window'));
btnClose.addEventListener('click', () => ipc.send('close-window'));

// ─── IPC Events ───────────────────────────────────────────────
ipc.on('tab-created', (e, { id, url, title }) => {
  tabsData[id] = { url, title };
  renderTab(id, title, true, url);
  setActiveTab(id);
  currentUrl = url;
  addressbar.value = url === 'woosh://home' ? 'woosh://home' : url;
  updateLockIcon(url);
  updateBookmarkStar(url);
});

ipc.on('tab-updated', (e, { id, url, title }) => {
  tabsData[id] = { url, title };
  const el = document.getElementById(`tab-${id}`);
  if (el) {
    el.querySelector('.tab-title').textContent = title || 'New Tab';
    // Update favicon
    const existingFav = el.querySelector('.tab-favicon');
    if (existingFav) {
      const newFav = makeFaviconEl(url);
      el.replaceChild(newFav, existingFav);
    }
  }
});

ipc.on('tab-closed', (e, id) => {
  document.getElementById(`tab-${id}`)?.remove();
  delete tabsData[id];
});

ipc.on('tab-switched', (e, id) => {
  setActiveTab(id);
  const tab = tabsData[id];
  if (tab) {
    currentUrl = tab.url;
    addressbar.value = tab.url === 'woosh://home' ? 'woosh://home' : tab.url;
    updateLockIcon(tab.url);
    updateBookmarkStar(tab.url);
  }
});

ipc.on('url-changed', (e, url) => {
  currentUrl = url;
  if (document.activeElement !== addressbar) {
    addressbar.value = url === 'woosh://home' ? 'woosh://home' : url;
  }
  if (activeTabId && tabsData[activeTabId]) {
    tabsData[activeTabId].url = url;
  }
  updateLockIcon(url);
  updateBookmarkStar(url);
});

ipc.on('page-loading', (e, isLoading) => {
  spinner.classList.toggle('hidden', !isLoading);
  btnReload.classList.toggle('loading', isLoading);
});

ipc.on('blocked-update', (e, stats) => {
  const total = (stats.ads || 0);
  if (total > 0) {
    shieldCount.textContent = total > 99 ? '99+' : total;
    shieldCount.classList.add('visible');
    btnShield.classList.add('active');
  } else {
    shieldCount.classList.remove('visible');
    btnShield.classList.remove('active');
  }
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

// ─── On load: sync tabs + load bookmarks ─────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const tabs = await ipc.invoke('get-tabs');
  const activeId = await ipc.invoke('get-active-tab');
  tabs.forEach(t => {
    tabsData[t.id] = { url: t.url, title: t.title };
    renderTab(t.id, t.title || 'New Tab', t.id === activeId, t.url);
  });
  if (activeId) setActiveTab(activeId);
  renderBookmarks();
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    btnBookmark.click();
  }
  if (e.altKey && e.key === 'ArrowLeft') ipc.send('go-back');
  if (e.altKey && e.key === 'ArrowRight') ipc.send('go-forward');
});