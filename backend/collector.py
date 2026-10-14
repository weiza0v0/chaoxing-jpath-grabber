#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本机接收器：浏览器把书页图片推过来，这里落盘，然后触发拼 PDF。

**纯标准库，零第三方依赖。**

为什么需要这么个东西？因为图书馆平台要 CAS 登录态，而登录 cookie 是 HttpOnly
的，JS 读不出来、也就没法交给后端。所以"带认证取数"只能在浏览器里做；而落盘
和拼 PDF 这类活儿交给本地进程更稳（不受标签页内存/被回收的影响）。

接口一览::

    GET  /                      运行状态、各书进度
    GET  /frontend              把 frontend/grabber.js 原文吐出来
                                （前端检测到 HTTP 页面时，靠它把自己塞进剪贴板）
    GET  /have/<book>           该书已落盘的文件名清单，前端据此跳过已下载的页
    POST /img/<book>/<文件名>    收图片字节
    POST /order/<book>          JSON 数组，指定页序；也可用目录里的 order.txt
    POST /log                   诊断信息
    POST /build/<book>          {"title": "..."} 触发拼 PDF（后台线程）
    GET  /build/<book>          查询拼装状态

默认只监听 127.0.0.1，不对外。用法::

    python3 collector.py                 # 输出到 ../output，端口 8765
    python3 collector.py --out D:/books  # 换输出目录
    python3 collector.py --port 9000
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

__version__ = '1.0.0'

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(REPO, 'output')
FRONTEND = os.path.join(REPO, 'frontend', 'grabber.js')
BUILD_PDF = os.path.join(HERE, 'build_pdf.py')

CFG = {'out': DEFAULT_OUT, 'quiet': False}
LOG_LOCK = threading.Lock()
BUILD_LOCK = threading.Lock()
BUILDS = {}


# --------------------------------------------------------------------------
# 日志
# --------------------------------------------------------------------------


def log(msg, console=True):
    line = '[%s] %s' % (time.strftime('%H:%M:%S'), msg)
    with LOG_LOCK:
        try:
            with open(os.path.join(CFG['out'], 'collector.log'), 'a', encoding='utf-8') as f:
                f.write(line + '\n')
        except OSError:
            pass
    if console and not CFG['quiet']:
        sys.stdout.write(line + '\n')
        sys.stdout.flush()


def safe_name(s, limit=100):
    return re.sub(r'[^A-Za-z0-9._!\-]', '_', s)[:limit] or 'x'


def book_dir(book):
    d = os.path.join(CFG['out'], safe_name(book))
    os.makedirs(d, exist_ok=True)
    return d


# --------------------------------------------------------------------------
# 拼 PDF
# --------------------------------------------------------------------------


def build_async(book, title=None):
    with BUILD_LOCK:
        st = BUILDS.get(book)
        if st and st['state'] == 'running':
            return st
        BUILDS[book] = {'state': 'running', 'started': time.time(), 'pages': 0,
                        'out': '', 'error': ''}
    d = book_dir(book)
    out = os.path.join(CFG['out'], safe_name(book) + '.pdf')
    cmd = [sys.executable, BUILD_PDF, d, '-o', out, '--json']
    if title:
        cmd += ['--title', title]

    def run():
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
            if p.returncode != 0:
                BUILDS[book].update(state='error', error=(p.stderr or '')[-2000:])
                log('拼装失败 [%s]: %s' % (book, (p.stderr or '')[-300:]))
                return
            info = json.loads(p.stdout.strip().splitlines()[-1])
            BUILDS[book].update(state='done', pages=info['pages'], out=info['out'],
                                skipped=info.get('skipped', []))
            log('拼装完成 [%s] %d 页 -> %s' % (book, info['pages'], info['out']))
        except Exception as e:                                   # noqa: BLE001
            BUILDS[book].update(state='error', error=str(e))
            log('拼装异常 [%s]: %s' % (book, e))

    threading.Thread(target=run, daemon=True).start()
    log('开始拼装 [%s]' % book)
    return BUILDS[book]


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    timeout = 60

    # ---- 工具 ----
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        # 新版 Chrome 的 Private / Local Network Access 预检要求
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def _send(self, body: bytes, ctype='text/plain; charset=utf-8', code=200):
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _read(self) -> bytes:
        n = int(self.headers.get('Content-Length') or 0)
        buf = bytearray()
        while len(buf) < n:
            chunk = self.rfile.read(min(65536, n - len(buf)))
            if not chunk:
                break
            buf += chunk
        return bytes(buf)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    # ---- 路由 ----
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/have/'):
            book = urllib.parse.unquote(path[len('/have/'):])
            d = book_dir(book)
            return self._send(('\n'.join(sorted(os.listdir(d))) + '\n').encode())

        if path == '/frontend':
            try:
                with open(FRONTEND, 'rb') as f:
                    return self._send(f.read(), 'application/javascript; charset=utf-8')
            except OSError as e:
                return self._send(str(e).encode(), code=500)

        if path.startswith('/build/'):
            book = urllib.parse.unquote(path[len('/build/'):])
            return self._send(json.dumps(BUILDS.get(book, {'state': 'idle'}),
                                         ensure_ascii=False).encode(),
                              'application/json; charset=utf-8')

        if path == '/':
            books = []
            for name in sorted(os.listdir(CFG['out'])):
                full = os.path.join(CFG['out'], name)
                if os.path.isdir(full):
                    books.append('%s: %d files' % (name, len(os.listdir(full))))
            txt = ['chaoxing-jpath-grabber collector v%s' % __version__,
                   'out  = %s' % CFG['out'],
                   'books= %d' % len(books)]
            txt += ['  ' + b for b in books]
            return self._send(('\n'.join(txt) + '\n').encode())

        return self._send(b'not found', code=404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._read()

        if path.startswith('/img/'):
            parts = [p for p in urllib.parse.unquote(path[len('/img/'):]).split('/') if p]
            if len(parts) == 2:
                book, name = parts
            elif len(parts) == 1:
                book, name = 'default', parts[0]
            else:
                return self._send(b'bad path', code=400)
            d = book_dir(book)
            name = safe_name(name)
            with open(os.path.join(d, name), 'wb') as f:
                f.write(body)
            n = len(os.listdir(d))
            if n % 25 == 0:
                log('  [%s] 已收 %d 页' % (safe_name(book), n))
            return self._send(b'saved')

        if path == '/log':
            log('  %s' % body.decode('utf-8', 'replace')[:4000].replace('\n', '\n  '))
            return self._send(b'logged')

        if path.startswith('/order/'):
            book = urllib.parse.unquote(path[len('/order/'):])
            d = book_dir(book)
            try:
                order = json.loads(body.decode('utf-8'))
                assert isinstance(order, list)
            except Exception:                                     # noqa: BLE001
                return self._send(b'bad order', code=400)
            with open(os.path.join(d, 'order.txt'), 'w', encoding='utf-8') as f:
                f.write('\n'.join(str(x) for x in order) + '\n')
            log('记录页序 [%s] 共 %d 项' % (book, len(order)))
            return self._send(b'ok')

        if path.startswith('/build/'):
            book = urllib.parse.unquote(path[len('/build/'):])
            title = None
            if body:
                try:
                    title = (json.loads(body.decode('utf-8')) or {}).get('title')
                except Exception:                                 # noqa: BLE001
                    pass
            build_async(book, title)
            return self._send(json.dumps(BUILDS[book], ensure_ascii=False).encode(),
                              'application/json; charset=utf-8')

        return self._send(b'not found', code=404)

    def log_message(self, *a):
        pass


# --------------------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser(description='书页接收器（零依赖）')
    ap.add_argument('--host', default='127.0.0.1',
                    help='监听地址（默认只监听本机；改成 0.0.0.0 会有安全风险）')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--out', default=DEFAULT_OUT, help='输出根目录')
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args(argv)

    CFG['out'] = os.path.abspath(a.out)
    CFG['quiet'] = a.quiet
    os.makedirs(CFG['out'], exist_ok=True)

    if a.host not in ('127.0.0.1', 'localhost', '::1'):
        print('!! 警告：正在监听 %s，局域网内其他人也能往你硬盘写文件。' % a.host)

    print('=' * 62)
    print(' chaoxing-jpath-grabber  collector v%s' % __version__)
    print('=' * 62)
    print(' 监听    http://%s:%d' % (a.host, a.port))
    print(' 输出    %s' % CFG['out'])
    print(' 前端    %s' % FRONTEND)
    print()
    print(' 接下来：在阅读器页面 F12 → Console 里粘贴 frontend/grabber.js')
    print(' 停止：Ctrl+C')
    print('=' * 62)

    log('collector started (threaded), out=%s' % CFG['out'])
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
