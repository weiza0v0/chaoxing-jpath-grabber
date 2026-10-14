#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""列出 output 目录下已经抓到的书，以及每本书的图片张数和拼装状态。

用法::

    python3 books.py            # 列默认的 ../output
    python3 books.py <目录>
"""

from __future__ import annotations

import os
import sys

IMG = ('.jpg', '.jpeg', '.png')


def main(argv):
    default = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'output')
    root = os.path.abspath(argv[1]) if len(argv) > 1 else default
    print('输出根目录: %s' % root)
    print()
    if not os.path.isdir(root):
        print('  (目录不存在，先运行 start.sh / start.bat 抓一本)')
        return 0

    rows = []
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        try:
            imgs = [f for f in os.listdir(d) if f.lower().endswith(IMG)]
        except OSError:
            continue
        pdf = os.path.join(root, name + '.pdf')
        pdf_s = ('%.1f MB' % (os.path.getsize(pdf) / 1048576)) if os.path.isfile(pdf) else '-'
        rows.append((name, len(imgs), pdf_s))

    if not rows:
        print('  (还没有抓到任何书)')
        return 0

    w = max(len(r[0]) for r in rows)
    print('  %-*s  %6s  %9s' % (w, '书标识', '图片数', 'PDF'))
    print('  ' + '-' * (w + 20))
    for name, n, pdf_s in rows:
        print('  %-*s  %6d  %9s' % (w, name, n, pdf_s))
    print()
    print('重新拼装某一本：用 make-pdf.sh / make-pdf.bat <书标识>')
    print('直接调脚本也可以：')
    print('  python3 backend/build_pdf.py "%s"' % os.path.join(root, rows[0][0]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
