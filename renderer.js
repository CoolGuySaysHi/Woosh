// renderer.js — Woosh Browser UI Logic

// ipc is set by preload.js — access via getter so it's always current
const ipc = window.ipc;

// ── Security: sanitise any user/web-sourced strings before innerHTML ──
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Theme system ───────────────────────────────────────────────
const THEMES = {
  woosh:    { name:'Woosh (Default)', accent:'#8b6cf7', pink:'#f06bbd', bgDeep:'#0a0a0f', bgToolbar:'#111118', bgTabBar:'#0d0d14', bgTab:'#161622', bgTabActive:'#1e1e2e', bgInput:'#1a1a26', textPrimary:'#eeeaf8', textSecondary:'#7a7590', font:'Fredoka' },
  ocean:    { name:'Ocean',           accent:'#38bdf8', pink:'#34d399', bgDeep:'#030f1c', bgToolbar:'#071828', bgTabBar:'#040e18', bgTab:'#071525', bgTabActive:'#0c2035', bgInput:'#091d2e', textPrimary:'#e0f2fe', textSecondary:'#5a8aaa', font:'Inter' },
  rose:     { name:'Rose',            accent:'#f43f5e', pink:'#fb923c', bgDeep:'#0f0509', bgToolbar:'#1a0810', bgTabBar:'#120607', bgTab:'#180a0e', bgTabActive:'#220d14', bgInput:'#1e0b12', textPrimary:'#fce7f3', textSecondary:'#8a5060', font:'Outfit' },
  forest:   { name:'Forest',          accent:'#4ade80', pink:'#a3e635', bgDeep:'#020b04', bgToolbar:'#071409', bgTabBar:'#040d05', bgTab:'#071209', bgTabActive:'#0c1f0e', bgInput:'#091509', textPrimary:'#dcfce7', textSecondary:'#4a7a55', font:'Space Grotesk' },
  midnight: { name:'Midnight',        accent:'#a78bfa', pink:'#e879f9', bgDeep:'#000000', bgToolbar:'#0a0a0a', bgTabBar:'#050505', bgTab:'#0f0f0f', bgTabActive:'#161616', bgInput:'#111111', textPrimary:'#f5f5f5', textSecondary:'#666666', font:'Syne' },
  custom:   { name:'Custom' }
};

function applyTheme(t) {
  const s = document.documentElement.style;
  s.setProperty('--accent', t.accent);
  s.setProperty('--purple', t.accent);
  s.setProperty('--pink', t.pink);
  s.setProperty('--accent-glow', hexRgba(t.accent, 0.35));
  s.setProperty('--accent-dim',  hexRgba(t.accent, 0.15));
  s.setProperty('--border-focus',hexRgba(t.accent, 0.6));
  s.setProperty('--bg-deep',      t.bgDeep);
  s.setProperty('--bg-toolbar',   t.bgToolbar);
  s.setProperty('--bg-tab-bar',   t.bgTabBar);
  s.setProperty('--bg-tab',       t.bgTab);
  s.setProperty('--bg-tab-active',t.bgTabActive);
  s.setProperty('--bg-input',     t.bgInput);
  s.setProperty('--text-primary', t.textPrimary);
  s.setProperty('--text-secondary',t.textSecondary);
  if (t.font) s.setProperty('--font-ui', `'${t.font}', sans-serif`);
}
function hexRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// Apply saved theme on startup
(async () => {
  try {
    const s = await ipc.invoke('get-settings');
    if (!s.theme) return;
    if (s.theme.preset && s.theme.preset !== 'custom' && THEMES[s.theme.preset]) {
      applyTheme(THEMES[s.theme.preset]);
    } else if (s.theme.custom) {
      applyTheme(s.theme.custom);
    }
  } catch(e) {}
})();

// Listen for live theme changes from settings page
ipc.on('theme-changed', (e, themeData) => applyTheme(themeData));

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
  // Skip internal pages
  if (!url || url.startsWith('woosh://') || url.includes('newtab.html') || url.includes('search.html') || url.includes('privacy.html')) {
    btnBookmark.classList.remove('bookmarked');
    return;
  }
  const isBookmarked = await ipc.invoke('is-bookmarked', url);
  btnBookmark.classList.toggle('bookmarked', isBookmarked);
}

// Star button — add or remove bookmark
btnBookmark.addEventListener('click', async () => {
  // Use the raw URL from tab data, not the pretty version
  const tab = tabsData[activeTabId];
  const rawUrl = tab ? tab.url : currentUrl;

  if (!rawUrl || rawUrl.startsWith('woosh://') || rawUrl.includes('newtab.html') || rawUrl.includes('search.html') || rawUrl.includes('privacy.html')) return;

  const isBookmarked = await ipc.invoke('is-bookmarked', rawUrl);

  if (isBookmarked) {
    await ipc.invoke('remove-bookmark', rawUrl);
    btnBookmark.classList.remove('bookmarked');
  } else {
    const title = document.title.replace(' — Woosh', '') || rawUrl;
    await ipc.invoke('add-bookmark', { title, url: rawUrl, favicon: getFaviconUrl(rawUrl) });
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
btnShield.addEventListener('click', (e) => {
  e.stopPropagation();
  ipc.send('open-shield-popup');
});
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

// Handle PWA shortcut launch
ipc.on('navigate-to', (e, url) => {
  ipc.send('navigate', url);
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
  // Use raw tab URL for bookmark check (not the pretty woosh:// version)
  const tab = tabsData[activeTabId];
  updateBookmarkStar(tab ? tab.url : url);
});

ipc.on('page-loading', (e, isLoading) => {
  spinner.classList.toggle('hidden', !isLoading);
  btnReload.classList.toggle('loading', isLoading);
  // Check for PWA support after page finishes loading
  if (!isLoading) {
    const pwaBtn = document.getElementById('pwa-install-btn');
    pwaBtn.classList.add('hidden');
    setTimeout(async () => {
      const pwa = await ipc.invoke('check-pwa');
      if (pwa) {
        pwaBtn.classList.remove('hidden');
        pwaBtn.onclick = () => ipc.send('install-pwa', pwa);
      }
    }, 500);
  }
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
  initPasswordManager();
  loadPasswordList();
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

// ─── Password Manager ─────────────────────────────────────────
let allPasswords = [];
let pendingSave = null;

async function loadPasswordList() {
  allPasswords = await ipc.invoke('get-passwords');
  const btnPasswords = document.getElementById('btn-passwords');
  if (btnPasswords) btnPasswords.classList.toggle('has-passwords', allPasswords.length > 0);
  renderPasswordList(allPasswords);
}

function renderPasswordList(passwords) {
  const passwordList  = document.getElementById('password-list');
  const passwordEmpty = document.getElementById('password-empty');
  if (!passwordList) return;
  passwordList.innerHTML = '';

  if (passwords.length === 0) {
    passwordEmpty.style.display = 'block';
    return;
  }
  passwordEmpty.style.display = 'none';

  passwords.forEach(p => {
    const item = document.createElement('div');
    item.className = 'password-item';

    const fav = document.createElement('div');
    fav.className = 'password-favicon';
    fav.textContent = p.domain[0].toUpperCase();
    const img = new Image();
    img.onload = () => { fav.innerHTML = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover'; fav.appendChild(img); };
    try { img.src = 'https://' + p.domain + '/favicon.ico'; } catch(e) {}

    const info = document.createElement('div');
    info.className = 'password-info';
    info.innerHTML = `<div class="password-domain">${esc(p.domain)}</div><div class="password-username">${esc(p.username)}</div>`;

    const actions = document.createElement('div');
    actions.className = 'password-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'pw-btn';
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy password';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(p.password);
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
    });

    const fillBtn = document.createElement('button');
    fillBtn.className = 'pw-btn';
    fillBtn.textContent = 'Fill';
    fillBtn.title = 'Autofill on current page';
    fillBtn.addEventListener('click', () => {
      ipc.send('autofill-password', { username: p.username, password: p.password });
      document.getElementById('password-popup').classList.add('hidden');
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'pw-btn delete';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', async () => {
      await ipc.invoke('delete-password', { domain: p.domain, username: p.username });
      loadPasswordList();
    });

    actions.appendChild(copyBtn);
    actions.appendChild(fillBtn);
    actions.appendChild(delBtn);
    item.appendChild(fav);
    item.appendChild(info);
    item.appendChild(actions);
    passwordList.appendChild(item);
  });
}

function initPasswordManager() {
  const btnPasswords       = document.getElementById('btn-passwords');
  const passwordPopup      = document.getElementById('password-popup');
  const passwordPopupClose = document.getElementById('password-popup-close');
  const passwordSearch     = document.getElementById('password-search');
  console.log('initPasswordManager called, btnPasswords:', btnPasswords, 'popup:', passwordPopup);
  if (!btnPasswords) { console.log('btn-passwords not found!'); return; }

  // Toggle popup window
  btnPasswords.addEventListener('click', (e) => {
    e.stopPropagation();
    ipc.send('open-password-popup');
  });

  passwordPopupClose.addEventListener('click', () => passwordPopup.classList.add('hidden'));

  document.addEventListener('click', (e) => {
    if (!passwordPopup.contains(e.target) && e.target !== btnPasswords) {
      passwordPopup.classList.add('hidden');
    }
  });

  // Search filter
  passwordSearch.addEventListener('input', () => {
    const q = passwordSearch.value.toLowerCase();
    renderPasswordList(q ? allPasswords.filter(p => p.domain.includes(q) || p.username.includes(q)) : allPasswords);
  });
}

// Save password banner
ipc.on('offer-save-password', (e, { domain, username, password }) => {
  pendingSave = { domain, username, password };
  const saveBanner = document.getElementById('save-password-banner');
  if (!saveBanner) return;
  saveBanner.innerHTML = `
    <span class="banner-icon">🔑</span>
    <span class="banner-text">Save password for <strong>${domain}</strong>?</span>
    <button class="banner-btn" id="banner-save">Save</button>
    <button class="banner-btn dismiss" id="banner-dismiss">Not now</button>
  `;
  saveBanner.classList.remove('hidden');
  document.getElementById('banner-save').addEventListener('click', async () => {
    if (pendingSave) { await ipc.invoke('save-password', pendingSave); loadPasswordList(); }
    saveBanner.classList.add('hidden');
    pendingSave = null;
  });
  document.getElementById('banner-dismiss').addEventListener('click', () => {
    saveBanner.classList.add('hidden');
    pendingSave = null;
  });
  setTimeout(() => saveBanner.classList.add('hidden'), 15000);
});


// ─── Shield / Ad Blocker Popup ────────────────────────────────
let adBlockState = { enabled: true, whitelist: [] };

async function refreshShieldPopup() {
  adBlockState = await ipc.invoke('get-adblocker-state');
  const shieldToggleBtn     = document.getElementById('shield-toggle-btn');
  const shieldWhitelistBtn  = document.getElementById('shield-whitelist-btn');
  const shieldSiteName      = document.getElementById('shield-site-name');
  const shieldWhitelistList = document.getElementById('shield-whitelist-list');
  if (!shieldToggleBtn) return;

  const tab = tabsData[activeTabId];
  let domain = '';
  try { domain = new URL(tab ? tab.url : '').hostname.replace('www.', ''); } catch(e) {}

  shieldToggleBtn.textContent = adBlockState.enabled ? 'ON' : 'OFF';
  shieldToggleBtn.className = 'toggle-btn' + (adBlockState.enabled ? ' on' : '');

  const isWhitelisted = domain && adBlockState.whitelist.includes(domain);
  if (shieldSiteName) shieldSiteName.textContent = domain || 'This site';
  shieldWhitelistBtn.textContent = isWhitelisted ? 'Blocked ✓' : 'Allow ads';
  shieldWhitelistBtn.className = 'toggle-btn' + (isWhitelisted ? ' whitelisted' : '');
  shieldWhitelistBtn.dataset.domain = domain;

  shieldWhitelistList.innerHTML = '';
  if (adBlockState.whitelist.length === 0) {
    shieldWhitelistList.innerHTML = '<span style="font-size:12px;color:var(--text-muted);font-family:var(--font-ui)">No sites whitelisted</span>';
  } else {
    adBlockState.whitelist.forEach(d => {
      const row = document.createElement('div');
      row.className = 'whitelist-item';
      row.innerHTML = `<span>${esc(d)}</span><button class="whitelist-remove" data-domain="${esc(d)}">✕</button>`;
      row.querySelector('.whitelist-remove').addEventListener('click', () => {
        ipc.send('remove-from-whitelist', d);
        setTimeout(refreshShieldPopup, 100);
      });
      shieldWhitelistList.appendChild(row);
    });
  }

  shieldToggleBtn.onclick = () => { ipc.send('toggle-adblocker'); setTimeout(refreshShieldPopup, 100); };
  shieldWhitelistBtn.onclick = () => {
    const d = shieldWhitelistBtn.dataset.domain;
    if (!d) return;
    ipc.send(adBlockState.whitelist.includes(d) ? 'remove-from-whitelist' : 'add-to-whitelist', d);
    setTimeout(refreshShieldPopup, 100);
  };

  const statsBtn = document.getElementById('shield-stats-btn');
  if (statsBtn) statsBtn.onclick = () => {
    ipc.send('navigate', 'woosh://privacy');
    document.getElementById('shield-popup').classList.add('hidden');
  };

  const closeBtn = document.getElementById('shield-popup-close');
  if (closeBtn) closeBtn.onclick = () => document.getElementById('shield-popup').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  const popup = document.getElementById('shield-popup');
  if (popup && !popup.contains(e.target) && e.target !== btnShield && !btnShield.contains(e.target)) {
    popup.classList.add('hidden');
  }
});

ipc.on('adblocker-state', (e, state) => { adBlockState = state; });

// ─── Fullscreen ───────────────────────────────────────────────
ipc.on('fullscreen-change', (e, isFullscreen) => {
  document.body.classList.toggle('fullscreen', isFullscreen);
});

// ── PWA install toast ─────────────────────────────────────────
ipc.on('pwa-installed', (e, name) => {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: linear-gradient(135deg, #8b6cf7, #f06292);
    color: white; padding: 10px 20px; border-radius: 20px;
    font-family: var(--font-ui); font-size: 13px; font-weight: 600;
    z-index: 99999; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    animation: slideUp 0.2s ease;
  `;
  toast.textContent = `✓ ${name} installed!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
});

// ─── Permission requests ───────────────────────────────────────
ipc.on('open-permission-popup', (e, data) => {
  ipc.send('open-permission-popup', data);
});

// ─── Profile / Sync button ─────────────────────────────────────
const btnProfile = document.getElementById('btn-profile');
if (btnProfile) {
  btnProfile.addEventListener('click', () => ipc.send('open-profile-popup'));
}

document.getElementById('btn-settings')?.addEventListener('click', () => {
  ipc.send('navigate', 'woosh://settings');
});

ipc.on('sync-state-changed', (e, { signedIn }) => {
  const dot = document.getElementById('profile-sync-dot');
  if (dot) dot.classList.toggle('visible', signedIn);
});

// ─── Download bar ──────────────────────────────────────────────
const downloadBar   = document.getElementById('download-bar');
const downloadItems = document.getElementById('download-bar-items');
const downloads     = {};

document.getElementById('download-bar-close')?.addEventListener('click', () => {
  downloadBar.classList.add('hidden');
  downloadItems.innerHTML = '';
});

ipc.on('download-started', (e, { id, filename, totalBytes, savePath }) => {
  downloads[id] = { filename, totalBytes, savePath };
  downloadBar.classList.remove('hidden');
  const item = document.createElement('div');
  item.className = 'dl-item';
  item.id = `dl-${id}`;
  item.innerHTML = `
    <div class="dl-icon">${fileIcon(filename)}</div>
    <div class="dl-info">
      <div class="dl-name">${esc(filename)}</div>
      <div class="dl-status" id="dl-status-${esc(id)}">Starting…</div>
      <div class="dl-progress-wrap"><div class="dl-progress-bar" id="dl-bar-${esc(id)}" style="width:0%"></div></div>
    </div>
    <button class="dl-action" id="dl-action-${esc(id)}">Cancel</button>`;
  downloadItems.appendChild(item);
});

ipc.on('download-progress', (e, { id, received, total }) => {
  const pct    = total > 0 ? Math.round((received / total) * 100) : 0;
  const bar    = document.getElementById(`dl-bar-${id}`);
  const status = document.getElementById(`dl-status-${id}`);
  if (bar) bar.style.width = pct + '%';
  if (status) status.textContent = total > 0
    ? `${pct}% · ${formatBytes(received)} / ${formatBytes(total)}`
    : formatBytes(received);
});

ipc.on('download-done', (e, { id, state, savePath }) => {
  const status = document.getElementById(`dl-status-${id}`);
  const bar    = document.getElementById(`dl-bar-${id}`);
  const action = document.getElementById(`dl-action-${id}`);
  if (state === 'completed') {
    if (bar) bar.style.width = '100%';
    if (status) status.textContent = 'Done ✓';
    if (action) { action.textContent = 'Show'; action.onclick = () => ipc.send('show-in-folder', savePath); }
  } else {
    if (status) status.textContent = state === 'cancelled' ? 'Cancelled' : 'Failed';
    if (bar) bar.style.background = '#f55d5d';
    if (action) action.style.display = 'none';
  }
});

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['mp4','mkv','avi','mov','webm'].includes(ext)) return '🎬';
  if (['mp3','wav','flac','ogg','aac'].includes(ext)) return '🎵';
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼️';
  if (['zip','tar','gz','rar','7z'].includes(ext)) return '🗜️';
  if (['pdf'].includes(ext)) return '📄';
  if (['exe','msi','dmg','deb'].includes(ext)) return '⚙️';
  return '📥';
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}


// ─── AI Sidebar button ─────────────────────────────────────────
document.getElementById('btn-ai')?.addEventListener('click', () => ipc.send('ai-sidebar-toggle'));
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'A') { e.preventDefault(); ipc.send('ai-sidebar-toggle'); }
});
ipc.on('ai-sidebar-state', (e, open) => {
  document.getElementById('btn-ai')?.classList.toggle('active', open);
});
// Notify AI window when tab switches so it can reset
ipc.on('tab-switched', () => {
  ipc.send('ai-tab-switched-notify');
});