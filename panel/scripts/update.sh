#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ange-clashboard"
APP_DIR="/opt/${APP_NAME}"
SUDO=""

if [ "${EUID}" -ne 0 ]; then
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

if [ ! -f "${APP_DIR}/compose.yaml" ] || [ ! -f "${APP_DIR}/.env" ]; then
  echo "Installation not found: ${APP_DIR}"
  exit 1
fi

cd "${APP_DIR}"
${SUDO} docker compose pull
${SUDO} docker compose up -d

echo
echo "AnGe-ClashBoard updated successfully."
echo "Data directory preserved: ${APP_DIR}/data"
