#!/usr/bin/env bash
# chaoxing-jpath-grabber —— Linux / macOS 启动脚本
#
# 本项目**零第三方依赖**，只用 Python 标准库。所以这里不装 pip 包，
# 只负责：找到可用的 Python 3.8+（没有就尝试用系统包管理器装上），
# 做个标准库自检，然后把 collector 跑起来。
set -euo pipefail
cd "$(dirname "$0")"

need_py() {
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 &&
       "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
      printf '%s' "$c"; return 0
    fi
  done
  return 1
}

install_py() {
  echo "→ 没找到 Python 3.8+，尝试自动安装…"
  if command -v apt-get >/dev/null 2>&1; then
    read -r -p "  用 apt-get 安装 python3？[y/N] " a
    [ "${a:-n}" = y ] || return 1
    sudo apt-get update && sudo apt-get install -y python3
  elif command -v dnf >/dev/null 2>&1; then
    read -r -p "  用 dnf 安装 python3？[y/N] " a
    [ "${a:-n}" = y ] || return 1
    sudo dnf install -y python3
  elif command -v yum >/dev/null 2>&1; then
    read -r -p "  用 yum 安装 python3？[y/N] " a
    [ "${a:-n}" = y ] || return 1
    sudo yum install -y python3
  elif command -v pacman >/dev/null 2>&1; then
    read -r -p "  用 pacman 安装 python？[y/N] " a
    [ "${a:-n}" = y ] || return 1
    sudo pacman -S --noconfirm python
  elif command -v brew >/dev/null 2>&1; then
    read -r -p "  用 Homebrew 安装 python3？[y/N] " a
    [ "${a:-n}" = y ] || return 1
    brew install python3
  elif command -v apk >/dev/null 2>&1; then
    read -r -p "  用 apk 安装 python3？[y/N] " a
    [ "${a:-n}" = y ] || return 1
    sudo apk add python3
  else
    return 1
  fi
}

PY="$(need_py || true)"
if [ -z "$PY" ]; then
  install_py || true
  PY="$(need_py || true)"
fi
if [ -z "$PY" ]; then
  cat <<'EOF'
✘ 仍然没有可用的 Python 3.8+。
  请手动安装后重试：
    Ubuntu/Debian : sudo apt install python3
    Fedora        : sudo dnf install python3
    Arch          : sudo pacman -S python
    macOS         : brew install python3
  下载页        : https://www.python.org/downloads/
EOF
  exit 1
fi

echo "→ Python: $PY ($("$PY" -V 2>&1))"
"$PY" - <<'EOF'
import http.server, json, os, re, struct, subprocess, sys, zlib  # noqa: F401
print("→ 标准库自检通过（本项目零第三方依赖，无需 pip install）")
EOF

exec "$PY" collector.py "$@"
