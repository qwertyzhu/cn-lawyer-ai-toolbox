#!/usr/bin/env bash
# ==============================================================================
# 中国律师 AI 工具箱 (CN Lawyer AI Toolbox) — 通用 Linux 服务器部署模板
# 用法: bash ops/deploy.sh root@YOUR_SERVER_IP your-domain.com
# 前置: 目标服务器建议安装 Node 20+、Nginx 与 poppler-utils（用于 PDF 正文提取）
# ==============================================================================
set -Eeuo pipefail

if [[ $# -lt 2 ]]; then
  echo "用法: bash ops/deploy.sh <user@server-ip> <domain>"
  echo "示例: bash ops/deploy.sh root@203.0.113.10 toolbox.example.com"
  exit 1
fi

REMOTE="$1"
DOMAIN="$2"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/opt/cn-lawyer-ai-toolbox"

cd "$PROJECT_DIR"

echo "==> [1/3] 本地构建离线 PWA 生产包..."
npm run build

echo "==> [2/3] 同步构建产物与轻量网关至 ${REMOTE}:${APP_DIR}..."
ssh "$REMOTE" "mkdir -p ${APP_DIR}/dist ${APP_DIR}/server"
COPYFILE_DISABLE=1 tar -czf - \
  -C "$PROJECT_DIR" dist server package.json \
  | ssh "$REMOTE" "tar -xzf - -C ${APP_DIR}"

echo "==> [3/3] 配置 systemd 守护进程（若需 HTTPS 请配合 Nginx + Certbot）..."
ssh "$REMOTE" "APP_DIR='${APP_DIR}' bash -s" <<'EOF'
set -Eeuo pipefail
cat > /etc/systemd/system/cn-lawyer-toolbox.service <<EOS
[Unit]
Description=CN Lawyer AI Toolbox Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=BIND_HOST=127.0.0.1
Environment=PORT=3681
ExecStart=/usr/bin/node ${APP_DIR}/server/index.mjs
Restart=always
RestartSec=3
MemoryMax=256M

[Install]
WantedBy=multi-user.target
EOS
systemctl daemon-reload
systemctl enable --now cn-lawyer-toolbox.service
systemctl restart cn-lawyer-toolbox.service
EOF

echo "✅ 部署完成！请在 Nginx 中反向代理 ${DOMAIN} -> http://127.0.0.1:3681 并启用 HTTPS。"
