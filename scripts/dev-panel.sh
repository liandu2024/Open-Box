#!/usr/bin/env bash
# Open-Box 面板本地开发:构建 + (重)启动 + 健康检查
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
panel_dir="$repo_root/panel"
pid_file="$repo_root/.dev-panel.pid"
port="${PORT:-2026}"
export PATH="$HOME/.local/share/node-v24.18.0-darwin-arm64/bin:$PATH"

cd "$panel_dir"
[[ -d node_modules ]] || corepack pnpm install
corepack pnpm run build

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  kill "$(cat "$pid_file")" 2>/dev/null || true
  sleep 1
fi

PORT="$port" nohup node server/index.mjs >"$repo_root/.dev-panel.log" 2>&1 &
echo $! >"$pid_file"

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null; then
    echo "Open-Box panel OK: http://127.0.0.1:$port"
    exit 0
  fi
  sleep 0.5
done
echo "FAIL: panel 未通过健康检查,日志见 .dev-panel.log" >&2
exit 1
