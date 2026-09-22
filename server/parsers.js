// parsers.js - 从原 renderer.js 中抽出的静态数据与核心"解析"逻辑。
// 原版 Electron 应用的核心"解析"行为就是：
//   finalUrl = 解析器前缀(api) + 视频页URL(videoUrl)
// 真正的流媒体提取由第三方解析网页（jx 服务）完成，服务端只负责构造这个嵌入 URL。

/** 支持的视频平台（首页 URL，用于友好提示与匹配） */
const platforms = [
  { value: 'https://v.qq.com', label: '腾讯视频' },
  { value: 'https://www.iqiyi.com', label: '爱奇艺' },
  { value: 'https://www.youku.com', label: '优酷' },
  { value: 'https://www.bilibili.com', label: '哔哩哔哩' },
  { value: 'https://www.mgtv.com', label: '芒果TV' }
];

/** 默认解析接口列表：{label, value}，value 是带 ?url= 前缀的第三方解析地址 */
const DEFAULT_API_LIST = [
  { value: 'https://jx.xmflv.com/?url=', label: '虾米视频解析' },
  { value: 'https://jx.77flv.cc/?url=', label: '七七云解析' },
  { value: 'https://jx.playerjy.com/?url=', label: 'Player-JY' },
  { value: 'https://jiexi.789jiexi.icu:4433/?url=', label: '789解析' },
  { value: 'https://jx.2s0.cn/player/?url=', label: '极速解析' },
  { value: 'https://bd.jx.cn/?url=', label: '冰豆解析' },
  { value: 'https://jx.973973.xyz/?url=', label: '973解析' },
  { value: 'https://www.ckplayer.vip/jiexi/?url=', label: 'CK' },
  { value: 'https://jx.nnxv.cn/tv.php?url=', label: '七哥解析' },
  { value: 'https://www.yemu.xyz/?url=', label: '夜幕' },
  { value: 'https://www.pangujiexi.com/jiexi/?url=', label: '盘古' },
  { value: 'https://www.playm3u8.cn/jiexi.php?url=', label: 'playm3u8' },
  { value: 'https://video.isyour.love/player/getplayer?url=', label: '芒果TV1' },
  { value: 'https://im1907.top/?jx=', label: '芒果TV2' },
  { value: 'https://jx.hls.one/?url=', label: 'HLS解析' }
];

/** 默认"美韩日剧"影视导航站点（直接跳转，无需解析） */
const DEFAULT_DRAMA_SITES = [
  { value: 'https://www.movie1080.xyz/', label: '影巢movie' },
  { value: 'https://monkey-flix.com/', label: '猴影工坊' },
  { value: 'https://www.letu.me/', label: '茉小影' },
  { value: 'https://www.ncat21.com/', label: '网飞猫' }
];

/** 判断某 URL 是否为各平台的视频详情页（与主线 renderer.js/main.js 逻辑保持一致）。 */
function isVideoPage(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    (url.includes('iqiyi.com/v_')) ||
    (url.includes('mgtv.com/b/')) ||
    (url.includes('v.qq.com/x/cover/')) ||
    (url.includes('bilibili.com/bangumi/play/')) ||
    ((url.includes('bilibili.com/video/')) && (url.includes('?p=') || url.includes('&p='))) ||
    (url.includes('youku.com/v_show/'))
  );
}

/**
 * 核心：构造"解析/嵌入 URL"。
 * 与原版 renderer.js 的 `finalUrl = selectedApiUrl + currentVideoUrl` 完全一致。
 * @param {string} videoUrl - 原始视频页面 URL（如 iqiyi 视频页）。
 * @param {string} [api] - 解析器 value（带前缀）。省略时使用列表中的第一个解析器。
 * @param {Array} [apiList] - 可用的解析器列表（默认 DEFAULT_API_LIST，可传入服务端自定义列表）。
 * @returns {{ok:true, parseUrl:string, api:{label,value}, videoUrl:string}}
 */
function buildParseUrl(videoUrl, api, apiList) {
  if (!videoUrl || typeof videoUrl !== 'string') {
    return { ok: false, error: '缺少 videoUrl 参数。' };
  }
  let normalized = videoUrl.trim();
  if (normalized && !/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized;
  }

  const parser = resolveApi(api, apiList);
  if (!parser.ok) {
    return { ok: false, error: parser.error, videoUrl: normalized };
  }

  // 与原版一致：前缀 + 原始 URL（不重复编码，第三方解析网页自行处理）。
  const parseUrl = parser.value.startsWith('http')
    ? parser.value + normalized
    : normalized;

  return { ok: true, parseUrl, api: parser, videoUrl: normalized };
}

/**
 * 解析用户传入的 api 描述：
 *  - 直接给 value（含前缀）→ 使用；
 *  - 给 label → 在列表中查找 value；
 *  - 给 {label,value} 对象 → 使用其 value；
 *  - 未提供 → 返回列表中的第一个解析器。
 * @param {string|object} [api]
 * @param {Array} [apiList] - 可用解析器列表，默认 DEFAULT_API_LIST。
 */
function resolveApi(api, apiList) {
  const list = Array.isArray(apiList) && apiList.length ? apiList : DEFAULT_API_LIST;
  let chosen = null;

  if (!api) {
    chosen = list[0];
  } else if (typeof api === 'string') {
    // 先当作 value 精确匹配，再当作 label 匹配。
    chosen = list.find((p) => p.value === api) ||
      list.find((p) => p.label === api) ||
      // 用户可能直接输入了一个带前缀的完整解析地址。
      (isApiLike(api) ? { value: api, label: '自定义解析' } : null);
  } else if (typeof api === 'object' && api !== null) {
    chosen = api.value || (api.label ? list.find((p) => p.label === api.label) : null);
  }

  if (!chosen) {
    return { ok: false, error: '未找到匹配的解析接口。' };
  }
  if (!/^https?:\/\//i.test(chosen.value)) {
    chosen = { ...chosen, value: chosen.value + '?url=' };
  }
  return { ok: true, value: chosen.value, label: chosen.label };
}

/** 粗略判断一个串是否像"解析器"（含常见 jx 特征或 ?url= / ?jx=） */
function isApiLike(value) {
  return /(?:^https?:\/\/).*(\?url=|\?jx=|jiexi|player|jx\.)/i.test(value);
}

module.exports = {
  platforms,
  DEFAULT_API_LIST,
  DEFAULT_DRAMA_SITES,
  isVideoPage,
  buildParseUrl,
  resolveApi
};
