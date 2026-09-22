// app.js - AudioVisual Web 版前端逻辑。
// 行为对应原 renderer.js：构造"解析/嵌入 URL"并可在 iframe 中直接播放。

let config = { platforms: [], parsers: [], dramaSites: [] };

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    populateParsers();
    renderDrama();
  } catch (e) {
    console.error('加载配置失败', e);
  }
}

function populateParsers() {
  const select = $('parser-select');
  select.innerHTML = '';
  config.parsers.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = p.value;
    opt.textContent = i === 0 ? `${p.label}（默认）` : p.label;
    select.appendChild(opt);
  });
}

function renderDrama() {
  const grid = $('drama-grid');
  grid.innerHTML = '';
  config.dramaSites.forEach((site) => {
    const a = document.createElement('a');
    a.className = 'drama-card';
    a.href = site.value;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<div class="name">${escapeHtml(site.label)}</div>
                   <div class="url">${escapeHtml(site.value)}</div>`;
    grid.appendChild(a);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 调用后端 /api/parse
async function doParse() {
  const videoUrl = $('video-url').value.trim();
  if (!videoUrl) {
    alert('请先输入视频页面链接。');
    return;
  }
  const api = $('parser-select').value;

  $('parse-btn').disabled = true;
  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, api })
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || '解析失败。');
      return;
    }
    showResult(data);
  } catch (e) {
    alert('请求失败：' + e.message);
  } finally {
    $('parse-btn').disabled = false;
  }
}

function showResult(data) {
  const resultBox = $('result');
  resultBox.classList.remove('hidden');
  $('parse-url').textContent = data.parseUrl;
  $('page-tag').textContent = data.isVideoPage ? '已识别为视频详情页' : '非典型视频页（结果仅供参考）';
  $('player-iframe').src = data.parseUrl;
}

// 事件绑定
$('parse-btn').addEventListener('click', doParse);
$('video-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') doParse(); });

$('clear-btn').addEventListener('click', () => {
  $('video-url').value = '';
  $('result').classList.add('hidden');
  $('player-iframe').src = '';
});

$('copy-btn').addEventListener('click', async () => {
  const text = $('parse-url').textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    flash($('copy-btn'), '已复制 ✓');
  } catch (e) {
    // 旧浏览器回退：选中副本
    const code = $('parse-url');
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = window.getSelection();
    sel.removeAllRanges();
    range.addRange(range);
    document.execCommand('copy');
  }
});

$('open-btn').addEventListener('click', () => {
  const url = $('parse-url').textContent;
  if (url) window.open(url, '_blank', 'noopener');
});

$('drama-mode-toggle').addEventListener('change', (e) => {
  const on = e.target.checked;
  $('parse-panel').classList.toggle('hidden', on);
  $('drama-panel').classList.toggle('hidden', !on);
});

function flash(btn, msg) {
  const original = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

loadConfig();
