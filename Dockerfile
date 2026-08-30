# syntax=docker/dockerfile:1
# bulkhaul-manage-web 多阶段构建（Node 构建 → Nginx 托管 + /api 反代）
# 构建：docker build -t blms-frontend .
# 生产由 docker-compose 编排（nginx 反代 /api → backend:8081，经 BACKEND_UPSTREAM 注入）

# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /build
# 预装依赖（层缓存）
COPY package*.json ./
RUN npm ci
# 构建静态产物
COPY . .
RUN npm run build

# ---- 运行阶段 ----
# 官方 nginx 镜像 entrypoint 自动对 /etc/nginx/templates/*.template 跑 envsubst，
# 用容器环境变量 BACKEND_UPSTREAM 替换 nginx 模板中的占位符（compose 注入 backend）
FROM nginx:1.27-alpine
ENV BACKEND_UPSTREAM=backend
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
