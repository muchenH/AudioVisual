// proxy.js - AudioVisual Web 版反向代理网关。
//
// 目的：让"纯浏览器"也能接近主线 Electron 版的体验。
// 桌面版用 BrowserView 内嵌各平台网页，并通过 onHeadersReceived 剥掉
//   X-Frame-Options / CSP，从而能随意内嵌、在页面里注入解析播放器。
// 浏览器无法直接 iframe 这些站点（会被 X-Frame-Options/CSP 拦截），
// 所以这里由服务端代为抓取，剥掉拦截头，并注入一段"探测脚本"，
// 从而实现：应用内浏览平台 -> 点击视频页自动解析 -> 浮层播放，以及
// 广告/弹窗压制，行为与主线大体一致。

const { URL } = require('url');

// 需要被剥掉的响应头（这些会阻止 iframe/嵌入）。
const STRIP_HEADERS = [
  'x-frame-options',
  'frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp'
];

// 需要强制替换为 text/html 的 content-type（某些站点返回 text/plain 的 html）。
const HTML_CT = 'text/html';

/** 注入到每个被代理的 HTML 页面 <head> 中的探测脚本。 */
const PROBE_SCRIPT = `
<script>
(function () {
  try {
    var AV_KEY = '__avProxied__';
    if (window[AV_KEY]) { return; }
    window[AV_KEY] = true;

    function post() {
      var u = window.location.href;
      try { window.parent.postMessage({ type: 'av:url', url: u }, '*'); } catch (e) {}
    }

    // 1. 链接统一走代理，保证应用内浏览不跳出 iframe 被拦截。
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.hasAttribute('data-av-skip')) return;
      var t = (a.target || '').toLowerCase();
      // 允许 <base target="_self"> 之外的同页/锚点导航；拦截 _blank。
      if (t === '_blank') { e.preventDefault(); window.open(a.href, '_self'); return; }
      // 绝对外链统一转为代理 URL。
      var href = a.href;
      if (/^https?:/i.test(href)) {
        e.preventDefault();
        window.location.href = '/proxy?url=' + encodeURIComponent(href);
      }
    }, true);

    // 2. 表单提交也走代理（可选，多数站点用不到）。
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (!f || !f.action) return;
      var action = f.action;
      if (/^https?:\/\//i.test(action)) {
        // 交给默认动作即可（GET 会整体跳转到外部），改为代理跳转：
        if ((f.method || 'get').toLowerCase() === 'get') {
          e.preventDefault();
          var q = new URL(action);
          var url = q.href;
          var data = new FormData(f);
          for (var pair of data.entries()) q.searchParams.append(pair[0], pair[1]);
          window.location.href = '/proxy?url=' + encodeURIComponent(q.href);
        }
      }
    }, true);

    // 3. 把当前 URL 上报给父页面（父页面据此判断是否自动解析）。
    window.addEventListener('load', post);
    window.addEventListener('av:navigation', post);
    // 历史 pushState/replaceState 不触发 load，兜底轮询。
    setInterval(post, 1500);

    // 3b. 拦截 SPA 的 pushState/replaceState，保证应用内跳转不逃出代理。
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      if (typeof orig !== 'function') return;
      history[fn] = function (state, title, url) {
        var res = orig.apply(this, arguments);
        try { post(); } catch (e) {}
        return res;
      };
    });

    // 4. 压制常见广告/弹窗/会员遮罩。
    var AV_CSS = document.createElement('style');
    AV_CSS.id = 'av-anti-nuisance';
    AV_CSS.textContent = (
      'html,body{visibility:visible!important}' +
      '#playerPopup,#vipCoversBox,div.iqp-player-vipmask,div.iqp-player-paymask,' +
      'div.iqp-player-loginmask,div[class^=qy-header-login-pop],' +
      '[class*="shapedPopup_container"],[class*="notSupportedDrm_drmTipsPopBox"],' +
      '[class*="floatPage_floatPage"],#tvgCashierPage,[class*="popwin_fullCover"],' +
      '.browser-ver-tip,.videopcg-browser-tips,.qy-player-browser-tip,.iqp-browser-tip,' +
      '.iqp-player-guide,div.m-iqyGuide-layer,.loading_loading__vzq4j,' +
      '.m-pc-down,.m-pc-client,.qy-dialog-container,.iqp-client-guide,.qy-dialog-wrap,' +
      '.plugin_ctrl_txp_bottom,.mod_player_vip_ads,.playlist-overlay-minipay,' +
      '{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}'
    );
    (document.head || document.documentElement).appendChild(AV_CSS);

    // 5. 换集等点击后的 URL 变化，通过 hashchange/popstate 补充上报。
    window.addEventListener('hashchange', post);
    window.addEventListener('popstate', post);
  } catch (err) {
    if (window.console) console.error('[av-probe] init error', err);
  }
})();
</script>`;

/**
 * 判断主机名是否指向内网/本机（用于防止反向代理被当作 SSRF 跳板）。
 * 命中则拒绝代理，避免用户通过 /proxy?url= 读取容器/内网资源。
 */
function isBlockedHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // 明显的本机名。
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true;

  // IPv6 回环 / 唯一本地地址 / 链路本地。
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;

  // IPv4 私有 / 回环 / 链路本地 / 保留段。
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                         // 组播 / 保留
  }
  return false;
}

/**
 * 校验并规范化要被代理的目标 URL，仅允许 http/https，且拒绝内网地址。
 * @returns {string|null} 规范化后的绝对 URL；不合法返回 null。
 */
function normalizeTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let u = rawUrl.trim();
  if (!u) return null;
  // 仅当缺少协议时才补 https；显式给了非 http(s) 协议一律拒绝。
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // 例如 ftp: / file: / javascript:
    u = 'https://' + u;
  }
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (process.env.AV_ALLOW_PRIVATE_HOSTS !== '1' && isBlockedHost(parsed.hostname)) return null;
    return parsed.href;
  } catch (e) {
    return null;
  }
}

/** 构造指向本站代理的 URL。 */
function proxyUrl(targetAbsoluteUrl) {
  return '/proxy?url=' + encodeURIComponent(targetAbsoluteUrl);
}

/**
 * 将相对引用改写为"经本站代理"的绝对 URL。
 * 仅处理 HTML 文档中的静态引用（script/style/img/iframe/外链等）。
 * 这样即便页面有严格帧限制，子资源也能正常加载，链接跳转也能留在应用内。
 */
function rewriteHtmlLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const makeProxy = (ref) => {
    let href = ref.trim();
    if (!href) return href;
    // 忽略纯锚点、数据/脚本/资源/空白
    if (/^(#|javascript:|data:|mailto:|tel:|\s*$)/i.test(href)) return href;
    let abs;
    try {
      abs = new URL(href, base.href).href;
    } catch (e) {
      return ref;
    }
    return proxyUrl(abs);
  };

  let out = html;
  // <base href="..."> -> 指向真实站点，让子资源按原站点解析，但导航走代理接管。
  out = out.replace(/<base[^>]*href=["'][^"']*["'][^>]*>/gi, () => `<base href="${base.origin}${base.pathname}" target="_self">`);

  // 外链/脚本/样式/图片/iframe/form 的 src|href|action：
  // 仅把"跨域或相对"且属于导航性质的链接改为代理；同源子资源不代理以避免循环。
  // 简化策略：所有 http(s) 与相对 link 都经代理，保证后续导航不出 app。
  const rewriteAttr = (full, prefix, name, quote, value) => {
    const v = value;
    if (!v || /^(#|javascript:|data:|mailto:|\s*$)/i.test(v)) return full;
    const isStylesheet = /stylesheet/i.test(full);
    // 直接子资源（css/js/图片/字体/媒体）保留原地址，避免代理链过长与循环。
    if (/\.(css|js|png|jpe?g|gif|svg|webp|woff2?|ttf|otf|ico|mp4|webm|mp3|m3u8)(\?|#|$)/i.test(v)) {
      return prefix + name + '=' + quote + v + quote;
    }
    return prefix + name + '=' + quote + makeProxy(v) + quote;
  };

  // 处理 <link href>, <a href>, <script src>, <img src/srcset>, <iframe src>, <form action>, <video/audio/source src>
  // 这里用一个正则分批处理，覆盖 src 与 href 属性。
  out = out.replace(/(\s(?:href|src|action)\s*=\s*)(["'])(.*?)\2/gi,
    (full, pre, q, val) => rewriteAttr(full, pre + q, '', q, val));

  return out;
}

/**
 * 把一段 HTML 文档"代理化"：改写链接、注入探测脚本、清除可能阻挡的 meta CSP。
 */
function proxifyDocument(html, targetUrl) {
  let out = html;
  // 清除 <meta http-equiv="Content-Security-Policy"> / X-UA-Compatible 等阻挡项。
  out = out.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  out = out.replace(/<meta[^>]*http-equiv=["']?x-frame-options["']?[^>]*>/gi, '');
  out = out.replace(/<meta[^>]*http-equiv=["']?x-ua-compatible["']?[^>]*>/gi, '');

  try {
    out = rewriteHtmlLinks(out, targetUrl);
  } catch (e) {
    // 链接改写失败不阻断，探测脚本仍会接管点击。
    if (typeof e === 'object' && e && e.message) {
      // ignore
    }
  }

  // 注入探测脚本到 <head> 开头，保证先行加载。
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (match) => match + PROBE_SCRIPT);
  } else {
    out = PROBE_SCRIPT + out;
  }
  return out;
}

/**
 * 根据响应头判断 HTTP Redirect 的 Location 是否应改为代理 URL。
 */
function proxyRedirectLocation(location, targetUrl) {
  if (!location) return location;
  const absolute = (() => {
    try {
      return new URL(location, targetUrl).href;
    } catch (e) {
      return location;
    }
  })();
  if (/^https?:/i.test(absolute)) return proxyUrl(absolute);
  return location;
}

/**
 * 抓取外部 URL（Node 20 自带 fetch）。
 * 返回 { status, headers, body, isHtml }；失败抛错。
 */
async function fetchTarget(targetUrl, extraHeaders = {}) {
  const timeoutMs = 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...extraHeaders
      }
    });
    const contentType = resp.headers.get('content-type') || '';
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType) ||
      !contentType || /^text\//i.test(contentType);
    const body = await resp.text();
    // resp.url 是跟随重定向后的最终地址；链接改写必须基于它，
    // 否则相对路径会按重定向前的 URL 解析而出错。
    const finalUrl = resp.url || targetUrl;
    return { status: resp.status, headers: resp.headers, body, isHtml, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  normalizeTarget,
  isBlockedHost,
  proxyUrl,
  proxifyDocument,
  proxyRedirectLocation,
  fetchTarget,
  HTML_CT,
  STRIP_HEADERS
};
