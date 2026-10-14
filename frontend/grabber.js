/* ============================================================================
 * chaoxing-jpath-grabber —— 浏览器端脚本
 *
 * 用途：把超星 jpath 阅读器（reader.shtml）里的整本书页抓下来，推给本机
 *       collector，由它落盘并拼成 PDF。
 *
 * 用法：打开阅读器页面 → F12 → Console → 粘贴本文件 → 回车。
 *
 * 原理：书页是画在 <canvas> 上的，DOM 里没有 <img>，所以只能从网络记录
 *       (performance) 里还原出真实图片地址，形如
 *         https://<host>/jpath/img/<书目录长hex>/0/0/<32位hex>/000078.jpg?zoom=0
 *       实测这条前缀**对整本书是固定的**，所以可以按页号直接枚举，不必滚动。
 *
 * 若当前是 http://<host>:9088（教材平台「本地全文」的默认入口），图片会 302
 * 跳到 https 的 png.dll，属于跨源、必被 CORS 拦截。脚本会自动跳到 https，
 * 并把自身源码塞进剪贴板，你只要 Ctrl+V 再回车一次。
 * ========================================================================== */
(() => {
  'use strict';

  /* ======================= 配置 ======================= */
  const COL = 'http://127.0.0.1:8765';   // 本机 collector
  const CFG = {
    mode: 'auto',          // auto | direct | scroll
    maxPage: 2000,         // 正文页号搜索上限
    concurrency: 5,        // 同时下载几页
    maxFow: 40,            // 前言类最多探到 fow0NN
    maxBang: 99,           // 目录类（!NNNNN）最多探到多少
    scrollStep: 1.15,      // 滚动兜底模式：每步滚多少倍可视高度
    scrollMaxSteps: 2000,
    scrollIdleStop: 30,
  };

  const TAG = '%c[jpath-grabber]';
  const CSS = 'color:#0aa;font-weight:700';
  const log = (...a) => console.log(TAG, CSS, ...a);
  const warn = (...a) => console.warn(TAG, 'color:#e60;font-weight:700', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (window.__jpathGrabberBusy) {
    warn('脚本已经在运行了，看右下角面板。想重来请刷新页面。');
    return;
  }
  window.__jpathGrabberBusy = true;

  /* ======================= 1. HTTP → HTTPS ======================= */
  /* 图片会从 http://host:9088 跳到 https://host/iis/png/png.dll，
     跨协议=跨源，fetch 必被 CORS 挡住。所以先把页面切到 https 同源。 */
  if (location.protocol === 'http:') {
    const u = new URL(location.href);
    u.protocol = 'https:';
    u.port = '';
    (async () => {
      let copied = false;
      try {
        const r = await fetch(COL + '/frontend');
        if (r.ok) {
          const src = await r.text();
          copy(src);                       // 只有 DevTools 控制台里有这个函数
          copied = true;
        }
      } catch (e) { /* collector 没开就算了 */ }
      alert('需要先切到 HTTPS 同源（书页图片会跳到 https，否则被 CORS 拦）。\n\n' +
            '点确定后自动跳转。' +
            (copied ? '\n\n脚本源码已放进剪贴板 —— 跳过去后直接 Ctrl+V 再回车即可。'
                    : '\n\n跳过去后请再粘贴一次本脚本。'));
      location.replace(u.href);
    })();
    return;
  }

  /* ======================= 2. 书标识 / 面板 ======================= */
  const qs = new URLSearchParams(location.search);
  const bookId = ('ssno' + (qs.get('ssno') || 'x') + '_' + (qs.get('code') || 'x').slice(0, 8))
    .replace(/[^A-Za-z0-9._-]/g, '_');

  const old = document.getElementById('jpathGrabberPanel');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'jpathGrabberPanel';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#eee;' +
    'font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:12px 14px;border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.45);width:320px';
  panel.innerHTML =
    '<div style="font-weight:700;margin-bottom:6px">jpath-grabber</div>' +
    '<div style="color:#9ad">状态：<b id="jst" style="color:#0ff">启动中…</b></div>' +
    '<div style="color:#9ad">已收 <b id="jc" style="color:#0ff">0</b> 页　跳过 <b id="jh" style="color:#8cf">0</b>　失败 <b id="jf" style="color:#f99">0</b></div>' +
    '<div id="jm" style="color:#bbb;font-size:12px;margin:4px 0 8px;word-break:break-all">—</div>' +
    '<button id="jx" style="width:100%;padding:6px;border:0;border-radius:6px;background:#a33;color:#fff;cursor:pointer">停止</button>';
  (document.body || document.documentElement).appendChild(panel);
  const $st = panel.querySelector('#jst');
  const $c = panel.querySelector('#jc');
  const $h = panel.querySelector('#jh');
  const $f = panel.querySelector('#jf');
  const $m = panel.querySelector('#jm');
  let stopped = false;
  panel.querySelector('#jx').onclick = () => { stopped = true; $st.textContent = '已手动停止'; };

  const postLog = (t) => {
    try {
      fetch(COL + '/log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: String(t) })
        .catch(() => {});
    } catch (e) { /* ignore */ }
  };

  /* ======================= 3. 等阅读器就绪 ======================= */
  const PREFIX_RE = /^(https?:\/\/[^/]+\/jpath\/img\/[^/]+\/[0-9A-Fa-f]+\/\d+\/\d+\/[0-9a-f]+\/)/;

  function scanPrefix() {
    for (const e of performance.getEntriesByType('resource')) {
      const m = e.name.match(PREFIX_RE);
      if (m) return m[1];
    }
    return null;
  }

  async function waitPrefix(timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const p = scanPrefix();
      if (p) return p;
      // 主动推一把：如果阅读器还没请求任何书页，滚一下促使它加载
      const r = document.querySelector('div.reader');
      if (r && r.scrollTop === 0) r.scrollTop = 1;
      await sleep(500);
    }
    return null;
  }

  /* ======================= 4. 下载 & 落盘 ======================= */
  let prefix = null;
  const have = new Set();     // 本机已有
  const saved = new Set();    // 本次成功
  const failed = new Set();   // 本次失败
  const order = [];           // 阅读顺序
  let bytes = 0, queue = [], inflight = 0;

  function upd() {
    $c.textContent = saved.size;
    $h.textContent = have.size;
    $f.textContent = failed.size;
  }

  function fileOf(n) { return String(n).padStart(6, '0') + '.jpg'; }

  async function rawFetch(name, tries = 2) {
    for (let t = 0; t < tries; t++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 45000);
      try {
        const r = await fetch(prefix + name + '?zoom=0', { credentials: 'include', signal: ac.signal });
        if (!r.ok) return null;
        if (!/^image\//i.test(r.headers.get('content-type') || '')) return null;
        const b = await r.arrayBuffer();
        return b.byteLength ? b : null;
      } catch (e) {
        await sleep(200 + t * 400);
      } finally { clearTimeout(timer); }
    }
    return null;
  }

  async function push(name, buf) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await fetch(COL + '/img/' + encodeURIComponent(bookId) + '/' + encodeURIComponent(name), {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: buf, signal: ac.signal,
      });
      return r.ok;
    } catch (e) { return false; } finally { clearTimeout(timer); }
  }

  /** 探一页是否存在（只取头部信息就够，但服务端不支持 HEAD，只能整取） */
  async function probe(name) {
    if (have.has(name) || saved.has(name)) return true;
    const b = await rawFetch(name, 1);
    return !!b;
  }

  /* 队列式并发下载 */
  function pump() {
    while (inflight < CFG.concurrency && queue.length) {
      const job = queue.shift();
      inflight++;
      (async () => {
        try {
          const b = await rawFetch(job.name);
          if (!b) { failed.add(job.name); return; }
          if (await push(job.name, b)) { saved.add(job.name); bytes += b.byteLength; }
          else failed.add(job.name);
        } catch (e) { failed.add(job.name); }
        finally { inflight--; upd(); pump(); }
      })();
    }
  }

  function enqueue(name) {
    if (have.has(name) || saved.has(name) || failed.has(name)) return;
    queue.push({ name });
    pump();
  }

  async function drain() {
    while ((queue.length || inflight) && !stopped) { await sleep(200); upd(); }
  }

  /* ======================= 5. 直取模式 ======================= */
  async function findMaxPage() {
    if (!await probe(fileOf(1))) return 0;
    let lo = 1, hi = 2;
    while (hi <= CFG.maxPage && await probe(fileOf(hi))) { lo = hi; hi *= 2; }
    hi = Math.min(hi, CFG.maxPage);
    // 二分找最后一个存在的页号
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (await probe(fileOf(mid))) lo = mid; else hi = mid;
    }
    return lo;
  }

  async function probeSeries(prefixStr, from, to, digits, stopAfter = 2) {
    const out = [];
    let miss = 0;
    for (let i = from; i <= to && miss < stopAfter; i++) {
      const name = prefixStr + String(i).padStart(digits, '0') + '.jpg';
      if (await probe(name)) { out.push(name); miss = 0; } else miss++;
      if (stopped) break;
    }
    return out;
  }

  async function directMode() {
    $st.textContent = '探测正文页数…';
    const maxPage = await findMaxPage();
    if (maxPage < 1) { log('直取模式：第 1 页都取不到，放弃'); return null; }
    log('正文页号范围 1 ~ ' + maxPage);
    $m.textContent = '正文 1 ~ ' + maxPage;

    const nums = [];
    for (let i = 1; i <= maxPage; i++) nums.push(fileOf(i));

    $st.textContent = '探测前置页…';
    const singles = [];
    for (const n of ['cov001.jpg', 'bok001.jpg', 'boo001.jpg', 'leg001.jpg',
                     'cov002.jpg', 'bak001.jpg']) {
      if (await probe(n)) singles.push(n);
    }
    const fows = await probeSeries('fow', 1, CFG.maxFow, 3);
    const bangs = await probeSeries('!', 1, CFG.maxBang, 5);
    log(`前置页: ${singles.join(',')} | 前言 ${fows.length} | 目录 ${bangs.length}`);

    // 阅读顺序
    const front = ['cov001.jpg', 'bok001.jpg', 'boo001.jpg', 'leg001.jpg']
      .filter((n) => singles.includes(n));
    const back = ['cov002.jpg', 'bak001.jpg'].filter((n) => singles.includes(n));
    order.push(...front, ...fows, ...bangs, ...nums, ...back);

    $st.textContent = '开始下载…';
    order.forEach(enqueue);
    await drain();
    return 'direct';
  }

  /* ======================= 6. 滚动兜底模式 ======================= */
  async function scrollMode() {
    const reader = document.querySelector('div.reader') ||
      [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 50)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!reader) { warn('找不到滚动容器'); return null; }
    log('切换到滚动兜底模式');

    const seenUrl = new Set();
    function scan() {
      for (const e of performance.getEntriesByType('resource')) {
        if (!e.name.includes('/jpath/img/') || seenUrl.has(e.name)) continue;
        const name = e.name.split('/').pop().split('?')[0];
        if (!/\.(jpe?g|png)$/i.test(name)) continue;
        seenUrl.add(e.name);
        if (!order.includes(name)) order.push(name);
        enqueue(name);
      }
    }
    scan();
    let idle = 0;
    for (let step = 1; step <= CFG.scrollMaxSteps && !stopped && idle < CFG.scrollIdleStop; step++) {
      if (document.visibilityState === 'hidden') {
        $st.textContent = '⚠ 页面在后台，已暂停';
        while (document.visibilityState === 'hidden' && !stopped) await sleep(1000);
        idle = 0;
      }
      const before = order.length;
      const dy = Math.max(400, reader.clientHeight * CFG.scrollStep);
      reader.scrollTop += dy;
      if (reader === document.body) window.scrollBy(0, dy);
      let waited = 0;
      while (waited < 1500 && !stopped) {
        await sleep(60); waited += 60;
        scan();
        if (order.length > before) break;
      }
      idle = order.length > before ? 0 : idle + 1;
      $st.textContent = `滚动采集 第 ${step} 步`;
      $m.textContent = `累计 ${order.length} 页，已收 ${saved.size}`;
    }
    await drain();
    return 'scroll';
  }

  /* ======================= 7. 主流程 ======================= */
  (async () => {
    try {
      log('书标识 =', bookId);

      $st.textContent = '等待阅读器加载书页…';
      prefix = await waitPrefix(40000);
      if (!prefix) {
        $st.textContent = '✘ 找不到书页地址';
        $m.textContent = '请在阅读器里翻一页，然后刷新页面重试';
        warn('40 秒内没在网络记录里发现书页地址。请在阅读器里翻一页后重试。');
        return;
      }
      log('图片前缀 =', prefix);

      try {
        const r = await fetch(COL + '/have/' + encodeURIComponent(bookId));
        if (r.ok) {
          (await r.text()).split('\n').map((x) => x.trim())
            .filter((x) => /\.(jpe?g|png)$/i.test(x))     // order.txt 之类不算页
            .forEach((x) => have.add(x));
        }
      } catch (e) { /* collector 没开也不致命，只是不能跳过已下载的 */ }
      upd();

      let used = null;
      if (CFG.mode !== 'scroll') used = await directMode();
      if (!used && CFG.mode !== 'direct') used = await scrollMode();

      $st.textContent = '收尾中…';
      await drain();

      // 报告页序
      if (order.length) {
        try {
          await fetch(COL + '/order/' + encodeURIComponent(bookId), {
            method: 'POST', headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(order),
          });
        } catch (e) {}
      }

      const failList = [...failed];
      $st.textContent = `✔ 完成 ${saved.size} 页（${used === 'direct' ? '直取' : '滚动'}模式）`;
      $m.textContent = `${(bytes / 1048576).toFixed(1)} MB 本次下载，跳过 ${have.size} 页，失败 ${failList.length} 页` +
        (failList.length ? '：' + failList.slice(0, 8).join(',') + (failList.length > 8 ? '…' : '') : '');
      log(`完成：新增 ${saved.size} 页，跳过 ${have.size} 页，失败 ${failList.length} 页，${(bytes / 1048576).toFixed(1)} MB`);

      // 触发拼 PDF
      if (!saved.size && !have.size) { warn('一页都没有，不触发拼装'); return; }
      $st.textContent = '正在拼 PDF…';
      try {
        await fetch(COL + '/build/' + encodeURIComponent(bookId), {
          method: 'POST', headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ title: (document.title || '').trim() }),
        });
        for (let i = 0; i < 240; i++) {
          await sleep(1000);
          const r = await fetch(COL + '/build/' + encodeURIComponent(bookId));
          const s = await r.json();
          if (s.state === 'done') {
            $st.textContent = '✔ PDF 已生成';
            $m.textContent = `${s.pages} 页 → ${s.out}`;
            log('PDF:', s.out);
            return;
          }
          if (s.state === 'error') { $st.textContent = '✘ 拼装失败'; $m.textContent = (s.error || '').slice(-200); return; }
          $st.textContent = '正在拼 PDF…' + (i + 1) + 's';
        }
        $st.textContent = '拼装超时，请到后端看日志';
      } catch (e) {
        $st.textContent = '✔ 抓取完成（没能连上 collector，未触发拼装）';
        $m.textContent = '请手动跑：python3 backend/build_pdf.py <书目录>';
      }
    } catch (e) {
      $st.textContent = '✘ 出错';
      $m.textContent = String((e && e.message) || e);
      warn('出错：', e);
    }
  })();
})();
