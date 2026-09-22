// app.js - AudioVisual Web 版前端（浏览器风格）。
// 行为对应主线 renderer.js：应用内浏览平台 -> 点开视频页自动解析 -> 浮层播放，
// 支持后退/前进/首页、平台/解析器/影视导航快捷切换、服务端设置持久化。

// ---- 元素 ----
const $ = (id) => document.getElementById(id);
const addressBar = $('address-bar');
const goBtn = $('go-btn');
const backBtn = $('back-btn');
const forwardBtn = $('forward-btn');
const homeBtn = $('home-btn');
const viewFrame = $('view');
const viewHost = $('view-host');
const homeEl = $('home');
const homeTitle = $('home-title');
const platformGrid = $('platform-grid');
const dramaGrid = $('drama-grid');
const modeToggle = $('mode-toggle');
const modeLabel = $('mode-label');
const quickPlatform = $('quick-platform');
const quickParser = $('quick-parser');
const quickParse = $('quick-parse');
const quickDrama = $('quick-drama');
const playerOverlay = $('player-overlay');
const playerFrame = $('player-frame');
const playerBack = $('player-back');
const playerParser = $('player-parser');
const playerReparse = $('player-reparse');
const playerTitle = $('player-title');
const toast = $('toast');
const settingsBtn = $('settings-btn');
const settingsModal = $('settings-modal');
const settingsClose = $('settings-close');
const settingsSave = $('settings-save');
const settingsReset = $('settings-reset');
const parsersInput = $('parsers-input');
const dramasInput = $('dramas-input');

// ---- 状态 ----
let config = { platforms: [], parsers: [], dramaSites: [] };
let mode = 'parse'; // 'parse' | 'drama'
let browserHistory = [];
let historyIndex = -1;
let currentTargetUrl = null;   // 当前 iframe 正在浏览的原始站点 URL
let lastAutoParsedUrl = null;  // 已自动解析过的视频页 URL（防止探测轮询重复触发）
let dismissedPlayerUrl = null; // 用户手动关闭播放浮层时的 URL（同一页不再自动弹出）

// ---- 工具 ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function showToast(msg, type = 'info', ms = 2200) {
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), ms);
}

function isVideoPageUrl(u) {
  if (!u) return false;
  return (
    u.includes('iqiyi.com/v_') ||
    u.includes('mgtv.com/b/') ||
    u.includes('v.qq.com/x/cover/') ||
    u.includes('bilibili.com/bangumi/play/') ||
    (u.includes('bilibili.com/video/') && (u.includes('?p=') || u.includes('&p='))) ||
    u.includes('youku.com/v_show/')
  );
}

function proxyUrl(target) {
  return '/proxy?url=' + encodeURIComponent(target);
}

// ---- 初始化：加载配置 ----
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
  } catch (e) {
    config = { platforms: [], parsers: [], dramaSites: [] };
    showToast('加载配置失败：' + e.message, 'error');
  }
  renderHome();
  populateSelects();
  renderHomeForMode();
}

function populateSelects() {
  // 平台
  quickPlatform.innerHTML = '';
  config.platforms.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.value; o.textContent = p.label;
    quickPlatform.appendChild(o);
  });
  // 解析器
  [quickParser, playerParser].forEach((sel) => {
    sel.innerHTML = '';
    config.parsers.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = p.value;
      o.textContent = i === 0 ? p.label + '（默认）' : p.label;
      sel.appendChild(o);
    });
  });
  // 影视导航
  quickDrama.innerHTML = '';
  config.dramaSites.forEach((d) => {
    const o = document.createElement('option');
    o.value = d.value; o.textContent = d.label;
    quickDrama.appendChild(o);
  });
}

function renderHome() {
  platformGrid.innerHTML = '';
  config.platforms.forEach((p) => {
    const c = document.createElement('button');
    c.className = 'card';
    c.innerHTML = `<div class="card-name">${escapeHtml(p.label)}</div><div class="card-url">${escapeHtml(p.value)}</div>`;
    c.addEventListener('click', () => navigate(p.value));
    platformGrid.appendChild(c);
  });

  dramaGrid.innerHTML = '';
  config.dramaSites.forEach((d) => {
    const c = document.createElement('button');
    c.className = 'card';
    c.innerHTML = `<div class="card-name">${escapeHtml(d.label)}</div><div class="card-url">${escapeHtml(d.value)}</div>`;
    c.addEventListener('click', () => navigate(d.value));
    dramaGrid.appendChild(c);
  });
}

// ---- 视图状态切换 ----
function showView() {
  viewHost.classList.remove('hidden');
  homeEl.classList.add('hidden');
}
function showHome() {
  viewHost.classList.add('hidden');
  homeEl.classList.remove('hidden');
  renderHomeForMode();
}

function renderHomeForMode() {
  const isDrama = mode === 'drama';
  homeTitle.textContent = isDrama ? '美韩日剧导航' : '选择平台开始观影';
  platformGrid.classList.toggle('hidden', isDrama);
  dramaGrid.classList.toggle('hidden', !isDrama);
}

// ---- 模式切换（对齐主线：切换后直接进入对应首页站点） ----
function setMode(next) {
  mode = next;
  modeLabel.textContent = next === 'drama' ? '美韩日剧' : '国内解析';
  quickPlatform.hidden = next === 'drama';
  quickParser.hidden = next === 'drama';
  quickParse.hidden = next === 'drama';
  quickDrama.hidden = next !== 'drama';
  syncModeToggle();
  // 切换模式时回到首页，让用户选择目标站点（避免自动加载未知站点）。
  goHome();
}

function syncModeToggle() {
  modeToggle.checked = mode === 'drama';
}

// 地址栏是否显示当前解析/播放页
function displayUrlInBar(u) {
  addressBar.value = u || '';
}

// ---- 导航 ----
function navigate(url, opts = {}) {
  let target = url && url.trim();
  if (!target) { showToast('请输入网址', 'error'); return; }
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  if (!playerOverlay.classList.contains('hidden')) closePlayer();
  currentTargetUrl = target;
  // 新的导航目标允许重新自动解析。
  lastAutoParsedUrl = null;
  dismissedPlayerUrl = null;
  displayUrlInBar(target);
  showView();
  if (!opts.replace) pushHistory(target);
  else browserHistory[historyIndex] = target;
  loadFrame(target);
}

function loadFrame(targetUrl) {
  viewFrame.src = proxyUrl(targetUrl);
}

function pushHistory(url) {
  // 避免连续重复
  if (browserHistory[historyIndex] === url) return;
  browserHistory = browserHistory.slice(0, historyIndex + 1);
  browserHistory.push(url);
  historyIndex = browserHistory.length - 1;
  updateNavButtons();
}

function goBack() {
  if (historyIndex > 0) {
    historyIndex--;
    const u = browserHistory[historyIndex];
    currentTargetUrl = u;
    displayUrlInBar(u);
    loadFrame(u);
    updateNavButtons();
  }
}
function goForward() {
  if (historyIndex < browserHistory.length - 1) {
    historyIndex++;
    const u = browserHistory[historyIndex];
    currentTargetUrl = u;
    displayUrlInBar(u);
    loadFrame(u);
    updateNavButtons();
  }
}
function updateNavButtons() {
  backBtn.disabled = historyIndex <= 0;
  forwardBtn.disabled = historyIndex >= browserHistory.length - 1;
}
function goHome() {
  if (!playerOverlay.classList.contains('hidden')) closePlayer();
  showHome();
  displayUrlInBar('');
  // 清空 iframe，避免后台继续加载/发声。
  viewFrame.src = 'about:blank';
  currentTargetUrl = null;
  lastAutoParsedUrl = null;
  dismissedPlayerUrl = null;
}

// ---- 自动解析 / 播放浮层 ----
function openPlayer(parseUrl, title) {
  playerTitle.textContent = title || '正在解析播放…';
  playerFrame.src = parseUrl; // 已是 /proxy 代理 URL
  playerOverlay.classList.remove('hidden');
}

function closePlayer() {
  playerOverlay.classList.add('hidden');
  playerFrame.src = '';
  // 记住用户主动关闭的页面，避免探测轮询把浮层又弹回来。
  dismissedPlayerUrl = lastAutoParsedUrl;
}

async function parseCurrentVideo(videoUrl) {
  if (!videoUrl) return;
  try {
    // 用户可能在浮层里切换了解析器，也可能用顶部快捷解析器。
    const sel = playerOverlay.classList.contains('hidden') ? quickParser : playerParser;
    const api = sel && sel.value ? sel.value : undefined;
    const res = await fetch('/api/parse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, api })
    });
    const data = await res.json();
    if (!data.ok) { showToast(data.error || '解析失败，请更换解析接口。', 'error'); return; }
    openPlayer(data.playUrl, data.isVideoPage ? '自动解析成功' : '已解析（非典型视频页）');
  } catch (e) {
    showToast('解析请求失败：' + e.message, 'error');
  }
}

async function reparse() {
  if (!currentTargetUrl) { showToast('当前没有可解析的页面', 'error'); return; }
  // 手动重新解析：允许对同一页再次弹出浮层。
  dismissedPlayerUrl = null;
  await parseCurrentVideo(currentTargetUrl);
}

// ---- iframe 内页面上报 URL（来自 /proxy 注入的探测脚本） ----
window.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || d.type !== 'av:url' || !d.url) return;
  // 只处理来自主浏览 iframe 的上报，忽略播放器 iframe。
  if (!event.source || event.source !== viewFrame.contentWindow) return;

  const orig = extractOriginUrl(d.url);
  // 同步地址栏：显示原始站点 URL 更友好。
  displayUrlInBar(orig);

  // 关键：当浏览页面变为视频详情页时自动解析并弹出播放（对齐主线）。
  // 注意：探测脚本会周期性上报同一 URL，必须去重，否则会反复重载播放器。
  if (isVideoPageUrl(orig) && orig !== lastAutoParsedUrl && orig !== dismissedPlayerUrl) {
    lastAutoParsedUrl = orig;
    currentTargetUrl = orig;
    parseCurrentVideo(orig);
  }
});

// 从 /proxy?url=xxx 解析出原始站点 URL（也能安全处理原始 URL 本身带 ? 的情况）
function extractOriginUrl(proxyOrRaw) {
  try {
    const abs = new URL(proxyOrRaw, location.origin);
    const v = abs.searchParams.get('url');
    if (v) return v;
  } catch (e) { /* 非 URL，按原样返回 */ }
  return proxyOrRaw;
}

// ---- 事件绑定 ----
goBtn.addEventListener('click', () => navigate(addressBar.value));
addressBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(addressBar.value); });
backBtn.addEventListener('click', goBack);
forwardBtn.addEventListener('click', goForward);
homeBtn.addEventListener('click', goHome);

quickPlatform.addEventListener('change', () => navigate(quickPlatform.value));
quickDrama.addEventListener('change', () => navigate(quickDrama.value));
quickParse.addEventListener('click', () => reparse());

modeToggle.addEventListener('change', (e) => setMode(e.target.checked ? 'drama' : 'parse'));

playerBack.addEventListener('click', () => closePlayer());
playerReparse.addEventListener('click', () => reparse());
playerParser.addEventListener('change', () => { if (!playerOverlay.classList.contains('hidden')) reparse(); });

// 设置
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsSave.addEventListener('click', saveSettings);
settingsReset.addEventListener('click', resetSettings);

function fmtList(list) {
  return (list || []).map((x) => `${x.label}|${x.value}`).join('\n');
}
function parseList(text) {
  return text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => { const [label, value] = l.split('|'); return { label: label.trim(), value: value.trim() }; })
    .filter((x) => x.label && x.value);
}

async function openSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    // 默认 vs 自定义：自定义为空时回退到默认
    const parsers = Array.isArray(s.parsers) && s.parsers.length ? s.parsers : config.parsers;
    const dramas = Array.isArray(s.dramaSites) && s.dramaSites.length ? s.dramaSites : config.dramaSites;
    parsersInput.value = fmtList(parsers);
    dramasInput.value = fmtList(dramas);
  } catch (e) {
    parsersInput.value = fmtList(config.parsers);
    dramasInput.value = fmtList(config.dramaSites);
  }
  settingsModal.classList.remove('hidden');
}
function closeSettings() { settingsModal.classList.add('hidden'); }

async function saveSettings() {
  const parsers = parseList(parsersInput.value);
  const dramaSites = parseList(dramasInput.value);
  try {
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parsers: parsers.length ? parsers : null, dramaSites: dramaSites.length ? dramaSites : null })
    });
    await loadConfig();
    showToast('设置已保存', 'success');
  } catch (e) {
    showToast('保存失败：' + e.message, 'error');
  }
}

async function resetSettings() {
  await fetch('/api/settings/reset', { method: 'POST' });
  await loadConfig();
  showToast('已恢复默认设置', 'success');
}

// 弹窗 Tab（data-tab 与面板 id 一致）
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = $(tab.dataset.tab);
    if (pane) pane.classList.add('active');
  });
});

// ---- 启动 ----
syncModeToggle();
loadConfig();
