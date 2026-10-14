/* ============================================================================
 * 补页脚本 v2：把滚动时被跳过的正文页补回来
 *
 * 三步走：
 *   ① 直接按已知图片前缀取指定页号（前缀若对整本书有效，几秒搞定）
 *   ② 取不到就把阅读器滚到该页大约的位置，等它自己加载，顺手把附近所有缺页一起收
 *   ③ 最后汇报还差哪几页
 *
 * 用法：在阅读器页面 Console 里粘贴运行。
 * ========================================================================== */
(async () => {
  const COL = 'http://127.0.0.1:8765';
  const MISSING = [78, 116, 117, 124, 139, 171, 196, 224, 252, 275, 329, 348, 385];
  const TOTAL = 415;                        // 全书总页数（含封面/前言/目录）
  const P = /^(https?:\/\/[^/]+\/jpath\/img\/[^/]+\/[0-9A-Fa-f]+\/\d+\/\d+\/[0-9a-f]+\/)/;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const qs = new URLSearchParams(location.search);
  const bookId = ('ssno' + (qs.get('ssno') || 'x') + '_' + (qs.get('code') || 'x').slice(0, 8))
    .replace(/[^A-Za-z0-9._-]/g, '_');

  /* ---------- 面板 ---------- */
  const old = document.getElementById('repairPanel');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'repairPanel';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#eee;' +
    'font:13px/1.7 system-ui,"Microsoft YaHei",sans-serif;padding:12px 14px;border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.45);width:300px';
  panel.innerHTML = '<div style="font-weight:700;margin-bottom:6px">补页</div>' +
    '<div id="rst" style="color:#0ff">准备…</div>' +
    '<div id="rmsg" style="color:#bbb;font-size:12px;margin-top:4px;word-break:break-all">—</div>';
  (document.body || document.documentElement).appendChild(panel);
  const $st = panel.querySelector('#rst');
  const $msg = panel.querySelector('#rmsg');

  const L = [];
  const say = (s) => { console.log('%c[补页] ' + s, 'color:#0aa'); L.push(s); };

  /* ---------- 已知前缀（后出现的更可能有效，优先用） ---------- */
  const prefixes = [...new Set(performance.getEntriesByType('resource').map((e) => e.name)
    .map((u) => (u.match(P) || [])[1]).filter(Boolean))].reverse();
  say('已知前缀数 = ' + prefixes.length);

  const fileOf = (n) => String(n).padStart(6, '0') + '.jpg';

  async function tryFetch(url) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      if (!/^image\//i.test(r.headers.get('content-type') || '')) return null;
      const buf = await r.arrayBuffer();
      return buf.byteLength ? buf : null;
    } catch (e) { return null; }
  }

  async function save(file, buf) {
    try {
      const r = await fetch(COL + '/img/' + encodeURIComponent(bookId) + '/' + encodeURIComponent(file), {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: buf,
      });
      return r.ok;
    } catch (e) { return false; }
  }

  /* ---------- 从网络记录里把"仍缺的页"一并捡走 ---------- */
  const remaining = new Set(MISSING);
  const savedOk = [];
  async function scanAndSave() {
    const got = [];
    for (const e of performance.getEntriesByType('resource')) {
      const base = e.name.split('/').pop().split('?')[0];
      if (!/^\d{6}\.jpg$/.test(base)) continue;
      const n = parseInt(base, 10);
      if (!remaining.has(n)) continue;
      const buf = await tryFetch(e.name);
      if (buf && await save(base, buf)) {
        remaining.delete(n); savedOk.push(n); got.push(n);
      }
    }
    return got;
  }

  const reader = document.querySelector('div.reader') ||
    [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 50)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];

  /* ---------- ① 直接按前缀取 ---------- */
  for (const n of MISSING) {
    const file = fileOf(n);
    $st.textContent = `① 按前缀取 ${file}`;
    $msg.textContent = `成功 ${savedOk.length}，仍缺 ${remaining.size}`;
    let ok = false;
    for (const pre of prefixes) {
      const buf = await tryFetch(pre + file + '?zoom=0');
      if (buf) { if (await save(file, buf)) { remaining.delete(n); savedOk.push(n); ok = true; } break; }
    }
    if (ok) say(`${file}  OK（按前缀）`);
    await sleep(120);
  }
  say(`① 结束：补回 ${savedOk.length} 页，仍缺 ${remaining.size} 页`);

  /* ---------- ② 滚动到缺页位置，等阅读器自己加载 ---------- */
  if (remaining.size && reader) {
    const per = reader.scrollHeight / TOTAL;
    const list = [...remaining].sort((a, b) => a - b);
    for (let i = 0; i < list.length; i++) {
      if (!remaining.has(list[i])) continue;
      const n = list[i];
      $st.textContent = `② 滚到第 ${n} 页附近（${i + 1}/${list.length}）`;
      $msg.textContent = `已补 ${savedOk.length}，仍缺 ${remaining.size}`;
      for (const adj of [0, -1, 1, -2, 2, 3]) {
        reader.scrollTop = Math.max(0, (n - 1 + adj) * per);
        await sleep(1200);
        const got = await scanAndSave();
        if (got.length) say(`滚到 ${n} 附近收到: ${got.map(fileOf).join(', ')}`);
        if (!remaining.has(n)) break;
      }
      if (remaining.has(n)) say(`${fileOf(n)} 仍未取到`);
    }
  }

  /* ---------- 收尾 ---------- */
  $st.textContent = `✔ 补回 ${savedOk.length} 页，仍缺 ${remaining.size} 页`;
  $msg.textContent = remaining.size ? ('仍缺: ' + [...remaining].join(',')) : '全部补齐';
  say('=== 汇总 ===');
  say('已补回(' + savedOk.length + '): ' + savedOk.sort((a, b) => a - b).join(','));
  say('仍缺失(' + remaining.size + '): ' + [...remaining].join(',') || '(无)');
  try { copy(L.join('\n')); } catch (e) {}
  try {
    await fetch(COL + '/log', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'REPAIR\n' + L.join('\n') });
    console.log('%c[补页] ✔ 结果已发送给 AI', 'color:#0a0;font-weight:700');
  } catch (e) {}
  return '补页完成';
})();
