#!/usr/bin/env bash
# ============================================================================
# 打一个「免安装」的 Windows 分发包。
#
# 做法：把官方 Windows 嵌入式 Python（≈10 MB）连同 backend / frontend 一起
# 打进 zip。收包的人**不需要装 Python**，解压双击 start.bat 就能用。
#
# 为什么不用 conda-pack / venv：本项目零第三方依赖，打包一整个 conda 环境
# （几百 MB）只是为了让对方拿到一份 Python 标准库 —— 纯浪费。真正要解决的
# 只是「对方机器上根本没有 Python」，嵌入式解释器正好对症。
#
# 用法：
#     ./dist/build-win.sh                 # 默认 Python 3.12.7
#     PYVER=3.13.1 ./dist/build-win.sh    # 换版本
#     ./dist/build-win.sh --no-cache      # 强制重新下载
#
# 在 WSL / Linux / macOS 上都能跑（只下载 Windows 版的解释器，不执行它）。
# 产物：dist/out/jpath-grabber-win64-<版本>.zip
# ============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO/dist"
PYVER="${PYVER:-3.12.7}"
NAME="jpath-grabber-win64"
BUILD="$DIST/build"
STAGE="$BUILD/$NAME"
CACHE="$DIST/cache"
OUT="$DIST/out"
ZIPNAME="$NAME-$PYVER.zip"

NO_CACHE=0
[ "${1:-}" = "--no-cache" ] && NO_CACHE=1

say() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "需要 python3（用于解压和打包）"
command -v curl    >/dev/null 2>&1 || die "需要 curl"

# ---------------------------------------------------------------------------
# 1. 下载嵌入式 Python
#    优先国内镜像（快且不用代理），python.org 兜底。
# ---------------------------------------------------------------------------
EMBED="python-$PYVER-embed-amd64.zip"
mkdir -p "$CACHE"

# 如果仓库里已经用 fetch-runtime.bat 装好了一份嵌入式解释器，直接复用：
# 省一次 10MB 下载，而且打出来的包和你本地验证过的解释器完全一致。
LOCAL_PY="$REPO/runtime/python"
USE_LOCAL=0
if [ "$NO_CACHE" = 0 ] && [ -f "$LOCAL_PY/python.exe" ]; then
  say "复用仓库里已有的 runtime/python：$LOCAL_PY"
  USE_LOCAL=1
fi

if [ "$USE_LOCAL" = 1 ]; then
  :
elif [ "$NO_CACHE" = 1 ] || [ ! -s "$CACHE/$EMBED" ]; then
  MIRRORS=(
    "https://registry.npmmirror.com/-/binary/python/$PYVER/$EMBED"
    "https://mirrors.huaweicloud.com/python/$PYVER/$EMBED"
    "https://www.python.org/ftp/python/$PYVER/$EMBED"
  )
  ok=0
  for url in "${MIRRORS[@]}"; do
    say "下载 $url"
    # 国内镜像不必走代理；走代理反而容易被节点掐断大文件
    if curl -fsSL --noproxy '*' --retry 3 --retry-all-errors --retry-delay 2 \
            --connect-timeout 20 -o "$CACHE/$EMBED.part" "$url" 2>/dev/null; then
      mv "$CACHE/$EMBED.part" "$CACHE/$EMBED"
      ok=1; break
    fi
    # 直连失败再试一次走代理（python.org 可能需要）
    if curl -fsSL --retry 3 --retry-all-errors --retry-delay 2 \
            --connect-timeout 20 -o "$CACHE/$EMBED.part" "$url" 2>/dev/null; then
      mv "$CACHE/$EMBED.part" "$CACHE/$EMBED"
      ok=1; break
    fi
  done
  [ "$ok" = 1 ] || die "所有镜像都下载失败。可手动下载 $EMBED 放到 $CACHE/"
else
  say "使用缓存 $CACHE/$EMBED"
fi

if [ "$USE_LOCAL" = 0 ]; then
  python3 - "$CACHE/$EMBED" <<'PY' || die "下载到的不是合法 zip"
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert 'python.exe' in z.namelist(), 'zip 里没有 python.exe'
print('   zip 校验通过，%d 个文件' % len(z.namelist()))
PY
fi

# ---------------------------------------------------------------------------
# 2. 组装目录
# ---------------------------------------------------------------------------
say "组装 $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE/backend" "$STAGE/frontend" "$STAGE/python" "$STAGE/output"

if [ "$USE_LOCAL" = 1 ]; then
  cp -a "$LOCAL_PY/." "$STAGE/python/"
else
  python3 - "$CACHE/$EMBED" "$STAGE/python" <<'PY'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PY
fi
[ -f "$STAGE/python/python.exe" ] || die "组装后没有 python.exe，解释器来源有问题"

cp "$REPO/backend/collector.py"  "$STAGE/backend/"
cp "$REPO/backend/build_pdf.py"  "$STAGE/backend/"
cp "$REPO/backend/books.py"      "$STAGE/backend/"
cp "$REPO/frontend/grabber.js"   "$STAGE/frontend/"
cp "$REPO/LICENSE"               "$STAGE/LICENSE.txt"
cp "$DIST/win/start.bat"         "$STAGE/"
cp "$DIST/win/make-pdf.bat"      "$STAGE/"
cp "$DIST/win/README.txt"        "$STAGE/"

# 占位的 output 目录（zip 不记录空目录，放个说明文件保住它）
cat > "$STAGE/output/把抓到的书放在这里.txt" <<'EOF'
抓取完成后，每本书会在这里生成一个文件夹（书页原图）和一个同名 PDF。

Make PDFs land here after a grab finishes.
EOF

cat > "$STAGE/VERSION.txt" <<EOF
$NAME
built : $(date -u '+%Y-%m-%d %H:%M UTC')
python: $PYVER (Windows embeddable, bundled)
source: $([ "$USE_LOCAL" = 1 ] && echo "repo runtime/python (reused)" || echo "downloaded $EMBED")
EOF

# 打包前先自检：脚本必须是纯 ASCII
say "自检：Windows 脚本编码"
python3 - "$STAGE" <<'PY' || exit 1
import os, sys
bad = []
for root, _, files in os.walk(sys.argv[1]):
    for f in files:
        if f.lower().endswith(('.bat', '.ps1')):
            p = os.path.join(root, f)
            d = open(p, 'rb').read()
            if any(b > 127 for b in d):
                bad.append(p)
            if b'\r\n' not in d:
                bad.append(p + ' (无 CRLF)')
if bad:
    print('   以下文件不是纯 ASCII / CRLF：')
    for b in bad:
        print('     ', b)
    sys.exit(1)
print('   OK：所有 .bat/.ps1 都是纯 ASCII + CRLF')
PY

# ---------------------------------------------------------------------------
# 3. 打包
# ---------------------------------------------------------------------------
mkdir -p "$OUT"
rm -f "$OUT/$ZIPNAME"
say "打包 $OUT/$ZIPNAME"
python3 - "$STAGE" "$OUT/$ZIPNAME" <<'PY'
import os, sys, zipfile

stage, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(stage)
base = os.path.basename(stage)

# 目录在前、文件在后，Windows 资源管理器解压更稳
entries = []
for dirpath, dirnames, filenames in os.walk(stage):
    dirnames.sort()
    rel = os.path.relpath(dirpath, root)
    if dirpath != stage:
        entries.append((rel.replace(os.sep, '/') + '/', None))
    for f in sorted(filenames):
        full = os.path.join(dirpath, f)
        arc = os.path.relpath(full, root).replace(os.sep, '/')
        entries.append((arc, full))

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for arc, full in entries:
        if full is None:
            zi = zipfile.ZipInfo(arc)
            zi.external_attr = 0o40755 << 16
            z.writestr(zi, b'')
        else:
            z.write(full, arc)
print('   %d 个条目' % len(entries))
PY

SIZE=$(python3 -c "import os,sys;print('%.1f'%(os.path.getsize(sys.argv[1])/1048576))" "$OUT/$ZIPNAME")
say "完成：$OUT/$ZIPNAME  ($SIZE MB)"
echo
echo "收包的人：解压整个 zip → 双击 start.bat。不需要装 Python。"
