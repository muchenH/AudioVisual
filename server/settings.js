// settings.js - 服务端设置持久化。
// 主线 Electron 版把"自定义解析接口/影视导航"存在 localStorage。
// Web 版由服务端统一存到 data/settings.json（可放在 Docker volume），
// 让部署的所有用户共享同一份自定义列表，也更贴合服务端形态。

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.AV_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = process.env.AV_SETTINGS_FILE || path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  parsers: null, // null 表示使用后端默认列表
  dramaSites: null
};

let cache = null;

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // 只读环境（如无卷的健康检查容器）下忽略，回退到内存。
  }
}

function read() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      parsers: Array.isArray(parsed.parsers) ? parsed.parsers : null,
      dramaSites: Array.isArray(parsed.dramaSites) ? parsed.dramaSites : null
    };
  } catch (e) {
    // 无文件或损坏 -> 使用默认
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

function write(next) {
  const merged = {
    parsers: Array.isArray(next.parsers) ? next.parsers : null,
    dramaSites: Array.isArray(next.dramaSites) ? next.dramaSites : null
  };
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(FILE, JSON.stringify(merged, null, 2), 'utf8');
    cache = merged;
    return true;
  } catch (e) {
    cache = merged;
    return false;
  }
}

function get() {
  return read();
}

function set(patch) {
  const current = read();
  return write({ ...current, ...patch });
}

function reset() {
  cache = { ...DEFAULT_SETTINGS };
  try {
    ensureDir(DATA_DIR);
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { get, set, reset };
