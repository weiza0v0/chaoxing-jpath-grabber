#!/usr/bin/env bash
# 手动重新拼 PDF（抓取结束后 collector 一般已经自动拼过了）
#
#   ./make-pdf.sh                 # 列出已抓到的书
#   ./make-pdf.sh <书标识>         # 拼这本书
#   ./make-pdf.sh <书目录> -o x.pdf
set -euo pipefail
cd "$(dirname "$0")"

OUT_ROOT="${JPATH_OUT:-$(cd .. && pwd)/output}"
PY="${PYTHON:-python3}"

if [ $# -eq 0 ]; then
  "$PY" books.py "$OUT_ROOT"
  echo
  echo "用法: ./make-pdf.sh <书标识>"
  exit 0
fi

TARGET="$1"; shift
if [ -d "$TARGET" ]; then
  DIR="$TARGET"
else
  DIR="$OUT_ROOT/$TARGET"
fi
[ -d "$DIR" ] || { echo "找不到目录: $DIR"; exit 1; }

exec "$PY" build_pdf.py "$DIR" "$@"
