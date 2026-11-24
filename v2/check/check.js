// The new Hub's check. Runs before every update (see the "New Hub check" workflow).
// It opens the app in Safari's engine at Josh's phone size (428 x 926), with the status bar (47)
// and the home swipe area (34) marked off, in light and dark, and on a PC screen (1440 x 900), and fails if:
//   - the phone doesn't follow its own light or dark setting, or a PC isn't dark (a PC is always dark, Josh's pick)
//   - the data doesn't load, or a page doesn't show
//   - tapping the bar or swiping doesn't land on the right page, or the app doesn't reopen on the last page
//   - anything is cut off, overlaps, or sits under the status bar, the page bar or the home swipe area
//   - any text is too faint to read, or any button is smaller than 44 by 44
//   - the TO-DO page shows the wrong tasks, or tick, add, drag, the Done folder, ?, the menu or the Archive don't work
//   - a TO-DO change could be saved twice (the double-save checks)
//   - saving goes wrong: a change doesn't save, saves twice, wipes out someone else's change, writes a
//     file it shouldn't, or a key that can only read isn't spotted and shown
// It never touches the real data box: GitHub is played by a made-up data box with sample data.
// Pictures of every page go to v2/check/out/.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { webkit } = require('playwright');
const Todo = require('../todo.js');
const Changes = require('../changes.js');

const ROOT = path.resolve(__dirname, '..', '..');      // the my-app folder
const OUT = path.join(__dirname, 'out');
const W = 428, H = 926, TOP = 47, BOTTOM = 34;
const PC = { W: 1440, H: 900 };
const PAGES = ['todo', 'finance', 'plan'];

// ---- Made-up sample data, shaped like the real files. Dates are set around the time the check runs. ----
const NOW = Date.now();
const at = (days, hours) => new Date(NOW + days * 864e5 + (hours || 0) * 36e5).toISOString();
const TASKS = {
  a: { title: 'Buy winter boots', status: 'open', kind: 'task', section: 'active', due: at(2), priority: 5, myNote: 'Check Costco first, size 10', notes: 'Robot history: never shown' },
  b: { title: 'Call about the phone bill', status: 'open', kind: 'task', section: 'active', due: at(-3), priority: 6 },
  c: { title: 'Get the oil changed', status: 'open', kind: 'task', section: 'active', due: null, priority: 7,
    subtasks: [{ text: 'Book a time', done: true }, { text: 'Drop the car off', done: false }] },
  l: { title: 'A long task name that has to wrap onto a second line without running under its picture or off the screen', status: 'open', kind: 'task', section: 'active', due: null, priority: 8 },
  m: { title: 'Bring the Genki book', status: 'open', kind: 'task', section: 'active', course: 'JPN A101', due: at(4), priority: 9 },
  d: { title: 'Hear back about the dorm repair', status: 'open', kind: 'task', section: 'onhold', due: null, priority: 10 },
  e: { title: 'Study for the kanji quiz', status: 'open', kind: 'task', section: 'jpn', course: 'JPN A101', due: at(6), priority: 1 },
  f: { title: 'Unit 9: Quiz #8', status: 'open', kind: 'task', section: 'mus', course: 'MUS A110', due: at(-10), priority: 2 },
  g: { title: 'Read chapter 7', status: 'open', kind: 'task', section: 'wrtg', course: 'WRTG A110', due: at(1, 3), priority: 3 },
  h: { title: 'Learn to ice skate', status: 'open', kind: 'task', section: 'someday', due: null, priority: 40 },
  i: { title: 'Print the bus pass', status: 'done', kind: 'task', section: 'done', prevSection: 'active', doneAt: at(0, -2), due: null, priority: 11 },
  j: { title: 'Old finished one', status: 'done', kind: 'task', section: 'done', prevSection: 'active', doneAt: at(-5), due: null, priority: 12 },
  k: { title: 'A deleted one', status: 'dropped', kind: 'task', section: 'done', droppedAt: at(-2), due: null, priority: 13 },
  q: { title: 'Rule check', status: 'open', kind: 'question', section: 'active', question: 'Is the sample still on?', due: null, priority: 50 },
};
const SUGS = {
  s1: { kind: 'task', title: 'Return the library book', status: 'new', source: 'email', createdAt: at(-1), proposed: { section: 'active' } },
  s2: { kind: 'task', title: 'Old idea', status: 'skipped', source: 'email', createdAt: at(-1), proposed: { section: 'active' } },
};
const SAMPLE = {
  'meta/app.json': { name: 'sample' },
  'data/tasks.json': TASKS,
  'data/suggestions.json': SUGS,
  'data/fin.json': { debts: { items: [{ name: 'Sample', owed: 40 }, { name: 'Paid', owed: 0 }] } },
  'data/calendar.json': { one: { name: 'One', events: [] }, two: { name: 'Two', events: [] } },
};
const flat = (tab) => Todo.listFor(TASKS, tab, NOW).flat();
const EXPECT = {
  todo: flat('all').length + ' open · ' + flat('all').filter(([, t]) => Todo.isOverdue(t, NOW)).length + ' overdue',
  finance: '1 debt still owed', plan: '2 calendars found',
};

const problems = [];
function problem(where, what) { problems.push(where + ': ' + what); console.log('  FAIL ' + where + ': ' + what); }
function expect(where, ok, what) { if (!ok) problem(where, what); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. The sorting and saving rules, on their own ----
function rules() {
  console.log('Checking the TO-DO rules');
  const ids = (tab) => flat(tab).map(([id]) => id);
  expect('rules', same(ids('all'), ['b', 'a', 'm', 'c', 'l', 'd']), 'All should be soonest first, undated next, Waiting last: got ' + ids('all'));
  expect('rules', same(ids('jpn'), ['m', 'e']), 'JPN should hold its own task and the one moved to All: got ' + ids('jpn'));
  expect('rules', same(ids('overdue'), ['f', 'b']), 'Overdue should hold every overdue task from every tab: got ' + ids('overdue'));
  expect('rules', same(ids('pop'), ['f']), 'POP wrong: got ' + ids('pop'));
  expect('rules', same(ids('bucket'), ['h']), 'Bucket List wrong: got ' + ids('bucket'));
  expect('rules', Todo.doneFor(TASKS, 'all', NOW).map(([id]) => id).join() === 'i', 'Done folder should hold only what was finished in the last day');
  expect('rules', Todo.archive(TASKS, NOW).map(([id]) => id).join() === 'k,j', 'Archive should hold older finished and deleted tasks, newest first');
  expect('rules', Todo.possible(SUGS, NOW).map(([id]) => id).join() === 's1', 'possible tasks: skipped ones must never come back');
  expect('rules', Todo.questions(TASKS).map((q) => q.text).join() === 'Is the sample still on?', 'the question list is wrong');
  // Josh's drag order wins.
  // (a drop gives every card in that list its place, the way the page does it)
  const order = ['l'].concat(ids('all').filter((x) => x !== 'l' && x !== 'd'));
  const orderChange = { id: 'r1', type: 'order', taskId: 'l', ids: order };
  const ranked = Changes.apply(Changes.apply(TASKS, [orderChange]), [orderChange]);
  expect('rules', ranked.l.changeIds.length === 1, 'the same new order saved twice must land once');
  expect('rules', Todo.listFor(ranked, 'all', NOW)[0][0][0] === 'l', 'a task Josh dragged to the top must stay on top');
  // Double-save checks.
  const tick = { id: 'x1', type: 'tick', taskId: 'a', at: at(0) };
  const twice = Changes.apply(Changes.apply(TASKS, [tick]), [tick]);
  expect('rules', twice.a.status === 'done' && twice.a.changeIds.filter((x) => x === 'x1').length === 1, 'the same tick saved twice must land once');
  const untick = { id: 'x1b', type: 'untick', taskId: 'a' };
  const back = Changes.apply(twice, [untick, tick]);
  expect('rules', back.a.status === 'open', 'an old tick sent again after an untick must not tick it again');
  const add = { id: 'x2', type: 'add', taskId: 'new1', task: { title: 'Added once', status: 'open', kind: 'task', section: 'active' } };
  const added = Changes.apply(Changes.apply(TASKS, [add]), [add, add]);
  expect('rules', Object.values(added).filter((t) => t.title === 'Added once').length === 1, 'the same new task saved twice must be added once');
  const trashed = Changes.apply(TASKS, [{ id: 'x3', type: 'trash', taskId: 'b', at: at(0) }]);
  expect('rules', trashed.b.status === 'dropped' && trashed.b.droppedBy === 'josh', 'a trashed task must go to the Archive marked deleted');
  const sk = { id: 'x4', type: 'skip', file: 'suggestions', suggestionId: 's1', at: at(0) };
  expect('rules', Changes.applySuggestions(Changes.applySuggestions(SUGS, [sk]), [sk]).s1.changeIds.length === 1, 'a skip saved twice must land once');
  expect('rules', Changes.SAVING === true, 'saving should be on');
  const d = Todo.dueFrom('2026-12-02', '');
  expect('rules', d && d.dueNoTime === true && /T23:59:00-09:00$/.test(d.due), 'a day with no time should mean 11:59 PM Alaska time: got ' + (d && d.due));
  const d2 = Todo.dueFrom('2026-07-02', '14:30');
  expect('rules', d2 && /T14:30:00-08:00$/.test(d2.due), 'a summer time should use Alaska daylight time: got ' + (d2 && d2.due));
}

// ---- Saving, without a browser: a made-up data box that can say no, change under us, or lose a reply ----
function fakeStore() {
  const st = { files: { 'data/tasks.json': JSON.parse(JSON.stringify(TASKS)), 'data/suggestions.json': JSON.parse(JSON.stringify(SUGS)) }, ver: { 'data/tasks.json': 1, 'data/suggestions.json': 1 }, writes: 0, before: null, after: null };
  st.readWithVersion = async (p) => ({ data: st.nullRead ? null : JSON.parse(JSON.stringify(st.files[p])), version: st.ver[p] });
  st.writeIfUnchanged = async (p, data, v) => {
    if (st.before) { const f = st.before; st.before = null; f(p); }
    if (st.readonly) { const e = new Error('read only'); e.code = 'readonly'; throw e; }
    if (v !== st.ver[p]) return false;
    st.files[p] = JSON.parse(JSON.stringify(data)); st.ver[p]++; st.writes++;
    if (st.after) { const f = st.after; st.after = null; f(p); }
    return true;
  };
  return st;
}
async function saveRules() {
  console.log('Checking saving');
  const W1 = 'save';
  // 1. A tick saves, and the waiting list empties.
  let st = fakeStore(); Changes.start();
  let c = Changes.add({ type: 'tick', taskId: 'a' });
  let r = await Changes.save(st);
  expect(W1, r.saved && st.files['data/tasks.json'].a.status === 'done' && !Changes.list().length, 'a tick should save and leave nothing waiting');
  expect(W1, r.saved && r.files['data/tasks.json'] && r.files['data/tasks.json'].a.status === 'done', 'a save should hand back what it wrote, so the screen matches');
  // 2. Someone else saves in between (the robot adds a task): ours goes in on top, theirs stays.
  st = fakeStore(); Changes.start();
  Changes.add({ type: 'tick', taskId: 'b' });
  st.before = (p) => { st.files[p].r1 = { title: 'Added by the robot', kind: 'task', status: 'open', section: 'active' }; st.ver[p]++; };
  r = await Changes.save(st);
  const f2 = st.files['data/tasks.json'];
  expect(W1, r.saved && f2.r1 && f2.b.status === 'done', "when someone else saves first, both changes should end up in the file (got r1=" + !!f2.r1 + ', b=' + f2.b.status + ')');
  // 3. The save lands but the reply is lost: trying again must not put it in twice.
  st = fakeStore(); Changes.start();
  c = Changes.add({ type: 'add', taskId: 'z1', task: { title: 'Once only', kind: 'task', status: 'open', section: 'active' } });
  st.after = () => { const e = new Error('no signal'); e.code = 'offline'; throw e; };
  r = await Changes.save(st);
  expect(W1, !r.saved && Changes.list().length === 1, 'a save whose reply was lost should stay waiting');
  r = await Changes.save(st);
  const once = Object.values(st.files['data/tasks.json']).filter((t) => t.title === 'Once only').length;
  expect(W1, r.saved && once === 1, 'trying again after a lost reply must not add the task twice (found ' + once + ')');
  // 4. A key that can only read: the change waits, and the app stops asking until the key changes.
  st = fakeStore(); Changes.start(); st.readonly = true;
  Changes.add({ type: 'tick', taskId: 'c' });
  r = await Changes.save(st);
  const before = st.writes;
  const r2 = await Changes.save(st);
  expect(W1, r.why === 'readonly' && Changes.isReadOnly() && Changes.list().length === 1 && r2.why === 'readonly' && st.writes === before, 'a key that can only read should keep the change waiting and say so');
  Changes.start();
  expect(W1, !Changes.isReadOnly(), 'putting in a new key should try saving again');
  // 5. A bad read (nothing came back): nothing is written.
  st = fakeStore(); Changes.start(); st.nullRead = true;
  Changes.add({ type: 'tick', taskId: 'c' });
  r = await Changes.save(st);
  expect(W1, r.why === 'unsafe' && st.writes === 0 && Changes.list().length === 1, 'if the file reads back empty, the app must not write over it');
  // 6. A skip and an add from a possible task save to their own files.
  st = fakeStore(); Changes.start();
  Changes.add({ file: 'suggestions', type: 'skip', suggestionId: 's1' });
  Changes.add({ type: 'tick', taskId: 'd' });
  r = await Changes.save(st);
  expect(W1, r.saved && st.files['data/suggestions.json'].s1.status === 'skipped' && st.files['data/tasks.json'].d.status === 'done', 'a skip and a tick should each save to their own file');
  Changes.start();
}

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

// Runs inside the page: finds anything cut off, overlapping, under the phone's edges or the page bar,
// too faint, or too small to tap.
function inspect({ W, H, TOP, BOTTOM }) {
  const out = [];
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    if (el.closest('.ghost') || el.closest('#print')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) +
    (el.textContent.trim() ? ' "' + el.textContent.trim().slice(0, 30) + '"' : '');
  const tag = (el) => el.tagName.toLowerCase();
  // Things a person sees: text, icons, fields, buttons.
  let items = Array.from(document.querySelectorAll('body *')).filter((el) => {
    if (!vis(el)) return false;
    if (el.closest('svg') && tag(el) !== 'svg') return false;
    if (['svg', 'input', 'img', 'textarea'].includes(tag(el))) return true;
    return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  // When the Connect screen or a sheet is up it covers everything else, so only what's on it counts.
  const cover = [document.getElementById('connect')].concat(Array.from(document.querySelectorAll('.sheet'))).find(vis);
  if (cover) items = items.filter((el) => cover.contains(el));
  const rect = (el) => el.getBoundingClientRect();
  // Lists that scroll: content partly scrolled past an edge is fine there, so those edges are only
  // judged when the list is scrolled all the way to that end (the check looks at both ends).
  const sc = (el) => el.closest('[data-scrolls]');
  const pastTop = (el) => { const s = sc(el); return !!s && s.scrollTop > 1; };
  const notAtBottom = (el) => { const s = sc(el); return !!s && s.scrollTop + s.clientHeight < s.scrollHeight - 1; };
  const floats = (el) => el.closest('[data-floats]');
  const inBar = (el) => el.closest('.bar');
  const bar = document.querySelector('.bar').getBoundingClientRect();
  const barOnTop = bar.top < H / 2;
  for (const el of items) {
    const r = rect(el);
    const skipTop = pastTop(el) && r.top < Math.max(TOP, barOnTop ? bar.bottom : 0) + 2;
    const skipBottom = notAtBottom(el) && r.bottom > H - BOTTOM - (barOnTop ? 0 : bar.height) - 2;
    if (!skipTop && !skipBottom && (r.left < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5 || r.top < -0.5)) out.push(name(el) + ' is cut off at the screen edge');
    else if (!skipTop && r.top < TOP && !cover) out.push(name(el) + ' sits under the status bar');
    else if (!skipBottom && r.bottom > H - BOTTOM) out.push(name(el) + ' sits in the home swipe area');
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && !['svg', 'textarea', 'input'].includes(tag(el))) out.push(name(el) + ' has text cut off');
    // Page content must not hide under the page bar.
    if (cover || el.closest('.bar') || (barOnTop ? skipTop : skipBottom)) continue;
    if (r.bottom > bar.top + 0.5 && r.top < bar.bottom - 0.5) out.push(name(el) + ' is under the page bar');
  }
  // Nothing overlaps anything else (unless one sits inside the other). Floating buttons are judged
  // with the list scrolled to its end, where Josh can always scroll the last card clear of them.
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (a.closest('#toast') || b.closest('#toast')) continue;
    // Cards scrolling past pinned things (the floating buttons, the page bar) are judged at the list's ends.
    const passing = (x, y) => ((floats(x) || (inBar(x) && !barOnTop)) && notAtBottom(y)) || (inBar(x) && barOnTop && pastTop(y));
    if (passing(a, b) || passing(b, a)) continue;
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
    if (['svg', 'input', 'img', 'textarea'].includes(tag(el))) continue;
    const s = getComputedStyle(el);
    const L1 = lum(rgb(s.color)), L2 = lum(behind(el));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.5 && +s.fontWeight >= 700);
    const need = big ? 3 : (el.closest('.tab') ? 3 : 4.5); // bar labels sit beside their icon, like iOS
    if (ratio < need) out.push(name(el) + ' is too faint (' + ratio.toFixed(2) + ' to 1, needs ' + need + ')');
  }
  // Every button is at least 44 by 44, so a thumb hits it (Apple's rule).
  for (const b of document.querySelectorAll('button, a[href], input, textarea, select')) {
    if (!vis(b) || (cover && !cover.contains(b))) continue;
    const r = rect(b);
    if (r.width < 43.5 || r.height < 43.5) out.push(name(b) + ' is smaller than 44 by 44 (' + Math.round(r.width) + ' by ' + Math.round(r.height) + ')');
  }
  return out;
}

async function settle(page, ms) { await page.waitForTimeout(ms || 450); }
async function look(page, where, size) { for (const p of await page.evaluate(inspect, size)) problem(where, p); }
// Look at the TO-DO list at its top and at its end.
async function lookBothEnds(page, where, size, shot) {
  await page.evaluate(() => { document.querySelector('.td-scroll').scrollTop = 0; });
  await settle(page, 150);
  await look(page, where + ' (top)', size);
  if (shot) await page.screenshot({ path: path.join(OUT, shot + '.png') });
  await page.evaluate(() => { const s = document.querySelector('.td-scroll'); s.scrollTop = s.scrollHeight; });
  await settle(page, 150);
  await look(page, where + ' (end)', size);
  if (shot) await page.screenshot({ path: path.join(OUT, shot + '-end.png') });
  await page.evaluate(() => { document.querySelector('.td-scroll').scrollTop = 0; });
  await settle(page, 100);
}

// A made-up data box standing in for GitHub. The key decides what it allows:
//   'sample-key' can only read (writes are refused, like a read-only key); 'saving-key' can save.
// It checks versions like GitHub does, so a save on top of an old copy is refused.
// ctx.box: the files; ctx.wrote: saves it took; ctx.refused: saves refused; ctx.badPaths: writes to other files.
// ctx.box.trap: a hook a test can set to act just before the next save.
async function newContext(browser, scheme, size, extra) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: size.W, height: size.H }, deviceScaleFactor: size.W > 1000 ? 1 : 3, colorScheme: scheme }, extra));
  ctx.wrote = 0; ctx.refused = 0; ctx.badPaths = [];
  const box = ctx.box = { files: {}, ver: {}, n: 0, trap: null };
  for (const [p, d] of Object.entries(SAMPLE)) { box.files[p] = JSON.parse(JSON.stringify(d)); box.ver[p] = 'v' + (++box.n); }
  box.bump = (p) => { box.ver[p] = 'v' + (++box.n); };
  await ctx.route('https://api.github.com/**', (route) => {
    const req = route.request();
    const m = req.url().match(/\/contents\/([^?]+)/);
    const p = m && m[1];
    const auth = req.headers().authorization || '';
    if (req.method() === 'GET') {
      if (!p || !(p in box.files)) return route.fulfill({ status: 404, body: '' });
      if (/raw/.test(req.headers().accept || '')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(box.files[p]) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: box.ver[p], content: Buffer.from(JSON.stringify(box.files[p], null, 2) + '\n').toString('base64') }) });
    }
    if (req.method() !== 'PUT') { ctx.badPaths.push(req.method() + ' ' + p); return route.fulfill({ status: 405, body: '' }); }
    if (!['data/tasks.json', 'data/suggestions.json'].includes(p)) ctx.badPaths.push(p);
    if (!/saving-key/.test(auth)) { ctx.refused++; return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Resource not accessible by personal access token"}' }); }
    let lost = false;
    if (box.trap) { const t = box.trap; box.trap = null; const r = t(p); if (r === 'lost') lost = true; else if (r) return route.fulfill(r); }
    const body = JSON.parse(req.postData());
    if (body.sha !== box.ver[p]) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
    box.files[p] = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    box.bump(p);
    ctx.wrote++;
    if (lost) return route.fulfill({ status: 502, body: '' }); // it saved, but the phone never hears back
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: box.ver[p] } }) });
  });
  return ctx;
}
async function openConnected(ctx, base, edges) {
  const page = await ctx.newPage();
  await page.goto(base);
  if (edges) await page.addStyleTag({ content: edges });
  await page.waitForFunction(() => document.documentElement.dataset.loaded);
  if (await page.locator('#connect').isVisible()) {
    await page.fill('#connect-key', 'sample-key');
    await page.click('#connect-go');
  }
  await page.waitForFunction(() => document.documentElement.dataset.loaded === 'yes' && document.documentElement.dataset.todo === 'ready', null, { timeout: 8000 })
    .catch(() => problem('open', 'the TO-DO page did not get ready'));
  return page;
}
const cardIds = (page, sel) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel || '.td-list .card')).map((c) => c.dataset.id), sel);
async function tapTab(page, id) { await page.click(`.tdtab[data-tab-id="${id}"]`); await settle(page, 200); }
// Hold a card and drag it with the mouse to a spot.
async function dragCard(page, id, toSel, where, toTopEdge) {
  const from = await page.locator(`.td-list .card[data-id="${id}"] .t`).boundingBox();
  const to = await page.locator(toSel).first().boundingBox();
  if (!from || !to) { problem(where, 'could not find the card or the drop spot'); return; }
  const vh = page.viewportSize().height;
  if (from.y < 0 || from.y > vh - 120 || to.y < 0 || to.y > vh) { problem(where, 'the card or the drop spot is off screen, so the check could not drag it'); return; }
  const fx = from.x + 20, fy = from.y + 8;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.waitForTimeout(420);
  const tx = to.x + to.width / 2, ty = toTopEdge ? to.y + 6 : to.y + to.height / 2;
  for (let k = 1; k <= 14; k++) { await page.mouse.move(fx + (tx - fx) * k / 14, fy + (ty - fy) * k / 14); await page.waitForTimeout(16); }
  await page.waitForTimeout(80);
  await page.mouse.up();
  await settle(page, 250);
}

// ---- 2. The whole TO-DO page, on a phone ----
async function phoneTodo(page, scheme, size) {
  const T = scheme + ' TO-DO';
  await page.tap('.tab[data-tab="todo"]');
  await settle(page);
  await tapTab(page, 'all');
  expect(T, same(await cardIds(page), ['b', 'a', 'm', 'c', 'l', 'd']), 'All shows the wrong cards: ' + await cardIds(page));
  expect(T, !(await page.locator('.td-list').textContent()).includes('Robot history'), "a card shows the robot's notes; only Josh's own note may show");
  expect(T, (await page.locator('.td-list').textContent()).includes('Check Costco first'), "Josh's own note does not show");
  expect(T, await page.locator('.card[data-id="b"] .od').count() === 1, 'an overdue task has no yellow line');
  expect(T, await page.locator('.td-suggest').isVisible(), 'the possible task does not show');
  await lookBothEnds(page, T, size, scheme + '-todo');

  // Pictures stand out past the card's top edge.
  const pop = await page.evaluate(() => { const c = document.querySelector('.td-list .card'); return c.querySelector('.pic').getBoundingClientRect().top < c.getBoundingClientRect().top; });
  expect(T, pop, 'card pictures should stand past the top of their card');

  // Tick: the card goes into Done, the "waiting to save" note shows, and nothing is written.
  await page.tap('.card[data-id="a"] .tick');
  await settle(page, 200);
  expect(T + ' tick', !(await cardIds(page)).includes('a'), 'a ticked task stayed in the list');
  expect(T + ' tick', (await page.locator('.done-count').textContent()).trim() === '2', 'the Done folder should now hold 2');
  // The key in this part can only read: the change waits on the phone and the page says why.
  await page.waitForSelector('.td-pending[data-state="readonly"]', { timeout: 4000 }).catch(() => {});
  expect(T + ' tick', await page.locator('#toast').isVisible(), 'the "this key can only read" note did not show');
  expect(T + ' tick', /1 change waiting to save: this key can only read/.test(await page.locator('.td-pending').textContent()), 'the waiting line should count the change and say the key can only read (got "' + (await page.locator('.td-pending').textContent()) + '")');
  await page.tap('.done-toggle');
  await settle(page, 200);
  expect(T + ' Done', (await cardIds(page, '.done-list .card')).join() === 'a,i', 'the Done folder shows the wrong tasks: ' + await cardIds(page, '.done-list .card'));
  await settle(page, 3500); // let the note fade so the pictures show the page itself
  await lookBothEnds(page, T + ' Done open', size, scheme + '-todo-done');
  await page.tap('.done-list .card[data-id="a"] .tick'); // untick
  await settle(page, 200);
  expect(T + ' untick', (await cardIds(page)).includes('a'), 'unticking did not bring the task back');

  // Tick a step.
  await page.tap('.card[data-id="c"] .sub[data-sub="1"]');
  await settle(page, 150);
  expect(T + ' step', (await page.locator('.card[data-id="c"] .sub[data-sub="1"]').getAttribute('aria-pressed')) === 'true', 'ticking a step did not stick');

  // Only overdue.
  await page.tap('.td-head .only');
  await settle(page, 150);
  expect(T + ' only overdue', (await cardIds(page)).join() === 'b', 'Only overdue should leave just the overdue task: ' + await cardIds(page));
  await page.tap('.td-head .only');
  await settle(page, 150);

  // Other tabs.
  await tapTab(page, 'overdue');
  expect(T + ' Overdue', (await cardIds(page)).join() === 'f,b', 'the Overdue tab shows the wrong cards: ' + await cardIds(page));
  await look(page, T + ' Overdue', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-overdue.png') });
  await tapTab(page, 'jpn');
  expect(T + ' JPN', (await cardIds(page)).join() === 'm,e', 'the JPN tab shows the wrong cards: ' + await cardIds(page));
  await look(page, T + ' JPN', size);
  await tapTab(page, 'all');

  // The + form.
  await page.tap('.td-fabs .plus');
  await settle(page, 300);
  await look(page, T + ' add form', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-add.png') });
  await page.fill('#add-name', 'Sample added from the form');
  await page.fill('#add-note', 'My own note');
  await page.tap('#add-form .wide');
  await settle(page, 200);
  expect(T + ' add', await page.locator('.td-list .card .t', { hasText: 'Sample added from the form' }).count() === 1, 'the new task did not show');
  expect(T + ' add', await page.locator('.td-list .card .n', { hasText: 'My own note' }).count() === 1, "the new task's note did not show");

  // Drag: reorder, move to a tab, and trash.
  await page.evaluate(() => { document.querySelector('.td-scroll').scrollTop = 0; });
  await settle(page, 150);
  const waitCount = async () => Number(((await page.locator('.td-pending').textContent()).match(/\d+/) || [0])[0]);
  const beforeDrag = await waitCount();
  await dragCard(page, 'm', '.td-list .card[data-id="b"]', T + ' reorder', true);
  expect(T + ' reorder', (await waitCount()) === beforeDrag + 1, 'one drag should add one line to the waiting-to-save list');
  expect(T + ' reorder', await page.evaluate(() => !document.querySelector('.card.ghost')), 'the dragged copy of the card was left on screen');
  expect(T + ' reorder', (await cardIds(page))[0] === 'm', 'dragging a card to the top did not keep it there: ' + await cardIds(page));
  await page.evaluate(() => { document.querySelector('.td-scroll').scrollTop = 0; });
  await settle(page, 150);
  const mv = (await cardIds(page))[1];
  await dragCard(page, mv, '.tdtab[data-tab-id="bucket"]', T + ' move');
  expect(T + ' move', !(await cardIds(page)).includes(mv), 'a card dropped on Bucket List stayed in All');
  await tapTab(page, 'bucket');
  expect(T + ' move', (await cardIds(page)).includes(mv), 'a card dropped on Bucket List is not there');
  await tapTab(page, 'all');
  const gone = (await cardIds(page))[1];
  const goneTitle = TASKS[gone] ? TASKS[gone].title : '?';
  const m = await page.locator(`.td-list .card[data-id="${gone}"] .t`).boundingBox();
  await page.mouse.move(m.x + 20, m.y + 8); await page.mouse.down(); await page.waitForTimeout(420);
  await page.mouse.move(m.x + 30, m.y + 40, { steps: 4 });
  await page.waitForTimeout(100);
  expect(T + ' trash', await page.locator('.td-trash').isVisible(), 'the trash did not show while dragging');
  const ghostBg = await page.evaluate(() => { const g = document.querySelector('.card.ghost'); return g ? getComputedStyle(g).backgroundColor : 'none'; });
  expect(T + ' drag', /^rgb\(/.test(ghostBg), 'the card being dragged has no solid background (got ' + ghostBg + ')');
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-dragging.png') });
  const tr = await page.locator('.td-trash').boundingBox();
  if (tr) await page.mouse.move(tr.x + tr.width / 2, tr.y + tr.height / 2, { steps: 10 });
  await page.waitForTimeout(80); await page.mouse.up(); await settle(page, 250);
  expect(T + ' trash', !(await cardIds(page)).includes(gone), 'a card dropped on the trash stayed');

  // ?, the menu, the Archive, Settings, the waiting list.
  await page.tap('.td-fabs [data-open="sheet-questions"]');
  await settle(page, 250);
  expect(T + ' ?', (await page.locator('#q-list').textContent()).includes('Is the sample still on?'), 'the question list is missing a question');
  await look(page, T + ' questions', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-questions.png') });
  await page.tap('#sheet-questions [data-close]');
  await page.tap('.td-fabs [data-open="sheet-menu"]');
  await settle(page, 250);
  await look(page, T + ' menu', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-menu.png') });
  await page.tap('#sheet-menu [data-open="sheet-archive"]');
  await settle(page, 250);
  const arch = await page.locator('#archive-list').textContent();
  expect(T + ' Archive', arch.includes('Old finished one') && arch.includes('A deleted one'), 'the Archive is missing finished or deleted tasks');
  expect(T + ' Archive', arch.includes(goneTitle), 'a task trashed on screen should show in the Archive');
  await look(page, T + ' Archive', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-archive.png') });
  await page.tap('#sheet-archive [data-close]');
  await page.tap('.td-fabs [data-open="sheet-menu"]');
  await page.tap('#sheet-menu [data-open="sheet-settings"]');
  await settle(page, 250);
  await look(page, T + ' Settings', size);
  await page.tap('#sheet-settings [data-close]');
  await page.tap('.td-pending');
  await settle(page, 250);
  expect(T + ' waiting list', (await page.locator('#waiting-list li').count()) >= 6, 'the waiting-to-save list is missing changes');
  await look(page, T + ' waiting list', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-waiting.png') });
  await page.tap('#sheet-waiting [data-close]');
  await settle(page, 200);
}

// How dark the page is: 0 is black, 255 is white. Used to check that the phone follows its setting and a PC is always dark.
async function darkness(page) {
  return page.evaluate(() => {
    const read = (el) => { const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); };
    return { body: read(document.body), todo: read(document.getElementById('page-todo')) };
  });
}

async function run() {
  rules();
  await saveRules();
  if (process.env.RULES_ONLY) { console.log(problems.length ? problems.length + ' problem(s).' : 'Rules and saving: all good.'); process.exit(problems.length ? 1 : 0); }
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/my-app/v2/';
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const edges = `:root{--safe-top:${TOP}px!important;--safe-bottom:${BOTTOM}px!important}`;
  const phone = { W, H, TOP, BOTTOM };
  const pc = { W: PC.W, H: PC.H, TOP: 0, BOTTOM: 0 };

  for (const scheme of ['light', 'dark']) {
    console.log('Checking ' + scheme + ' mode (phone)');
    const ctx = await newContext(browser, scheme, phone, { hasTouch: true, isMobile: true });

    // 1. No key on this phone yet: the Connect screen shows and looks right.
    const page = await ctx.newPage();
    await page.goto(base);
    await page.addStyleTag({ content: edges });
    await page.waitForFunction(() => document.documentElement.dataset.loaded);
    if (await page.locator('#connect').isHidden()) problem(scheme + ' first open', 'the Connect screen did not show with no key');
    await look(page, scheme + ' Connect screen', phone);
    await page.screenshot({ path: path.join(OUT, `${scheme}-connect.png`) });

    // 2. Connect with a (made-up) key; the data loads.
    await page.fill('#connect-key', 'sample-key');
    await page.tap('#connect-go');
    await page.waitForFunction(() => document.documentElement.dataset.loaded === 'yes', null, { timeout: 8000 }).catch(() => {});
    if (!(await page.locator('#connect').isHidden())) problem(scheme + ' connect', 'the Connect screen did not close');
    const ph = await darkness(page);
    if (scheme === 'light') expect(scheme + ' phone colors', ph.body > 200 && ph.todo > 200, 'a phone set to light should show the light colors (got ' + JSON.stringify(ph) + ')');
    else expect(scheme + ' phone colors', ph.body < 50 && ph.todo < 50, 'a phone set to dark should show the dark colors (got ' + JSON.stringify(ph) + ')');

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
      if (id !== 'todo') { await look(page, `${scheme} ${id}`, phone); await page.screenshot({ path: path.join(OUT, `${scheme}-${id}.png`) }); }
    }

    // 4. Swiping: move the pages the way a finger does, and the bar follows.
    await page.evaluate(() => { const p = document.getElementById('pages'); p.scrollLeft = 0; });
    await settle(page);
    if ((await page.evaluate(() => document.querySelector('.tab[aria-current="page"]').dataset.tab)) !== 'todo') problem(scheme + ' swipe', 'swiping back to TO-DO did not update the bar');

    // 5. The TO-DO page, all of it.
    await phoneTodo(page, scheme, phone);

    // 6. Reopen: lands on the page used last.
    await page.tap('.tab[data-tab="finance"]');
    await settle(page, 1300);
    const before = await page.evaluate(() => ({ stored: localStorage.getItem('hub2.lastPage'), bar: document.querySelector('.tab[aria-current="page"]')?.dataset.tab, x: document.getElementById('pages').scrollLeft }));
    await page.reload();
    await page.addStyleTag({ content: edges });
    await page.waitForFunction(() => document.documentElement.dataset.loaded === 'yes', null, { timeout: 8000 }).catch(() => problem(scheme + ' reopen', 'the data did not load with the saved key'));
    const reopened = await page.evaluate(() => { const p = document.getElementById('pages'); return Math.round(p.scrollLeft / p.clientWidth); });
    if (reopened !== 1) {
      const after = await page.evaluate(() => ({ stored: localStorage.getItem('hub2.lastPage'), bar: document.querySelector('.tab[aria-current="page"]')?.dataset.tab, x: document.getElementById('pages').scrollLeft, w: document.getElementById('pages').clientWidth }));
      problem(scheme + ' reopen', 'did not open on the page used last (Finance). Before: ' + JSON.stringify(before) + ' After: ' + JSON.stringify(after));
    }

    if (ctx.badPaths.length) problem(scheme, 'the app tried to write somewhere it never should: ' + ctx.badPaths.join(', '));
    if (ctx.refused > 3) problem(scheme, `with a key that can only read, the app kept trying to save (${ctx.refused} times); it should stop after the first no`);
    await ctx.close();

    // 7. PC: tabs down the left, buttons along the top, Done on the right.
    console.log('Checking ' + scheme + ' mode (PC)');
    const pctx = await newContext(browser, scheme, pc, {});
    const pp = await openConnected(pctx, base);
    await pp.click('.tab[data-tab="todo"]');
    await settle(pp);
    const layout = await pp.evaluate(() => {
      const tabs = document.querySelector('.td-tabs').getBoundingClientRect();
      const list = document.querySelector('.td-list').getBoundingClientRect();
      const add = document.querySelector('.td-head .addbtn').getBoundingClientRect();
      return { tabsLeft: tabs.right <= list.left, addTop: add.bottom <= list.top, fabs: getComputedStyle(document.querySelector('.td-fabs')).display };
    });
    expect(scheme + ' PC', layout.tabsLeft, 'the tabs should run down the left of the list');
    expect(scheme + ' PC', layout.addTop, 'the buttons should sit along the top');
    expect(scheme + ' PC', layout.fabs === 'none', 'the floating phone buttons should not show on a PC');
    const pcd = await darkness(pp);
    expect(scheme + ' PC colors', pcd.body < 50 && pcd.todo < 50, 'a PC should always be dark, even when set to light (got ' + JSON.stringify(pcd) + ')');
    await lookBothEnds(pp, scheme + ' PC TO-DO', pc, scheme + '-pc-todo');
    await dragCard(pp, 'a', '.tdtab[data-tab-id="waiting"]', scheme + ' PC move');
    await tapTab(pp, 'waiting');
    expect(scheme + ' PC move', (await cardIds(pp)).includes('a'), 'a card dragged onto Waiting is not there');
    await tapTab(pp, 'all');
    await pp.click('.td-head .addbtn');
    await settle(pp, 250);
    await look(pp, scheme + ' PC add form', pc);
    await pp.screenshot({ path: path.join(OUT, scheme + '-pc-todo-add.png') });
    if (pctx.badPaths.length) problem(scheme + ' PC', 'the app tried to write somewhere it never should: ' + pctx.badPaths.join(', '));
    await pctx.close();
  }

  // 8. Saving, the way Josh will do it: a key that can only read first, then Settings > Change key.
  console.log('Checking saving on the phone');
  const sctx = await newContext(browser, 'light', phone, { hasTouch: true, isMobile: true });
  const sp = await openConnected(sctx, base, edges);
  const S = 'saving';
  await sp.tap('.tab[data-tab="todo"]');
  await settle(sp);
  const state = () => sp.locator('.td-pending').getAttribute('data-state');
  const waitSaved = async (where) => {
    await sp.waitForFunction(() => ['saved', 'none'].includes(document.querySelector('.td-pending').dataset.state), null, { timeout: 8000 })
      .catch(async () => problem(where, 'changes did not save (the line says "' + (await sp.locator('.td-pending').textContent()) + '", last try: ' + (await sp.locator('.td-pending').getAttribute('data-why')) + ', saves taken: ' + sctx.wrote + ')'));
  };
  await sp.tap('.card[data-id="a"] .tick');
  await sp.waitForSelector('.td-pending[data-state="readonly"]', { timeout: 4000 }).catch(() => problem(S, 'a key that can only read was not spotted'));
  await sp.tap('.td-pending');
  await settle(sp, 300);
  expect(S, await sp.locator('#waiting-change-key').isVisible(), 'the waiting list should offer to put in a key that can save');
  await look(sp, S + ' waiting list (read-only key)', phone);
  await sp.screenshot({ path: path.join(OUT, 'light-todo-waiting-readonly.png') });
  await sp.tap('#sheet-waiting [data-close]');
  await settle(sp, 200);
  await sp.locator('[data-open="sheet-menu"]:visible').first().tap();
  await settle(sp, 200);
  await sp.tap('#sheet-menu [data-open="sheet-settings"]');
  await settle(sp, 200);
  await sp.tap('#settings-change-key');
  await settle(sp, 200);
  expect(S, await sp.locator('#connect').isVisible() && await sp.locator('#connect-cancel').isVisible(), 'Change key should show the key screen with a Not now button');
  await look(sp, S + ' change key screen', phone);
  await sp.screenshot({ path: path.join(OUT, 'light-change-key.png') });
  await sp.fill('#connect-key', 'saving-key');
  await sp.tap('#connect-go');
  await sp.waitForFunction(() => document.getElementById('connect').hidden, null, { timeout: 5000 }).catch(() => problem(S, 'the key screen did not close'));
  await waitSaved(S + ' after a new key');
  let file = sctx.box.files['data/tasks.json'];
  expect(S, file.a.status === 'done' && file.a.doneBy === 'josh', 'the tick made before the new key went in did not save');
  await sp.screenshot({ path: path.join(OUT, 'light-todo-saved.png') });

  // Someone else (the robot) saves just before the phone does: both changes must end up in the file, and show.
  sctx.box.trap = (p) => { sctx.box.files[p].r1 = { title: 'Added by the robot', kind: 'task', status: 'open', section: 'active', priority: 5 }; sctx.box.bump(p); return null; };
  await sp.tap('.card[data-id="b"] .tick');
  await waitSaved(S + ' when the robot saved first');
  file = sctx.box.files['data/tasks.json'];
  expect(S, file.r1 && file.b.status === 'done', 'when the robot saved first, one of the two changes was lost');
  await settle(sp, 300);
  expect(S, (await cardIds(sp)).includes('r1'), "after saving, the robot's new task should show too");

  // The save lands but the phone never hears back: the next save must not put it in twice.
  sctx.box.trap = () => 'lost';
  await sp.tap('.card[data-id="c"] .tick');
  await sp.waitForSelector('.td-pending[data-state="waiting"]', { timeout: 5000 }).catch(() => {});
  await sp.tap('.card[data-id="m"] .tick');
  await waitSaved(S + ' after a lost reply');
  file = sctx.box.files['data/tasks.json'];
  expect(S, file.c.status === 'done' && file.m.status === 'done' && (file.c.changeIds || []).length === 1, 'after a lost reply the change landed ' + (file.c.changeIds || []).length + ' times, or the next change did not save');

  // Reopening with nothing waiting writes nothing.
  const wroteBefore = sctx.wrote;
  await sp.reload();
  await sp.waitForFunction(() => document.documentElement.dataset.todo === 'ready', null, { timeout: 8000 }).catch(() => {});
  await settle(sp, 1500);
  expect(S, sctx.wrote === wroteBefore, 'reopening with nothing waiting should not write anything');
  expect(S, !(await sp.locator('.td-pending').isVisible()), 'after reopening, nothing should be waiting to save');
  if (sctx.badPaths.length) problem(S, 'the app tried to write somewhere it never should: ' + sctx.badPaths.join(', '));
  await sctx.close();

  // 9. Reduce Motion: the pictures stay inside their cards.
  console.log('Checking Reduce Motion');
  const cctx = await newContext(browser, 'light', phone, { hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const cp = await openConnected(cctx, base, edges);
  await cp.tap('.tab[data-tab="todo"]');
  await settle(cp);
  const inside = await cp.evaluate(() => { const c = document.querySelector('.td-list .card'); return c.querySelector('.pic').getBoundingClientRect().top >= c.getBoundingClientRect().top - 0.5; });
  expect('Reduce Motion', inside, 'with Reduce Motion on, pictures should stay inside their cards');
  await look(cp, 'Reduce Motion TO-DO', phone);
  await cp.screenshot({ path: path.join(OUT, 'light-todo-reduce-motion.png') });
  await cctx.close();

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
