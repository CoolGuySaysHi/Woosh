const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  const logFile = path.join(require('os').tmpdir(), 'woosh-crash.log');
  fs.writeFileSync(logFile, err.stack || String(err));
  console.error('CRASH:', err);
});
const crypto = require('crypto');

// ─── Password Manager ─────────────────────────────────────────
// Passwords encrypted with AES-256-GCM using a device key
// The device key is generated once and stored separately from passwords

let PASSWORDS_FILE = null;
let DEVICE_KEY_FILE = null;

function getPasswordsFile() {
  if (!PASSWORDS_FILE) PASSWORDS_FILE = path.join(app.getPath('userData'), 'passwords.enc');
  return PASSWORDS_FILE;
}

function getDeviceKeyFile() {
  if (!DEVICE_KEY_FILE) DEVICE_KEY_FILE = path.join(app.getPath('userData'), 'device.key');
  return DEVICE_KEY_FILE;
}

function getDeviceKey() {
  const keyFile = getDeviceKeyFile();
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile);
  }
  // Generate a new random 32-byte key for this device
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key);
  return key;
}

function encryptPasswords(passwords) {
  const key = getDeviceKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = JSON.stringify(passwords);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + encrypted data
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptPasswords(encoded) {
  try {
    const key = getDeviceKey();
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.slice(0, 16);
    const authTag = buf.slice(16, 32);
    const encrypted = buf.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch(e) { return []; }
}

function loadPasswords() {
  try {
    const f = getPasswordsFile();
    if (fs.existsSync(f)) {
      return decryptPasswords(fs.readFileSync(f, 'utf8'));
    }
  } catch(e) {}
  return [];
}

function savePasswords(passwords) {
  try {
    fs.writeFileSync(getPasswordsFile(), encryptPasswords(passwords));
  } catch(e) {}
}

ipcMain.handle('get-passwords', () => loadPasswords());

// ── Password popup window ──────────────────────────────────────
let passwordWindow = null;

ipcMain.on('open-password-popup', () => {
  if (passwordWindow && !passwordWindow.isDestroyed()) {
    passwordWindow.focus();
    return;
  }
  const mainBounds = mainWindow.getBounds();
  passwordWindow = new BrowserWindow({
    width: 320,
    height: 480,
    x: mainBounds.x + mainBounds.width - 340,
    y: mainBounds.y + TOOLBAR_HEIGHT + 8,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });
  passwordWindow.loadFile(path.join(__dirname, 'passwords-popup.html'));
  passwordWindow.on('blur', () => {
    if (passwordWindow && !passwordWindow.isDestroyed()) passwordWindow.close();
  });
  passwordWindow.on('closed', () => { passwordWindow = null; });
});

ipcMain.on('close-password-popup', () => {
  if (passwordWindow && !passwordWindow.isDestroyed()) passwordWindow.close();
});

// ── Shield popup window ───────────────────────────────────────
let shieldWindow = null;

ipcMain.on('open-shield-popup', () => {
  if (shieldWindow && !shieldWindow.isDestroyed()) {
    shieldWindow.focus();
    return;
  }
  const mainBounds = mainWindow.getBounds();
  const tab = tabs.find(t => t.id === activeTabId);
  let currentDomain = '';
  try { currentDomain = new URL(tab ? tab.url : '').hostname.replace('www.', ''); } catch(e) {}

  shieldWindow = new BrowserWindow({
    width: 290,
    height: 300,
    x: mainBounds.x + mainBounds.width - 380,
    y: mainBounds.y + TOOLBAR_HEIGHT + 8,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });
  // Pass everything via query string — no IPC needed on load
  shieldWindow.loadFile(path.join(__dirname, 'shield-popup.html'), {
    query: {
      domain: currentDomain,
      enabled: String(adBlockEnabled),
      whitelist: [...adBlockWhitelist].join(',')
    }
  });
  shieldWindow.on('blur', () => {
    if (shieldWindow && !shieldWindow.isDestroyed()) shieldWindow.close();
  });
  shieldWindow.on('closed', () => { shieldWindow = null; });
});

ipcMain.on('close-shield-popup', () => {
  if (shieldWindow && !shieldWindow.isDestroyed()) shieldWindow.close();
});

// ── Account / Sync popup ──────────────────────────────────────
let accountWindow = null;
ipcMain.on('open-account-popup', () => {
  if (accountWindow && !accountWindow.isDestroyed()) { accountWindow.focus(); return; }
  const mainBounds = mainWindow.getBounds();
  accountWindow = new BrowserWindow({
    width: 320, height: 520,
    x: mainBounds.x + mainBounds.width - 340,
    y: mainBounds.y + TOOLBAR_HEIGHT + 8,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    parent: mainWindow,
    webPreferences: { nodeIntegration: true, contextIsolation: false, preload: path.join(__dirname, 'preload.js'), sandbox: false }
  });
  accountWindow.loadFile(path.join(__dirname, 'account-popup.html'));
  accountWindow.on('blur', () => { if (accountWindow && !accountWindow.isDestroyed()) accountWindow.close(); });
  accountWindow.on('closed', () => { accountWindow = null; });
});
ipcMain.on('close-account-popup', () => {
  if (accountWindow && !accountWindow.isDestroyed()) accountWindow.close();
});

// Firebase config — stored in userData/firebase-config.json
ipcMain.handle('get-firebase-config', () => {
  try {
    const f = path.join(app.getPath('userData'), 'firebase-config.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch(e) {}
  return null;
});
ipcMain.handle('save-firebase-config', (e, config) => {
  try {
    const f = path.join(app.getPath('userData'), 'firebase-config.json');
    fs.writeFileSync(f, JSON.stringify(config, null, 2));
    return true;
  } catch(e) { return false; }
});

// Google sign-in via Electron — opens system browser for OAuth
ipcMain.on('firebase-google-sign-in', () => {
  const { shell } = require('electron');
  // Open a small auth window instead
  const authWin = new BrowserWindow({
    width: 500, height: 650, parent: accountWindow,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  // We use a simple approach: signInWithPopup doesn't work in Electron
  // so we direct the user to sign in via email or tell them to use email/password
  authWin.close();
  if (accountWindow && !accountWindow.isDestroyed()) {
    accountWindow.webContents.send('google-sign-in-result', {
      error: 'Google sign-in requires a browser. Please use email/password instead.'
    });
  }
});

// Gather all local data for sync
ipcMain.handle('get-all-sync-data', async () => {
  const data = {};
  // History
  try {
    const hf = path.join(app.getPath('userData'), 'history.json');
    data.history = fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, 'utf-8')) : [];
  } catch(e) { data.history = []; }
  // Bookmarks
  try {
    const bf = path.join(app.getPath('userData'), 'bookmarks.json');
    data.bookmarks = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf-8')) : [];
  } catch(e) { data.bookmarks = []; }
  // Passwords (already encrypted, safe to sync as-is)
  try {
    const pf = path.join(app.getPath('userData'), 'passwords.enc');
    data.passwords = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf-8') : '';
  } catch(e) { data.passwords = ''; }
  // Settings
  try {
    const sf = path.join(app.getPath('userData'), 'adblock-settings.json');
    data.settings = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf-8')) : {};
  } catch(e) { data.settings = {}; }
  return data;
});

// ── Downloads ─────────────────────────────────────────────────
const activeDownloads = new Map();

ipcMain.on('show-download-in-folder', (e, savePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(savePath);
});

const DOWNLOAD_BAR_HEIGHT = 64;
let downloadBarVisible = false;
ipcMain.on('set-download-bar-visible', (e, visible) => {
  downloadBarVisible = visible;
  updateActiveViewBounds();
});


ipcMain.handle('save-password', (e, { domain, username, password }) => {
  const passwords = loadPasswords();
  const existing = passwords.findIndex(p => p.domain === domain && p.username === username);
  if (existing >= 0) {
    passwords[existing] = { domain, username, password, updated: Date.now() };
  } else {
    passwords.push({ domain, username, password, added: Date.now() });
  }
  savePasswords(passwords);
  return passwords;
});

ipcMain.handle('delete-password', (e, { domain, username }) => {
  const passwords = loadPasswords().filter(p => !(p.domain === domain && p.username === username));
  savePasswords(passwords);
  return passwords;
});

ipcMain.handle('get-passwords-for-domain', (e, domain) => {
  return loadPasswords().filter(p => p.domain === domain || domain.includes(p.domain) || p.domain.includes(domain));
});

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

ipcMain.on('autofill-password', (e, { username, password }) => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.view.webContents.executeJavaScript(`
    (function() {
      const inputs = document.querySelectorAll('input[type="password"]');
      if (!inputs.length) return;
      const pwField = inputs[0];
      // Find the nearest username field above the password field
      const usernameSelectors = ['input[type="email"]', 'input[type="text"]', 'input[name*="user"]', 'input[name*="email"]', 'input[id*="user"]', 'input[id*="email"]'];
      let userField = null;
      for (const sel of usernameSelectors) {
        userField = document.querySelector(sel);
        if (userField) break;
      }
      if (userField) {
        userField.focus();
        userField.value = ${JSON.stringify(username)};
        userField.dispatchEvent(new Event('input', { bubbles: true }));
        userField.dispatchEvent(new Event('change', { bubbles: true }));
      }
      pwField.focus();
      pwField.value = ${JSON.stringify(password)};
      pwField.dispatchEvent(new Event('input', { bubbles: true }));
      pwField.dispatchEvent(new Event('change', { bubbles: true }));
    })();
  `);
});

// ── Ad blocker state + whitelist ──────────────────────────────
let adBlockEnabled = true;
let adBlockWhitelist = new Set(); // domains to never block on

function loadAdBlockSettings() {
  try {
    const f = path.join(app.getPath('userData'), 'adblock-settings.json');
    console.log('[AdBlock] Loading from:', f);
    if (fs.existsSync(f)) {
      const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
      adBlockEnabled = s.enabled !== false;
      adBlockWhitelist = new Set(s.whitelist || []);
      console.log('[AdBlock] Loaded:', { enabled: adBlockEnabled, whitelist: [...adBlockWhitelist] });
    } else {
      console.log('[AdBlock] No settings file found, using defaults');
    }
  } catch(e) { console.error('[AdBlock] Load error:', e); }
}

function saveAdBlockSettings() {
  try {
    const f = path.join(app.getPath('userData'), 'adblock-settings.json');
    const data = JSON.stringify({ enabled: adBlockEnabled, whitelist: [...adBlockWhitelist] });
    fs.writeFileSync(f, data);
    console.log('[AdBlock] Saved:', data, 'to:', f);
  } catch(e) { console.error('[AdBlock] Save error:', e); }
}

ipcMain.on('permission-response', (e, { domain, permission, granted }) => {
  ipcMain.emit(`permission-response-${domain}-${permission}`, null, granted);
});

ipcMain.on('close-permission-popup', () => {
  if (permissionWindow && !permissionWindow.isDestroyed()) permissionWindow.close();
});

// ── Profile popup window ──────────────────────────────────────
let profileWindow = null;
ipcMain.on('open-profile-popup', () => {
  if (profileWindow && !profileWindow.isDestroyed()) { profileWindow.focus(); return; }
  const mainBounds = mainWindow.getBounds();
  profileWindow = new BrowserWindow({
    width: 300, height: 440,
    x: mainBounds.x + mainBounds.width - 320,
    y: mainBounds.y + TOOLBAR_HEIGHT + 8,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, parent: mainWindow,
    webPreferences: { nodeIntegration: true, contextIsolation: false, preload: path.join(__dirname, 'preload.js'), sandbox: false }
  });
  profileWindow.loadFile(path.join(__dirname, 'profile-popup.html'));
  profileWindow.on('blur', () => { if (profileWindow && !profileWindow.isDestroyed()) profileWindow.close(); });
  profileWindow.on('closed', () => { profileWindow = null; });
});
ipcMain.on('close-profile-popup', () => {
  if (profileWindow && !profileWindow.isDestroyed()) profileWindow.close();
});

// ── Downloads ──────────────────────────────────────────────────
ipcMain.on('show-in-folder', (e, filePath) => {
  require('electron').shell.showItemInFolder(filePath);
});

// ── History ───────────────────────────────────────────────────
let historyFile = null;
function getHistoryFile() {
  if (!historyFile) historyFile = path.join(app.getPath('userData'), 'history.json');
  return historyFile;
}
function loadHistory() {
  try {
    if (fs.existsSync(getHistoryFile())) return JSON.parse(fs.readFileSync(getHistoryFile(), 'utf-8'));
  } catch(e) {}
  return [];
}
function saveHistoryEntry(entry) {
  try {
    const history = loadHistory();
    history.unshift(entry);
    // Keep last 5000 entries
    fs.writeFileSync(getHistoryFile(), JSON.stringify(history.slice(0, 5000)));
  } catch(e) {}
}
ipcMain.handle('get-history', () => loadHistory());
ipcMain.handle('clear-history', () => { try { fs.writeFileSync(getHistoryFile(), '[]'); } catch(e) {} return []; });
ipcMain.on('add-history', (e, entry) => saveHistoryEntry(entry));

// ── Firebase Sync ─────────────────────────────────────────────
// Using Firebase REST API — no npm package needed
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBV0Fk7sb3vKSdIJ4P8u9so0Dc0S7dqio4",
  authDomain: "woosh-98336.firebaseapp.com",
  projectId: "woosh-98336",
  storageBucket: "woosh-98336.firebasestorage.app",
  messagingSenderId: "893068757888",
  appId: "1:893068757888:web:0b983ce80b1a2149a24f65"
};

let syncUser = null;  // { uid, email, displayName, photoURL, idToken, refreshToken }
let syncFile = null;
function getSyncFile() {
  if (!syncFile) syncFile = path.join(app.getPath('userData'), 'sync-user.json');
  return syncFile;
}
function loadSyncUser() {
  try {
    if (fs.existsSync(getSyncFile())) return JSON.parse(fs.readFileSync(getSyncFile(), 'utf-8'));
  } catch(e) {}
  return null;
}
function saveSyncUser(user) {
  try { fs.writeFileSync(getSyncFile(), JSON.stringify(user)); } catch(e) {}
}

// Firebase REST helpers
function firebasePost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(endpoint);
    const options = { hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }};
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); }});
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function firestoreSet(collection, docId, data, idToken) {
  return new Promise((resolve, reject) => {
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') fields[k] = { stringValue: v };
      else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
      else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      else fields[k] = { stringValue: JSON.stringify(v) };
    }
    const body = JSON.stringify({ fields });
    const path2 = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${docId}`;
    const options = {
      hostname: 'firestore.googleapis.com', path: path2, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`,
        'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function firestoreGet(collection, docId, idToken) {
  return new Promise((resolve, reject) => {
    const p = `/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${docId}`;
    const options = {
      hostname: 'firestore.googleapis.com', path: p, method: 'GET',
      headers: { 'Authorization': `Bearer ${idToken}` }
    };
    const req = https.request(options, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const doc = JSON.parse(d);
          if (!doc.fields) { resolve(null); return; }
          const result = {};
          for (const [k, v] of Object.entries(doc.fields)) {
            if (v.stringValue !== undefined) {
              try { result[k] = JSON.parse(v.stringValue); } catch(e) { result[k] = v.stringValue; }
            } else if (v.integerValue !== undefined) result[k] = Number(v.integerValue);
            else if (v.booleanValue !== undefined) result[k] = v.booleanValue;
          }
          resolve(result);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function refreshIdToken(user) {
  try {
    const res = await firebasePost(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
      { grant_type: 'refresh_token', refresh_token: user.refreshToken }
    );
    if (res.id_token) {
      user.idToken = res.id_token;
      user.refreshToken = res.refresh_token;
      saveSyncUser(user);
    }
    return user;
  } catch(e) { return user; }
}

async function doSync(user) {
  user = await refreshIdToken(user);
  const history   = loadHistory().slice(0, 500); // cap at 500 for sync
  const bookmarks = (() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'bookmarks.json'), 'utf-8')); } catch(e) { return []; } })();
  const passwords = (() => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'passwords.enc'), 'base64'); } catch(e) { return ''; } })();
  const settings  = { enabled: adBlockEnabled, whitelist: [...adBlockWhitelist] };
  const lastSync  = Date.now();

  await firestoreSet('woosh-sync', user.uid, {
    history: JSON.stringify(history),
    bookmarks: JSON.stringify(bookmarks),
    passwords,
    settings: JSON.stringify(settings),
    lastSync
  }, user.idToken);

  saveSyncUser({ ...user, lastSync });
  return { history: history.length, bookmarks: bookmarks.length, passwords: passwords ? 1 : 0, lastSync };
}

async function doRestore(user) {
  user = await refreshIdToken(user);
  const data = await firestoreGet('woosh-sync', user.uid, user.idToken);
  if (!data) return;
  try {
    if (data.history) fs.writeFileSync(getHistoryFile(), JSON.stringify(data.history));
    if (data.bookmarks) fs.writeFileSync(path.join(app.getPath('userData'), 'bookmarks.json'), JSON.stringify(data.bookmarks));
    if (data.passwords) fs.writeFileSync(path.join(app.getPath('userData'), 'passwords.enc'), Buffer.from(data.passwords, 'base64'));
    if (data.settings) {
      adBlockEnabled = data.settings.enabled !== false;
      adBlockWhitelist = new Set(data.settings.whitelist || []);
      saveAdBlockSettings();
    }
  } catch(e) { console.error('[Sync] Restore error:', e); }
}

ipcMain.handle('get-sync-state', async () => {
  syncUser = loadSyncUser();
  const stats = syncUser ? {
    lastSync: syncUser.lastSync,
    history: loadHistory().length,
    bookmarks: (() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'bookmarks.json'), 'utf-8')).length; } catch(e) { return 0; } })(),
    passwords: (() => { try { return fs.existsSync(path.join(app.getPath('userData'), 'passwords.enc')) ? '?' : 0; } catch(e) { return 0; } })(),
  } : null;
  return { config: FIREBASE_CONFIG, user: syncUser, stats };
});

ipcMain.handle('sync-signin-email', async (e, { email, password }) => {
  try {
    const res = await firebasePost(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`,
      { email, password, returnSecureToken: true }
    );
    if (res.error) return { error: res.error.message.replace(/_/g,' ').toLowerCase() };
    syncUser = { uid: res.localId, email: res.email, displayName: res.displayName || email.split('@')[0],
      photoURL: null, idToken: res.idToken, refreshToken: res.refreshToken };
    saveSyncUser(syncUser);
    await doRestore(syncUser);
    const stats = await doSync(syncUser);
    mainWindow.webContents.send('sync-state-changed', { signedIn: true, user: syncUser });
    return { user: syncUser, stats };
  } catch(e) { return { error: 'Network error' }; }
});

ipcMain.handle('sync-signup-email', async (e, { email, password }) => {
  try {
    const res = await firebasePost(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`,
      { email, password, returnSecureToken: true }
    );
    if (res.error) return { error: res.error.message.replace(/_/g,' ').toLowerCase() };
    syncUser = { uid: res.localId, email: res.email, displayName: email.split('@')[0],
      photoURL: null, idToken: res.idToken, refreshToken: res.refreshToken };
    saveSyncUser(syncUser);
    const stats = await doSync(syncUser);
    mainWindow.webContents.send('sync-state-changed', { signedIn: true, user: syncUser });
    return { user: syncUser, stats };
  } catch(e) { return { error: 'Network error' }; }
});

ipcMain.handle('sync-signin-google', async () => {
  // Open Google OAuth in a popup window
  return new Promise((resolve) => {
    const { session: s } = require('electron');
    const oauthWin = new BrowserWindow({
      width: 500, height: 650, parent: mainWindow, modal: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    const clientId = FIREBASE_CONFIG.googleClientId || '';
    const redirectUri = 'https://localhost';
    const scope = 'openid email profile';
    const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
    oauthWin.loadURL(authUrl);
    oauthWin.webContents.on('will-redirect', async (e, url) => {
      if (url.startsWith('https://localhost')) {
        oauthWin.close();
        resolve({ error: 'Google sign-in requires additional setup. Please use email/password instead.' });
      }
    });
    oauthWin.on('closed', () => resolve({ error: 'Cancelled' }));
  });
});

ipcMain.handle('sync-signout', async () => {
  syncUser = null;
  try { fs.unlinkSync(getSyncFile()); } catch(e) {}
  mainWindow.webContents.send('sync-state-changed', { signedIn: false });
});

ipcMain.handle('sync-now', async () => {
  if (!syncUser) return null;
  try { return await doSync(syncUser); } catch(e) { return null; }
});
let permissionWindow = null;
ipcMain.on('open-permission-popup', (e, { domain, permission, label }) => {
  if (permissionWindow && !permissionWindow.isDestroyed()) permissionWindow.close();
  const mainBounds = mainWindow.getBounds();
  permissionWindow = new BrowserWindow({
    width: 380,
    height: 130,
    x: Math.round(mainBounds.x + mainBounds.width / 2 - 190),
    y: mainBounds.y + TOOLBAR_HEIGHT + 8,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });
  permissionWindow.loadFile(path.join(__dirname, 'permission-popup.html'), {
    query: { domain, permission, label }
  });
  permissionWindow.on('closed', () => { permissionWindow = null; });
});

ipcMain.handle('get-current-domain', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return '';
  try { return new URL(tab.url).hostname.replace('www.', ''); } catch(e) { return ''; }
});

// ── PWA support ───────────────────────────────────────────────
ipcMain.handle('check-pwa', async () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return null;
  try {
    const result = await tab.view.webContents.executeJavaScript(`
      (function() {
        const manifest = document.querySelector('link[rel="manifest"]');
        if (!manifest) return null;
        return manifest.href;
      })();
    `);
    if (!result) return null;
    // Fetch the manifest to get app name and icons
    return new Promise((resolve) => {
      const url = new URL(result);
      const mod = url.protocol === 'https:' ? require('https') : require('http');
      let data = '';
      const req = mod.get(result, { timeout: 3000 }, (res) => {
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const manifest = JSON.parse(data);
            if (manifest.name || manifest.short_name) {
              resolve({
                name: manifest.short_name || manifest.name,
                url: tab.url,
                icon: manifest.icons ? manifest.icons[manifest.icons.length - 1]?.src : null
              });
            } else { resolve(null); }
          } catch(e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch(e) { return null; }
});

ipcMain.on('install-pwa', async (e, { name, url, icon }) => {
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: `Install ${name}?`,
    message: `Install "${name}" as an app?`,
    detail: `A shortcut will be added to your desktop that opens ${name} in Woosh.`,
    buttons: ['Install', 'Cancel'],
    defaultId: 0
  });
  if (result.response !== 0) return;

  try {
    const appName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'App';
    const desktopPath = app.getPath('desktop');

    if (process.platform === 'win32') {
      // Windows: create a .url internet shortcut file
      const shortcutPath = path.join(desktopPath, `${appName}.url`);
      const wooshExe = process.execPath;
      // .url files open in default browser, but we want Woosh specifically
      // So create a .bat launcher that opens Woosh with the URL
      const batPath = path.join(app.getPath('userData'), `${appName}-pwa.bat`);
      fs.writeFileSync(batPath, `@echo off\n"${wooshExe}" "${url}"\n`);
      // Create a .url file pointing to the bat
      const urlContent = `[InternetShortcut]\nURL=${url}\n`;
      fs.writeFileSync(shortcutPath, urlContent);
    } else if (process.platform === 'darwin') {
      // Mac: create a .webloc file
      const shortcutPath = path.join(desktopPath, `${appName}.webloc`);
      const weblocContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>${url}</string></dict></plist>`;
      fs.writeFileSync(shortcutPath, weblocContent);
    } else {
      // Linux: create a .desktop file
      const shortcutPath = path.join(desktopPath, `${appName}.desktop`);
      fs.writeFileSync(shortcutPath, `[Desktop Entry]\nType=Application\nName=${appName}\nExec=xdg-open ${url}\nIcon=web-browser\nTerminal=false\n`);
    }

    mainWindow.webContents.send('pwa-installed', name);
  } catch(err) {
    console.error('[PWA] Failed to create shortcut:', err);
  }
});

ipcMain.handle('toggle-adblocker', () => {
  console.log('[IPC] toggle-adblocker called, was:', adBlockEnabled);
  adBlockEnabled = !adBlockEnabled;
  saveAdBlockSettings();
  return { enabled: adBlockEnabled, whitelist: [...adBlockWhitelist] };
});

ipcMain.handle('add-to-whitelist', (e, domain) => {
  console.log('[IPC] add-to-whitelist called, domain:', domain);
  adBlockWhitelist.add(domain.replace('www.', ''));
  saveAdBlockSettings();
  return { enabled: adBlockEnabled, whitelist: [...adBlockWhitelist] };
});

ipcMain.handle('remove-from-whitelist', (e, domain) => {
  console.log('[IPC] remove-from-whitelist called, domain:', domain);
  adBlockWhitelist.delete(domain.replace('www.', ''));
  saveAdBlockSettings();
  return { enabled: adBlockEnabled, whitelist: [...adBlockWhitelist] };
});

ipcMain.handle('get-privacy-stats', () => ({
  lifetime: lifetimeStats,
  perTab: blockStats
}));

ipcMain.handle('reset-privacy-stats', () => {
  lifetimeStats = { totalAds: 0, totalTrackers: 0, totalBlocked: 0, since: Date.now() };
  saveStats(lifetimeStats);
  return lifetimeStats;
});

// ─── Bookmarks ─────────────────────────────────────────────────

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

  // Fullscreen — hide toolbar, expand view to fill screen
  mainWindow.on('enter-full-screen', () => {
    isFullscreen = true;
    mainWindow.webContents.send('fullscreen-change', true);
    updateActiveViewBounds();
  });
  mainWindow.on('leave-full-screen', () => {
    isFullscreen = false;
    mainWindow.webContents.send('fullscreen-change', false);
    updateActiveViewBounds();
  });
  // Also handle when a webpage requests fullscreen (e.g. YouTube video)
  mainWindow.webContents.on('enter-html-full-screen', () => {
    isFullscreen = true;
    mainWindow.webContents.send('fullscreen-change', true);
    updateActiveViewBounds();
  });
  mainWindow.webContents.on('leave-html-full-screen', () => {
    isFullscreen = false;
    mainWindow.webContents.send('fullscreen-change', false);
    updateActiveViewBounds();
  });
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
  } else if (url === 'woosh://history') {
    view.webContents.loadFile('history.html');
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
  if (url.includes('history.html')) return 'woosh://history';
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
      preload: path.join(__dirname, 'preload.js'), sandbox: false,
      partition: 'persist:woosh'
    }
  });
  const tab = { id, view, url, title: 'New Tab' };
  tabs.push(tab);
  blockStats[id] = { ads: 0, trackers: 0 };

  // ── Password form detection ──
  view.webContents.on('did-finish-load', () => {
    view.webContents.executeJavaScript(`
      (function() {
        if (window.__wooshPwWatcher) return;
        window.__wooshPwWatcher = true;
        function getUsername(root) {
          const sels = ['input[type="email"]','input[autocomplete="email"]','input[autocomplete="username"]','input[type="text"][name*="user" i]','input[type="text"][name*="email" i]','input[type="text"][id*="user" i]','input[type="text"][id*="email" i]','input[type="text"]'];
          for (const s of sels) {
            const f = root ? root.querySelector(s) : document.querySelector(s);
            if (f && f.value.trim()) return f.value.trim();
          }
          return '';
        }
        function tryCapture(context) {
          const pw = (context || document).querySelector('input[type="password"]');
          if (!pw || !pw.value) return;
          const user = getUsername(context);
          if (user) {
            window.__wooshSavePw = { username: user, password: pw.value, domain: location.hostname.replace(/^www\\./, '') };
          }
        }
        document.addEventListener('submit', e => tryCapture(e.target), true);
        document.addEventListener('click', e => {
          const btn = e.target.closest('button[type="submit"],[type="submit"]');
          if (btn) setTimeout(() => tryCapture(btn.closest('form') || document), 200);
        }, true);
      })();
    `).catch(() => {});
  });

  // Poll for captured credentials every 2 seconds
  let pwInterval = setInterval(async () => {
    if (!view || view.webContents.isDestroyed()) { clearInterval(pwInterval); return; }
    try {
      const d = await view.webContents.executeJavaScript('(function(){var x=window.__wooshSavePw;window.__wooshSavePw=null;return x||null;})()');
      if (d && d.username && d.password && id === activeTabId) {
        mainWindow.webContents.send('offer-save-password', d);
      }
    } catch(e) {}
  }, 2000);

  view.webContents.on('did-navigate', async (e, navUrl) => {
    tab.url = navUrl;
    blockStats[id] = { ads: 0, trackers: 0 };
    if (id === activeTabId) {
      mainWindow.webContents.send('url-changed', prettyURL(navUrl));
      mainWindow.webContents.send('page-loading', false);
      mainWindow.webContents.send('blocked-update', blockStats[id]);
    }
    // Track history (skip internal pages)
    if (!navUrl.startsWith('woosh://') && !navUrl.startsWith('file://')) {
      saveHistoryEntry({ url: navUrl, title: tab.title || navUrl, visited: Date.now() });
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

let isFullscreen = false;

function updateActiveViewBounds() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const bounds = mainWindow.getBounds();
  const bottomOffset = downloadBarVisible ? DOWNLOAD_BAR_HEIGHT : 0;
  if (isFullscreen) {
    tab.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height - bottomOffset });
  } else {
    tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: bounds.width, height: bounds.height - TOOLBAR_HEIGHT - bottomOffset });
  }
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
  // Now safe to use app.getPath — load persisted data
  lifetimeStats = loadStats();
  loadAdBlockSettings();
  loadHistory();

  const { session, shell } = require('electron');
  const woosh = session.fromPartition('persist:woosh');

  // ── Single global ad blocker ──────────────────────────────────
  woosh.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (!adBlockEnabled) { callback({ cancel: false }); return; }
    // Check if the requesting page's domain is whitelisted
    try {
      const originDomain = new URL(details.referrer || details.url).hostname.replace('www.', '');
      if (adBlockWhitelist.has(originDomain)) { callback({ cancel: false }); return; }
    } catch(e) {}
    if (isDomainBlocked(details.url)) {
      // Find which tab this belongs to for stats
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && blockStats[activeTabId]) {
        const isTracker = isTrackerDomain(details.url);
        blockStats[activeTabId].ads++;
        if (isTracker) blockStats[activeTabId].trackers++;
        lifetimeStats.totalBlocked++;
        lifetimeStats.totalAds++;
        if (isTracker) lifetimeStats.totalTrackers++;
        saveStats(lifetimeStats);
        mainWindow.webContents.send('blocked-update', blockStats[activeTabId]);
      }
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });

  // Register Woosh as a handler for http and https
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  createWindow();

  // ── Download manager ──────────────────────────────────────────
  woosh.setPermissionCheckHandler((webContents, permission) => {
    return ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard', 'fullscreen', 'pointerLock'].includes(permission);
  });

  woosh.on('will-download', (event, item, webContents) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);

    const downloadId = Date.now().toString();
    mainWindow.webContents.send('download-started', {
      id: downloadId,
      filename: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      savePath
    });

    item.on('updated', (e, state) => {
      if (state === 'progressing') {
        mainWindow.webContents.send('download-progress', {
          id: downloadId,
          received: item.getReceivedBytes(),
          total: item.getTotalBytes()
        });
      }
    });

    item.once('done', (e, state) => {
      mainWindow.webContents.send('download-done', {
        id: downloadId,
        state, // 'completed' | 'cancelled' | 'interrupted'
        savePath
      });
    });
  });

  woosh.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'fullscreen') { callback(true); return; }
    let domain = '';
    try { domain = new URL(webContents.getURL()).hostname.replace('www.', ''); } catch(e) {}
    if (permCache[domain]?.[permission] !== undefined) {
      callback(permCache[domain][permission] === 'granted');
      return;
    }
    const labels = { media: 'microphone and/or camera', geolocation: 'your location', notifications: 'send notifications' };
    const label = labels[permission] || permission;
    mainWindow.webContents.send('open-permission-popup', { domain, permission, label });
    ipcMain.once(`permission-response-${domain}-${permission}`, (e, granted) => {
      if (!permCache[domain]) permCache[domain] = {};
      permCache[domain][permission] = granted ? 'granted' : 'denied';
      callback(granted);
    });
  });
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