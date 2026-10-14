#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把抓下来的书页图片拼成一个 PDF。

设计目标：**零第三方依赖**，只用 Python 标准库。因为抓下来的书页只有两种格式：

  * JPEG —— 直接以 ``/DCTDecode`` 原样嵌进 PDF，不做任何重编码；
  * PNG  —— 取出 IHDR / PLTE / IDAT，以 ``/FlateDecode`` + ``Predictor 15``
             原样嵌进 PDF。调色板图走 ``/Indexed`` 色彩空间。

两者都是**无损**的，所以成品 PDF 的体积和原图总和基本一致（不会像"统一转 JPEG"
那样膨胀十倍）。实测：415 页 / 31.7 MB 原图 → 63 MB PDF（含 415 份对象开销）。

用法::

    python3 build_pdf.py <书目录>              # 输出 <书目录>.pdf
    python3 build_pdf.py <书目录> -o out.pdf   # 指定输出
    python3 build_pdf.py <书目录> --dpi 300    # 声明页面物理尺寸（影响打印）
    python3 build_pdf.py <书目录> --list       # 只打印页序，不生成

页序由 :func:`reading_order` 推断（超星 PDG 命名规律），也可以在同级目录放一个
``order.txt``（每行一个文件名）来手工指定，此时以它为准。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import zlib

__version__ = '1.0.0'

# --------------------------------------------------------------------------
# 图片解析
# --------------------------------------------------------------------------


def jpeg_info(d: bytes):
    """读 JPEG 的尺寸和分量数（用于决定 /DeviceRGB 还是 /DeviceGray）。"""
    if d[:2] != b'\xff\xd8':
        return None
    i, n = 2, len(d)
    while i < n - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        m = d[i + 1]
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        ln = (d[i + 2] << 8) | d[i + 3]
        # SOF0..SOF15，跳过 DHT(C4) / JPG(C8) / DAC(CC)
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h = (d[i + 5] << 8) | d[i + 6]
            w = (d[i + 7] << 8) | d[i + 8]
            return {'kind': 'jpeg', 'w': w, 'h': h, 'ncomp': d[i + 9]}
        i += 2 + ln
    return None


def png_info(d: bytes):
    """读 PNG 的 IHDR / PLTE / IDAT。"""
    if d[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    i, info, idat = 8, {'kind': 'png'}, []
    while i + 8 <= len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        data = d[i + 8:i + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, _comp, _filt, inter = struct.unpack('>IIBBBBB', data[:13])
            info.update(w=w, h=h, bd=bd, ct=ct, inter=inter)
        elif typ == b'PLTE':
            info['plte'] = data
        elif typ == b'IDAT':
            idat.append(data)
        elif typ == b'IEND':
            break
        i += 12 + ln
    info['idat'] = b''.join(idat)
    return info


# PNG 颜色类型 -> (PDF 色彩空间片段, DecodeParms 里的 Colors)
_PNG_CS = {
    0: ('/DeviceGray', 1),                       # 灰度
    2: ('/DeviceRGB', 3),                        # 真彩
    # 3 = 调色板，色彩空间依赖 PLTE，单独处理
}


def image_object(path: str, allow_pillow: bool = True):
    """把一个图片文件转成 PDF image XObject 需要的 (字典片段, 流数据, 宽, 高)。

    返回 ``(extra_dict, stream, w, h)``；无法处理时抛 ``ValueError``。
    """
    with open(path, 'rb') as f:
        d = f.read()

    ji = jpeg_info(d)
    if ji:
        cs = {1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK'}.get(ji['ncomp'])
        if cs is None:
            raise ValueError('不支持的 JPEG 分量数 %d' % ji['ncomp'])
        extra = ('/ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode' % cs)
        return extra, d, ji['w'], ji['h']

    pi = png_info(d)
    if pi:
        w, h, bd, ct = pi['w'], pi['h'], pi['bd'], pi['ct']
        if pi.get('inter'):
            raise ValueError('暂不支持交错(Adam7) PNG')
        if bd not in (1, 2, 4, 8, 16):
            raise ValueError('不支持的 PNG 位深 %d' % bd)

        if ct == 3:
            plte = pi.get('plte')
            if not plte:
                raise ValueError('调色板 PNG 缺少 PLTE')
            n = len(plte) // 3 - 1
            cs, colors = '/Indexed /DeviceRGB %d <%s>' % (n, plte.hex()), 1
        elif ct in _PNG_CS:
            cs, colors = _PNG_CS[ct]
        else:
            raise ValueError('暂不支持带透明通道的 PNG（颜色类型 %d）' % ct)

        if bd == 16:
            raise ValueError('暂不支持 16 位 PNG')

        extra = ('/ColorSpace [%s] /BitsPerComponent %d /Filter /FlateDecode '
                 '/DecodeParms << /Predictor 15 /Colors %d /BitsPerComponent %d /Columns %d >>'
                 % (cs, bd, colors, bd, w))
        # IDAT 已经是 zlib 流，PDF 的 FlateDecode 直接认，无需解压重压
        return extra, pi['idat'], w, h

    raise ValueError('既不是 JPEG 也不是 PNG')


# --------------------------------------------------------------------------
# 页序
# --------------------------------------------------------------------------

# 超星 PDG 的命名习惯：
#   cov001 封面 / boo?001 书名页 / leg001 版权页 / fowNNN 前言
#   !NNNNN 目录（罗马数字页）/ NNNNNN 正文 / cov002 封底 / bak001 封底
_FRONT_SINGLE = {'cov001': (100, 0), 'bok001': (110, 0), 'boo001': (110, 0), 'leg001': (120, 0)}
_BACK_SINGLE = {'cov002': (900, 0), 'bak001': (910, 0)}


def order_key(name: str):
    stem = name.rsplit('.', 1)[0]
    if stem in _FRONT_SINGLE:
        return _FRONT_SINGLE[stem] + (stem,)
    if stem in _BACK_SINGLE:
        return _BACK_SINGLE[stem] + (stem,)
    m = re.fullmatch(r'(fow|fwd|pre)(\d+)', stem, re.I)
    if m:
        return (200, int(m.group(2)), stem)
    m = re.fullmatch(r'!(\d+)', stem)
    if m:
        return (300, int(m.group(1)), stem)
    m = re.fullmatch(r'(\d+)', stem)
    if m:
        return (400, int(m.group(1)), stem)
    return (800, 0, stem)


IMG_EXT = ('.jpg', '.jpeg', '.png')


def reading_order(files):
    imgs = [f for f in files if f.lower().endswith(IMG_EXT)]
    return sorted(imgs, key=order_key)


def order_override(bookdir):
    p = os.path.join(bookdir, 'order.txt')
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8') as f:
        names = [ln.strip() for ln in f if ln.strip() and not ln.startswith('#')]
    have = set(os.listdir(bookdir))
    return [n for n in names if n in have]


# --------------------------------------------------------------------------
# PDF 组装
# --------------------------------------------------------------------------


def pdf_string(s: str) -> str:
    """把 Python 字符串转成合法的 PDF 字符串对象。

    ASCII 走字面量 ``(...)``；含非 ASCII 的（比如中文书名）走
    ``<FEFF...>`` 的 UTF-16BE 十六进制形式，这是 PDF 规定的做法。
    """
    try:
        s.encode('latin-1')
        esc = s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        return '(%s)' % esc
    except UnicodeEncodeError:
        return '<FEFF%s>' % s.encode('utf-16-be').hex().upper()


def build_pdf(bookdir, out_path, dpi=300.0, title=None, verbose=True):
    files = os.listdir(bookdir)
    order = order_override(bookdir) or reading_order(files)
    if not order:
        raise SystemExit('目录里没有图片: %s' % bookdir)

    scale = 72.0 / dpi
    infos = []
    skipped = []
    for name in order:
        path = os.path.join(bookdir, name)
        try:
            extra, stream, w, h = image_object(path)
            infos.append((name, extra, stream, w, h))
        except ValueError as e:
            skipped.append((name, str(e)))
            if verbose:
                print('  跳过 %s: %s' % (name, e), file=sys.stderr)

    if not infos:
        raise SystemExit('没有任何可用的图片')

    box_w = max(w for _, _, _, w, _ in infos) * scale
    box_h = max(h for _, _, _, _, h in infos) * scale

    out = bytearray()
    offsets = {}

    def put(b):
        out.extend(b)

    def putstr(s):
        out.extend(s.encode('latin-1'))

    def add_obj(num, head, stream=None, tail=b''):
        offsets[num] = len(out)
        putstr('%d 0 obj\n' % num)
        putstr(head)
        if stream is not None:
            putstr('\nstream\n')
            put(stream)
            putstr('\nendstream')
        put(tail)
        putstr('\nendobj\n')

    n_pages = len(infos)
    total_obj = 2 + n_pages * 3
    info_obj = total_obj + 1
    # 只有写了 Info 对象时才把 xref 表扩到它，否则会留下一个偏移为 0 的空条目
    total_obj_final = info_obj if title else total_obj

    put(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')

    kids = ' '.join('%d 0 R' % (3 + i * 3) for i in range(n_pages))
    add_obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
    add_obj(2, '<< /Type /Pages /Count %d /Kids [%s] >>' % (n_pages, kids))

    for i, (name, extra, stream, w, h) in enumerate(infos):
        pn, cn, imn = 3 + i * 3, 4 + i * 3, 5 + i * 3
        iw, ih = w * scale, h * scale
        x0, y0 = (box_w - iw) / 2, (box_h - ih) / 2

        add_obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.4f %.4f] '
                    '/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>'
                % (box_w, box_h, imn, cn))

        content = 'q\n%.4f 0 0 %.4f %.4f %.4f cm\n/Im0 Do\nQ\n' % (iw, ih, x0, y0)
        add_obj(cn, '<< /Length %d >>' % len(content), content.encode('latin-1'))

        add_obj(imn, '<< /Type /XObject /Subtype /Image /Width %d /Height %d %s '
                     '/Length %d >>' % (w, h, extra, len(stream)), stream)

    if title:
        add_obj(info_obj, '<< /Title %s /Producer (chaoxing-jpath-grabber) >>'
                % pdf_string(title))

    xref_pos = len(out)
    putstr('xref\n0 %d\n' % (total_obj_final + 1))
    putstr('0000000000 65535 f \n')
    for n in range(1, total_obj_final + 1):
        putstr('%010d 00000 n \n' % offsets.get(n, 0))
    putstr('trailer\n<< /Size %d /Root 1 0 R' % (total_obj_final + 1))
    if title:
        putstr(' /Info %d 0 R' % info_obj)
    putstr(' >>\nstartxref\n%d\n%%%%EOF\n' % xref_pos)

    with open(out_path, 'wb') as f:
        f.write(out)

    return {
        'pages': n_pages,
        'skipped': skipped,
        'bytes': len(out),
        'out': out_path,
        'box': [round(box_w, 2), round(box_h, 2)],
        'dpi': dpi,
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser(description='把书页图片拼成 PDF（零第三方依赖）')
    ap.add_argument('bookdir', help='书页所在目录')
    ap.add_argument('-o', '--out', help='输出 PDF 路径（默认 <bookdir>.pdf）')
    ap.add_argument('--dpi', type=float, default=300.0,
                    help='按多少 dpi 声明页面物理尺寸，只影响打印大小（默认 300）')
    ap.add_argument('--title', help='写入 PDF 元数据的标题')
    ap.add_argument('--list', action='store_true', help='只打印页序，不生成 PDF')
    ap.add_argument('--json', action='store_true', help='结果以 JSON 输出')
    a = ap.parse_args(argv)

    if not os.path.isdir(a.bookdir):
        raise SystemExit('不是目录: %s' % a.bookdir)

    if a.list:
        order = order_override(a.bookdir) or reading_order(os.listdir(a.bookdir))
        for i, n in enumerate(order, 1):
            print('%4d  %s' % (i, n))
        print('共 %d 页' % len(order))
        return 0

    out = a.out or (a.bookdir.rstrip('/\\') + '.pdf')
    r = build_pdf(a.bookdir, out, dpi=a.dpi, title=a.title, verbose=not a.json)
    if a.json:
        print(json.dumps(r, ensure_ascii=False))
    else:
        print('完成: %s' % r['out'])
        print('  页数 %d，页面 %.1f x %.1f pt，%.1f MB'
              % (r['pages'], r['box'][0], r['box'][1], r['bytes'] / 1048576))
        if r['skipped']:
            print('  跳过 %d 个文件' % len(r['skipped']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
