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

// ---- Made-up sample data, shaped like the real files. Dates are set around midday today (Alaska time). ----
// The pages run on this same clock (see newContext), so a check that runs across midnight can't see two
// different days. Late at night is checked on purpose, in its own pass.
const NOW = (() => {
  const t = Date.now();
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Anchorage', hour: 'numeric', hourCycle: 'h23' }).format(t));
  return t + (12 - h) * 36e5;
})();
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
// A calendar copy shaped like the real one, around today (Anchorage time).
const Plan = require('../plan.js');
const Money = require('../money.js');
const FinSave = require('../finsave.js');
const TODAY = Plan.dayKey(NOW);
const T = (dayOff, h, m) => new Date(Plan.dayStart(Plan.addDays(TODAY, dayOff)) + ((h * 60 + (m || 0)) * 60000)).toISOString();
const ev = (id, summary, dayOff, h1, m1, h2, m2) => ({ id, summary, start: { dateTime: T(dayOff, h1, m1) }, end: { dateTime: T(dayOff, h2, m2) } });
const allDay = (id, summary, dayOff) => ({ id, summary, start: { date: Plan.addDays(TODAY, dayOff) }, end: { date: Plan.addDays(TODAY, dayOff + 1) } });
const RANGE = { from: Plan.addDays(TODAY, -8), to: Plan.addDays(TODAY, 20), fetchedAt: at(0, -1) };
const WEEK = [-3, -2, -1, 0, 1, 2, 3];
const CALENDAR = {
  work: Object.assign({ name: 'Work Schedule', events: WEEK.map((d) => ev('w' + d, 'Work (Midtown)', d, 10, 0, 15, 0)) }, RANGE),
  class: Object.assign({ name: 'Class Schedule', events: [
    allDay('dorm', 'Dorm Night', 0),
    ev('bk', 'Creekside Eatery Breakfast', 0, 7, 30, 9, 30),
    ev('long', 'A long class name that has to wrap inside its block without spilling into the next one', 0, 14, 0, 15, 30),
    ev('cw', 'Classwork Time', 0, 15, 30, 16, 30),
    ev('jpn', 'Elementary Japanese I', 0, 17, 30, 19, 10),
    ev('wr', 'Introduction to College Writing', 1, 17, 30, 18, 45),
  ] }, RANGE),
  gym: Object.assign({ name: 'Gym Schedule', events: [ev('g1', 'Gym', 1, 18, 0, 19, 0)] }, RANGE),
  main: Object.assign({ name: 'My calendar', events: [
    ev('din', 'Creekside Eatery Dinner', 0, 16, 30, 17, 30),
    ev('q', 'Quick call', 0, 12, 0, 12, 10),
    ev('late', 'Movie night', 0, 22, 30, 23, 59),
    ev('mirror', 'Due: Print the bus pass', 0, 11, 0, 11, 30), // the calendar's copy of a task already ticked: must not show
  ] }, RANGE),
  storage: Object.assign({ name: 'Storage Schedule', events: [allDay('s1', 'Foothills Josh F 10-6', 0)] }, RANGE),
  bb: Object.assign({ name: 'University of Alaska', events: [ev('b1', 'New Event 8/26/26', 0, 17, 30, 18, 30)] }, RANGE),
};
const BRIEF = { current: { date: TODAY, headline: 'Sample day: work until 3, then the Japanese class.', setAt: at(0, -2),
  html: '<!doctype html><html><head><style>body{}</style></head><body><div class="band top"><div class="inner"><h1>Sample day</h1><svg><text>skip</text></svg>' +
    '<div class="acts"><div class="act"><p class="t">10 AM – 3 PM</p><p>The Midtown shift.</p></div></div></div></div>' +
    '<div class="band bottom"><div class="inner"><h2>Needs attention</h2><ol class="list"><li><span class="num">1</span><div class="body"><p class="title"><a href="https://example.com/">Read chapter 7</a></p><p>Due tomorrow, <a href="https://example.com/">on your TO-DO</a>.</p></div></li></ol>' +
    '<h2>Resolved</h2><ol class="list"><li><span class="num">1</span><div class="body"><p class="title">Bus pass printed</p><p>Done yesterday.</p></div></li></ol><p>Money: nothing new.</p></div></div>' +
    '<script>document.title = "a brief must never run code"</script></body></html>' } };
// Made-up money: a paycheck six days ago, a week of charges (one person payment with no reason yet, one pending,
// one bought twice the same day), two accounts, savings, a debt with a payment due, wishlists, a store rule.
const dayN = (n) => Plan.dayKey(NOW + n * 864e5);
const TX = [
  ['t01', -6, 950, 'First National Bank Alaska', 'Arctic Sample paycheck', 'income', 'income'],
  ['t02', -6, -42.18, 'First National Bank Alaska', 'Corner Store Anchorage AK', 'groceries', '50'],
  ['t03', -5, -38.5, 'First National Bank Alaska', 'Sample Gas Station', 'gas', 'gas'],
  ['t04', -4, -10.99, 'Cash App', 'Sample Music · Cash App Card', 'subscriptions', 'subs'],
  ['t05', -3, -24.75, 'Cash App', 'DoorDash Sample Diner · Cash App Card', 'food', '30'],
  ['t06', -3, -24.75, 'Cash App', 'DoorDash Sample Diner · Cash App Card', 'food', '30'],
  ['t07', -2, -40, 'Cash App', 'CASH APP*SAMPLE FRIEND', 'people', '30'],
  ['t08', -2, 60, 'Cash App', 'Transfer from bank', 'transfer', 'transfer'],
  ['t09', -2, -60, 'First National Bank Alaska', 'Transfer to Cash App', 'transfer', 'transfer'],
  ['t10', -1, -55, 'First National Bank Alaska', 'Sample Clinic Anchorage AK', 'medical', 'medical'],
  ['t11', -1, -18.4, 'First National Bank Alaska', 'Sample Bookshop with a rather long name that keeps going', 'shopping', '30'],
  ['t12', 0, -6.25, 'Cash App', 'Sample Coffee · Cash App Card', 'food', '30', 1],
].map(([id, n, a, k, s, cat, u, p]) => ({ id, d: dayN(n), a, k, s, cat, c: cat, u, m: 0, p: p || 0 }));
const MONTHS = {};
for (const t of TX) (MONTHS[t.d.slice(0, 7)] = MONTHS[t.d.slice(0, 7)] || { txns: [] }).txns.push(t);
const FIN = {
  tracker: { anchors: { 'First National Bank Alaska': { amount: 512.34, date: TODAY }, 'Cash App': { amount: 21.6, date: TODAY } } },
  rules: { gas: 120, subs: [{ name: 'Sample Music', monthly: 10.99, billDay: +dayN(-4).slice(8) }] },
  savings: { efund: { account: 'Sample savings', saved: 250, asOf: dayN(-1) }, other: [{ name: 'Cash App Savings', amount: 30, goal: 'Laptop', asOf: dayN(-1) }] },
  debts: { items: [{ id: 'd1', name: 'Sample phone plan', owedTo: 'Sample Wireless', owed: 120, total: 200 }, { id: 'd2', name: 'Paid back a friend', owedTo: 'Sample Friend', owed: 0, total: 50 }],
    payments: [{ id: 'p1', debtId: 'd1', name: 'Sample phone plan', amount: 40, due: dayN(5), paid: false }] },
  wishlists: { lists: [{ id: 'l_tech', name: 'Tech', items: [{ id: 'w1', name: 'Sample laptop', amount: 600, saved: 30, setAside: [{ amount: 30, paycheck: dayN(-6), at: at(-1) }] }, { id: 'w2', name: 'Old headphones', amount: 80, saved: 80, bought: dayN(-10) }] }] },
  exceptions: { items: [{ id: 'x1', name: 'Concert ticket', amount: 45, bucket: '30', when: dayN(8) }] },
  storeRules: { items: [{ id: 'r1', store: 'Corner Store', cat: 'groceries', u: '50', at: at(-3) }] },
};
const SAMPLE = {
  'meta/app.json': { name: 'sample' },
  'data/tasks.json': TASKS,
  'data/suggestions.json': SUGS,
  'data/fin.json': FIN,
  'data/fin.config.months.json': MONTHS,
  'data/calendar.json': CALENDAR,
  'data/brief.json': BRIEF,
};
const flat = (tab) => Todo.listFor(TASKS, tab, NOW).flat();
const EXPECT = {
  todo: flat('all').length + ' open · ' + flat('all').filter(([, t]) => Todo.isOverdue(t, NOW)).length + ' overdue',
  finance: 'Next paycheck ' + Money.longDay(Money.work(FIN, MONTHS, null, new Date(NOW)).nextPaycheck), plan: Plan.dueLine(Plan.dueToday(TASKS, NOW).length),
};
const LATE_N = Plan.overdue(TASKS, NOW).length;

const problems = [];
// With Josh's real data, this check's log is public: what a problem names (a task, an event) is left out of it.
const REAL = process.env.REAL_DATA_DIR || '';
const scrub = (t) => (REAL ? String(t).replace(/ "[^"]*"/g, ' (name hidden)') : t);
function problem(where, what) { problems.push(where + ': ' + scrub(what)); console.log('  FAIL ' + where + ': ' + scrub(what)); }
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

// ---- 1b. The Plan rules, on their own ----
function planRules() {
  console.log('Checking the Plan rules');
  const W = 'plan rules';
  const evs = Plan.eventsOf(CALENDAR);
  const names = evs.map((e) => e.name);
  expect(W, !names.some((n) => /^Due:/.test(n)), "the calendar's \"Due:\" copies must not show (due items come from the task list)");
  expect(W, !names.includes('Foothills Josh F 10-6') && !names.includes('New Event 8/26/26'), "the store's calendar and the Blackboard copy should be left out");
  expect(W, names.includes('Gym') && names.includes('Work (Midtown)') && names.includes('Dorm Night'), 'Work, Class, Gym and main calendars should all show');
  expect(W, Plan.eventsOf({ x: { name: 'Brand new calendar', events: [ev('n', 'Something new', 0, 9, 0, 10, 0)] } }).map((e) => e.kind).join() === 'main', 'a calendar Plan has never seen must still show (in the main color)');
  const due = Plan.dueOf(TASKS, NOW);
  expect(W, !due.some((d) => d.taskId === 'i'), 'a ticked task must not show as due');
  expect(W, due.some((d) => d.taskId === 'g' && d.name === 'Due: Read chapter 7'), 'an open task with a due date should show as due, under its current name');
  expect(W, due.filter((d) => d.late).map((d) => d.taskId).sort().join() === 'b,f', 'only overdue tasks may be yellow');
  expect(W, Plan.overdue(TASKS, NOW).map((x) => x.id).join() === 'f,b', 'the overdue list should be oldest first');
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return { h: 0, s: 0 }; const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: (h * 60 + 360) % 360, s: d / mx }; };
  expect(W, Object.values(Plan.KINDS).every((k) => { const c = hue(k.color); return !(c.s > 0.5 && c.h >= 38 && c.h <= 70); }), 'no calendar may be yellow: yellow only means overdue');
  const day = Plan.dayOf(evs, TODAY, 20);
  const work = day.timed.find((x) => x.name === 'Work (Midtown)'), long = day.timed.find((x) => /long class/.test(x.name));
  expect(W, work && long && work.cols === 2 && long.cols === 2 && work.col !== long.col, 'things at the same time should sit side by side');
  const brk = day.timed.find((x) => /Breakfast/.test(x.name));
  expect(W, brk && Math.round(brk.a) === 450 && Math.round(brk.b) === 570, 'breakfast should run 7:30 to 9:30 (got ' + (brk && [brk.a, brk.b]) + ')');
  expect(W, day.allDay.map((x) => x.name).join() === 'Dorm Night', 'all-day events should sit in the all-day row');
  const r = Plan.rangeOf(CALENDAR);
  expect(W, Plan.loaded(r, TODAY) && !Plan.loaded(r, Plan.addDays(TODAY, 40)), 'a day outside the calendar copy should count as not copied yet');
  expect(W, Plan.headline(BRIEF, NOW, day) === BRIEF.current.headline, "today's brief headline should be the top line");
  const old = { current: Object.assign({}, BRIEF.current, { date: Plan.addDays(TODAY, -1) }) };
  expect(W, Plan.headline(old, NOW, day) !== BRIEF.current.headline, "yesterday's brief must not show as today's");
  expect(W, new Date(Plan.dayStart('2027-03-14')).toISOString() === '2027-03-14T09:00:00.000Z' && new Date(Plan.dayStart('2027-03-15')).toISOString() === '2027-03-15T08:00:00.000Z', 'days should start at midnight Alaska time, also across the clock change');
  expect(W, Plan.weekStart('2026-11-25') === '2026-11-22', 'weeks should start on Sunday');
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
// ---- Finance rules: the money math and the saving rules, without a browser ----
function finRules() {
  const F = 'Finance rules';
  const w = Money.work(FIN, MONTHS, null, new Date(NOW));
  const B = w.budget;
  expect(F, B, 'the buckets did not work out from the sample paycheck');
  if (B) {
    // The buckets' "left" amounts plus what's held add up to what's in the accounts (Total debt isn't part of it).
    const sum = B.tiles.filter((t) => t.key !== 'debt').reduce((a, t) => a + Math.max(0, t.left), 0) + B.alsoHeld - B.shortBy;
    expect(F, Math.abs(sum - B.balance) < 0.02, 'the buckets do not add up to the accounts (' + sum.toFixed(2) + ' vs ' + B.balance + ')');
    expect(F, B.tiles.some((t) => t.key === 'debt' && t.name === 'Total debt'), 'there is no Total debt bucket');
  }
  const rows = w.activity.flatMap((d) => d.rows);
  expect(F, rows.filter((r) => r.double).length === 2, 'the same charge twice on one day should be flagged');
  expect(F, rows.some((r) => r.ask), 'money sent to a person should ask what it was for');
  expect(F, rows.some((r) => r.pending), 'a pending charge should show as pending');
  expect(F, rows.some((r) => r.ruled), 'a store rule should show on its charges');
  expect(F, !rows.some((r) => /^Cash App to (to|from)\b/i.test(r.name)), 'a Cash App name came out as "Cash App to to"');
  // Every label is spelled out: no short names in the money words.
  const words = JSON.stringify([Object.values(Money.BUCKETS), Object.values(Money.CATS).map((c) => c.name), Object.values(Money.GROUPS)]);
  expect(F, !/\b(subs|Subs|misc|w\/|\$\d+k)\b/.test(words), 'a Finance label is shortened: ' + (words.match(/\b(subs|Subs|misc|w\/)\b/) || [''])[0]);
  // Saving: each change lands once, a file never shrinks, and every change adds one line to the change log.
  const c1 = { id: 'c1', at: at(0), type: 'addNote', note: { id: 'n1', page: 'finance', text: 'Lent $40' } };
  const once = FinSave.apply('notes', null, [c1]);
  const twice = FinSave.apply('notes', once, [c1]);
  expect(F, once.items.length === 1 && twice.items.length === 1, 'a note could land twice');
  const fx = { id: 'c2', at: at(0), type: 'fixCharge', txId: 't05', name: 'Dinner', cat: 'food', bucket: '30' };
  const m1 = FinSave.apply('months', MONTHS, [fx]);
  const t5 = Money.allTx(m1).find((t) => t.id === 't05');
  expect(F, t5.name === 'Dinner' && t5.lb === 'josh' && (t5.changeIds || []).length === 1, 'fixing a charge did not mark it as his');
  expect(F, FinSave.size(FinSave.apply('months', m1, [fx])) === FinSave.size(m1), 'fixing the same charge again changed the file');
  const r = FinSave.apply('fin', FIN, [{ id: 'c3', at: at(0), type: 'undoRule', ruleId: 'r1' }]);
  expect(F, r.storeRules.items.length === 1 && r.storeRules.items[0].undone, 'undoing a store rule should switch it off, not delete it');
  expect(F, FinSave.size(r) >= FinSave.size(FIN), 'undoing a store rule made the money file smaller');
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
  // 4b. A "can only read" answer about the OLD key that arrives after the new key went in must not mark the new key.
  st = fakeStore(); Changes.start(); st.readonly = true;
  Changes.add({ type: 'tick', taskId: 'c' });
  st.before = () => { Changes.start(); }; // the new key goes in while the old key's save is on its way
  await Changes.save(st);
  expect(W1, !Changes.isReadOnly(), "an answer about the old key marked the new key as read-only");
  // 4c. A save writes the file the way it is already written (the robot's \u2019 codes, or the old app's plain letters),
  // so only the changed lines differ and the writers never rewrite each other's spelling.
  const { asFileText, styleOf } = require('../data.js');
  const sample = { a: { title: 'Bring Mom’s book — café', n: 1 } };
  const robotText = JSON.stringify(sample, null, 2).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const appText = JSON.stringify(sample, null, 2) + '\n';
  expect(W1, asFileText(sample, styleOf(robotText)) === robotText, "a save would rewrite the robot's way of writing the file");
  expect(W1, asFileText(sample, styleOf(appText)) === appText, "a save would rewrite the old app's way of writing the file");
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

  // Lists that scroll: content partly scrolled past an edge is fine there, so those edges are only
  // judged when the list is scrolled all the way to that end (the check looks at both ends).
  const sc = (el) => el.closest('[data-scrolls]');
  // What shows of a thing inside a scroll area that doesn't fill the screen (Plan's hours) is the part inside it.
  const rect = (el) => {
    const r = el.getBoundingClientRect(), s = sc(el);
    if (!s || s === el) return r;
    const c = s.getBoundingClientRect();
    const top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom), left = Math.max(r.left, c.left), right = Math.min(r.right, c.right);
    return { top, bottom, left, right, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  items = items.filter((el) => { const r = rect(el); return r.width > 0 && r.height > 0; });
  // When the Connect screen or a sheet is up it covers everything else, so only what's on it counts.
  const cover = [document.getElementById('connect')].concat(Array.from(document.querySelectorAll('.sheet'))).find(vis);
  if (cover) items = items.filter((el) => cover.contains(el));
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
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).textOverflow !== 'ellipsis' && !['svg', 'textarea', 'input'].includes(tag(el))) out.push(name(el) + ' has text cut off with no "…"');
    // Page content must not hide under the page bar.
    if (cover || el.closest('.bar') || (barOnTop ? skipTop : skipBottom)) continue;
    if (r.bottom > bar.top + 0.5 && r.top < bar.bottom - 0.5) out.push(name(el) + ' is under the page bar');
  }
  // Inside anything that scrolls, no part may be squeezed shorter than what it holds (it would spill past the edge instead of scrolling).
  for (const box of document.querySelectorAll('body *')) {
    if (!vis(box) || !/auto|scroll/.test(getComputedStyle(box).overflowY)) continue;
    for (const kid of box.children) {
      if (!vis(kid) || getComputedStyle(kid).overflowY !== 'visible') continue;
      if (kid.scrollHeight > kid.clientHeight + 1 && kid.clientHeight > 0) out.push(name(kid).split(' "')[0] + ' is squeezed shorter than what it holds, so it spills instead of scrolling');
    }
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
    const r = b.getBoundingClientRect();
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
  extra = Object.assign({}, extra);
  const startAt = extra.at || NOW;
  delete extra.at;
  const ctx = await browser.newContext(Object.assign({ viewport: { width: size.W, height: size.H }, deviceScaleFactor: size.W > 1000 ? 1 : 3, colorScheme: scheme }, extra));
  // The page's clock starts at the check's own time and runs on normally from there.
  await ctx.addInitScript((startAt) => {
    const Real = Date;
    const shift = startAt - Real.now();
    class CheckDate extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); }
      static now() { return Real.now() + shift; }
    }
    window.Date = CheckDate;
  }, startAt);
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
    if (!['data/tasks.json', 'data/suggestions.json', 'data/fin.json', 'data/fin.config.months.json', 'data/notes.json', 'data/log.json'].includes(p)) ctx.badPaths.push(p);
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
    // This key can only read: the key screen says so straight away, and Not now closes it.
    await page.waitForFunction(() => document.documentElement.dataset.keySaves, null, { timeout: 8000 }).catch(() => {});
    const said = await page.evaluate(() => ({ saves: document.documentElement.dataset.keySaves, why: document.getElementById('connect-why').textContent, open: !document.getElementById('connect').hidden }));
    expect('connect', said.saves === 'false' && said.open && /ends in -key\) can only read/.test(said.why), 'a key that can only read was not spotted on the key screen (' + JSON.stringify(said) + ')');
    if (said.open) await page.click('#connect-cancel');
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

// Every tab opens and shows its list, and the "Only overdue" switch works on each: nothing is left looking like it's still loading.
async function everyTab(page, T) {
  for (const t of Todo.TABS) {
    await tapTab(page, t.id);
    const read = () => page.evaluate((id) => ({
      on: !!document.querySelector('.tdtab[data-tab-id="' + id + '"][aria-current="true"]'),
      sub: document.querySelector('.td-sub').textContent,
      cards: document.querySelectorAll('.td-list .card').length,
      late: document.querySelectorAll('.td-list .card .due.late').length,
      shown: document.querySelectorAll('.td-list .card').length + document.querySelectorAll('.td-list .empty').length,
      ready: document.documentElement.dataset.todo,
    }), t.id);
    const st = await read();
    expect(T + ' ' + t.name + ' tab', st.on && st.ready === 'ready' && !/loading/i.test(st.sub) && st.shown > 0,
      'the tab did not open and show its list (selected: ' + st.on + ', line: "' + st.sub + '", items: ' + st.shown + ')');
    if (t.id === 'overdue') {
      expect(T + ' Overdue tab', st.cards > 0 && st.late === st.cards, 'every card on the Overdue tab should have its date in yellow (' + st.late + ' of ' + st.cards + ')');
      await underlines(page, T + ' Overdue tab', 'cards');
      continue;
    }
    const sw = page.locator('.only');
    if (!(await sw.isVisible())) { problem(T + ' ' + t.name + ' tab', 'the Only overdue switch is missing'); continue; }
    await sw.click();
    await settle(page, 250);
    const on = await read();
    expect(T + ' ' + t.name + ' tab, Only overdue', (await sw.getAttribute('aria-pressed')) === 'true' && on.ready === 'ready' && on.shown > 0 && on.late === on.cards,
      'the Only overdue switch did not filter the list (cards: ' + on.cards + ', overdue: ' + on.late + ')');
    await sw.click();
    await settle(page, 250);
  }
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
  // An overdue date is yellow but doesn't say "Overdue": the underline says it (Josh's pick, Nov 25).
  const lateDate = await page.locator('.card[data-id="b"] .due.late').textContent().catch(() => '');
  expect(T, lateDate !== '' && !/overdue/i.test(lateDate), 'an overdue task\'s date should be yellow and should not say "Overdue" (got "' + lateDate + '")');
  expect(T, await page.locator('.card[data-id="d"] .due.late').count() === 0, 'a task that is not overdue is marked Overdue');
  await underlines(page, T + ' All', 'cards');
  expect(T, await page.locator('.td-suggest').isVisible(), 'the possible task does not show');
  await lookBothEnds(page, T, size, scheme + '-todo');

  await everyTab(page, T);
  await tapTab(page, 'all');

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
  expect(T + ' tick', /1 change waiting to save: the key here \(ends in -key\) can only read/.test(await page.locator('.td-pending').textContent()), 'the waiting line should count the change and say which key can only read (got "' + (await page.locator('.td-pending').textContent()) + '")');
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
// ---- The Plan page ----
async function planReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.plan === 'ready', null, { timeout: 8000 }).catch(() => problem('plan', 'the Plan page did not get ready'));
}
// Look at Plan with its hours scrolled to the top and to the end.
// Every name in a Plan block must end where you can see it: whole lines only, a "…" when it is cut,
// never running past its block, and never a block too short to show one line.
// Overdue look (Josh's pick, Nov 25): every overdue task, and only those, gets a still yellow underline that runs
// the full width of the task. It must never move, so it can't read as a loading bar.
async function underlines(page, where, rowsSel) {
  const bad = await page.evaluate((rowsSel) => {
    const out = [];
    const YELLOW = 'rgb(255, 214, 10)';
    const still = (el) => getComputedStyle(el).animationName === 'none' &&
      getComputedStyle(el).transitionDuration.split(',').every((d) => parseFloat(d) === 0 || !/box-shadow|border|all/.test(getComputedStyle(el).transitionProperty));
    if (rowsSel === 'cards') {
      for (const c of document.querySelectorAll('.td-list .card')) {
        const late = !!c.querySelector('.due.late');
        const sh = getComputedStyle(c).boxShadow;
        const has = sh.includes('inset') && sh.includes(YELLOW);
        const name = (c.querySelector('.t') || c).textContent.trim();
        if (late && !has) out.push('overdue task "' + name + '" has no full-width yellow underline');
        if (!late && has) out.push('"' + name + '" is not overdue but has the yellow underline');
        if (has && !still(c)) out.push('the yellow underline on "' + name + '" moves; it has to stay still');
      }
    } else {
      for (const r of document.querySelectorAll(rowsSel)) {
        const late = r.classList.contains('late');
        const cs = getComputedStyle(r);
        const has = cs.borderBottomColor === YELLOW && parseFloat(cs.borderBottomWidth) >= 3;
        const list = r.parentElement.getBoundingClientRect(), box = r.getBoundingClientRect();
        const name = (r.querySelector('.t') || r).textContent.trim();
        if (late && !has) out.push('overdue task "' + name + '" has no yellow underline');
        if (!late && has) out.push('"' + name + '" is not overdue but has the yellow underline');
        if (has && (box.left - list.left > 1 || list.right - box.right > 1)) out.push('the yellow underline under "' + name + '" does not run the full width');
        if (has && !still(r)) out.push('the yellow underline under "' + name + '" moves; it has to stay still');
      }
    }
    return out;
  }, rowsSel);
  for (const b of bad) problem(where, b);
}

async function namesFit(page, where) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('#page-plan .pl-ev, #page-plan .pl-wev, #page-plan .pl-wchip')) {
      if (!b.offsetParent) continue;
      const nm = b.classList.contains('pl-wchip') ? b : b.querySelector('.nm');
      if (!nm) { out.push('a block has no name in it'); continue; }
      const name = '"' + nm.textContent.replace(/\u00AD/g, '') + '"';
      if (nm === b) {
        if (b.scrollWidth > b.clientWidth + 1 && getComputedStyle(b).textOverflow !== 'ellipsis') out.push('an all-day name is cut with no "…": ' + name);
        continue;
      }
      const cs = getComputedStyle(b), lh = parseFloat(getComputedStyle(nm).lineHeight);
      const inner = b.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
      const r = nm.getBoundingClientRect();
      if (r.height < lh - 1) out.push('a block is too short to show its name: ' + name);
      else if (r.bottom > inner + 1) out.push('a name runs past the bottom of its block: ' + name);
      const clamp = getComputedStyle(nm).webkitLineClamp;
      if (nm.scrollHeight > nm.clientHeight + 1 && (!clamp || clamp === 'none')) out.push('a name is cut with no "…": ' + name);
      if (nm.scrollWidth > nm.clientWidth + 1 && getComputedStyle(nm).textOverflow !== 'ellipsis') out.push('a name is wider than its block: ' + name);
      // A word may only break at a space or at one of Plan's own split points (shown with a "-"):
      // so every piece that can't break further must fit the block's width, unless the name is one line ending in "…".
      const ncs = getComputedStyle(nm);
      if (!(ncs.whiteSpace === 'nowrap' && ncs.textOverflow === 'ellipsis')) {
        const cx = document.createElement('canvas').getContext('2d');
        cx.font = ncs.fontStyle + ' ' + ncs.fontWeight + ' ' + ncs.fontSize + ' ' + ncs.fontFamily;
        for (const word of nm.textContent.split(/\s+/)) {
          const bits = word.split('\u00AD');
          if (bits.some((x, i) => cx.measureText(i < bits.length - 1 ? x + '-' : x).width > nm.clientWidth + 0.5)) { out.push('a name has to break in the middle of a word: ' + name); break; }
        }
      }
    }
    return out;
  });
  for (const p of [...new Set(bad)]) problem(where, p);
}
async function lookPlan(page, where, size, shot) {
  for (const end of ['top', 'end']) {
    await page.evaluate((end) => { document.querySelectorAll('#page-plan [data-scrolls]').forEach((s) => { s.scrollTop = end === 'top' ? 0 : s.scrollHeight; }); }, end);
    await settle(page, 150);
    await look(page, where + ' (' + end + ')', size);
    if (end === 'top') await namesFit(page, where);
    if (shot) await page.screenshot({ path: path.join(OUT, shot + (end === 'end' ? '-end' : '') + '.png') });
  }
}
// A sheet that scrolls is judged at its top and at its end.
async function lookSheet(page, where, size, sel) {
  for (const end of ['top', 'end']) {
    await page.evaluate(([sel, end]) => { const c = document.querySelector(sel + ' .sheet-card'); c.scrollTop = end === 'top' ? 0 : c.scrollHeight; }, [sel, end]);
    await settle(page, 150);
    await look(page, where + ' (' + end + ')', size);
  }
  await page.evaluate((sel) => { document.querySelector(sel + ' .sheet-card').scrollTop = 0; }, sel);
}
const planText = (page) => page.evaluate(() => document.getElementById('page-plan').innerText.replace(/\u00AD/g, ''));
async function phonePlan(page, scheme, size) {
  const P = scheme + ' Plan';
  await page.tap('.tab[data-tab="plan"]');
  await settle(page);
  await planReady(page);
  // Opens on today, in the day view.
  if ((await page.locator('.pl-wrap').getAttribute('data-view')) !== 'day') { await page.tap('[data-view-pick="day"]'); await settle(page, 200); }
  const text = await planText(page);
  expect(P, text.includes('Work (Midtown)') && text.includes('Creekside Eatery Breakfast') && text.includes('Dorm Night'), 'today\'s events do not show by name');
  expect(P, !text.includes('Print the bus pass') && !text.includes('Foothills Josh F') && !text.includes('New Event 8/26'), 'something that should be left out shows (a ticked task\'s calendar copy, the store\'s calendar or the Blackboard copy)');
  expect(P, (await page.locator('.pl-hl').textContent()).trim() === BRIEF.current.headline, 'the brief line should show today\'s brief headline');
  const late = page.locator('.pl-late');
  expect(P, (await late.isVisible()) && (await late.textContent()).trim() === LATE_N + ' overdue', 'today should show a yellow "' + LATE_N + ' overdue" button');
  await lookPlan(page, P + ' day', size, scheme + '-plan-day');
  // Tapping a block shows just its name.
  await page.evaluate(() => { document.querySelector('.pl-daycard .pl-scroll').scrollTop = document.querySelector('.pl-grid').offsetHeight * 9 / 24; });
  await settle(page, 150);
  await page.locator('.pl-daycard .pl-ev', { hasText: /Work \(Mid\u00AD?town\)/ }).tap();
  await settle(page, 200);
  const tip = await page.evaluate(() => { const b = document.querySelector('.pl-bubble'); return { shown: !b.hidden, text: b.innerText }; });
  expect(P, tip.shown && /Work \(Midtown\)/.test(tip.text), 'tapping a block did not show its name (' + JSON.stringify(tip) + ')');
  expect(P, !(await page.locator('#sheet-brief').isVisible()), 'tapping a block should only show its name, not open anything');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-tap.png') });
  await page.tap('.pl-date');
  await settle(page, 150);
  expect(P, await page.locator('.pl-bubble').isHidden(), 'the name bubble did not go away');
  // The brief slides up; it shows the lists, the brief's own words as plain text, and never runs anything from it.
  await page.tap('.pl-brief');
  await settle(page, 350);
  expect(P, await page.locator('#sheet-brief').isVisible(), 'tapping the brief line did not open the brief');
  const bt = (await page.locator('#brief-body').innerText()).toLowerCase();
  expect(P, /Overdue · 2/i.test(bt) && bt.includes('unit 9: quiz #8') && bt.includes('needs attention') && bt.includes('read chapter 7') && bt.includes('money: nothing new'), 'the brief is missing its lists or its own words');
  expect(P, !(await page.locator('#brief-body a, #brief-body script, #brief-body svg').count()) && (await page.title()) !== 'a brief must never run code', 'the brief must show as plain words only (no links, no code)');
  expect(P, (await page.locator('#brief-body .due.late').count()) === LATE_N, 'every overdue task in the brief should have its date in yellow');
  expect(P, !(await page.locator('#brief-body .due.late').allTextContents()).some((t) => /overdue/i.test(t)), 'an overdue date in the brief should not say "Overdue"');
  await underlines(page, P + ' brief', '#brief-body .pl-row');
  await lookSheet(page, P + ' brief', size, '#sheet-brief');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-brief.png') });
  // Swipe down to close (a finger, as far as the test browser can play one).
  const swiped = await page.evaluate(async () => {
    const card = document.querySelector('#sheet-brief .sheet-card');
    if (typeof Touch !== 'function' || typeof TouchEvent !== 'function') return 'no touch';
    const t = (y) => new Touch({ identifier: 1, target: card, clientX: 200, clientY: y });
    card.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], bubbles: true, cancelable: true }));
    card.dispatchEvent(new TouchEvent('touchmove', { touches: [t(460)], bubbles: true, cancelable: true }));
    card.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById('sheet-brief').hidden ? 'closed' : 'open';
  }).catch((e) => 'error: ' + e.message);
  if (swiped === 'closed') console.log('  ok: swiping down closes the brief');
  else {
    if (swiped === 'open') problem(P, 'swiping down did not close the brief');
    else console.log('  note: the test browser could not play a swipe (' + swiped + '), so the × button was checked instead');
    await page.tap('#sheet-brief [data-close]');
    await settle(page, 300);
  }
  expect(P, await page.locator('#sheet-brief').isHidden(), 'the brief did not close');
  // The yellow button opens the brief at the overdue list.
  await page.tap('.pl-late');
  await settle(page, 400);
  expect(P, await page.locator('#sheet-brief').isVisible(), 'the overdue button did not open the brief');
  await page.tap('#sheet-brief [data-close]');
  await settle(page, 300);
  // Arrows move a day; Today comes back.
  const d0 = await page.locator('.pl-date').textContent();
  await page.tap('.pl-next');
  await settle(page, 200);
  expect(P, (await page.locator('.pl-date').textContent()) !== d0 && await page.locator('.pl-today').isVisible(), 'the › arrow did not move to the next day, or Today did not show');
  expect(P, (await planText(page)).includes('Introduction to College Writing'), "tomorrow's class does not show on tomorrow");
  await page.tap('.pl-today');
  await settle(page, 200);
  expect(P, (await page.locator('.pl-date').textContent()) === d0, 'Today did not go back to today');
  // Week view.
  await page.tap('[data-view-pick="week"]');
  await settle(page, 300);
  expect(P, (await page.locator('.pl-wday').count()) === 7 && (await page.locator('.pl-wev').count()) >= 7, 'the week grid should show 7 days with blocks');
  await lookPlan(page, P + ' week', size, scheme + '-plan-week');
  // Weeks past the calendar copy say so.
  for (let i = 0; i < 4; i++) { await page.tap('.pl-next'); await settle(page, 120); }
  expect(P, await page.locator('.pl-wnote').isVisible(), 'a week past the calendar copy should say it isn\'t copied yet');
  await look(page, P + ' week not copied yet', size);
  await page.tap('.pl-today');
  await settle(page, 200);
  // Tapping a day in the week opens that day.
  await page.locator('.pl-wday').nth(0).tap();
  await settle(page, 250);
  expect(P, (await page.locator('.pl-wrap').getAttribute('data-view')) === 'day', 'tapping a day in the week should open that day');
  await page.tap('.pl-today');
  await settle(page, 200);
  const dk = await page.evaluate(() => { const m = getComputedStyle(document.getElementById('page-plan')).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); });
  if (scheme === 'light') expect(P, dk > 200, 'Plan should be light on a phone set to light (got ' + dk + ')');
  else expect(P, dk < 50, 'Plan should be dark on a phone set to dark (got ' + dk + ')');
}
async function pcPlan(pp, scheme, size) {
  const P = scheme + ' PC Plan';
  await pp.click('.tab[data-tab="plan"]');
  await settle(pp);
  await planReady(pp);
  const lay = await pp.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const d = r('.pl-daycard'), w = r('.pl-weekcard'), k = r('.pl-key'), b = r('.pl-brief');
    return { side: d.width > 0 && w.width > 0 && d.right <= w.left && Math.abs(d.top - w.top) < 2, key: k.width > 0 && k.right <= d.left, briefTop: b.bottom <= d.top,
      bg: (() => { const m = getComputedStyle(document.getElementById('page-plan')).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); })(),
      switches: document.querySelectorAll('#page-plan input[type="checkbox"], #page-plan [role="switch"]').length };
  });
  expect(P, lay.side, 'the day and the week should sit side by side');
  expect(P, lay.key && lay.briefTop, 'the calendar list should be on the left and the brief line on top');
  expect(P, lay.switches === 0, 'Plan should have no hide switches');
  expect(P, lay.bg < 50, 'a PC should always be dark (got ' + lay.bg + ')');
  await lookPlan(pp, P, size, scheme + '-pc-plan');
  await pp.click('.pl-brief');
  await settle(pp, 300);
  expect(P, await pp.locator('#sheet-brief').isVisible(), 'the brief did not open on a PC');
  await underlines(pp, P + ' brief', '#brief-body .pl-row');
  await lookSheet(pp, P + ' brief', size, '#sheet-brief');
  await pp.screenshot({ path: path.join(OUT, scheme + '-pc-plan-brief.png') });
  await pp.keyboard.press('Escape');
  await settle(pp, 200);
}

// ---- Finance ----
async function finReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.finance === 'ready', null, { timeout: 8000 }).catch(() => problem('Finance', 'the Finance page did not get ready'));
}
// The whole Finance page is judged at its top and at its end.
async function lookFin(page, where, size, shot) {
  for (const end of ['top', 'end']) {
    await page.evaluate((end) => { const p = document.getElementById('page-finance'); p.scrollTop = end === 'top' ? 0 : p.scrollHeight; }, end);
    await settle(page, 150);
    await look(page, where + ' (' + end + ')', size);
    if (shot) await page.screenshot({ path: path.join(OUT, shot + (end === 'end' ? '-end' : '') + '.png') });
  }
  await page.evaluate(() => { document.getElementById('page-finance').scrollTop = 0; });
}
const FIN_TABS = ['spending', 'activity', 'wishlists', 'debt', 'quick'];
// His Finance rule (Nov 25): every label spelled out. No short day or month names, no "subs", no "$1k".
async function spelledOut(page, where) {
  const bad = await page.evaluate(() => {
    const t = document.getElementById('page-finance').innerText + ' ' + (document.getElementById('sheet-fin').hidden ? '' : document.getElementById('sheet-fin').innerText);
    const m = t.match(/\b(subs|Subs|Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\.?|\$\d+(\.\d+)?k\b|\b\d{1,2}\/\d{1,2}\b/);
    return m ? m[0] : '';
  });
  expect(where, !bad, 'a label is shortened ("' + bad + '"); every Finance label is spelled out');
}
async function phoneFinance(page, scheme, size) {
  const F = scheme + ' Finance';
  await page.tap('.tab[data-tab="finance"]');
  await settle(page);
  await finReady(page);
  const tabsOk = await page.evaluate(() => Array.from(document.querySelectorAll('.fi-tabs [data-fi-tab]')).map((b) => b.dataset.fiTab + ':' + b.getAttribute('aria-pressed')).join(','));
  expect(F, tabsOk === 'spending:true,activity:false,wishlists:false,debt:false,quick:false', 'Finance should have the 5 tabs and open on Spending (got ' + tabsOk + ')');
  // Spending, top to bottom: graph, Total balance, Savings balance, buckets, then the pie (his pick).
  const order = await page.evaluate(() => ['.fi-chart', '.fi-two', '.fi-buckets', '.fi-pie'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(F, order.every((v, i) => !i || v > order[i - 1]), 'Spending should go graph, balances, buckets, pie (tops: ' + order.join(', ') + ')');
  for (const t of FIN_TABS) {
    await page.tap(`.fi-tabs [data-fi-tab="${t}"]`);
    await settle(page, 250);
    expect(F, (await page.getAttribute(`.fi-tabs [data-fi-tab="${t}"]`, 'aria-pressed')) === 'true', 'the ' + t + ' tab did not open');
    await lookFin(page, F + ' ' + t, size, scheme + '-finance-' + t);
    await spelledOut(page, F + ' ' + t);
  }
  // A bucket opens one short line, with the breakdown in a dropdown.
  await page.tap('.fi-tabs [data-fi-tab="spending"]');
  await settle(page, 200);
  await page.tap('[data-tile="needs"]');
  await settle(page, 200);
  expect(F, /^Needs: 50% · \$[\d,]+ this paycheck$/.test((await page.locator('.fi-infohead').textContent()).trim()), 'tapping Needs should show "Needs: 50% · $___ this paycheck" (got "' + (await page.locator('.fi-infohead').textContent()) + '")');
  await page.tap('[data-break]');
  await settle(page, 200);
  await look(page, F + ' bucket breakdown', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-finance-needs-open.png') });
  // Total debt opens "Who you owe", with a button to the Debt page.
  await page.tap('[data-tile="debt"]');
  await settle(page, 250);
  expect(F, await page.locator('#sheet-fin').isVisible() && /Who you owe/.test(await page.locator('#fin-sheet-title').textContent()), 'Total debt should open "Who you owe"');
  await lookSheet(page, F + ' who you owe', size, '#sheet-fin');
  await page.screenshot({ path: path.join(OUT, scheme + '-finance-who-you-owe.png') });
  await page.tap('[data-go-debt]');
  await settle(page, 250);
  expect(F, (await page.getAttribute('.fi-tabs [data-fi-tab="debt"]', 'aria-pressed')) === 'true', 'the Debt page button did not open Debt');
  // Add a debt: the form looks right (closed without saving).
  await page.tap('[data-add-debt]');
  await settle(page, 250);
  await lookSheet(page, F + ' add a debt', size, '#sheet-fin');
  await page.screenshot({ path: path.join(OUT, scheme + '-finance-add-debt.png') });
  await page.tap('#sheet-fin .sheet-top [data-close]');
  await settle(page, 200);
  // Activity: a charge opens the fix sheet (closed without saving).
  await page.tap('.fi-tabs [data-fi-tab="activity"]');
  await settle(page, 200);
  const cols = await page.evaluate(() => { const r = document.querySelector('.fi-row'); const a = r.children[1].getBoundingClientRect(), b = r.children[2].getBoundingClientRect(); const h = document.querySelector('.fi-dayhead').children; return { a: Math.round(a.right), b: Math.round(b.right), ha: Math.round(h[1].getBoundingClientRect().right), hb: Math.round(h[2].getBoundingClientRect().right) }; });
  expect(F, Math.abs(cols.a - cols.ha) < 2 && Math.abs(cols.b - cols.hb) < 2, 'the Amount and Balance columns do not line up with their headings (' + JSON.stringify(cols) + ')');
  await page.locator('.fi-row').first().tap();
  await settle(page, 250);
  expect(F, /Fix this charge/.test(await page.locator('#fin-sheet-title').textContent()), 'tapping a charge should open "Fix this charge"');
  await lookSheet(page, F + ' fix a charge', size, '#sheet-fin');
  await spelledOut(page, F + ' fix a charge');
  await page.screenshot({ path: path.join(OUT, scheme + '-finance-fix-charge.png') });
  await page.tap('#sheet-fin .sheet-top [data-close]');
  await settle(page, 200);
  await page.tap('.fi-tabs [data-fi-tab="wishlists"]');
  await settle(page, 200);
  await page.locator('[data-aside]').first().tap();
  await settle(page, 250);
  await lookSheet(page, F + ' set money aside', size, '#sheet-fin');
  await page.tap('#sheet-fin .sheet-top [data-close]');
  await settle(page, 200);
  await page.tap('.fi-tabs [data-fi-tab="spending"]');
  await settle(page, 200);
  // Plan's message box.
  await page.tap('.tab[data-tab="plan"]');
  await settle(page);
  await page.tap('.pl-msg');
  await settle(page, 250);
  expect(scheme + ' Plan message', await page.locator('#sheet-planmsg').isVisible(), 'the Plan message button did not open its box');
  await lookSheet(page, scheme + ' Plan message', size, '#sheet-planmsg');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-message.png') });
  await page.tap('#sheet-planmsg [data-close]');
  await settle(page, 200);
}
async function pcFinance(pp, scheme, size) {
  const F = scheme + ' PC Finance';
  await pp.click('.tab[data-tab="finance"]');
  await settle(pp);
  await finReady(pp);
  const lay = await pp.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const p = document.getElementById('page-finance');
    const side = r('.fi-side'), main = r('.fi-main'), chart = r('.fi-chart'), bk = r('.fi-buckets');
    const m = getComputedStyle(p).backgroundColor.match(/[\d.]+/g).map(Number);
    return { left: side.width > 0 && side.right <= main.left, sideBySide: chart.right <= bk.left && Math.abs(chart.top - bk.top) < 4,
      fits: p.scrollHeight <= p.clientHeight + 1, over: p.scrollHeight - p.clientHeight, phoneTabs: getComputedStyle(document.querySelector('.fi-tabs')).display,
      bg: Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) };
  });
  expect(F, lay.left, 'the Finance tabs should run down the left');
  expect(F, lay.phoneTabs === 'none', 'the phone tab row should not show on a PC');
  expect(F, lay.sideBySide, 'Spending should show the graph side and the buckets side by side');
  expect(F, lay.fits, 'Spending should fit on one screen (it runs ' + lay.over + ' pixels past the bottom)');
  expect(F, lay.bg < 50, 'a PC should always be dark (got ' + lay.bg + ')');
  for (const t of FIN_TABS) {
    await pp.click(`.fi-side [data-fi-tab="${t}"]`);
    await settle(pp, 250);
    await lookFin(pp, F + ' ' + t, size, scheme + '-pc-finance-' + t);
  }
  await pp.click('.fi-side [data-fi-tab="spending"]');
  await settle(pp, 200);
  await pp.click('[data-tile="debt"]');
  await settle(pp, 250);
  await look(pp, F + ' who you owe', size);
  await pp.keyboard.press('Escape');
  await settle(pp, 200);
  expect(F, await pp.locator('#sheet-fin').isHidden(), 'Escape should close the Finance sheet');
}

async function darkness(page) {
  return page.evaluate(() => {
    const read = (el) => { const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); };
    return { body: read(document.body), todo: read(document.getElementById('page-todo')) };
  });
}

async function run() {
  rules();
  planRules();
  finRules();
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
    // This made-up key can only read: the key screen says so and stays open, and Not now closes it.
    expect(scheme + ' connect', /can only read/.test(await page.locator('#connect-why').textContent()), 'a key that can only read was not spotted on the key screen');
    if (await page.locator('#connect-cancel').isVisible()) await page.tap('#connect-cancel');
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
      if (id === 'plan') await planReady(page);
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

    // 5b. The Plan page, all of it.
    await phonePlan(page, scheme, phone);

    // 5c. The Finance page, all of it, and Plan's message box.
    await phoneFinance(page, scheme, phone);

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
    await everyTab(pp, scheme + ' PC TO-DO');
    await tapTab(pp, 'overdue');
    await underlines(pp, scheme + ' PC Overdue tab', 'cards');
    await pp.screenshot({ path: path.join(OUT, scheme + '-pc-todo-overdue.png') });
    await tapTab(pp, 'all');
    await dragCard(pp, 'a', '.tdtab[data-tab-id="waiting"]', scheme + ' PC move');
    await tapTab(pp, 'waiting');
    expect(scheme + ' PC move', (await cardIds(pp)).includes('a'), 'a card dragged onto Waiting is not there');
    await tapTab(pp, 'all');
    await pp.click('.td-head .addbtn');
    await settle(pp, 250);
    await look(pp, scheme + ' PC add form', pc);
    await pp.screenshot({ path: path.join(OUT, scheme + '-pc-todo-add.png') });
    await pp.keyboard.press('Escape');
    await settle(pp, 250);
    expect(scheme + ' PC add form', !(await pp.locator('#sheet-add').isVisible()), 'Escape should close the add form on a PC');
    await pcPlan(pp, scheme, pc);
    await pcFinance(pp, scheme, pc);
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
  // Another key that can only read: the key screen says so right away and stays open.
  await sp.fill('#connect-key', 'sample-key-two');
  await sp.tap('#connect-go');
  await sp.waitForFunction(() => /can only read/.test(document.getElementById('connect-why').textContent), null, { timeout: 5000 })
    .catch(() => problem(S, 'Change key with a key that can only read did not say so on the key screen'));
  expect(S, await sp.locator('#connect').isVisible(), 'the key screen should stay open when the new key can only read');
  // A key that can save: never called read-only, the test of it writes nothing, and the waiting tick saves once.
  const w0 = sctx.wrote;
  await sp.fill('#connect-key', 'saving-key');
  await sp.tap('#connect-go');
  await sp.waitForFunction(() => document.getElementById('connect').hidden, null, { timeout: 5000 }).catch(() => problem(S, 'the key screen did not close'));
  expect(S, (await sp.evaluate(() => document.documentElement.dataset.keySaves)) === 'true', 'a key that can save was called read-only');
  await waitSaved(S + ' after a new key');
  expect(S, sctx.wrote === w0 + 1, 'checking the key should write nothing; the waiting tick should save once (writes: ' + (sctx.wrote - w0) + ')');
  expect(S, (await sp.locator('.td-pending').getAttribute('data-state')) !== 'readonly', 'a key that can save still shows as read-only');
  await sp.locator('[data-open="sheet-menu"]:visible').first().tap();
  await settle(sp, 200);
  await sp.tap('#sheet-menu [data-open="sheet-settings"]');
  await settle(sp, 200);
  expect(S, /ends in -key\.$/.test(await sp.locator('#settings-key').textContent()), 'Settings should say which key is in use (got "' + (await sp.locator('#settings-key').textContent()) + '")');
  await sp.tap('#sheet-settings [data-close]');
  await settle(sp, 200);
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
  await sp.waitForFunction(() => /^server/.test(document.querySelector('.td-pending').dataset.why || ''), null, { timeout: 6000 })
    .catch(() => problem(S, 'the lost reply was not noticed'));
  expect(S, (await sp.locator('.td-pending').textContent()).includes('1 change waiting to save'), 'after a lost reply the change should still show as waiting');
  await sp.tap('.card[data-id="m"] .tick');
  await waitSaved(S + ' after a lost reply');
  file = sctx.box.files['data/tasks.json'];
  expect(S, file.c.status === 'done' && file.m.status === 'done' && (file.c.changeIds || []).length === 1, 'after a lost reply the change landed ' + (file.c.changeIds || []).length + ' times, or the next change did not save');

  // Finance saving: a Quick-budget note, a fixed charge, and a Plan message, each saved once, each with a change-log line.
  const FS = 'Finance saving';
  const finSaved = async (where) => {
    await sp.waitForFunction(() => ['saved', 'none'].includes(document.querySelector('.fi-pending').dataset.state), null, { timeout: 8000 })
      .catch(async () => problem(where, 'Finance changes did not save (last try: ' + (await sp.locator('.fi-pending').getAttribute('data-why')) + ')'));
  };
  await sp.tap('.tab[data-tab="finance"]');
  await settle(sp);
  await finReady(sp);
  await sp.tap('.fi-tabs [data-fi-tab="quick"]');
  await settle(sp, 200);
  await sp.fill('[data-note-form] textarea', 'Lent $40 to a friend, paying me back on the 5th');
  await sp.tap('[data-note-form] button[type="submit"]');
  await finSaved(FS + ' note');
  let notesF = sctx.box.files['data/notes.json'] || { items: [] };
  expect(FS, notesF.items.length === 1 && notesF.items[0].page === 'finance' && notesF.items[0].status === 'waiting', 'the Quick-budget note did not save as waiting (' + JSON.stringify(notesF.items) + ')');
  expect(FS, /Waiting/.test(await sp.locator('.fi-notes').textContent()), 'the sent note should show as Waiting');
  await sp.tap('.fi-tabs [data-fi-tab="activity"]');
  await settle(sp, 200);
  const txId = await sp.locator('.fi-row').first().getAttribute('data-tx');
  await sp.locator('.fi-row').first().tap();
  await settle(sp, 250);
  await sp.fill('#sheet-fin input[name="name"]', 'Morning coffee');
  await sp.selectOption('#sheet-fin select[name="cat"]', 'food');
  await sp.tap('#sheet-fin button[type="submit"]');
  await finSaved(FS + ' fix a charge');
  const fixed = Money.allTx(sctx.box.files['data/fin.config.months.json']).find((t) => t.id === txId);
  expect(FS, fixed && fixed.name === 'Morning coffee' && fixed.lb === 'josh', 'the fixed charge did not save as his');
  expect(FS, (await sp.locator('.fi-row').first().textContent()).includes('Morning coffee'), 'the fixed name should show in Activity');
  // A lost reply: the note saves, the phone never hears back, and the next save must not put it in twice.
  sctx.box.trap = (p) => (p === 'data/notes.json' ? 'lost' : null);
  await sp.tap('.fi-tabs [data-fi-tab="quick"]');
  await settle(sp, 200);
  await sp.fill('[data-note-form] textarea', 'Put $20 aside for a birthday gift');
  await sp.tap('[data-note-form] button[type="submit"]');
  await sp.waitForFunction(() => /^server|^error/.test(document.querySelector('.fi-pending').dataset.why || ''), null, { timeout: 6000 }).catch(() => problem(FS, 'the lost reply was not noticed'));
  await sp.tap('.tab[data-tab="plan"]');
  await settle(sp);
  await sp.tap('.pl-msg');
  await settle(sp, 250);
  await sp.fill('#sheet-planmsg textarea', 'Move my dentist to Friday at 3 PM');
  await sp.tap('#sheet-planmsg button[type="submit"]');
  await sp.waitForFunction(() => document.querySelector('#sheet-planmsg .pm-state').textContent === 'All saved' || document.querySelector('.fi-pending').dataset.state === 'saved', null, { timeout: 8000 })
    .catch(async () => problem(FS + ' Plan message', 'the Plan message did not save (' + (await sp.locator('.fi-pending').getAttribute('data-why')) + ')'));
  await look(sp, FS + ' Plan message sent', phone);
  await sp.screenshot({ path: path.join(OUT, 'light-plan-message-sent.png') });
  await sp.tap('#sheet-planmsg [data-close]');
  await settle(sp, 200);
  notesF = sctx.box.files['data/notes.json'] || { items: [] };
  const texts = notesF.items.map((n) => n.page + ':' + n.text);
  expect(FS, texts.length === 3 && new Set(notesF.items.map((n) => n.id)).size === 3 && texts.filter((t) => /birthday/.test(t)).length === 1 && texts.some((t) => /^plan:Move my dentist/.test(t)),
    'after a lost reply the notes landed wrong: ' + JSON.stringify(texts));
  const logF = sctx.box.files['data/log.json'] || { items: [] };
  const logged = logF.items.filter((l) => l.changeId);
  expect(FS, logged.length === 4 && new Set(logged.map((l) => l.changeId)).size === 4 && logged.every((l) => l.at && l.who && l.what && l.why),
    'every Finance change should add one line to the change log (got ' + logged.length + ')');

  // Reopening with nothing waiting writes nothing.
  const wroteBefore = sctx.wrote;
  await sp.reload();
  await sp.waitForFunction(() => document.documentElement.dataset.todo === 'ready', null, { timeout: 8000 }).catch(() => {});
  await settle(sp, 1500);
  expect(S, sctx.wrote === wroteBefore, 'reopening with nothing waiting should not write anything');
  expect(S, !(await sp.locator('.td-pending').isVisible()), 'after reopening, nothing should be waiting to save');
  if (sctx.badPaths.length) problem(S, 'the app tried to write somewhere it never should: ' + sctx.badPaths.join(', '));
  await sctx.close();

  // 9. Late at night: nothing on Plan pokes out past the end of the day (the "now" dot sits at the very bottom).
  console.log('Checking Plan late at night');
  const lateAt = Plan.dayStart(Plan.dayKey(NOW)) + 23 * 36e5 + 59 * 6e4;
  const lctx = await newContext(browser, 'light', phone, { hasTouch: true, isMobile: true, at: lateAt });
  const lp = await openConnected(lctx, base, edges);
  await lp.tap('.tab[data-tab="plan"]');
  await settle(lp);
  await planReady(lp);
  if ((await lp.locator('.pl-wrap').getAttribute('data-view')) !== 'day') { await lp.tap('[data-view-pick="day"]'); await settle(lp, 200); }
  await lookPlan(lp, 'Late night Plan day', phone, 'light-plan-late-night');
  await lp.tap('[data-view-pick="week"]');
  await settle(lp, 200);
  await lookPlan(lp, 'Late night Plan week', phone);
  await lctx.close();

  // 10. Reduce Motion: the pictures stay inside their cards.
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

// ---- With Josh's real data (read-only, no pictures, nothing named in the log) ----
// Runs only when the "New Hub check" has a read-only key for the data box (see the workflow).
// It opens TO-DO and Plan on a phone in light and dark and on a PC, and looks for anything cut off,
// overlapping, too faint or too small. It never writes: every save is refused and counted as a fail.
async function realRun() {
  const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(REAL, p), 'utf8')); } catch (e) { return undefined; } };
  for (const p of Object.keys(SAMPLE)) { const d = read(p); if (d !== undefined) SAMPLE[p] = d; else if (p !== 'meta/app.json') delete SAMPLE[p]; }
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/my-app/v2/';
  const browser = await webkit.launch();
  const edges = `:root{--safe-top:${TOP}px!important;--safe-bottom:${BOTTOM}px!important}`;
  const sizes = [['light phone', 'light', { W, H, TOP, BOTTOM }, { hasTouch: true, isMobile: true }], ['dark phone', 'dark', { W, H, TOP, BOTTOM }, { hasTouch: true, isMobile: true }], ['PC', 'dark', { W: PC.W, H: PC.H, TOP: 0, BOTTOM: 0 }, {}]];
  for (const [label, scheme, size, extra] of sizes) {
    console.log('Real data: ' + label);
    const ctx = await newContext(browser, scheme, size, extra);
    const pg = await openConnected(ctx, base, size.TOP ? edges : '');
    await planReady(pg);
    const tap = (sel) => (extra.hasTouch ? pg.tap(sel) : pg.click(sel));
    await tap('.tab[data-tab="todo"]'); await settle(pg);
    await lookBothEnds(pg, 'real ' + label + ' TO-DO', size);
    await tap('.tab[data-tab="plan"]'); await settle(pg);
    for (const v of size.TOP ? ['day', 'week'] : ['day']) {
      if (size.TOP) { await tap(`[data-view-pick="${v}"]`); await settle(pg, 250); }
      await lookPlan(pg, 'real ' + label + ' Plan ' + v, size);
    }
    await tap('.pl-brief'); await settle(pg, 350);
    await look(pg, 'real ' + label + ' Plan brief', size);
    if (ctx.wrote || ctx.badPaths.length) problem('real ' + label, 'the app tried to save while only looking');
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(problems.length ? problems.length + ' problem(s) with the real data.' : 'Real data: all good.');
  process.exit(problems.length ? 1 : 0);
}

(REAL ? realRun() : run()).catch((e) => { console.error(REAL ? 'The real-data check stopped: ' + e.name : e); process.exit(1); });
