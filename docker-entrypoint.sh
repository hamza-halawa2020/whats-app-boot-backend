#!/bin/sh
set -eu

mkdir -p "${WWEBJS_AUTH_PATH:-/app/.wwebjs_auth}" \
  "${WWEBJS_CACHE_PATH:-/app/.wwebjs_cache}" \
  "${XDG_CONFIG_HOME:-/app/.chromium_config}" \
  "${XDG_CACHE_HOME:-/app/.chromium_cache}"

chmod -R 1777 "${WWEBJS_AUTH_PATH:-/app/.wwebjs_auth}" \
  "${WWEBJS_CACHE_PATH:-/app/.wwebjs_cache}" \
  "${XDG_CONFIG_HOME:-/app/.chromium_config}" \
  "${XDG_CACHE_HOME:-/app/.chromium_cache}" 2>/dev/null || true

exec "$@"
