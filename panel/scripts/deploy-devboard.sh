#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bind_host="${BIND_HOST:-0.0.0.0}"
devboard_port="${PORT:-2048}"
devboard_url="http://127.0.0.1:${devboard_port}"
pid_file="$project_dir/.devboard-server.pid"

cd "$project_dir"
corepack pnpm run build

entry_asset=$(sed -n 's/.*src="\.\/\(assets\/[^\"]*\.js\)".*/\1/p' dist/index.html)

if [ -z "$entry_asset" ]; then
  echo "Unable to determine the built entry asset."
  exit 1
fi

# server/index.mjs uses node:sqlite, which requires Node 22.5+. Prefer the
# default `node` on PATH if it's new enough, otherwise fall back to a
# standalone install kept alongside it for this purpose.
pick_server_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major=$(node -e "console.log(process.versions.node.split('.')[0])")
    if [ "$major" -ge 22 ]; then
      command -v node
      return 0
    fi
  fi
  local fallback
  fallback=$(ls -d "$HOME"/.local/share/node-v2[2-9]*-darwin-*/bin/node 2>/dev/null | sort -V | tail -n1)
  if [ -n "$fallback" ]; then
    echo "$fallback"
    return 0
  fi
  return 1
}

server_node=$(pick_server_node) || {
  echo "No Node 22.5+ runtime found (required for node:sqlite). Install one and re-run."
  exit 1
}

is_devboard_up() {
  curl -fsS --max-time 2 "$devboard_url/" >/dev/null 2>&1
}

if ! is_devboard_up; then
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    kill "$(cat "$pid_file")" 2>/dev/null || true
    sleep 1
  fi

  HOST="$bind_host" PORT="$devboard_port" \
    "$server_node" "$project_dir/server/index.mjs" \
    >"$project_dir/.devboard-server.log" 2>&1 &
  echo $! >"$pid_file"

  for _ in $(seq 1 20); do
    is_devboard_up && break
    sleep 0.5
  done
fi

if ! curl -fsS --max-time 10 "$devboard_url/" | grep -Fq "$entry_asset"; then
  echo "Development board did not serve the newly built asset: $entry_asset"
  exit 1
fi

lan_ip=$(ipconfig getifaddr en0 2>/dev/null || true)
echo "Development board updated: $devboard_url ($entry_asset)"
if [ -n "$lan_ip" ]; then
  echo "Also reachable on the LAN at: http://${lan_ip}:${devboard_port}/"
fi
