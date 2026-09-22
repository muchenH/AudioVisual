# AudioVisual Web 版（Docker）—— 后端镜像。
# 复用原 Electron 应用的核心"解析"逻辑，以 HTTP 服务 + 浏览器前端的方式提供。

FROM node:20-alpine

# 避免 Alpine 下 npm 的警告并固定时区
ENV NODE_ENV=production \
    PORT=3000 \
    AV_DATA_DIR=/app/data

WORKDIR /app

# 先安装依赖以利用镜像缓存
COPY server/package.json ./server/package.json
RUN npm install --prefix /app/server --omit=dev

# 复制服务端与前端静态资源
COPY server ./server
COPY public ./public

# 设置持久化目录（compose 可挂载卷以长期保存自定义解析器/导航）。
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# 健康检查：轮询 /api/health
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
