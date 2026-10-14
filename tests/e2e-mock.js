/* 端到端自测：把**真实的** frontend/grabber.js 放进一个最小化的假浏览器环境里跑，
 * 验证 二分搜索页数 / 前置页探测 / 页序 / 推送 collector / 触发拼装 全链路。
 *
 * 前置：
 *   1. 先生成测试图片:  python3 tests/make-fixtures.py
 *   2. 先启动后端:      python3 backend/collector.py
 *   3. 再跑:            node tests/e2e-mock.js
 *
 * 不需要 npm install，用 Node 18+ 自带的 fetch 即可。
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const ASSETS = process.env.FIXTURES || '/tmp/jpath-fixtures';
const HOST = 'https://example.test';
const PREFIX = HOST + '/jpath/img/a174/ABCDEF/0/0/0123456789abcdef0123456789abcdef/';
const BOOK = 'ssno999_abcdef12';
const COL = 'http://127.0.0.1:8765';

/* ---------- 假 DOM ---------- */
const nodes = {};
function fakeEl(sel) {
  const el = {
    _sel: sel, style: {}, id: '', innerHTML: '', textContent: '', onclick: null,
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    querySelector(s) {
      const key = sel + ' >> ' + s;
      if (!nodes[key]) nodes[key] = fakeEl(s);
      return nodes[key];
    },
    querySelectorAll: () => [],
    scrollTop: 0, clientHeight: 800, scrollHeight: 6400,
    scrollBy() {}, getBoundingClientRect: () => ({ top: 0, left: 0 }),
    addEventListener() {},
  };
  return el;
}

const reader = fakeEl('div.reader');
const panel = fakeEl('div#jpathGrabberPanel');
nodes['div.reader'] = reader;

global.window = globalThis;
global.location = {
  href: HOST + '/jpath/reader/reader.shtml?channel=100&code=abcdef1234567890&ssno=999&cpage=1',
  protocol: 'https:', search: '?channel=100&code=abcdef1234567890&ssno=999&cpage=1',
  replace(u) { console.log('[location.replace]', u); },
};
global.document = {
  title: '测试用书',
  body: fakeEl('body'),
  documentElement: fakeEl('html'),
  visibilityState: 'visible',
  createElement: () => fakeEl('created'),
  getElementById: (id) => (id === 'jpathGrabberPanel' ? null : null),
  querySelector: (s) => (s === 'div.reader' ? reader : null),
  querySelectorAll: () => [],
  addEventListener() {},
};
global.alert = (m) => console.log('[alert]', m);
global.copy = (t) => { global.__copied = t; };

/* ---------- 假的 performance：直接给出图片前缀 ---------- */
global.performance = {
  getEntriesByType(type) {
    if (type !== 'resource') return [];
    return [{ name: PREFIX + '000001.jpg?zoom=0', initiatorType: 'img' }];
  },
};

/* ---------- fetch：书页走内存里的 mock，其余转发给真的 collector ---------- */
const realFetch = global.fetch;
const stats = { img: 0, miss: 0, post: 0 };
global.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith(PREFIX)) {
    const name = url.slice(PREFIX.length).split('?')[0];
    const p = path.join(ASSETS, name);
    if (fs.existsSync(p)) {
      stats.img++;
      const buf = fs.readFileSync(p);
      return {
        ok: true, status: 200, url,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    }
    stats.miss++;
    return { ok: false, status: 404, url, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  if (url.startsWith(COL)) stats.post++;
  return realFetch(url, opts);
};

/* ---------- 跑真实脚本 ---------- */
const src = fs.readFileSync(path.join(REPO, 'frontend', 'grabber.js'), 'utf8');
console.log('--- 运行 grabber.js ---');
eval(src);

/* ---------- 等它跑完 ---------- */
const t0 = Date.now();
const timer = setInterval(async () => {
  const st = nodes['created >> #jst'] ? nodes['created >> #jst'].textContent : '(无)';
  const msg = nodes['created >> #jm'] ? nodes['created >> #jm'].textContent : '';
  if (/PDF 已生成|✘|超时|完成/.test(st) || Date.now() - t0 > 60000) {
    clearInterval(timer);
    console.log('\n--- 结果 ---');
    console.log('状态:', st);
    console.log('详情:', msg);
    console.log('统计: 拉图', stats.img, '次，404', stats.miss, '次，请求 collector', stats.post, '次');
    console.log('期望书标识:', BOOK);
    const dir = path.join(REPO, 'output', BOOK);
    if (fs.existsSync(dir)) {
      const got = fs.readdirSync(dir).sort();
      console.log('collector 落盘', got.length, '个文件:');
      console.log('  ' + got.join(' '));
      const ord = path.join(dir, 'order.txt');
      if (fs.existsSync(ord)) console.log('order.txt:', fs.readFileSync(ord, 'utf8').trim().replace(/\n/g, ' → '));
    } else {
      console.log('!! collector 没有落盘任何文件');
    }
    process.exit(0);
  }
}, 500);
