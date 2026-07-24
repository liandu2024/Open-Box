#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ange-clashboard"
APP_DIR="/opt/${APP_NAME}"
DATA_DIR="${APP_DIR}/data"
IMAGE="ghcr.io/liandu2024/ange-clashboard:latest"
DEFAULT_PORT="2048"
PORT="${1:-$DEFAULT_PORT}"
SUDO=""

if [ "${EUID}" -ne 0 ]; then
  SUDO="sudo"
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid port: ${PORT}"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

${SUDO} mkdir -p "${DATA_DIR}"

${SUDO} tee "${APP_DIR}/.env" >/dev/null <<EOF
PORT=${PORT}
IMAGE=${IMAGE}
EOF

${SUDO} tee "${APP_DIR}/compose.yaml" >/dev/null <<'EOF'
services:
  ange-clashboard:
    image: ${IMAGE}
    container_name: ange-clashboard
    ports:
      - "${PORT}:2048"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
EOF

cd "${APP_DIR}"
${SUDO} docker compose pull
${SUDO} docker compose up -d

echo
echo "AnGe-ClashBoard installed successfully."
echo "URL: http://<your-server-ip>:${PORT}"
echo "App dir: ${APP_DIR}"
