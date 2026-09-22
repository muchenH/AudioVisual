# AudioVisual · Web 版（Docker）

这是 `muchenH/AudioVisual` 的 **Docker / Web 版本**（分支 `docker-audiovisual`）。

原版是基于 **Electron** 的桌面应用：在页面里注入一个 iframe，把"解析接口"拼接到原始视频页 URL 上，从而播放。本版本把同样的核心逻辑抽成一个 **Node.js + Express 的 HTTP 服务**，并附带一个可直接在浏览器中使用的界面——无需安装桌面客户端，也无需 GUI。

> ⚠️ 本项目仅供学习交流使用，严禁用于任何商业用途。

---

## 核心逻辑（与原应用一致）

原版 `renderer.js` 的"解析"只做一件事：

```js
const finalUrl = selectedApiUrl + currentVideoUrl;   // 解析器前缀 + 视频页URL
window.voidAPI.embedVideo(finalUrl);                  // 把解析页嵌入播放器
```

Web 版后端据此构造出**解析/嵌入 URL**，前端再通过 iframe 直接加载，行为与原版完全一致。真正的流媒体提取由第三方解析网页完成。

---

## 目录结构

```
AudioVisual-clone/           # 原 Electron 源码（保留不变）
├── server/                  # Web 版后端（新增）
│   ├── server.js            # Express 服务 + API
│   ├── parsers.js           # 从 renderer.js 抽出的数据与解析逻辑
│   └── package.json
├── public/                  # Web 版前端（新增）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── Dockerfile               # 后端镜像（node:20-alpine）
└── docker-compose.yml
```

---

## API 说明

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/config` | 返回平台 / 解析器 / 影视导航列表 |
| POST | `/api/parse` | 输入 `{ url, api? }`，返回构造好的 `{ parseUrl }` |
| POST | `/api/drama` | 输入影视链接，返回直接跳转的导航 URL |
| GET  | `/build?url=xxx&api=yyy` | 返回可直接嵌入的 iframe 页面 |

`api` 可省略（默认使用第一个解析器），也支持传入解析器 `value`、`label` 或 `{label, value}` 对象。

---

## 快速开始（Docker）

### 方式一：docker compose（推荐）

```bash
docker compose up --build
```

启动后访问：<http://localhost:3000>

### 方式二：手动构建镜像

```bash
docker build -t audiovisual-web:latest .
docker run --name audiovisual-web -p 3000:3000 audiovisual-web:latest
```

### 自定义端口

```bash
docker compose up --build -e PORT=8080   # compose 通过 environment 传递
# 或
docker run -p 8080:3000 -e PORT=8080 audiovisual-web:latest
```

---

## 本地运行（不装 Docker）

```bash
cd server
npm install
npm start        # 监听 http://localhost:3000
```

---

## 与原版 Electron 应用的对比

| | 原版 Electron | Docker / Web 版 |
|---|---|---|
| 运行方式 | 桌面客户端（Electron） | 浏览器 + HTTP 服务 |
| 依赖 | Node + Electron | Node（Docker 镜像内） |
| 解析逻辑 | 构造 URL 并注入 iframe | 同左（抽为后端 API） |
| 平台支持 | Windows / Linux 桌面 | 任意能浏览器的平台 |
| 适合场景 | 本地桌面使用 | 服务器部署、远程访问、无桌面环境 |

---

## 免责声明

本项目是从开源项目 `muchenH/AudioVisual` 派生而来的 Web / Docker 化改造，
仅用于学习交流，请遵守相关法律法规与原作许可。
