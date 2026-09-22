// server.js - AudioVisual Web 版后端（Docker 版）。
// 复用原版 Electron 应用的核心"解析"逻辑：把视频页 URL 拼接到第三方解析器前缀，
// 生成一个可在浏览器中直接嵌入 iframe 播放的"解析/嵌入 URL"。

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

const app = express();
app.use(express.json({ limit: '1mb' }));

// 提供前端静态页面。
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查。
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'audiovisual-web', time: new Date().toISOString() });
});

// 配置：平台 / 解析器 / 影视导航列表（供前端下拉框使用）。
app.get('/api/config', (req, res) => {
  res.json({
    platforms,
    parsers: DEFAULT_API_LIST,
    dramaSites: DEFAULT_DRAMA_SITES
  });
});

// 核心：构造"解析/嵌入 URL"。
// body: { url: "<视频页URL>", api?: "<解析器 value|label|对象>" }
// 返回: { ok, parseUrl, api, videoUrl } 或 { ok:false, error }
app.post('/api/parse', (req, res) => {
  const { url, api } = req.body || {};
  const result = buildParseUrl(url, api);
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error });
  }
  // 附带是否为常见视频页的提示（与原版行为一致）。
  result.isVideoPage = isVideoPage(result.videoUrl);
  return res.json(result);
});

// 影视导航（美韩日剧模式）：直接返回目标站点 URL，无需解析。
// body: { url? } —— 省略则返回第一个默认导航站点。
app.post('/api/drama', (req, res) => {
  const { url } = req.body || {};
  let target = null;

  if (url && typeof url === 'string') {
    const trimmed = url.trim();
    target = DEFAULT_DRAMA_SITES.find((d) => d.value === trimmed) ||
      DEFAULT_DRAMA_SITES.find((d) => trimmed.startsWith(d.value)) ||
      (trimmed.startsWith('http') ? { value: trimmed, label: '自定义导航' } : null);
  }

  if (!target) {
    target = DEFAULT_DRAMA_SITES[0];
  }

  return res.json({ ok: true, navigateUrl: target.value, label: target.label });
});

// 便捷跳转：GET /?url=xxx&api=yyy  → 302 到构造好的解析页（可选）。
// 由于第三方解析页可能存在跨域/嵌出限制，这里默认只做 302 跳转，
// 前端也可自行在 iframe 中加载 `GET /build?html=1` 返回的嵌入页。
app.get('/build', (req, res) => {
  const url = req.query.url;
  const api = req.query.api;
  if (!url) {
    return res.status(400).send('<html><body>缺少 url 参数</body></html>');
  }
  const result = buildParseUrl(url, api);
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
