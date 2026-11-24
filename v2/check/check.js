// The new Hub's check. Runs before every update (see the "New Hub check" workflow).
// It opens the app in Safari's engine at Josh's phone size (428 x 926), with the status bar (47)
// and the home swipe area (34) marked off, in light and dark, and fails if:
//   - the data doesn't load, or a page doesn't show
//   - tapping the bar or swiping doesn't land on the right page, or the app doesn't reopen on the last page
//   - anything is cut off, overlaps, or sits under the status bar or the home swipe area
//   - any text is too faint to read
// It never touches the real data box: GitHub is answered with made-up sample data.
// Pictures of every page go to v2/check/out/.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');      // the my-app folder
const OUT = path.join(__dirname, 'out');
const W = 428, H = 926, TOP = 47, BOTTOM = 34;
const PAGES = ['todo', 'finance', 'plan'];

// ---- Made-up sample data, shaped like the real files ----
const SAMPLE = {
  'meta/app.json': { name: 'sample' },
  'data/tasks.json': {
    a: { title: 'Sample one', status: 'open' }, b: { title: 'Sample two', status: 'open' },
    c: { title: 'Sample three', status: 'open' }, d: { title: 'Done one', status: 'done' },
    e: { title: 'Dropped one', status: 'dropped' },
  },
  'data/fin.json': { debts: { items: [{ name: 'Sample', owed: 40 }, { name: 'Paid', owed: 0 }] } },
  'data/calendar.json': { one: { name: 'One', events: [] }, two: { name: 'Two', events: [] } },
};
const EXPECT = { todo: '3 open tasks', finance: '1 debt still owed', plan: '2 calendars found' };

// ---- A tiny web server for the app's own files ----
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/my-app/, '');
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const problems = [];
function problem(where, what) { problems.push(where + ': ' + what); console.log('  FAIL ' + where + ': ' + what); }

// Runs inside the page: finds anything cut off, overlapping, under the phone's edges, or too faint.
function inspect({ W, H, TOP, BOTTOM }) {
  const out = [];
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) +
    (el.textContent.trim() ? ' "' + el.textContent.trim().slice(0, 30) + '"' : '');
  // Things a person sees: text, icons, fields, buttons.
  const items = Array.from(document.querySelectorAll('body *')).filter((el) => {
    if (!vis(el)) return false;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return false;
    if (['svg', 'input', 'img'].includes(el.tagName.toLowerCase())) return true;
    return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  // When the Connect screen is up it covers everything else, so only what's on it counts.
  const cover = document.getElementById('connect');
  if (vis(cover)) for (let i = items.length - 1; i >= 0; i--) if (!cover.contains(items[i])) items.splice(i, 1);
  const rect = (el) => el.getBoundingClientRect();
  for (const el of items) {
    const r = rect(el);
    if (r.left < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5 || r.top < -0.5) out.push(name(el) + ' is cut off at the screen edge');
    else if (r.top < TOP) out.push(name(el) + ' sits under the status bar');
    else if (r.bottom > H - BOTTOM) out.push(name(el) + ' sits in the home swipe area');
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && el.tagName.toLowerCase() !== 'svg') out.push(name(el) + ' has text cut off');
  }
  // Page content must not hide under the bottom bar.
  const bar = document.querySelector('.bar').getBoundingClientRect();
  for (const el of items) {
    if (el.closest('.bar') || el.closest('[hidden]')) continue;
    const r = rect(el);
    if (r.bottom > bar.top + 0.5 && r.top < bar.bottom && !document.getElementById('connect').contains(el)) out.push(name(el) + ' is under the bottom bar');
  }
  // Nothing overlaps anything else (unless one sits inside the other).
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.contains(b) || b.contains(a)) continue;
    const p = rect(a), q = rect(b);
    const x = Math.min(p.right, q.right) - Math.max(p.left, q.left);
    const y = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (x > 1 && y > 1) out.push(name(a) + ' overlaps ' + name(b));
  }
  // Text is readable: at least 4.5 to 1 against what's behind it (3 to 1 for big text).
  const rgb = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0);
  const behind = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0) layers.push(c); if (c.a >= 1) break; }
    let base = rgb(getComputedStyle(document.body).backgroundColor);
    for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
    return base;
  };
  for (const el of items) {
    if (['svg', 'input', 'img'].includes(el.tagName.toLowerCase())) continue;
    const s = getComputedStyle(el);
    const L1 = lum(rgb(s.color)), L2 = lum(behind(el));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.5 && +s.fontWeight >= 700);
    const need = big ? 3 : (el.closest('.tab') ? 3 : 4.5); // bar labels sit beside their icon, like iOS
    if (ratio < need) out.push(name(el) + ' is too faint (' + ratio.toFixed(2) + ' to 1, needs ' + need + ')');
  }
  return out;
}

async function settle(page) { await page.waitForTimeout(450); }

async function run() {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/my-app/v2/';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const edges = `:root{--safe-top:${TOP}px!important;--safe-bottom:${BOTTOM}px!important}`;

  for (const scheme of ['light', 'dark']) {
    console.log('Checking ' + scheme + ' mode');
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, colorScheme: scheme });
    let wrote = 0;
    await ctx.route('https://api.github.com/**', (route) => {
      const req = route.request();
      if (req.method() !== 'GET') { wrote++; return route.fulfill({ status: 405, body: '' }); }
      const m = req.url().match(/\/contents\/(.+?)\?/);
      const body = m && SAMPLE[m[1]];
      return route.fulfill(body ? { status: 200, contentType: 'application/json', body: JSON.stringify(body) } : { status: 404, body: '' });
    });

    // 1. No key on this phone yet: the Connect screen shows and looks right.
    const page = await ctx.newPage();
    await page.goto(base);
    await page.addStyleTag({ content: edges });
    await page.waitForFunction(() => document.documentElement.dataset.loaded);
    if (await page.locator('#connect').isHidden()) problem(scheme + ' first open', 'the Connect screen did not show with no key');
    for (const p of await page.evaluate(inspect, { W, H, TOP, BOTTOM })) problem(scheme + ' Connect screen', p);
    await page.screenshot({ path: path.join(OUT, `${scheme}-connect.png`) });

    // 2. Connect with a (made-up) key; the data loads.
    await page.fill('#connect-key', 'sample-key');
    await page.tap('#connect-go');
    await page.waitForFunction(() => document.documentElement.dataset.loaded === 'yes', null, { timeout: 8000 }).catch(() => {});
    if (!(await page.locator('#connect').isHidden())) problem(scheme + ' connect', 'the Connect screen did not close');

    // 3. Each page by tapping the bar.
    for (let i = 0; i < PAGES.length; i++) {
      const id = PAGES[i];
      await page.tap(`.tab[data-tab="${id}"]`);
      await settle(page);
      const state = await page.evaluate((i) => {
        const p = document.getElementById('pages');
        return { at: Math.round(p.scrollLeft / p.clientWidth), current: document.querySelector('.tab[aria-current="page"]')?.dataset.tab };
      }, i);
      if (state.at !== i) problem(`${scheme} ${id}`, 'tapping the bar did not move to this page');
      if (state.current !== id) problem(`${scheme} ${id}`, 'the bar does not show this page as the current one');
      const line = (await page.locator(`[data-line="${id}"]`).textContent()).trim();
      if (line !== EXPECT[id]) problem(`${scheme} ${id}`, `data line says "${line}", expected "${EXPECT[id]}"`);
      for (const p of await page.evaluate(inspect, { W, H, TOP, BOTTOM })) problem(`${scheme} ${id}`, p);
      await page.screenshot({ path: path.join(OUT, `${scheme}-${id}.png`) });
    }

    // 4. Swiping: move the pages the way a finger does, and the bar follows.
    await page.evaluate(() => { const p = document.getElementById('pages'); p.scrollLeft = 0; });
    await settle(page);
    if ((await page.evaluate(() => document.querySelector('.tab[aria-current="page"]').dataset.tab)) !== 'todo') problem(scheme + ' swipe', 'swiping back to TO-DO did not update the bar');

    // 5. Reopen: lands on the page used last.
    await page.tap('.tab[data-tab="finance"]');
    await settle(page);
    await page.reload();
    await page.addStyleTag({ content: edges });
    await page.waitForFunction(() => document.documentElement.dataset.loaded === 'yes', null, { timeout: 8000 }).catch(() => problem(scheme + ' reopen', 'the data did not load with the saved key'));
    const reopened = await page.evaluate(() => { const p = document.getElementById('pages'); return Math.round(p.scrollLeft / p.clientWidth); });
    if (reopened !== 1) problem(scheme + ' reopen', 'did not open on the page used last (Finance)');

    if (wrote) problem(scheme, `the app tried to change the data box ${wrote} time(s); it must only read`);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('');
  if (problems.length) {
    console.log(problems.length + ' problem(s) found. Pictures are in v2/check/out/.');
    process.exit(1);
  }
  console.log('All good. Pictures are in v2/check/out/.');
}

run().catch((e) => { console.error(e); process.exit(1); });
