const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');

// ─── Ad & Tracker Blocker ─────────────────────────────────────
// Domains to block — covers ads, trackers, telemetry, and malware
const BLOCKED_DOMAINS = new Set([
  // Google ads & tracking
  'googleadservices.com','googlesyndication.com','doubleclick.net',
  'googletagmanager.com','googletagservices.com','google-analytics.com',
  'analytics.google.com','adservice.google.com','pagead2.googlesyndication.com',
  // Facebook
  'connect.facebook.net','connect.facebook.com','graph.facebook.com',
  'an.facebook.com','staticxx.facebook.com',
  // Amazon ads
  'aax.amazon-adsystem.com','s.amazon-adsystem.com',
  // Twitter/X tracking
  'static.ads-twitter.com','analytics.twitter.com','t.co',
  // Major ad networks
  'ads.yahoo.com','advertising.com','adblade.com','adroll.com',
  'criteo.com','criteo.net','pubmatic.com','rubiconproject.com',
  'openx.net','openx.com','appnexus.com','casalemedia.com',
  'smartadserver.com','taboola.com','outbrain.com','revcontent.com',
  'zergnet.com','mgid.com','disqus.com','quantserve.com',
  // Analytics & trackers
  'hotjar.com','mouseflow.com','fullstory.com','mixpanel.com',
  'segment.com','amplitude.com','heap.io','kissmetrics.com',
  'optimizely.com','crazyegg.com','clicktale.com',
  // Telemetry
  'scorecardresearch.com','comscore.com','chartbeat.com',
  'newrelic.com','nr-data.net','ping.chartbeat.net',
  // Pop-up/malware
  'popcash.net','popads.net','propellerads.com','adcash.com',
  'yllix.com','exoclick.com',
]);

// Per-tab block counters  { tabId: { ads: N, trackers: N } }
const blockStats = {};
// Lifetime stats saved to disk — paths resolved lazily after app is ready
let STATS_FILE = null;
let BOOKMARKS_FILE = null;

function getStatsFile() {
  if (!STATS_FILE) STATS_FILE = path.join(app.getPath('userData'), 'privacy-stats.json');
  return STATS_FILE;
}

function getBookmarksFile() {
  if (!BOOKMARKS_FILE) BOOKMARKS_FILE = path.join(app.getPath('userData'), 'bookmarks.json');
  return BOOKMARKS_FILE;
}

function loadStats() {
  try {
    const f = getStatsFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch(e) {}
  return { totalAds: 0, totalTrackers: 0, totalBlocked: 0, since: Date.now() };
}

function saveStats(stats) {
  try { fs.writeFileSync(getStatsFile(), JSON.stringify(stats, null, 2)); } catch(e) {}
}

let lifetimeStats = { totalAds: 0, totalTrackers: 0, totalBlocked: 0, since: Date.now() };

function isDomainBlocked(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Check exact match and parent domains
    if (BLOCKED_DOMAINS.has(hostname)) return true;
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      if (BLOCKED_DOMAINS.has(parts.slice(i).join('.'))) return true;
    }
  } catch(e) {}
  return false;
}

function isTrackerDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes('analytics') || hostname.includes('tracker') ||
           hostname.includes('telemetry') || hostname.includes('metric') ||
           hostname.includes('segment') || hostname.includes('pixel');
  } catch(e) { return false; }
}

ipcMain.handle('get-privacy-stats', () => ({
  lifetime: lifetimeStats,
  perTab: blockStats
}));

ipcMain.handle('reset-privacy-stats', () => {
  lifetimeStats = { totalAds: 0, totalTrackers: 0, totalBlocked: 0, since: Date.now() };
  saveStats(lifetimeStats);
  return lifetimeStats;
});

// ─── Bookmarks stored in bookmarks.json next to main.js ───────

function loadBookmarks() {
  try {
    const f = getBookmarksFile();
    if (fs.existsSync(f)) {
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    }
  } catch(e) {}
  return [];
}

function saveBookmarks(bookmarks) {
  try {
    fs.writeFileSync(getBookmarksFile(), JSON.stringify(bookmarks, null, 2));
  } catch(e) {}
}

ipcMain.handle('get-bookmarks', () => loadBookmarks());

ipcMain.handle('add-bookmark', (e, { title, url, favicon }) => {
  const bookmarks = loadBookmarks();
  // Don't add duplicates
  if (bookmarks.find(b => b.url === url)) return bookmarks;
  bookmarks.push({ title, url, favicon, added: Date.now() });
  saveBookmarks(bookmarks);
  return bookmarks;
});

ipcMain.handle('remove-bookmark', (e, url) => {
  const bookmarks = loadBookmarks().filter(b => b.url !== url);
  saveBookmarks(bookmarks);
  return bookmarks;
});

ipcMain.handle('is-bookmarked', (e, url) => {
  return loadBookmarks().some(b => b.url === url);
});

let mainWindow;
let tabs = [];
let activeTabId = 0;
let nextTabId = 1;
const TOOLBAR_HEIGHT = 124;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    frame: false, titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true, contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0a0a0f'
  });
  mainWindow.loadFile('index.html');

  mainWindow.on('resize', () => updateActiveViewBounds());
  createTab('woosh://home');
}

// ─── Search ───────────────────────────────────────────────────
ipcMain.handle('woosh-search', async (event, { query, page = 1 }) => {
  return new Promise((resolve) => {
    const postData = querystring.stringify({ q: query, s: String((page - 1) * 20) });

    const options = {
      hostname: 'html.duckduckgo.com',
      path: '/html/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    };

    const timer = setTimeout(() => { req.destroy(); resolve({ success: false, error: 'Timed out' }); }, 10000);

    let body = '';

    const req = https.request(options, (res) => {
      console.log('[Woosh] DDG status:', res.statusCode);
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timer);

        // Log the raw HTML so we can see DDG's actual structure
        console.log('[Woosh] === RAW HTML SAMPLE (first 4000 chars) ===');
        console.log(body.slice(0, 4000));
        console.log('[Woosh] === END SAMPLE ===');

        // Log all class names found in the HTML so we can see what DDG uses
        const classes = new Set();
        const classRe = /class="([^"]+)"/g;
        let cm;
        while ((cm = classRe.exec(body)) !== null) {
          cm[1].split(/\s+/).forEach(c => classes.add(c));
        }
        console.log('[Woosh] All CSS classes in response:', [...classes].sort().join(', '));

        try {
          const results = parseDDG(body);
          console.log('[Woosh] Parsed', results.length, 'results');
          if (results.length > 0) console.log('[Woosh] First result:', results[0]);
          resolve({ success: true, data: { results, suggestions: [] }, instance: 'DuckDuckGo' });
        } catch(e) {
          console.log('[Woosh] Parse error:', e.message);
          resolve({ success: false, error: 'Parse error: ' + e.message });
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, error: 'Network error: ' + e.message });
    });

    req.write(postData);
    req.end();
  });
});

function parseDDG(html) {
  const results = [];

  // Strategy 1: original class names
  const titleRe1 = /<a\s+class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  // Strategy 2: any <a> with href that looks like an external result
  // DDG wraps results in href="/l/?uddg=..." or direct URLs
  const titleRe2 = /<a[^>]+class="[^"]*result[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  // Strategy 3: grab ALL links that go outside duckduckgo.com
  const allLinksRe = /<a[^>]+href="(https?:\/\/(?!([^"]*duckduckgo))[^"]+)"[^>]*>([^<]{5,})<\/a>/g;

  // Strategy 4: DDG redirect links /l/?uddg=...
  const redirectRe = /<a[^>]+href="\/l\/\?[^"]*uddg=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const snippetRe = /<a[^>]+class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  // Try strategy 1 first
  let m;
  const titles = [];

  while ((m = titleRe1.exec(html)) !== null) {
    titles.push({ href: m[1], title: clean(m[2]) });
  }

  // If strategy 1 found nothing, try strategy 4 (redirect links)
  if (titles.length === 0) {
    console.log('[Woosh] Strategy 1 failed, trying redirect links...');
    while ((m = redirectRe.exec(html)) !== null) {
      const url = decodeURIComponent(m[1]);
      const title = clean(m[2]);
      if (title.length > 3 && url.startsWith('http')) {
        titles.push({ href: url, title });
      }
    }
  }

  // If still nothing, try strategy 3 (all external links)
  if (titles.length === 0) {
    console.log('[Woosh] Strategy 4 failed, trying all external links...');
    while ((m = allLinksRe.exec(html)) !== null) {
      const url = m[1];
      const title = clean(m[3]);
      if (title.length > 3) {
        titles.push({ href: url, title });
      }
    }
  }

  console.log('[Woosh] Found', titles.length, 'title links');

  // Get snippets
  const snippets = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(clean(m[1]));
  }

  for (let i = 0; i < titles.length && results.length < 10; i++) {
    let url = titles[i].href;

    // Unwrap DDG redirect URLs
    if (url.includes('/l/?') || url.includes('duckduckgo.com/l/')) {
      try {
        const qs = url.includes('?') ? url.split('?')[1] : '';
        const p = new URLSearchParams(qs);
        const uddg = p.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch(e) {}
    }

    if (!url.startsWith('http')) url = 'https://' + url;
    if (url.includes('duckduckgo.com')) continue;

    results.push({
      title: titles[i].title || 'Result',
      url,
      content: snippets[i] || ''
    });
  }

  return results;
}

function clean(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// ─── URL helpers ──────────────────────────────────────────────
function resolveURL(url) {
  if (!url || url === 'woosh://home') return null;
  if (url.startsWith('woosh://')) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.includes('.') && !url.includes(' ')) return 'https://' + url;
  return `woosh://search?q=${encodeURIComponent(url)}`;
}

function loadURLInView(view, url) {
  if (url === 'woosh://home') {
    view.webContents.loadFile('newtab.html');
  } else if (url === 'woosh://privacy') {
    view.webContents.loadFile('privacy.html');
  } else if (url && url.startsWith('woosh://search?')) {
    const raw = url.slice('woosh://search?q='.length);
    view.webContents.loadFile('search.html', { query: { q: decodeURIComponent(raw) } });
  } else if (url) {
    view.webContents.loadURL(url);
  }
}

function prettyURL(url) {
  if (!url) return 'woosh://home';
  if (url.includes('newtab.html')) return 'woosh://home';
  if (url.includes('privacy.html')) return 'woosh://privacy';
  if (url.includes('search.html')) {
    try {
      const u = new URL(url);
      const q = u.searchParams.get('q');
      return q ? `woosh://search?q=${encodeURIComponent(q)}` : 'woosh://search';
    } catch(e) { return 'woosh://search'; }
  }
  return url;
}

// ─── Tab management ───────────────────────────────────────────
function createTab(url = 'woosh://home') {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false, contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'), sandbox: false
    }
  });
  const tab = { id, view, url, title: 'New Tab' };
  tabs.push(tab);
  blockStats[id] = { ads: 0, trackers: 0 };

  // ── Ad & tracker blocking ──
  view.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (isDomainBlocked(details.url)) {
      const isTracker = isTrackerDomain(details.url);
      blockStats[id].ads++;
      if (isTracker) blockStats[id].trackers++;
      lifetimeStats.totalBlocked++;
      lifetimeStats.totalAds++;
      if (isTracker) lifetimeStats.totalTrackers++;
      saveStats(lifetimeStats);
      // Send live update to toolbar shield
      if (id === activeTabId) {
        mainWindow.webContents.send('blocked-update', blockStats[id]);
      }
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });

  view.webContents.on('did-navigate', (e, navUrl) => {
    tab.url = navUrl;
    // Reset per-page block counter on navigation
    blockStats[id] = { ads: 0, trackers: 0 };
    if (id === activeTabId) {
      mainWindow.webContents.send('url-changed', prettyURL(navUrl));
      mainWindow.webContents.send('page-loading', false);
      mainWindow.webContents.send('blocked-update', blockStats[id]);
    }
    mainWindow.webContents.send('tab-updated', { id, url: navUrl, title: tab.title });
  });
  view.webContents.on('did-navigate-in-page', (e, navUrl) => { tab.url = navUrl; if (id === activeTabId) mainWindow.webContents.send('url-changed', prettyURL(navUrl)); });
  view.webContents.on('did-start-loading', () => { if (id === activeTabId) mainWindow.webContents.send('page-loading', true); });
  view.webContents.on('did-stop-loading', () => { if (id === activeTabId) mainWindow.webContents.send('page-loading', false); });
  view.webContents.on('page-title-updated', (e, title) => {
    tab.title = title;
    mainWindow.webContents.send('tab-updated', { id, url: tab.url, title });
    if (id === activeTabId) mainWindow.webContents.send('title-changed', title);
  });
  view.webContents.on('did-fail-load', () => { if (id === activeTabId) mainWindow.webContents.send('page-loading', false); });

  loadURLInView(view, url);
  switchToTab(id);
  mainWindow.webContents.send('tab-created', { id, url, title: tab.title });
  return id;
}

function switchToTab(id) {
  tabs.forEach(t => { try { mainWindow.removeBrowserView(t.view); } catch(e) {} });
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  mainWindow.addBrowserView(tab.view);
  updateActiveViewBounds();
  mainWindow.webContents.send('url-changed', prettyURL(tab.url));
  mainWindow.webContents.send('title-changed', tab.title);
  mainWindow.webContents.send('tab-switched', id);
  mainWindow.webContents.send('blocked-update', blockStats[id] || { ads: 0, trackers: 0 });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  try { mainWindow.removeBrowserView(tab.view); } catch(e) {}
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { app.quit(); return; }
  if (activeTabId === id) switchToTab(tabs[Math.min(idx, tabs.length - 1)].id);
  mainWindow.webContents.send('tab-closed', id);
}

function updateActiveViewBounds() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const bounds = mainWindow.getBounds();
  tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: bounds.width, height: bounds.height - TOOLBAR_HEIGHT });
}

// ─── IPC ──────────────────────────────────────────────────────
ipcMain.on('navigate', (e, url) => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  if (!url || url === 'woosh://home') {
    loadURLInView(tab.view, 'woosh://home'); tab.url = 'woosh://home';
    mainWindow.webContents.send('url-changed', 'woosh://home'); return;
  }
  const resolved = resolveURL(url);
  if (resolved?.startsWith('woosh://search?')) {
    loadURLInView(tab.view, resolved); tab.url = resolved; mainWindow.webContents.send('url-changed', resolved);
  } else if (resolved) {
    tab.view.webContents.loadURL(resolved); tab.url = resolved;
    mainWindow.webContents.send('url-changed', resolved); mainWindow.webContents.send('page-loading', true);
  } else {
    loadURLInView(tab.view, url); tab.url = url; mainWindow.webContents.send('url-changed', url);
  }
});

ipcMain.on('go-back', () => { const t = tabs.find(t => t.id === activeTabId); if (t?.view.webContents.canGoBack()) t.view.webContents.goBack(); });
ipcMain.on('go-forward', () => { const t = tabs.find(t => t.id === activeTabId); if (t?.view.webContents.canGoForward()) t.view.webContents.goForward(); });
ipcMain.on('reload', () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.view.webContents.reload(); });
ipcMain.on('new-tab', () => createTab('woosh://home'));
ipcMain.on('switch-tab', (e, id) => switchToTab(id));
ipcMain.on('close-tab', (e, id) => closeTab(id));
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); updateActiveViewBounds(); });
ipcMain.on('close-window', () => mainWindow.close());
ipcMain.handle('get-current-url', () => { const t = tabs.find(t => t.id === activeTabId); return t ? prettyURL(t.url) : ''; });
ipcMain.handle('get-tabs', () => tabs.map(t => ({ id: t.id, url: t.url, title: t.title })));
ipcMain.handle('get-active-tab', () => activeTabId);

app.whenReady().then(() => {
  // Now safe to use app.getPath — load persisted stats
  lifetimeStats = loadStats();

  // Register Woosh as a handler for http and https
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Handle URLs opened via Woosh being set as default browser
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.focus();
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) { tab.view.webContents.loadURL(url); }
  }
});

// Windows: handle second-instance launch with URL argument
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const url = argv.find(a => a.startsWith('http://') || a.startsWith('https://'));
    if (url && mainWindow) {
      mainWindow.focus();
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) tab.view.webContents.loadURL(url);
    }
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}