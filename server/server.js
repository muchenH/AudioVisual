// server.js - AudioVisual Web 版后端（Docker 版）。
//
// 复用原版 Electron 应用的核心"解析"逻辑，并以一个"反向代理网关"提供近似主线的
// 浏览体验：
//   1. /proxy 抓取并透传外部网页，剥掉 X-Frame-Options / CSP，注入探测脚本，
//      从而能在 iframe 中浏览平台 / 解析站并"应用内跳转"。
//   2. /api/parse 构造解析 URL（与主线 finalUrl = api + videoUrl 一致）。
//   3. 服务端 /api/settings 统一持久化自定义解析接口与影视导航列表。

const path = require('path');
const express = require('express');

const {
  platforms,
  DEFAULT_API_LIST,
  DEFAULT_DRAMA_SITES,
  isVideoPage,
  buildParseUrl,
  resolveApi
} = require('./parsers');
const {
  normalizeTarget,
  proxyUrl,
  proxifyDocument,
  proxyRedirectLocation,
  fetchTarget
} = require('./proxy');
const settings = require('./settings');

const app = express();
app.use(express.json({ limit: '1mb' }));

// 提供前端静态页面。
app.use(express.static(path.join(__dirname, '..', 'public')));

// 组合最终配置：默认列表 + 服务端自定义（自定义覆盖默认）。
function effectiveConfig() {
  const s = settings.get();
  return {
    parsers: Array.isArray(s.parsers) && s.parsers.length ? s.parsers : DEFAULT_API_LIST,
    dramaSites: Array.isArray(s.dramaSites) && s.dramaSites.length ? s.dramaSites : DEFAULT_DRAMA_SITES
  };
}

// --- 反向代理网关 ---
// GET /proxy?url=<外部URL>  把外部网页以"可嵌入 / 应用内跳转"的形式返回。
app.get('/proxy', async (req, res) => {
  const targetUrl = normalizeTarget(req.query.url || req.query.u);
  if (!targetUrl) {
    return res.status(400).type('html').send('<html><body style="background:#1e1e2f;color:#e8e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">无效的代理目标 URL</body></html>');
  }

  try {
    const { status, headers, body, isHtml, finalUrl } = await fetchTarget(targetUrl);

    // 剥离会阻止嵌入的头。
    res.status(status);

    // Location 头（重定向）改走代理，保证应用内。
    const location = headers.get('location');
    if (location) {
      const pl = proxyRedirectLocation(location, finalUrl || targetUrl);
      res.setHeader('Location', pl);
    }

    headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (['x-frame-options', 'frame-options', 'content-security-policy',
        'content-security-policy-report-only', 'x-content-security-policy',
        'x-webkit-csp', 'location'].includes(lk)) {
        return;
      }
      // 避免响应头重复设置导致错误。
      if (lk === 'content-length' || lk === 'transfer-encoding' || lk === 'connection') return;
      try { res.setHeader(key, value); } catch (e) { /* 忽略非法头 */ }
    });

    if (isHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // 以重定向后的最终 URL 为基准改写相对链接。
      return res.send(proxifyDocument(body, finalUrl || targetUrl));
    }
    // 非 HTML（图片/视频/其它）：直接透传 Buffer。fetch 已把 body 读成 text，
    // 对二进制不准确；此处对明显非文本内容尽量用文本透传，实际主要服务 HTML 页面。
    return res.send(body);
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? '代理目标请求超时。' : '代理请求失败：' + (err && err.message ? err.message : String(err));
    return res.status(502).type('html').send(
      `<html><body style="background:#1e1e2f;color:#e8e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:0 24px;text-align:center;">${msg}</body></html>`
    );
  }
});

// 健康检查。
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'audiovisual-web', time: new Date().toISOString() });
});

// 配置：平台 / 解析器 / 影视导航列表（供前端下拉框与首页使用）。
app.get('/api/config', (req, res) => {
  const cfg = effectiveConfig();
  res.json({
    platforms,
    parsers: cfg.parsers,
    dramaSites: cfg.dramaSites
  });
});

// 读取服务端自定义设置。
app.get('/api/settings', (req, res) => {
  res.json({ ok: true, ...settings.get() });
});

// 保存服务端自定义设置。（body: { parsers?, dramaSites? }）
app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (Array.isArray(body.parsers)) patch.parsers = body.parsers;
  if (Array.isArray(body.dramaSites)) patch.dramaSites = body.dramaSites;
  // 支持清空：显式传 null 恢复默认。
  if (body.parsers === null) patch.parsers = null;
  if (body.dramaSites === null) patch.dramaSites = null;

  settings.set(patch);
  res.json({ ok: true, ...settings.get() });
});

// 恢复默认设置。
app.post('/api/settings/reset', (req, res) => {
  settings.reset();
  res.json({ ok: true, ...settings.get() });
});

// 核心：构造"解析/嵌入 URL"（与主线 finalUrl = api + videoUrl 一致）。
// body: { url: "<视频页URL>", api?: "<解析器 value|label|对象>" }
app.post('/api/parse', (req, res) => {
  const { url, api } = req.body || {};
  const result = buildParseUrl(url, api, effectiveConfig().parsers);
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error });
  }
  result.isVideoPage = isVideoPage(result.videoUrl);
  // 附带可代理访问的 URL，浏览器 iframe 用。
  result.playUrl = proxyUrl(result.parseUrl);
  return res.json(result);
});

// 影视导航（美韩日剧模式）：直接返回目标站点 URL，无需解析。
// body: { url? } —— 省略则返回第一个默认导航站点。
app.post('/api/drama', (req, res) => {
  const { url } = req.body || {};
  const cfg = effectiveConfig();
  const sites = cfg.dramaSites;
  let target = null;

  if (url && typeof url === 'string') {
    const trimmed = url.trim();
    target = sites.find((d) => d.value === trimmed) ||
      sites.find((d) => trimmed.startsWith(d.value)) ||
      (trimmed.startsWith('http') ? { value: trimmed, label: '自定义导航' } : null);
  }

  if (!target) {
    target = sites[0];
  }

  return res.json({ ok: true, navigateUrl: target.value, playUrl: proxyUrl(target.value), label: target.label });
});

// 便捷跳转：GET /build?url=xxx&api=yyy  → 302 到构造好的解析页（可选）。
// 浏览器 iframe 建议用前端浮层 + /proxy 加载。
app.get('/build', (req, res) => {
  const url = req.query.url;
  const api = req.query.api;
  if (!url) {
    return res.status(400).send('<html><body>缺少 url 参数</body></html>');
  }
  const result = buildParseUrl(url, api, effectiveConfig().parsers);
  if (!result.ok) {
    return res.status(400).send(`<html><body>${result.error}</body></html>`);
  }
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;height:100%;background:#000}</style></head>
    <body style="height:100%"><iframe src="${result.parseUrl}" style="border:0;height:100%;width:100%" allowfullscreen></iframe>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AudioVisual Web service listening on http://0.0.0.0:${PORT}`);
});

module.exports = app;
