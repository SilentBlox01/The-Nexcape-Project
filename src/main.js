/**
 * Nexcape Browser — main application controller.
 * Features: multi-tab, find-in-page, zoom, bookmarks, history, settings.
 */

console.log('[NXC] main.js module starting...');
console.log('[NXC] window.__TAURI__:', typeof window.__TAURI__);
console.log('[NXC] __TAURI__ keys:', window.__TAURI__ ? Object.keys(window.__TAURI__) : 'N/A');

let invoke, listen, Window, Webview, LogicalPosition, LogicalSize;
try {
  invoke = window.__TAURI__.core.invoke;
  listen = window.__TAURI__.event.listen;
  Window = window.__TAURI__.window.Window;
  Webview = window.__TAURI__.webview.Webview;
  LogicalPosition = window.__TAURI__.dpi.LogicalPosition;
  LogicalSize = window.__TAURI__.dpi.LogicalSize;
  console.log('[NXC] Tauri APIs loaded OK');
} catch(e) {
  console.error('[NXC] TAURI API ERROR:', e.message, e.stack);
  const d = document.getElementById('err-display');
  if (d) { d.style.display = 'block'; d.textContent = 'TAURI API ERROR:\n' + e.message + '\n\n' + e.stack; }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHROME_H  = 82;   // tabbar (38) + toolbar (44)
const OFFSCREEN = -32000;
const WEBVIEW_TIMEOUT_MS = 12000;
const ZOOM_STEP = 0.1;
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 5.0;

const NEW_TAB_URL  = 'nexcape://newtab';
const SETTINGS_URL = 'nexcape://settings';
const NEW_TAB_APP  = 'pages/new-tab.html';
const SETTINGS_APP = 'pages/settings.html';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  tabs: [],
  activeTabId: null,
  webviews: {},
  mainWindow: null,
  sidebarMode: 'bookmarks',
  sidebarOpen: false,
  searchEngine: 'https://www.startpage.com/search?q=',
  findBarOpen: false,
  findQuery: '',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const tabBar         = $('tab-bar');
const tabNewBtn      = $('tab-new-btn');
const btnBack        = $('btn-back');
const btnForward     = $('btn-forward');
const btnReload      = $('btn-reload');
const btnHome        = $('btn-home');
const btnFind        = $('btn-find');
const addressBar     = $('address-bar');
const suggestions    = $('suggestions');
const btnBookmark    = $('btn-bookmark');
const btnSidebar     = $('btn-sidebar');
const btnSettings    = $('btn-settings');
const sidebar        = $('sidebar');
const sidebarContent = $('sidebar-content');
const noTabs         = $('no-tabs-placeholder');
const securityIcon   = $('security-icon');
const progressBar    = $('progress-bar');
const findBar        = $('find-bar');
const findInput      = $('find-input');
const findCount      = $('find-count');
const zoomIndicator  = $('zoom-indicator');
const toast          = $('toast');

const ICON_RELOAD = '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M13 2.5A6.5 6.5 0 1 1 8 1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 1l2.5 2.5L8 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STOP   = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2.5" y="2.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.7"/></svg>';

// ── Utils ─────────────────────────────────────────────────────────────────────

const escHtml = v => {
  const d = document.createElement('div');
  d.textContent = v || '';
  return d.innerHTML;
};

const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

let zoomTimer;
function showZoomIndicator(zoom) {
  zoomIndicator.textContent = Math.round(zoom * 100) + '%';
  zoomIndicator.hidden = false;
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => { zoomIndicator.hidden = true; }, 2500);
}

let toastTimer;
function showToast(message, type) {
  toast.textContent = message;
  toast.className = 'toast toast-' + (type || 'info') + ' visible';
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 2500);
}

// ── URL utilities ─────────────────────────────────────────────────────────────

function getContentBounds() {
  const sw = state.sidebarOpen ? 280 : 0;
  return {
    x: 0,
    y: CHROME_H,
    width:  Math.max(window.innerWidth - sw, 300),
    height: Math.max(window.innerHeight - CHROME_H, 200),
  };
}

function internalRoute(input) {
  if (!input) return { displayUrl: NEW_TAB_URL, loadUrl: NEW_TAB_APP, title: 'New Tab' };
  const n = input.trim().toLowerCase();
  if (n === NEW_TAB_URL || n === NEW_TAB_APP || n === 'newtab')
    return { displayUrl: NEW_TAB_URL, loadUrl: NEW_TAB_APP, title: 'New Tab' };
  if (n === SETTINGS_URL || n === SETTINGS_APP || n === 'settings')
    return { displayUrl: SETTINGS_URL, loadUrl: SETTINGS_APP, title: 'Settings' };
  if (/^nexcape:\/\//i.test(input))
    return { displayUrl: NEW_TAB_URL, loadUrl: NEW_TAB_APP, title: 'New Tab' };
  return null;
}

function normalizeUrl(input) {
  const t = (input || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|127(?:\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(t)) return 'http://' + t;
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(t) && !/\s/.test(t)) return 'https://' + t;
  return state.searchEngine + encodeURIComponent(t);
}

function resolveTarget(input) {
  const direct = internalRoute(input);
  if (direct) return direct;
  const url = normalizeUrl(input);
  if (!url) return { displayUrl: NEW_TAB_URL, loadUrl: NEW_TAB_APP, title: 'New Tab' };
  return { displayUrl: url, loadUrl: url, title: titleFromUrl(url) };
}

function titleFromUrl(url) {
  if (!url || url === NEW_TAB_URL) return 'New Tab';
  if (url === SETTINGS_URL) return 'Settings';
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch (e) { return url; }
}

function isBookmarkableUrl(url) {
  return /^https?:\/\//i.test(url || '') && !/^https?:\/\/localhost[:/]/i.test(url);
}

function formatWebviewError(err) {
  if (!err) return 'Unknown webview error.';
  if (typeof err === 'string') return err;
  if (typeof err.payload === 'string') return err.payload;
  if (err.payload) return JSON.stringify(err.payload);
  return err.message || JSON.stringify(err);
}

function getGoogleFaviconUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (!h || h === 'localhost') return null;
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(h) + '&sz=32';
  } catch (e) { return null; }
}

// ── Tab info injection ────────────────────────────────────────────────────────

async function injectTabInfoScript(label, tabId) {
  const script = [
    '(function(){',
    '  if(window.__nxcInjected)return; window.__nxcInjected=true;',
    '  var id=' + JSON.stringify(tabId) + ';',
    '  var em=window.__TAURI__&&window.__TAURI__.event&&window.__TAURI__.event.emit;',
    '  if(!em)return;',
    '  function fav(){',
    '    var ss=["link[rel~=\'icon\']","link[rel=\'shortcut icon\']","link[rel=\'apple-touch-icon\']"];',
    '    for(var i=0;i<ss.length;i++){var e=document.querySelector(ss[i]);if(e&&e.href)return e.href;}',
    '    return null;',
    '  }',
    '  function send(){try{em("nexcape:tab-info",{tabId:id,title:document.title||"",favicon:fav()});}catch(ex){}}',
    '  send();',
    '  if(document.head)new MutationObserver(send).observe(document.head,{subtree:true,childList:true,characterData:true});',
    '  window.addEventListener("load",send,{once:true});',
    '  document.addEventListener("keydown",function(e){',
    '    var ctrl=e.ctrlKey||e.metaKey;',
    '    var isAltArrow=e.altKey&&(e.key==="ArrowLeft"||e.key==="ArrowRight");',
    '    var isF5=e.key==="F5";',
    '    if(!ctrl&&!isAltArrow&&!isF5)return;',
    '    try{em("nexcape:keydown",{key:e.key,ctrl:!!e.ctrlKey,shift:!!e.shiftKey,alt:!!e.altKey,meta:!!e.metaKey});}catch(ex){}',
    '  },true);',
    '})();',
  ].join('\n');
  try { await invoke('eval_in_webview', { label: label, script: script }); } catch (e) { /* ignore */ }
}


// ── Zoom ──────────────────────────────────────────────────────────────────────

function getActiveTabZoom() {
  const tab = getActiveTab();
  return tab ? (tab.zoom || 1.0) : 1.0;
}

async function applyZoom(zoom) {
  const tab = getActiveTab();
  if (!tab || !tab.label || tab.url === NEW_TAB_URL || tab.url === SETTINGS_URL) return;
  tab.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const script = 'document.documentElement.style.zoom="' + tab.zoom + '";';
  try { await invoke('eval_in_webview', { label: tab.label, script: script }); } catch (e) { /* ignore */ }
  showZoomIndicator(tab.zoom);
}

async function zoomIn()    { await applyZoom(getActiveTabZoom() + ZOOM_STEP); }
async function zoomOut()   { await applyZoom(getActiveTabZoom() - ZOOM_STEP); }
async function zoomReset() { await applyZoom(1.0); zoomIndicator.hidden = true; }

// ── Find in page ──────────────────────────────────────────────────────────────

// Build the find-in-page script as an array of strings to avoid escape issues
function buildFindScript(query, direction, isReset) {
  var lines = [
    '(function(){',
    '  var HC="__nxcH__";',
    '  function clearHL(){',
    '    var ms=document.querySelectorAll("."+HC);',
    '    for(var i=0;i<ms.length;i++){',
    '      var p=ms[i].parentNode;',
    '      if(p)p.replaceChild(document.createTextNode(ms[i].textContent),ms[i]);',
    '    }',
    '    if(document.body)document.body.normalize();',
    '  }',
    '  var query=' + JSON.stringify(query) + ';',
    '  var direction=' + JSON.stringify(direction) + ';',
    '  var reset=' + (isReset ? 'true' : 'false') + ';',
    '  if(!query){',
    '    clearHL();window.__nxcMarks=[];window.__nxcIdx=0;',
    '    if(window.__TAURI__&&window.__TAURI__.event)window.__TAURI__.event.emit("nexcape:find-result",{count:0,current:0});',
    '    return;',
    '  }',
    '  if(reset||query!==window.__nxcQuery){',
    '    clearHL();',
    '    window.__nxcQuery=query;window.__nxcIdx=0;',
    // Use a safe character class — no } in it
    '    var re=new RegExp(query.replace(/[.+*?^$|()\\[\\]\\\\]/g,"\\\\$&"),"gi");',
    '    function walk(n){',
    '      if(!n)return;',
    '      var t=n.nodeName;',
    '      if(t==="SCRIPT"||t==="STYLE"||t==="NOSCRIPT"||t==="IFRAME"||t==="TEXTAREA")return;',
    '      if(n.nodeType===3){',
    '        re.lastIndex=0;if(!re.test(n.textContent))return;re.lastIndex=0;',
    '        var f=document.createDocumentFragment(),last=0,m;',
    '        while((m=re.exec(n.textContent))!==null){',
    '          f.appendChild(document.createTextNode(n.textContent.slice(last,m.index)));',
    '          var mk=document.createElement("mark");mk.className=HC;',
    '          mk.style.cssText="background:#fbbf24;color:#000;border-radius:2px;padding:0 1px;";',
    '          mk.textContent=m[0];f.appendChild(mk);last=m.index+m[0].length;',
    '        }',
    '        f.appendChild(document.createTextNode(n.textContent.slice(last)));',
    '        n.parentNode.replaceChild(f,n);',
    '      }else{',
    '        var kids=Array.from(n.childNodes);for(var k=0;k<kids.length;k++)walk(kids[k]);',
    '      }',
    '    }',
    '    if(document.body)walk(document.body);',
    '    window.__nxcMarks=Array.from(document.querySelectorAll("."+HC));',
    '  } else {',
    '    var total=(window.__nxcMarks||[]).length;',
    '    if(!total){if(window.__TAURI__&&window.__TAURI__.event)window.__TAURI__.event.emit("nexcape:find-result",{count:0,current:0});return;}',
    '    if(direction==="next")window.__nxcIdx=(window.__nxcIdx+1)%total;',
    '    if(direction==="prev")window.__nxcIdx=(window.__nxcIdx-1+total)%total;',
    '  }',
    '  var marks=window.__nxcMarks||[];',
    '  for(var i=0;i<marks.length;i++){',
    '    marks[i].style.background=(i===window.__nxcIdx)?"#f97316":"#fbbf24";',
    '    marks[i].style.outline=(i===window.__nxcIdx)?"2px solid #ea580c":"none";',
    '  }',
    '  if(marks.length&&marks[window.__nxcIdx])marks[window.__nxcIdx].scrollIntoView({block:"center",behavior:"smooth"});',
    '  if(window.__TAURI__&&window.__TAURI__.event)window.__TAURI__.event.emit("nexcape:find-result",{count:marks.length,current:window.__nxcIdx+1});',
    '})();',
  ];
  return lines.join('\n');
}

function openFindBar() {
  state.findBarOpen = true;
  findBar.hidden = false;
  btnFind.classList.add('active');
  requestAnimationFrame(() => findBar.classList.add('open'));
  setTimeout(() => findInput.focus(), 50);
}

function closeFindBar() {
  state.findBarOpen = false;
  findBar.classList.remove('open');
  btnFind.classList.remove('active');
  setTimeout(() => { findBar.hidden = true; }, 250);
  const tab = getActiveTab();
  if (tab && tab.label) {
    const script = buildFindScript('', null, true);
    invoke('eval_in_webview', { label: tab.label, script: script }).catch(() => {});
  }
  findCount.textContent = '';
  state.findQuery = '';
  findInput.value = '';
}

async function findInPage(direction, isReset) {
  const tab = getActiveTab();
  if (!tab || !tab.label) return;
  const query = findInput.value.trim();
  state.findQuery = query;
  const script = buildFindScript(query, direction || null, !!isReset);
  try { await invoke('eval_in_webview', { label: tab.label, script: script }); } catch (e) { /* ignore */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  state.mainWindow = Window.getCurrent();

  // ── Clean up orphaned child webviews from a previous hot-reload session ──
  try {
    if (window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getAllWebviews) {
      const all = await window.__TAURI__.webview.getAllWebviews();
      for (var i = 0; i < all.length; i++) {
        if (all[i].label && all[i].label.startsWith('nxc-')) {
          console.log('[NXC] Closing orphaned webview:', all[i].label);
          try { await all[i].close(); } catch(e) { /* ignore */ }
        }
      }
    }
  } catch (e) {
    console.warn('[NXC] Could not clean orphaned webviews:', e.message);
  }

  try {
    const engine = await invoke('get_setting', { key: 'search_engine' });
    if (engine) state.searchEngine = engine;
  } catch (e) { /* ignore */ }

  await listen('nexcape:navigate', function(event) {
    if (typeof event.payload === 'string') navigateActive(event.payload);
  });

  await listen('nexcape:tab-info', function(event) {
    const p = event.payload || {};
    const tab = state.tabs.find(function(t) { return t.id === p.tabId; });
    if (!tab) return;
    let changed = false;
    if (p.title && p.title !== tab.title) { tab.title = p.title; changed = true; }
    if (p.favicon && p.favicon !== tab.favicon) { tab.favicon = p.favicon; changed = true; }
    if (changed) { renderTabs(); if (tab.isActive) updateAddressBar(); }
  });

  await listen('nexcape:find-result', function(event) {
    const p = event.payload || {};
    if (!p.count) {
      findCount.textContent = state.findQuery ? 'No results' : '';
      findCount.className = 'find-count no-results';
    } else {
      findCount.textContent = p.current + ' / ' + p.count;
      findCount.className = 'find-count';
    }
  });

  await listen('nexcape:settings-changed', function(event) {
    const p = event.payload || {};
    if (p.key === 'search_engine' && p.value) state.searchEngine = p.value;
  });

  // ★ Receive keyboard shortcuts forwarded from child webviews
  await listen('nexcape:keydown', function(event) {
    const p = event.payload || {};
    onKeyDown({
      key: p.key || '',
      ctrlKey: !!p.ctrl,
      shiftKey: !!p.shift,
      altKey: !!p.alt,
      metaKey: !!p.meta,
      preventDefault: function() {},
      stopPropagation: function() {},
    });
  });

  // ── DOM listeners — attached BEFORE first tab so they're immediately ready ─
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', debounce(repositionActiveWebview, 60));
  tabBar.addEventListener('dblclick', function(e) { if (e.target === tabBar) openNewTab(); });
  findInput.addEventListener('input', debounce(function() { findInPage(null, true); }, 150));
  findInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); findInPage(e.shiftKey ? 'prev' : 'next', false); }
    if (e.key === 'Escape') closeFindBar();
  });
  $('find-prev').addEventListener('click', function() { findInPage('prev', false); });
  $('find-next').addEventListener('click', function() { findInPage('next', false); });
  $('find-close').addEventListener('click', closeFindBar);

  // ── Open first tab last ───────────────────────────────────────────────────
  await openNewTab();
}


// ── Tab counters ──────────────────────────────────────────────────────────────
// Seed webviewCounter with timestamp to guarantee unique labels across hot-reloads.
// Without this, a hot-reload resets counters to 0, colliding with still-alive child webviews.

let tabCounter = 0;
let webviewCounter = Date.now();

function nextTabId()      { return 'tab-' + (++tabCounter); }
function nextLabel(tabId) { return 'nxc-' + tabId + '-' + (++webviewCounter); }

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

async function openNewTab(input) {
  const target = resolveTarget(input || null);
  const id = nextTabId();

  state.tabs.forEach(function(t) { t.isActive = false; });

  const tab = {
    id: id,
    label: '',
    url: target.displayUrl,
    loadUrl: target.loadUrl,
    title: target.title,
    favicon: /^https?:\/\//i.test(target.loadUrl) ? getGoogleFaviconUrl(target.loadUrl) : null,
    isLoading: true,
    isActive: true,
    error: null,
    history: [target.displayUrl],
    historyIndex: 0,
    zoom: 1.0,
  };

  state.tabs.push(tab);
  state.activeTabId = id;

  renderTabs(); updateToolbar(); updateAddressBar();
  updateContentPlaceholder(); updateProgressBar();

  await hideAllWebviews();
  await createWebviewForTab(tab, target.loadUrl);
  recordVisit(tab);
  checkBookmarkState();
}

async function switchToTab(tabId) {
  if (tabId === state.activeTabId) return;
  await hideAllWebviews();

  state.tabs.forEach(function(t) { t.isActive = t.id === tabId; });
  state.activeTabId = tabId;

  renderTabs(); updateToolbar(); updateAddressBar();
  updateContentPlaceholder(); updateProgressBar();

  const tab = getActiveTab();
  if (tab && !tab.error) await showWebview(tabId);
  if (tab && tab.zoom && tab.zoom !== 1.0) await applyZoom(tab.zoom);
  else zoomIndicator.hidden = true;

  checkBookmarkState();
}

async function closeTab(tabId) {
  const index = state.tabs.findIndex(function(t) { return t.id === tabId; });
  if (index < 0) return;

  const wasActive = state.activeTabId === tabId;
  await closeWebview(tabId);
  state.tabs.splice(index, 1);

  // Close the window when the last tab is closed
  if (!state.tabs.length) {
    try { await state.mainWindow.close(); } catch (e) { /* ignore */ }
    return;
  }

  if (wasActive) {
    state.activeTabId = null;
    await switchToTab(state.tabs[Math.min(index, state.tabs.length - 1)].id);
    return;
  }

  renderTabs(); updateToolbar(); updateContentPlaceholder(); updateProgressBar();
}

async function closeWebview(tabId) {
  const wv = state.webviews[tabId];
  if (!wv) return;
  try { await wv.close(); } catch (e) { /* ignore */ }
  delete state.webviews[tabId];
}

async function createWebviewForTab(tab, loadUrl) {
  const bounds = getContentBounds();
  const label = nextLabel(tab.id);
  tab.label = label;
  tab.loadUrl = loadUrl;
  tab.isLoading = true;
  tab.error = null;

  const options = { url: loadUrl, x: OFFSCREEN, y: OFFSCREEN, width: bounds.width, height: bounds.height };

  renderTabs(); updateContentPlaceholder(); updateProgressBar();

  let webview;
  try {
    webview = new Webview(state.mainWindow, label, options);
    state.webviews[tab.id] = webview;
  } catch (err) {
    tab.isLoading = false;
    tab.error = 'Could not create tab: ' + formatWebviewError(err);
    renderTabs(); updateToolbar(); updateContentPlaceholder(); updateProgressBar();
    return false;
  }

  return new Promise(function(resolve) {
    let settled = false;

    async function finish(ok, err) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (!ok) {
        try { await webview.close(); } catch (e) { /* ignore */ }
        delete state.webviews[tab.id];
        tab.error = 'Could not load page: ' + formatWebviewError(err);
      } else {
        tab.error = null;
      }

      tab.isLoading = false;
      renderTabs(); updateToolbar(); updateContentPlaceholder(); updateProgressBar();

      if (ok && tab.id === state.activeTabId) {
        await new Promise(function(r) { setTimeout(r, 50); });
        await showWebview(tab.id);
        if (tab.zoom && tab.zoom !== 1.0) await applyZoom(tab.zoom);
        if (state.findBarOpen && state.findQuery) {
          setTimeout(function() { findInPage(null, true); }, 400);
        }
      }

      resolve(ok);
    }

    const timeout = setTimeout(function() {
      finish(false, 'Timed out. Check your connection and try again.');
    }, WEBVIEW_TIMEOUT_MS);

    webview.once('tauri://created', function() {
      injectTabInfoScript(label, tab.id).catch(function() {});
      finish(true);
    });
    webview.once('tauri://error', function(e) { finish(false, e); });
  });
}

async function hideAllWebviews() {
  const wvs = Object.values(state.webviews);
  for (let i = 0; i < wvs.length; i++) {
    try { await wvs[i].setPosition(new LogicalPosition(OFFSCREEN, OFFSCREEN)); } catch (e) { /* ignore */ }
  }
}

async function showWebview(tabId) {
  const wv = state.webviews[tabId];
  if (!wv) return;
  const b = getContentBounds();
  try {
    await wv.setSize(new LogicalSize(b.width, b.height));
    await wv.setPosition(new LogicalPosition(b.x, b.y));
    await wv.setFocus();
  } catch (e) { console.warn('showWebview:', e); }
}

async function repositionActiveWebview() {
  const tab = getActiveTab();
  if (!tab || tab.error) return;
  await showWebview(tab.id);
}

function getActiveTab() {
  return state.tabs.find(function(t) { return t.id === state.activeTabId; }) || null;
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function navigateActive(input) {
  const target = resolveTarget(input);
  if (!state.activeTabId) { await openNewTab(target.displayUrl); return; }
  const tab = getActiveTab();
  if (!tab) return;
  await loadTab(tab, target, true);
  recordVisit(tab);
  checkBookmarkState();
}

async function loadTab(tab, target, addToHistory) {
  await closeWebview(tab.id);

  tab.url = target.displayUrl;
  tab.loadUrl = target.loadUrl;
  tab.title = target.title;
  tab.error = null;

  if (/^https?:\/\//i.test(target.loadUrl)) {
    const gf = getGoogleFaviconUrl(target.loadUrl);
    if (gf) tab.favicon = gf;
  } else { tab.favicon = null; }

  if (addToHistory) {
    const cur = tab.history[tab.historyIndex];
    if (cur !== target.displayUrl) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(target.displayUrl);
      tab.historyIndex = tab.history.length - 1;
    }
  }

  updateAddressBar(); updateToolbar();
  await createWebviewForTab(tab, target.loadUrl);
}

async function navigateHistory(delta) {
  const tab = getActiveTab();
  if (!tab) return;
  const next = tab.historyIndex + delta;
  if (next < 0 || next >= tab.history.length) return;
  tab.historyIndex = next;
  await loadTab(tab, resolveTarget(tab.history[next]), false);
  checkBookmarkState();
}

async function reloadActive() {
  const tab = getActiveTab();
  if (!tab) return;
  await loadTab(tab, resolveTarget(tab.url), false);
}

async function recordVisit(tab) {
  if (!tab || !/^https?:\/\//i.test(tab.url)) return;
  try {
    const s = await invoke('get_setting', { key: 'save_history' });
    if (s === 'false') return;
  } catch (e) { /* ignore */ }
  invoke('add_history_entry', { url: tab.url, title: tab.title || tab.url, faviconUrl: tab.favicon || null }).catch(function() {});
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderTabs() {
  tabBar.querySelectorAll('.tab').forEach(function(el) { el.remove(); });

  state.tabs.forEach(function(tab) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.isActive ? ' active' : '') + (tab.error ? ' error' : '');
    el.dataset.tabId = tab.id;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.isActive));
    el.title = (tab.url && tab.url !== NEW_TAB_URL) ? tab.url : 'New Tab';

    let faviconHtml;
    if (tab.isLoading) {
      faviconHtml = '<div class="tab-favicon"><div class="tab-loading"></div></div>';
    } else if (tab.error) {
      faviconHtml = '<div class="tab-favicon tab-error-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5l5 9H1l5-9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 4.5v2.5M6 8.8v.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div>';
    } else {
      faviconHtml = '<div class="tab-favicon">' + (
        tab.favicon
          ? '<img src="' + escHtml(tab.favicon) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
          : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2" opacity="0.3"/></svg>'
      ) + '</div>';
    }

    el.innerHTML = faviconHtml +
      '<span class="tab-title">' + escHtml(tab.title || 'New Tab') + '</span>' +
      '<button class="tab-close" title="Close tab" aria-label="Close tab">' +
        '<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '</button>';

    el.addEventListener('click', function(e) {
      if (e.target.closest('.tab-close')) { e.stopPropagation(); closeTab(tab.id); }
      else switchToTab(tab.id);
    });
    el.addEventListener('auxclick', function(e) {
      if (e.button === 1) { e.preventDefault(); closeTab(tab.id); }
    });

    tabBar.insertBefore(el, tabNewBtn);
  });
}

function updateAddressBar() {
  const tab = getActiveTab();
  if (!tab || tab.url === NEW_TAB_URL)   addressBar.value = '';
  else if (tab.url === SETTINGS_URL)     addressBar.value = 'nexcape://settings';
  else                                   addressBar.value = tab.url || '';

  const url = tab ? tab.url : '';
  const isHttps = /^https:\/\//i.test(url);
  const isHttp  = /^http:\/\//i.test(url) && !isHttps;
  const secBtn  = $('security-btn');
  secBtn.classList.toggle('secure',   isHttps);
  secBtn.classList.toggle('insecure', isHttp);
  secBtn.title = isHttps ? 'Connection is secure' : isHttp ? 'Connection is not secure' : 'Internal page';
  securityIcon.style.color = isHttps ? 'var(--green)' : isHttp ? 'var(--yellow)' : 'var(--text-muted)';
}

function updateToolbar() {
  const tab = getActiveTab();
  const has = !!tab;
  btnBack.disabled    = !has || tab.historyIndex <= 0;
  btnForward.disabled = !has || tab.historyIndex >= tab.history.length - 1;
  btnReload.disabled  = !has;
  btnReload.innerHTML = (has && tab.isLoading) ? ICON_STOP : ICON_RELOAD;
  btnReload.title     = (has && tab.isLoading) ? 'Stop loading' : 'Reload (F5 / Ctrl+R)';
}

function updateContentPlaceholder() {
  const tab = getActiveTab();
  if (!state.tabs.length) {
    noTabs.innerHTML = '<div class="placeholder-icon">+</div><p>Press <kbd>Ctrl+T</kbd> to open a new tab</p>';
    noTabs.classList.add('visible'); return;
  }
  if (tab && tab.error) {
    noTabs.innerHTML = '<div class="placeholder-icon error">!</div><p>' + escHtml(tab.error) + '</p><button class="retry-btn" onclick="window.__reloadActive()">Try again</button>';
    noTabs.classList.add('visible'); return;
  }
  noTabs.classList.remove('visible');
}

function updateProgressBar() {
  const tab = getActiveTab();
  progressBar.classList.toggle('loading', !!(tab && tab.isLoading));
}

// ── Suggestions ───────────────────────────────────────────────────────────────

let suggestionResults = [], selectedIdx = -1;

async function showSuggestions(query) {
  if (!query || query.length < 2) { hideSuggestions(); return; }
  try {
    const hist = await invoke('search_history', { query: query }) || [];
    const bks  = await invoke('get_bookmarks') || [];
    const lower = query.toLowerCase();
    const bkF = bks.filter(function(b) { return (b.url && b.url.toLowerCase().includes(lower)) || (b.title && b.title.toLowerCase().includes(lower)); }).slice(0, 3);
    const usedUrls = bkF.map(function(b) { return b.url; });
    suggestionResults = [
      ...bkF.map(function(b) { return { type: 'bookmark', url: b.url, title: b.title }; }),
      ...hist.filter(function(e) { return !usedUrls.includes(e.url); }).slice(0, 5).map(function(e) { return { type: 'history', url: e.url, title: e.title }; }),
    ];
    if (!suggestionResults.length) { hideSuggestions(); return; }
    suggestions.innerHTML = suggestionResults.map(function(s, i) {
      return '<div class="suggestion-item" data-index="' + i + '" role="option">' +
        '<span class="suggestion-icon">' + (s.type === 'bookmark' ? '🔖' : '🕐') + '</span>' +
        '<div class="suggestion-text"><div class="suggestion-title">' + escHtml(s.title || s.url) + '</div>' +
        '<div class="suggestion-url">' + escHtml(s.url) + '</div></div></div>';
    }).join('');
    suggestions.querySelectorAll('.suggestion-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        navigateActive(suggestionResults[+el.dataset.index].url);
        hideSuggestions(); addressBar.blur();
      });
    });
    selectedIdx = -1;
    suggestions.classList.add('visible');
    addressBar.setAttribute('aria-expanded', 'true');
  } catch (e) { hideSuggestions(); }
}

function hideSuggestions() {
  suggestions.classList.remove('visible');
  addressBar.setAttribute('aria-expanded', 'false');
  selectedIdx = -1;
}

function highlightSuggestion() {
  suggestions.querySelectorAll('.suggestion-item').forEach(function(el, i) {
    el.classList.toggle('selected', i === selectedIdx);
    if (i === selectedIdx) addressBar.value = suggestionResults[i].url;
  });
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

async function checkBookmarkState() {
  const tab = getActiveTab();
  if (!isBookmarkableUrl(tab && tab.url)) {
    btnBookmark.classList.remove('bookmarked');
    btnBookmark.dataset.bookmarkId = '';
    return;
  }
  const id = await invoke('is_bookmarked', { url: tab.url }).catch(function() { return null; });
  btnBookmark.classList.toggle('bookmarked', !!id);
  btnBookmark.dataset.bookmarkId = id || '';
}

async function toggleBookmark() {
  const tab = getActiveTab();
  if (!isBookmarkableUrl(tab && tab.url)) return;
  if (btnBookmark.dataset.bookmarkId) {
    await invoke('remove_bookmark', { id: btnBookmark.dataset.bookmarkId });
    btnBookmark.classList.remove('bookmarked');
    btnBookmark.dataset.bookmarkId = '';
    showToast('Bookmark removed');
  } else {
    const bk = await invoke('add_bookmark', { url: tab.url, title: tab.title || tab.url, faviconUrl: tab.favicon || null });
    btnBookmark.classList.add('bookmarked');
    btnBookmark.dataset.bookmarkId = bk.id;
    showToast('Bookmark saved ✓', 'success');
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

async function toggleSidebar(mode) {
  const m = mode || state.sidebarMode;
  if (state.sidebarOpen && state.sidebarMode === m) {
    state.sidebarOpen = false;
    sidebar.classList.remove('open');
  } else {
    state.sidebarOpen = true;
    state.sidebarMode = m;
    sidebar.classList.add('open');
    await renderSidebar();
  }
  $('sidebar-tab-bookmarks').classList.toggle('active', state.sidebarMode === 'bookmarks');
  $('sidebar-tab-history').classList.toggle('active', state.sidebarMode === 'history');
  repositionActiveWebview();
}

async function renderSidebar() {
  sidebarContent.innerHTML = '';
  const items = state.sidebarMode === 'bookmarks'
    ? await invoke('get_bookmarks').catch(function() { return []; })
    : await invoke('get_history').catch(function() { return []; });

  if (!items || !items.length) {
    const icon = state.sidebarMode === 'bookmarks' ? '🔖' : '🕐';
    const msg  = state.sidebarMode === 'bookmarks'
      ? 'No bookmarks yet<br><small>Click ★ to save a page</small>'
      : 'No history yet';
    sidebarContent.innerHTML = '<div class="sidebar-empty"><div class="sidebar-empty-icon">' + icon + '</div><p>' + msg + '</p></div>';
    return;
  }

  if (state.sidebarMode === 'history') {
    const groups = {};
    items.forEach(function(item) {
      const d = item.visited_at
        ? new Date(item.visited_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
        : 'Unknown';
      if (!groups[d]) groups[d] = [];
      groups[d].push(item);
    });
    Object.keys(groups).forEach(function(date) {
      const hdr = document.createElement('div');
      hdr.className = 'sidebar-group-header';
      hdr.textContent = date;
      sidebarContent.appendChild(hdr);
      groups[date].forEach(function(item) { sidebarContent.appendChild(makeSidebarItem(item)); });
    });
  } else {
    items.forEach(function(item) { sidebarContent.appendChild(makeSidebarItem(item)); });
  }
}

function makeSidebarItem(item) {
  const el = document.createElement('div');
  el.className = 'sidebar-item';
  const timeStr = item.visited_at ? new Date(item.visited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const iconHtml = item.favicon_url
    ? '<img src="' + escHtml(item.favicon_url) + '" class="sidebar-favicon" alt="" onerror="this.style.display=\'none\'">'
    : '<div class="sidebar-item-icon">' + (state.sidebarMode === 'history' ? (timeStr || '🕐') : '🔖') + '</div>';
  el.innerHTML = iconHtml +
    '<div class="sidebar-item-text">' +
      '<div class="sidebar-item-title">' + escHtml(item.title || item.url) + '</div>' +
      '<div class="sidebar-item-url">' + escHtml(item.url) + '</div>' +
    '</div>' +
    (state.sidebarMode === 'bookmarks' ? '<button class="sidebar-item-del" aria-label="Remove">✕</button>' : '');
  if (state.sidebarMode === 'bookmarks') {
    el.querySelector('.sidebar-item-del').addEventListener('click', function(e) {
      e.stopPropagation();
      invoke('remove_bookmark', { id: item.id }).then(function() { renderSidebar(); checkBookmarkState(); showToast('Bookmark removed'); });
    });
  }
  el.addEventListener('click', function() { navigateActive(item.url); });
  return el;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function onKeyDown(event) {
  const ctrl  = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  const key   = event.key;

  if (ctrl && key.toLowerCase() === 't') { event.preventDefault(); openNewTab(); return; }
  if (ctrl && key.toLowerCase() === 'w') { event.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId); return; }
  if (ctrl && key.toLowerCase() === 'l') { event.preventDefault(); addressBar.focus(); addressBar.select(); return; }
  if (ctrl && key.toLowerCase() === 'f') { event.preventDefault(); state.findBarOpen ? findInput.focus() : openFindBar(); return; }
  if (ctrl && key.toLowerCase() === 'd') { event.preventDefault(); toggleBookmark(); return; }
  if (ctrl && key.toLowerCase() === 'r') { event.preventDefault(); reloadActive(); return; }

  if (ctrl && (key === '+' || key === '=')) { event.preventDefault(); zoomIn(); return; }
  if (ctrl && key === '-')  { event.preventDefault(); zoomOut(); return; }
  if (ctrl && key === '0')  { event.preventDefault(); zoomReset(); return; }

  if (ctrl && key === 'Tab') {
    event.preventDefault();
    if (state.tabs.length > 1) {
      const idx  = state.tabs.findIndex(function(t) { return t.id === state.activeTabId; });
      const next = (idx + (shift ? -1 : 1) + state.tabs.length) % state.tabs.length;
      switchToTab(state.tabs[next].id);
    }
    return;
  }

  if (ctrl && /^[1-9]$/.test(key)) {
    event.preventDefault();
    const n = parseInt(key, 10) - 1;
    if (n < state.tabs.length) switchToTab(state.tabs[n].id);
    return;
  }

  if (event.altKey && key === 'ArrowLeft')  { event.preventDefault(); navigateHistory(-1); return; }
  if (event.altKey && key === 'ArrowRight') { event.preventDefault(); navigateHistory(1);  return; }
  if (key === 'F5') { event.preventDefault(); reloadActive(); return; }

  if (key === 'Escape') {
    if (state.findBarOpen) { closeFindBar(); return; }
    if (suggestions.classList.contains('visible')) { hideSuggestions(); addressBar.blur(); return; }
    if (state.sidebarOpen) { toggleSidebar(); return; }
    return;
  }

  if (document.activeElement === addressBar) {
    if (key === 'ArrowDown') { event.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, suggestionResults.length - 1); highlightSuggestion(); }
    if (key === 'ArrowUp')   { event.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, -1); highlightSuggestion(); }
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

tabNewBtn.addEventListener('click',   function() { openNewTab(); });
btnBack.addEventListener('click',     function() { navigateHistory(-1); });
btnForward.addEventListener('click',  function() { navigateHistory(1); });
btnReload.addEventListener('click',   reloadActive);
btnHome.addEventListener('click',     function() { navigateActive(null); });
btnFind.addEventListener('click',     function() { state.findBarOpen ? findInput.focus() : openFindBar(); });

addressBar.addEventListener('focus',  function() { addressBar.select(); });
addressBar.addEventListener('input',  debounce(function(e) { showSuggestions(e.target.value.trim()); }, 200));
addressBar.addEventListener('blur',   function() { setTimeout(hideSuggestions, 150); });
addressBar.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigateActive(selectedIdx >= 0 ? suggestionResults[selectedIdx].url : addressBar.value);
    hideSuggestions(); addressBar.blur();
  }
});

btnBookmark.addEventListener('click', toggleBookmark);
btnSidebar.addEventListener('click',  function() { toggleSidebar(); });

$('sidebar-tab-bookmarks').addEventListener('click', function() {
  state.sidebarMode = 'bookmarks';
  $('sidebar-tab-bookmarks').classList.add('active');
  $('sidebar-tab-history').classList.remove('active');
  if (!state.sidebarOpen) toggleSidebar('bookmarks'); else renderSidebar();
});
$('sidebar-tab-history').addEventListener('click', function() {
  state.sidebarMode = 'history';
  $('sidebar-tab-history').classList.add('active');
  $('sidebar-tab-bookmarks').classList.remove('active');
  if (!state.sidebarOpen) toggleSidebar('history'); else renderSidebar();
});
$('sidebar-close-btn').addEventListener('click', function() { toggleSidebar(); });
btnSettings.addEventListener('click', function() { openNewTab(SETTINGS_URL); });

window.__reloadActive = reloadActive;

init().catch(function(err) {
  console.error('Nexcape init failed:', err);
  noTabs.innerHTML = '<div class="placeholder-icon error">!</div><p>Could not initialize Nexcape: ' + escHtml(formatWebviewError(err)) + '</p>';
  noTabs.classList.add('visible');
});
