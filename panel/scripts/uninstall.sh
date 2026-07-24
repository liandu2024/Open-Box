#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ange-clashboard"
APP_DIR="/opt/${APP_NAME}"
IMAGE="ghcr.io/liandu2024/ange-clashboard:latest"
SUDO=""

if [ "${EUID}" -ne 0 ]; then
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

if [ -f "${APP_DIR}/compose.yaml" ]; then
  cd "${APP_DIR}"
  ${SUDO} docker compose down --remove-orphans || true
fi

${SUDO} docker rm -f "${APP_NAME}" >/dev/null 2>&1 || true
${SUDO} docker image rm "${IMAGE}" >/dev/null 2>&1 || true
${SUDO} rm -rf "${APP_DIR}"

echo
echo "AnGe-ClashBoard has been fully uninstalled."
