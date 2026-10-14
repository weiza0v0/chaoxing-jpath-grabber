/* ============================================================================
 * 超星 jpath 阅读器 —— 边滚边收，整本书抓取
 *
 * 阅读器是纵向连续滚动的（容器 <div class="reader">），每往下滚一点就加载
 * 一页。所以本脚本不去猜页码规律：滚到哪页就立刻把那页取下来推给本地。
 *
 * 用法：在阅读器页面 Console 里粘贴运行，然后放着别动。
 * ========================================================================== */
(() => {
  'use strict';

  const COL = 'http://127.0.0.1:8765';
  const P = /^(https?:\/\/[^/]+\/jpath\/img\/[^/]+\/[0-9A-Fa-f]+\/\d+\/\d+\/[0-9a-f]+\/)/;
  const CONC = 4;           // 同时下载几页
  const STEP_FACTOR = 1.15; // 每步滚多少倍可视高度（≈一整页，保证不漏页）
  const POLL_MS = 60;       // 轮询间隔
  const MAX_WAIT = 1500;    // 单步最多等这么久（真到书末时会走满）
  const IDLE_STOP = 30;     // 连续多少步没新页就认为到底了
  const MAX_STEPS = 2000;   // 兜底上限

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 书页图片会 302 跳到 https://<host>/iis/png/png.dll，若当前是 http://…:9088
  // 就属于跨源，fetch 必被 CORS 挡。这里直接引导跳到 https 同源。
  if (location.protocol === 'http:') {
    const u = new URL(location.href);
    u.protocol = 'https:';
    u.port = '';
    const go = confirm('当前页面是 HTTP，书页图片会跳到 HTTPS，属于跨源，会被 CORS 拦截。\n\n' +
      '点「确定」自动跳到同源地址：\n' + u.href.slice(0, 120) + '…\n\n' +
      '跳转后请再粘贴运行一次本脚本。');
    if (go) location.replace(u.href);
    else console.warn('%c[抓书] 已取消跳转。请手动把地址栏的 http://…:9088 改成 https://…（去掉端口）', 'color:#e60;font-weight:700');
    return;
  }

  // 每本书一个独立标识，避免多本书的文件混在一起（它们都叫 !00001.jpg）
  const qs = new URLSearchParams(location.search);
  const bookId = ('ssno' + (qs.get('ssno') || 'x') + '_' + (qs.get('code') || 'x').slice(0, 8))
    .replace(/[^A-Za-z0-9._-]/g, '_');

  /* ---------------- 面板 ---------------- */
  const old = document.getElementById('harvestPanel');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'harvestPanel';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#eee;' +
    'font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:12px 14px;border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.45);width:290px';
  panel.innerHTML =
    '<div style="font-weight:700;margin-bottom:6px">整本书抓取（边滚边收）</div>' +
    '<div style="color:#9ad">状态：<b id="hst" style="color:#0ff">准备…</b></div>' +
    '<div style="color:#9ad">已收：<b id="hcnt" style="color:#0ff">0</b> 页　失败：<b id="hfail" style="color:#f99">0</b></div>' +
    '<div id="hmsg" style="color:#bbb;font-size:12px;margin:4px 0 8px;word-break:break-all">—</div>' +
    '<button id="hstop" style="width:100%;padding:6px;border:0;border-radius:6px;background:#a33;color:#fff;cursor:pointer">停止</button>';
  (document.body || document.documentElement).appendChild(panel);
  const $st = panel.querySelector('#hst');
  const $cnt = panel.querySelector('#hcnt');
  const $fail = panel.querySelector('#hfail');
  const $msg = panel.querySelector('#hmsg');
  let stopped = false;
  panel.querySelector('#hstop').onclick = () => { stopped = true; $st.textContent = '已手动停止'; };

  const postLog = (t) => {
    try {
      fetch(COL + '/log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: String(t) }).catch(() => {});
    } catch (e) {}
  };

  /* ---------------- 下载队列 ---------------- */
  let haveSet = new Set();       // 本地已存在的文件名（来自接收器 /have），重跑时跳过
  const seenUrl = new Set();     // 已入队的完整 URL
  const savedFile = new Set();   // 已成功落盘的文件名
  const failed = new Map();      // 文件名 -> url（最后重试）
  const order = [];              // 成功顺序（= 阅读顺序）
  let inflight = 0, totalBytes = 0;
  let queue = [];

  function fileNameOf(url) {
    const m = url.match(P);
    if (!m) return null;
    return url.slice(m[1].length).split('?')[0];
  }

  function updatePanel() {
    $cnt.textContent = String(savedFile.size);
    $fail.textContent = String(failed.size);
  }

  async function fetchOne(url) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await fetch(url, { credentials: 'include', signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (!/^image\//i.test(ct)) throw new Error('ct=' + ct);
      const buf = await r.arrayBuffer();
      if (!buf.byteLength) throw new Error('空响应');
      return buf;
    } finally { clearTimeout(timer); }
  }

  async function saveOne(file, buf) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await fetch(COL + '/img/' + encodeURIComponent(bookId) + '/' + encodeURIComponent(file), {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: buf, signal: ac.signal,
      });
      if (!r.ok) throw new Error('落盘 HTTP ' + r.status);
    } finally { clearTimeout(timer); }
  }

  async function doJob(job) {
    try {
      const buf = await fetchOne(job.url);
      await saveOne(job.file, buf);
      savedFile.add(job.file);
      order.push(job.file);
      totalBytes += buf.byteLength;
    } catch (e) {
      failed.set(job.file, job.url);
    }
  }

  function pump() {
    while (inflight < CONC && queue.length) {
      const job = queue.shift();
      inflight++;
      doJob(job).finally(() => { inflight--; updatePanel(); pump(); });
    }
  }

  function enqueue(url) {
    if (!url || seenUrl.has(url)) return;
    const file = fileNameOf(url);
    if (!file || savedFile.has(file) || haveSet.has(file)) return;
    seenUrl.add(url);
    queue.push({ url, file });
    pump();
  }

  /* ---------------- 发现新页 ---------------- */
  function scanPerf() {
    let n = 0;
    for (const e of performance.getEntriesByType('resource')) {
      if (!e.name.includes('/jpath/img/')) continue;
      const before = seenUrl.size;
      enqueue(e.name);
      if (seenUrl.size > before) n++;
    }
    return n;
  }

  function scanDom() {
    const reader = document.querySelector('div.reader') || document.body;
    if (!reader) return 0;
    let n = 0;
    const before0 = seenUrl.size;
    reader.querySelectorAll('img').forEach((im) => { enqueue(im.currentSrc || im.src); });
    return seenUrl.size - before0;
  }

  /* ---------------- 主流程 ---------------- */
  (async () => {
    const reader = document.querySelector('div.reader') ||
      [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 50)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!reader) { $st.textContent = '✘ 找不到滚动容器'; return; }
    postLog('HARVEST start reader=<' + reader.tagName + ' class=' + String(reader.className).slice(0, 40) + '>');
    // 先问接收器要"本地已有哪些页"，重跑时只补缺的
    try {
      const r = await fetch(COL + '/have/' + encodeURIComponent(bookId));
      if (r.ok) {
        haveSet = new Set((await r.text()).split('\n').map((x) => x.trim()).filter(Boolean));
        $msg.textContent = '本地已有 ' + haveSet.size + ' 页，将跳过';
      }
    } catch (e) { /* 接收器没开也不致命 */ }
    $st.textContent = '滚动采集中…';

    scanPerf(); scanDom();
    let idle = 0;
    const t0 = Date.now();
    let lastReport = 0;

    for (let step = 1; step <= MAX_STEPS && !stopped; step++) {
      // 页面切到后台时暂停。Chrome 会节流后台定时器，而且阅读器的懒加载依赖
      // 渲染，硬跑会被误判成"到书末"而提前收工。切回前台自动继续。
      if (document.visibilityState === 'hidden') {
        $st.textContent = '⚠ 页面在后台，已暂停';
        $msg.textContent = '请把阅读器标签页切回前台，脚本会自动继续';
        while (document.visibilityState === 'hidden' && !stopped) await sleep(1000);
        idle = 0;
        $st.textContent = '继续滚动…';
      }

      const before = seenUrl.size;

      // 直接跳一整页的高度：既保证不跳过任何一页，又比慢慢蹭快得多
      const dy = Math.max(400, reader.clientHeight * STEP_FACTOR);
      reader.scrollTop = reader.scrollTop + dy;
      if (reader === document.body) window.scrollBy(0, dy);

      // 自适应等待：新页一出现就立刻继续，不等满固定时间
      let waited = 0;
      while (waited < MAX_WAIT && !stopped) {
        await sleep(POLL_MS);
        waited += POLL_MS;
        scanPerf(); scanDom();
        if (seenUrl.size > before) break;
      }

      if (seenUrl.size === before) {
        idle++;
        if (idle >= IDLE_STOP) { $msg.textContent = '已到书末（连续 ' + IDLE_STOP + ' 步无新页）'; break; }
      } else idle = 0;

      if (Date.now() - lastReport > 400) {
        lastReport = Date.now();
        const secs = (Date.now() - t0) / 1000;
        const rate = (seenUrl.size / Math.max(1, secs)).toFixed(1);
        $st.textContent = `滚到第 ${step} 步（${secs.toFixed(0)}s，${rate} 页/秒）`;
        $msg.textContent = `累计发现 ${seenUrl.size} 页，已收 ${savedFile.size} 页，${(totalBytes / 1048576).toFixed(1)} MB`;
      }
    }

    // 等队列排空
    $st.textContent = '等待下载完成…';
    while ((queue.length || inflight) && !stopped) { await sleep(300); updatePanel(); }

    // 重试失败的
    if (failed.size && !stopped) {
      $st.textContent = '重试失败页…';
      const retry = [...failed.entries()];
      failed.clear();
      for (const [file, url] of retry) {
        queue.push({ url, file });
      }
      pump();
      while ((queue.length || inflight) && !stopped) { await sleep(300); updatePanel(); }
    }

    $st.textContent = '✔ 完成 ' + savedFile.size + ' 页';
    $msg.textContent = `${(totalBytes / 1048576).toFixed(1)} MB，失败 ${failed.size} 页`;
    const summary = 'HARVEST DONE saved=' + savedFile.size + ' failed=' + failed.size +
      ' bytes=' + totalBytes + '\norder=' + order.join(',') +
      '\nfailed=' + [...failed.keys()].join(',');
    postLog(summary);
    console.log('%c[抓书] 完成：' + savedFile.size + ' 页，失败 ' + failed.size + ' 页', 'color:#0a0;font-weight:700');
    console.log(order.join('\n'));
    window.__harvestOrder = order;
  })();
})();
