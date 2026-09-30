# 多阶段构建：先构建前端，再组装运行时镜像。
#
# 基础镜像选 Alpine 是为了体积；已实测 node:sqlite（服务端持久层依赖的
# Node 内置模块）在 musl 上可正常工作，不需要编译原生扩展。

# ---------- 阶段 1：构建前端 ----------
FROM node:24-alpine AS build

WORKDIR /build

# 先只拷贝清单文件，让依赖层能被缓存 —— 改业务代码时不必重装依赖
COPY app/package.json app/package-lock.json ./app/
RUN npm --prefix app ci --no-audit --no-fund

# vite.config.ts 里 outDir 是 '../server/public'（相对 app/ 解析），
# 所以构建产物会落到 /build/server/public
COPY app ./app
RUN npm --prefix app run build


# ---------- 阶段 2：运行时 ----------
FROM node:24-alpine AS runtime

# tini 负责转发信号并回收僵尸进程；compose 里 stop 时服务端能收到 SIGTERM 正常收尾
RUN apk add --no-cache tini

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    # 数据库与上传的照片都放在这个目录，便于挂卷持久化
    UBR_DATA_DIR=/data

# 只装服务端的生产依赖（express），不进前端依赖
COPY --chown=node:node server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev --no-audit --no-fund

# 用 --chown 逐项指定属主，而不是最后统一 chown -R。
# 后者会让 chown 递归改写 /app 下所有文件，等于把整份内容再复制一层
# （实测多出 77MB，几乎与 tiles+data+依赖 的总和相当）。
COPY --chown=node:node server ./server
COPY --chown=node:node --from=build /build/server/public ./server/public

# 地图瓦片与官方点位数据：打进镜像做到开箱即用
# （也可以用卷覆盖，方便单独更新瓦片而不重新构建镜像）
COPY --chown=node:node tiles ./tiles
COPY --chown=node:node data ./data

# 只给空的数据目录设属主；/app 已在上面逐项处理过
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8787

# Alpine 自带 wget（busybox），不必额外装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.mjs"]