#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成端到端自测用的假书页（文件名是 .jpg 但内容是 PNG，跟真实平台一致）。

    python3 tests/make-fixtures.py [输出目录]
默认输出到 /tmp/jpath-fixtures，可用环境变量 FIXTURES 覆盖。
"""
import os
import sys

from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('FIXTURES', '/tmp/jpath-fixtures')
os.makedirs(OUT, exist_ok=True)

BODY = 12          # 正文页数


def mk(name, mode, size, color):
    Image.new(mode, size, color).save(os.path.join(OUT, name), format='PNG')


for i in range(1, BODY + 1):
    mk(f'{i:06d}.jpg', 'P' if i % 2 else 'L', (40, 60), 3 if i % 2 else 90)
for name, mode, size, color in [
    ('cov001.jpg', 'RGB', (44, 60), (200, 30, 30)),
    ('cov002.jpg', 'RGB', (44, 60), (30, 30, 200)),
    ('bok001.jpg', 'RGB', (44, 60), (240, 240, 240)),
    ('leg001.jpg', 'P', (44, 60), 1),
    ('fow001.jpg', 'P', (40, 60), 2),
    ('fow002.jpg', 'P', (40, 60), 2),
]:
    mk(name, mode, size, color)
for i in range(1, 4):
    mk(f'!{i:05d}.jpg', 'P', (40, 60), 4)

print('生成 %d 个测试图 -> %s' % (len(os.listdir(OUT)), OUT))
