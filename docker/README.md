# AudioVisual · Web 版（Docker）

这是 `muchenH/AudioVisual` 的 **Docker / Web 版本**：把桌面版（Electron）的观影体验搬到浏览器里，
无需安装客户端，部署在 Docker 中即可通过容器端口远程观影。

> ⚠️ 本项目仅供学习交流使用，严禁用于任何商业用途。

---

## 与桌面版一致的体验

桌面版的核心体验是"**应用内浏览平台 → 点开视频自动解析播放**"。Web 版用 **反向代理网关 + 浏览器风格前端** 复刻了它：

| 主线（Electron 桌面版） | Web / Docker 版 |
|---|---|
| `BrowserView` 内嵌平台网页 | `/proxy` 反向代理平台网页，iframe 内浏览 |
| `onHeadersReceived` 剥掉 `X-Frame-Options` / CSP | 代理层剥掉同名响应头 + 清除 CSP `<meta>` |
| `preload-web.js` 在页面内检测视频页并上报 | 代理注入**探测脚本**，`postMessage` 上报当前 URL |
| 进入视频页**自动解析**并注入播放器 | 父页面收到上报后**自动解析**，弹出**全屏播放浮层** |
| 注入 CSS 压制广告 / 弹窗 / 会员遮罩 | 探测脚本注入同样的压制样式 |
| 后退 / 前进 / 首页、平台快速切换 | 顶部工具栏：后退 / 前进 / 首页 / 地址栏 / 快捷选择 |
| 美韩日剧模式（直达导航站） | 模式开关 + 影视导航卡片与快捷下拉 |
| 设置面板自定义解析接口 / 导航（localStorage） | 设置弹窗，**服务端持久化**（Docker 卷共享） |

解析逻辑本身与主线完全一致：

```js
const finalUrl = selectedApiUrl + currentVideoUrl;   // 解析器前缀 + 视频页 URL
```

真正的流媒体提取由第三方解析网页完成，服务端只负责构造并代理这个嵌入 URL。

---

## 目录结构

```
AudioVisual-docker/
├── server/                  # Web 版后端
│   ├── server.js            # Express 服务 + API 路由
│   ├── proxy.js             # 反向代理网关（剥头 / 注脚本 / SSRF 防护）
│   ├── parsers.js           # 从 renderer.js 抽出的平台与解析逻辑
│   ├── settings.js          # 服务端设置持久化（data/settings.json）
│   └── package.json
├── public/                  # 浏览器风格前端
│   ├── index.html           # 工具栏 / 首页 / 浏览 iframe / 播放浮层 / 设置
│   ├── app.js               # 导航、自动解析、播放浮层、设置逻辑
│   └── style.css
├── check_api.py             # 后端 API 自检脚本
├── Dockerfile               # 镜像（node:20-alpine）
└── docker-compose.yml
```

---

## API 说明

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/config` | 返回平台 / 解析器 / 影视导航列表（含服务端自定义） |
| POST | `/api/parse` | 输入 `{ url, api? }`，返回 `{ parseUrl, playUrl, isVideoPage }` |
| POST | `/api/drama` | 输入影视链接，返回直接跳转的导航 URL |
| GET  | `/api/settings` | 读取服务端自定义设置 |
| POST | `/api/settings` | 保存自定义设置（`{ parsers?, dramaSites? }`，传 `null` 恢复默认） |
| POST | `/api/settings/reset` | 恢复默认设置 |
| GET  | `/proxy?url=...` | **反向代理网关**：抓取外部网页、剥头、注入探测脚本后返回 |

`api` 可省略（使用列表第一个解析器），也支持解析器 `value`、`label` 或 `{label, value}` 对象。

### 反向代理的安全边界

`/proxy` 会**拒绝**内网与本机地址（`localhost`、`127.0.0.1`、`10.x`、`172.16-31.x`、`192.168.x`、
`169.254.x` 云元数据等）以及非 `http(s)` 协议，避免被当作 SSRF 跳板。
如需在受信内网中放开，可设置环境变量 `AV_ALLOW_PRIVATE_HOSTS=1`。

---

## 快速开始（Docker）

### 方式一：docker compose（推荐）

```bash
docker compose up --build
```

启动后访问：<http://localhost:3000>

自定义解析接口与导航列表会保存在命名卷 `audiovisual-data`，重构容器不丢失。

### 方式二：手动构建镜像

```bash
docker build -t audiovisual-web:latest .
docker run --name audiovisual-web -p 3000:3000 \
  -v audiovisual-data:/app/data audiovisual-web:latest
```

### 自定义端口

```bash
# 宿主机 8080 -> 容器 3000
docker run -p 8080:3000 -e PORT=3000 audiovisual-web:latest
```

---

## 本地运行（不装 Docker）

```bash
cd server
npm install
npm start        # 监听 http://localhost:3000
```

自检后端 API：

```bash
python check_api.py http://localhost:3000
```

---

## 使用说明

1. **首页选择平台**（或直接在地址栏输入网址）进入应用内浏览。
2. 在平台页面中正常浏览，**点开任意视频详情页**时会自动解析并弹出播放浮层。
3. 播放浮层顶部可**切换解析接口**或**重新解析**；点"返回平台"回到浏览页面。
4. 顶部工具栏支持**后退 / 前进 / 首页**，快捷区可快速切换平台、解析接口或影视导航。
5. 右上角 **⚙ 设置** 可自定义解析接口与影视导航（每行 `名称|地址`），保存后服务端持久化。
6. 打开右上角开关进入 **美韩日剧模式**，直达影视导航站。

> 若某站点无法在应用内加载（部分站点对代理/嵌入限制严格），可切换解析接口重试，或直接使用地址栏粘贴视频链接解析。

---

## 已知限制

- 代理方式无法 100% 兼容所有站点的复杂 JS / 登录 / 验证码 / DRM 流程；这类站点可能需要在主机浏览器中直接访问。
- 为让平台页面正常工作（Cookie、登录、播放器脚本），浏览 iframe 需要 `allow-same-origin`；请仅在本机/可信网络部署，不要公开暴露到公网。
- 第三方解析接口的可用性由第三方决定，失败时可更换接口。

---

## 免责声明

本项目是从开源项目 `muchenH/AudioVisual` 派生而来的 Web / Docker 化改造，
仅用于学习交流，请遵守相关法律法规与原作许可。
