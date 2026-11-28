// The new Hub's check. Runs before every update (see the "New Hub check" workflow).
// It opens the app in Safari's engine at Josh's phone size (428 x 926), with the status bar (47)
// and the home swipe area (34) marked off, with the phone set to light and to dark, and on a PC screen (1440 x 900,
// and 1920 x 1080 for filling the screen), and fails if:
//   - anything isn't dark: the app is dark only, on the phone and a PC, whatever the phone is set to (Josh's pick, Nov 26)
//   - any text size, corner or edge is outside the shared set (Josh's pick, Nov 26)
//   - a floating button sits over card text at any scroll spot, or a Plan header button sits off its row
//   - a part of an approved mockup is missing (the graph's pins, key, savings line, dollar labels and date row;
//     the buckets' fill; the TO-DO and Plan headers), or the graph is squished or stretched at any width
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
  l: { title: 'A long task name that has to wrap onto a second line without running under its picture or off the screen', status: 'open', kind: 'task', section: 'active', due: null, priority: 8, myNote: 'From the class email' },
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
const Robot = require('../robot.js');
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
TX.find((t) => t.id === 't12').name = 'Coffee'; // the robot's label, which its tag can undo
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
// The robot's changes, as it logs them: each shows a keep and undo tag on the changed thing (robot.js).
const MONTH12 = dayN(0).slice(0, 7);
const LOG = { items: [
  { id: 'rb1', at: at(0, -1), who: 'robot', what: 'Added a note from the class email', why: 'A UAA email', file: 'data/tasks.json',
    robot: { kind: 'task', ref: 'l', sets: [{ path: ['l', 'myNote'], after: 'From the class email' }] } },
  { id: 'rb2', at: at(0, -1), who: 'robot', what: 'Named this charge Coffee', why: 'Same store as last week', file: 'data/fin.config.months.json',
    robot: { kind: 'charge', ref: 't12', sets: [{ path: [MONTH12, 'txns', { id: 't12' }, 'name'], after: 'Coffee' }] } },
  { id: 'rb3', at: at(0, -2), who: 'robot', what: 'Set Cash App to the balance in the email', why: 'Balance email', file: 'data/fin.json',
    robot: { kind: 'balance', ref: 'Cash App', sets: [{ path: ['tracker', 'anchors', 'Cash App', 'amount'], before: 25.1, after: 21.6 }] } },
  { id: 'rb4', at: at(0, -2), who: 'robot', what: 'Took the $40 payment off', why: 'Payment email', file: 'data/fin.json',
    robot: { kind: 'debt', ref: 'd1', sets: [{ path: ['debts', 'items', { id: 'd1' }, 'owed'], before: 160, after: 120 }] } },
  { id: 'rb5', at: at(0, -3), who: 'robot', what: 'Moved Creekside Eatery Dinner to 4:30 PM', why: 'Dining hours email', file: null,
    robot: { kind: 'event', ref: 'main:din', calendar: true } },
  { id: 'rb6', at: at(-8), who: 'robot', what: 'Too old to show', file: 'data/tasks.json', robot: { kind: 'task', ref: 'b', sets: [{ path: ['b', 'priority'], before: 1, after: 6 }] } },
  { id: 'rb7', at: at(-1), who: 'robot', what: 'Already kept', file: 'data/tasks.json', robot: { kind: 'task', ref: 'c', sets: [{ path: ['c', 'priority'], before: 1, after: 7 }] } },
  { id: 'rb7a', at: at(-1, 1), who: 'Josh, in the new Hub', what: 'Kept: Already kept', answers: 'rb7', answer: 'kept' },
] };
const SAMPLE = {
  'meta/app.json': { name: 'sample' },
  'data/log.json': LOG,
  'data/tasks.json': TASKS,
  'data/suggestions.json': SUGS,
  'data/fin.json': FIN,
  'data/fin.config.months.json': MONTHS,
  'data/calendar.json': CALENDAR,
};
const flat = (tab) => Todo.listFor(TASKS, tab, NOW).flat();
const EXPECT = {
  todo: Object.values(TASKS).filter((t) => t.kind !== 'question' && t.status === 'open').length + ' open · ' + flat('overdue').length + ' overdue',
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
// Every changed script or style gets a new version mark (found Nov 28: the marks are changed by hand, and one left
// unchanged means phones keep the old file even after the Hub reloads itself). Compared with what's live now (main).
function stampRules() {
  const L = 'Version marks';
  const { execSync } = require('child_process');
  const git = (c) => execSync('git ' + c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  try { git('fetch -q origin main --depth=50'); } catch (e) { /* offline: use what's here */ }
  let live;
  try { live = git('show origin/main:v2/index.html'); } catch (e) { console.log('  (Version marks: no live copy to compare with, skipped)'); return; }
  const now = fs.readFileSync(path.join(ROOT, 'v2', 'index.html'), 'utf8');
  const refs = (h) => { const o = {}; h.replace(/(?:src|href)="([\w.-]+\.(?:js|css))(?:\?v=(\d+))?"/g, (m, f, v) => { o[f] = v || ''; return m; }); return o; };
  const a = refs(live), b = refs(now);
  for (const [f, v] of Object.entries(b)) {
    if (!v) { problem(L, f + ' has no version mark (?v=) in index.html'); continue; }
    let same = true;
    try { same = git('show origin/main:v2/' + f) === fs.readFileSync(path.join(ROOT, 'v2', f), 'utf8'); } catch (e) { same = false; }
    if (!same && a[f] === v) problem(L, f + ' changed but its version mark is still ?v=' + v + ', so phones would keep the old one');
  }
}
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
  // The main calendar is copied a year ahead and the others 45 days: a day past 45 days with only the main
  // calendar on it counts as copied, and only for the main calendar.
  const longMain = JSON.parse(JSON.stringify(CALENDAR));
  for (const k of Object.keys(longMain)) longMain[k].to = Plan.addDays(TODAY, 45);
  longMain.main.to = Plan.addDays(TODAY, 365);
  longMain.main.events.push(ev('far', 'Far-off plan', 60, 12, 0, 13, 0));
  const r2 = Plan.rangeOf(longMain), far = Plan.addDays(TODAY, 60);
  expect(W, Plan.loaded(r2, far), 'a day past 45 days with only the main calendar copied should count as copied (it said "not copied yet")');
  expect(W, Plan.coveredBy(r2, far).join() === 'My calendar', 'a day past 45 days should be covered by the main calendar only (got ' + Plan.coveredBy(r2, far).join() + ')');
  expect(W, Plan.dayOf(Plan.eventsOf(longMain), far, 20).timed.some((x) => x.name === 'Far-off plan'), 'a plan 60 days ahead on the main calendar should show on its day');
  expect(W, !Plan.loaded(r2, Plan.addDays(TODAY, 400)), 'a day past every calendar copy should still count as not copied yet');
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
    // The buckets' "left" amounts plus what's held never add up to more than what's in the accounts (Total debt isn't
    // part of it). To invest is the paycheck's 20% at most, not whatever cash is left (his pick, Nov 26).
    const sum = B.tiles.filter((t) => t.key !== 'debt').reduce((a, t) => a + Math.max(0, t.left), 0) + B.alsoHeld - B.missing;
    expect(F, sum <= B.balance + 0.02, 'the buckets add up to more than the accounts (' + sum.toFixed(2) + ' vs ' + B.balance + ')');
    expect(F, B.toInvest <= B.C * 0.2 + 0.005, 'To invest shows more than the paycheck\'s 20% (' + B.toInvest + ')');
    expect(F, B.tiles.some((t) => t.key === 'debt' && t.name === 'Total debt'), 'there is no Total debt bucket');
  }
  // Money taken out of savings is debt owed to Savings; putting money back pays it down, never below zero;
  // wishlist money kept in a savings pot is left out both ways (Josh, Nov 26).
  {
    const sv = (id, d, a, n, extra) => Object.assign({ id, d, a, n, s: n, u: 'savings', k: 'Sample Bank' }, extra || {});
    const sf = { savings: { other: [{ name: 'Sample Pot', amount: 30, goal: 'Sample Item' }] },
      wishlists: { lists: [{ id: 'l1', name: 'Sample list', items: [{ id: 'w1', name: 'Sample Item', amount: 60, saved: 30, setAside: [{ amount: 30, in: 'Sample Pot' }] }] }] },
      debts: { items: [{ id: 'dh', name: 'Took money from savings', owedTo: 'Savings', owed: 40, total: 40 }] } };
    const sm = { '2026-01': { txns: [sv('s1', '2026-01-02', 100, 'From savings'), sv('s2', '2026-01-03', -150, 'To savings'),
      sv('s3', '2026-01-04', 40, 'From savings'), sv('s4', '2026-01-05', -10, 'To savings'),
      sv('s5', '2026-01-06', -30, 'Moved to Sample Pot'), sv('s6', '2026-01-07', 30, 'From Sample Pot'), sv('s7', '2026-01-08', 25, 'Spent on its item', { wish: 'w1' })] } };
    const o = Money.owedToSavings(sf, sm);
    expect(F, o && o.owed === 30 && o.total === 40 && o.owedTo === 'Savings', 'money out of savings did not show as owed to Savings (' + JSON.stringify(o && [o.owed, o.total]) + ')');
    const SD = Money.debts(sf, '2026-01-09', sm);
    expect(F, SD.totalOwed === 30 && SD.open.length === 1, 'a hand-made debt to savings was counted on top of the worked-out one');
    const back = JSON.parse(JSON.stringify(sm)); back['2026-01'].txns.push(sv('s8', '2026-01-09', -50, 'To savings'));
    const ob = Money.owedToSavings(sf, back);
    expect(F, ob && ob.owed === 0 && ob.paidOff === '2026-01-09', 'putting money back into savings did not pay off what was owed');
  }
  // To invest (his picks, Nov 26): a move into savings comes off the green balance line and off To invest on its
  // day, and the blue Savings line goes up by the same amount. Money taken out of savings never refills To invest,
  // and "Where your money went" shows it as taken back out, beside what was kept.
  {
    const addTx = (months, t) => { const m = JSON.parse(JSON.stringify(months)); (m[t.d.slice(0, 7)] = m[t.d.slice(0, 7)] || { txns: [] }).txns.push(t); return m; };
    const day = dayN(-1), before = dayN(-2);
    const inM = addTx(MONTHS, { id: 'sv1', d: day, a: -40, k: 'First National Bank Alaska', s: 'Transfer to Sample savings', cat: 'savings', c: 'savings', u: 'savings', m: 0, p: 0 });
    const w1 = Money.work(FIN, MONTHS, null, new Date(NOW)), w2 = Money.work(FIN, inM, null, new Date(NOW));
    const B1 = w1.budget, B2 = w2.budget;
    const step = (ser, d0, d1) => ser[d1] - ser[d0];
    expect(F, Math.abs((step(w2.bal.series, before, day) - step(w1.bal.series, before, day)) + 40) < 0.01, 'a $40 move into savings did not come off the green line on its day');
    expect(F, w2.savingsLine && Math.abs((step(w2.savingsLine, before, day) - step(w1.savingsLine, before, day)) - 40) < 0.01, 'a $40 move into savings did not lift the blue Savings line by $40 on its day');
    // Money into a wishlist pot the Savings total counts (like Cash App Savings) moves the blue line too, even with
    // other spending the same day (found Nov 28 on his Nov 19 move).
    const potM = addTx(addTx(MONTHS, { id: 'sv5', d: day, a: -25, k: 'First National Bank Alaska', s: 'Moved to Cash App Savings', cat: 'savings', c: 'savings', u: 'savings', m: 0, p: 0 }),
      { id: 'sv6', d: day, a: -60, k: 'First National Bank Alaska', s: 'Sample store', c: 'groceries', u: '50', m: 0, p: 0 });
    const wp = Money.work(FIN, potM, null, new Date(NOW));
    expect(F, wp.savingsLine && Math.abs((step(wp.savingsLine, before, day) - step(w1.savingsLine, before, day)) - 25) < 0.01 && Math.abs((step(wp.bal.series, before, day) - step(w1.bal.series, before, day)) + 85) < 0.01,
      'a $25 move into a wishlist savings pot should lift the blue line by $25 and take $25 off the green line beside the day\'s other spending');
    graphMovesMatch(FIN, potM, new Date(NOW), F + ' graph');
    graphMovesMatch(FIN, inM, new Date(NOW), F + ' graph');
    expect(F, w2.savingsLine && w2.bal.days.filter((d) => d !== day).every((d, i, a) => i === 0 || w2.savingsLine[d] === w2.savingsLine[a[i - 1]] || d === dayN(0)), 'the Savings line moved on a day with no money in or out of savings');
    expect(F, B2 && B2.movedIn === 40 && Math.abs(B2.investPlan - Math.max(0, B1.investPlan - 40)) < 0.01, 'a $40 move into savings did not come off To invest (plan ' + (B2 && B2.investPlan) + ' vs ' + (B1 && B1.investPlan) + ')');
    expect(F, B2 && B2.toInvest <= B2.investPlan + 0.005 && B2.toInvest <= Math.max(0, B2.cashLeft) + 0.005, 'To invest is more than its plan or the cash left after the other buckets');
    // Taken out of savings (and so into the accounts): To invest stays the same, and Debt shows it owed to Savings.
    const outM = addTx(inM, { id: 'sv2', d: dayN(0), a: 15, k: 'First National Bank Alaska', s: 'Transfer from Sample savings', cat: 'savings', c: 'savings', u: 'savings', m: 0, p: 0 });
    const outFin = JSON.parse(JSON.stringify(FIN)); outFin.tracker.anchors['First National Bank Alaska'].amount += 15;
    const w3 = Money.work(outFin, outM, null, new Date(NOW)), B3 = w3.budget;
    expect(F, B3 && Math.abs(B3.toInvest - B2.toInvest) < 0.01, 'money taken out of savings refilled To invest (' + (B3 && B3.toInvest) + ' vs ' + (B2 && B2.toInvest) + ')');
    expect(F, w3.debts.open.some((d) => d.owedTo === 'Savings' && d.owed === 15), 'money taken out of savings did not show on Debt as owed to Savings');
    const pie = Money.pieFor(outFin, outM, B3.P.start, dayN(0)), sav = pie.groups.find((g) => g.group === 'savings');
    expect(F, sav && sav.putIn === 40 && sav.out === 15 && sav.kept === 25 && sav.total === 40, '"Where your money went" should size Savings by money put in ($40) and show $15 taken back out and $25 kept (got ' + JSON.stringify(sav && [sav.total, sav.out, sav.kept]) + ')');
    // Spending no other bucket covers comes out of To invest last.
    const bigM = addTx(MONTHS, { id: 'big', d: dayN(0), a: -900, k: 'First National Bank Alaska', s: 'Sample Big Store', cat: 'shopping', c: 'shopping', u: '30', m: 0, p: 0 });
    const B4 = Money.work(FIN, bigM, null, new Date(NOW)).budget;
    expect(F, B4 && B4.uncovered > 0 ? B4.investPlan === Math.max(0, Math.round((B4.C * 0.2 - B4.movedIn - B4.uncovered) * 100) / 100) : true, 'spending no other bucket covered did not come out of To invest');
  }
  // When the accounts hold less than the plan, no bucket may show money that isn't there, Gas and
  // Subscriptions included (Josh's yes, Nov 25), and the buckets still add up to the accounts.
  const lowFin = JSON.parse(JSON.stringify(FIN));
  lowFin.tracker.anchors['First National Bank Alaska'].amount = 20;
  lowFin.tracker.anchors['Cash App'].amount = 0;
  const L = Money.work(lowFin, MONTHS, null, new Date(NOW)).budget;
  if (L) {
    const shown = L.tiles.filter((t) => t.key !== 'debt' && t.key !== 'invest').reduce((a, t) => a + Math.max(0, t.left), 0);
    expect(F, L.shortBy > 0, 'a nearly empty account should show as short of the plan');
    expect(F, shown <= L.balance + 0.02, 'with ' + L.balance + ' in the accounts, the buckets still show ' + shown.toFixed(2));
    const sumL = shown + Math.max(0, L.toInvest || 0) + L.alsoHeld - L.missing;
    expect(F, Math.abs(sumL - L.balance) < 0.02, 'when short, the buckets do not add up to the accounts (' + sumL.toFixed(2) + ' vs ' + L.balance + ')');
  }
  // Debt is kept apart from the balance: a payment due before payday holds nothing back (Josh, Nov 25).
  const dueFin = JSON.parse(JSON.stringify(FIN));
  dueFin.debts = dueFin.debts || {}; dueFin.debts.payments = (dueFin.debts.payments || []).concat([{ id: 'pchk', debtId: 'dchk', name: 'Check payment', amount: 40, due: at(1).slice(0, 10), paid: false }]);
  const DB = Money.work(dueFin, MONTHS, null, new Date(NOW)).budget;
  if (B && DB) expect(F, Math.abs((DB.toInvest || 0) - (B.toInvest || 0)) < 0.01 && DB.alsoHeld === B.alsoHeld, 'a debt payment due before payday held money back from the buckets');
  // Wishlist money kept in a savings pot outside the accounts isn't held a second time out of the balance.
  const potFin = JSON.parse(JSON.stringify(FIN));
  potFin.wishlists = { lists: [{ id: 'lp', name: 'Pot', items: [{ id: 'wp', name: 'Pot item', amount: 100, saved: 30, setAside: [{ amount: 30, at: at(-1), in: 'Cash App Savings' }] }] }] };
  const noFin = JSON.parse(JSON.stringify(FIN)); noFin.wishlists = { lists: [] };
  const PB = Money.work(potFin, MONTHS, null, new Date(NOW)).budget, NB = Money.work(noFin, MONTHS, null, new Date(NOW)).budget;
  if (PB && NB) expect(F, PB.wishHeld === NB.wishHeld && PB.toInvest === NB.toInvest, 'wishlist money in a savings pot was held out of the balance too');
  // A charge made on the same day as a balance reading, but after it, still comes off the balance (found Nov 25).
  const lateFin = { tracker: { anchors: { 'Cash App': { amount: 50, date: '2026-01-10', set: '2026-01-10T12:00:00Z' } } } };
  const lateM = { '2026-01': { txns: [
    { d: '2026-01-09', a: -1, k: 'Cash App' },
    { d: '2026-01-10', a: -5, k: 'Cash App', t: '2026-01-10T08:00:00Z' },
    { d: '2026-01-10', a: -20, k: 'Cash App', t: '2026-01-10T18:00:00Z' },
    { d: '2026-01-11', a: -10, k: 'Cash App' }] } };
  const lb = Money.balances(lateFin, lateM, '2026-01-11');
  expect(F, lb && lb.current === 20, 'a charge after the balance was read did not come off (' + (lb && lb.current) + ' vs 20)');
  expect(F, lb && lb.series['2026-01-09'] === 55 && lb.series['2026-01-10'] === 30, 'a charge before the balance was read was counted twice going back');
  // Missed charges (his pick, Nov 25): money sent to a person with no label, or a flagged charge nothing sorts.
  const MS = Money.missed(FIN, MONTHS, TODAY);
  expect(F, MS.now.length === 1 && MS.now[0].id === 't07', 'the sample friend payment should be the one missed charge (got ' + JSON.stringify(MS.now.map((m) => m.id)) + ')');
  const laterM = FinSave.apply('months', MONTHS, [{ id: 'cl1', at: at(0), type: 'labelLater', txId: 't07' }]);
  const ML = Money.missed(FIN, laterM, TODAY);
  expect(F, ML.now.length === 0 && ML.all.length === 1, 'Label later should stop the pop-up but keep the charge in the Questions inbox');
  const labelM = FinSave.apply('months', laterM, [{ id: 'cl2', at: at(0), type: 'fixCharge', txId: 't07', cat: 'food', bucket: '30' }]);
  expect(F, Money.missed(FIN, labelM, TODAY).all.length === 0, 'a labelled charge should leave the Questions inbox');
  const rvM = JSON.parse(JSON.stringify(MONTHS)); for (const k of Object.keys(rvM)) for (const t of rvM[k].txns) if (t.id === 't02' || t.id === 't11') { t.rv = 1; if (t.id === 't11') t.cat = t.c = 'other'; }
  const rvIds = Money.missed(FIN, rvM, TODAY).all.map((m) => m.id);
  expect(F, rvIds.includes('t11') && !rvIds.includes('t02'), 'a flagged charge should be missed unless something already sorts it (a store rule, a store word or his answer)');
  // Money he adds to his Cash App shows at the bank as CASH APP*JOSHUA (found Nov 27: a $44 top-up was called a
  // missed charge and counted in Wants). It's always a move between his own accounts, whatever the robot labelled it.
  const topM = { [TODAY.slice(0, 7)]: { txns: [{ id: 'tj1', d: TODAY, a: -44, k: 'First National Bank Alaska', s: 'POS PURCHASE CASH APP*JOSHUA Oakland CA', cat: 'other', c: 'other', rv: 1 }] } };
  const tj = topM[TODAY.slice(0, 7)].txns[0];
  expect(F, Money.missed(FIN, topM, TODAY).all.length === 0, 'money added to his own Cash App (CASH APP*JOSHUA) should never be a missed charge');
  expect(F, Money.catOf(tj, []) === 'transfer' && Money.bucketOf(tj, []) === 'transfer', 'money added to his own Cash App should count as a transfer, not as Wants');
  // A bank alert that names no store waits 2 days for its name before it's asked about (found Nov 27).
  const unM = { [TODAY.slice(0, 7)]: { txns: [{ id: 'tu1', d: TODAY, a: -12, k: 'First National Bank Alaska', s: 'Bank debit (the alert named no store)', cat: 'other', c: 'other', rv: 1, unnamed: true }] } };
  expect(F, Money.missed(FIN, unM, TODAY).all.length === 0, 'a charge the bank alert did not name should wait for its name before it is a missed charge');
  expect(F, Money.missed(FIN, unM, Money.addDays(TODAY, 2)).all.length === 1, 'a charge still unnamed after 2 days should be asked about');
  expect(F, Money.cleanName('Check #3206') === 'Check #3206' && Money.cleanName('VENMO NONE 8558124430 NY') === 'Venmo payment', 'a check lost its number, or a nameless Venmo payment kept a junk name');
  const rows = w.activity.flatMap((d) => d.rows);
  expect(F, rows.filter((r) => r.double).length === 2, 'the same charge twice on one day should be flagged');
  expect(F, rows.some((r) => r.ask), 'money sent to a person should ask what it was for');
  // One charge counted twice under two names, a day apart (found Nov 27: a $20 Venmo payment went in pending as
  // "Pizza" and again from the emails). Same account and amount within a day is flagged unless checked as two real ones.
  const vA = { id: 'tv1', d: dayN(-2), a: -20, k: 'First National Bank Alaska', s: 'VENMO *NONE 8558124430 NY', p: 1 };
  const vB = { id: 'tv2', d: dayN(-1), a: -20, k: 'First National Bank Alaska', s: 'VENMO *None NEW YORK NY' };
  const vM = JSON.parse(JSON.stringify(MONTHS)); for (const t of [vA, vB]) (vM[t.d.slice(0, 7)] = vM[t.d.slice(0, 7)] || { txns: [] }).txns.push(t);
  const vRows = Money.work(FIN, vM, null, new Date(NOW)).activity.flatMap((d) => d.rows);
  expect(F, vRows.filter((r) => r.double && (r.id === 'tv1' || r.id === 'tv2')).length === 2, 'the same charge under two names a day apart should be flagged as maybe counted twice');
  expect(F, Money.doublePairs([vA, Object.assign({}, vB, { both: true })]).length === 0, 'two charges checked as both real should not be flagged');
  expect(F, Money.doublePairs([vA, Object.assign({}, vB, { k: 'Cash App' })]).length === 0, 'the same amount on two different accounts should not be flagged');

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
  const cover = [document.getElementById('lockcard'), document.getElementById('connect')].concat(Array.from(document.querySelectorAll('.sheet'))).find(vis);
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
    // A button can reach past its drawn edge with an invisible ::after (TO-DO steps, Nov 28): the part a thumb can hit counts.
    const af = getComputedStyle(b, '::after');
    const reach = (v) => (af.content !== 'none' && af.position === 'absolute' && /px$/.test(v) ? Math.max(0, -parseFloat(v)) : 0);
    const w = r.width + reach(af.left) + reach(af.right), h = r.height + reach(af.top) + reach(af.bottom);
    if (w < 43.5 || h < 43.5) out.push(name(b) + ' is smaller than 44 by 44 (' + Math.round(w) + ' by ' + Math.round(h) + ')');
  }
  return out;
}

// One shared set of sizes on every page (his pick, Nov 26). Text: 34, 20, 17, 15, 13, 11 (bar labels), and 16 in
// typing boxes (the size an iPhone needs so it doesn't zoom in). Corners: 22, 14, 12, or fully round. On the phone,
// titles and full-width cards sit 20 from the screen edge. The tabs stay exactly as they were (his "Og is fine").
function sizeSet({ W, H }) {
  const out = [];
  const TEXT = [11, 13, 15, 17, 20, 34], RAD = [0, 12, 14, 22];
  const skip = '.tab, .bar, .tdtab, .td-tabs, .fi-tab, .fi-tabs, .fi-side, #print, .ghost, #toast';
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : (el.className && el.className.baseVal ? '.' + el.className.baseVal.split(' ')[0] : '')));
  const box = (el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
  const cover = [document.getElementById('lockcard'), document.getElementById('connect')].concat(Array.from(document.querySelectorAll('.sheet'))).find((el) => el && vis(el));
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest(skip) || !vis(el) || (cover && !cover.contains(el))) continue;
    const s = getComputedStyle(el);
    const own = box(el) || Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      const f = Math.round(parseFloat(s.fontSize) * 10) / 10;
      if (box(el) ? f !== 16 : !TEXT.includes(f)) out.push(name(el) + ' "' + (el.textContent || el.value || '').trim().slice(0, 24) + '" has text size ' + f + ' (the set is ' + (box(el) ? '16 for typing boxes' : TEXT.join(', ')) + ')');
    }
    if (el.closest('svg')) continue;
    const r = el.getBoundingClientRect(), k = window.hubScale ? window.hubScale() : 1, half = Math.min(r.width, r.height) / k / 2;
    for (const c of ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']) {
      const v = s['border' + c + 'Radius'];
      if (!v || v === '0px') continue;
      const n = parseFloat(v);
      const round = /%$/.test(v) ? n >= 50 : n >= half - 0.6;
      if (!round && !RAD.includes(Math.round(n))) { out.push(name(el) + ' has a ' + v + ' corner (the set is 22, 14, 12, or fully round)'); break; }
    }
  }
  if (W < 900 && !cover) {
    // The page showing now: its title and full-width cards start 20 from the screen edge.
    const page = Array.from(document.querySelectorAll('.page')).find((p) => { const r = p.getBoundingClientRect(); return Math.abs(r.left) < 2; });
    if (page) {
      const h1 = page.querySelector('h1');
      if (h1 && vis(h1) && Math.abs(h1.getBoundingClientRect().left - 20) > 0.6) out.push('the ' + page.id + ' title sits ' + h1.getBoundingClientRect().left.toFixed(1) + ' from the screen edge (should be 20)');
      for (const c of page.querySelectorAll('.card:not(.ghost), .pl-card, .fi-card, .td-suggest')) {
        if (!vis(c)) continue;
        const r = c.getBoundingClientRect();
        if (r.width < W * 0.8) continue;
        if (Math.abs(r.left - 20) > 0.6 || Math.abs(W - r.right - 20) > 0.6) { out.push(name(c) + ' sits ' + r.left.toFixed(1) + ' and ' + (W - r.right).toFixed(1) + ' from the screen edges (should be 20)'); break; }
      }
    }
  }
  return out;
}
const sizeSeen = new Set();
async function sizes(page, where, size) {
  for (const p of await page.evaluate(sizeSet, size)) {
    const key = p.replace(/ "[^"]*"/, '');
    if (sizeSeen.has(key)) continue;
    sizeSeen.add(key);
    problem(where, p);
  }
}
// The + floats bottom right in the space no card text uses (his pick, Nov 26): at every scroll spot, no floating
// button may sit over any card's text.
function floatHits() {
  const out = [];
  const btns = Array.from(document.querySelectorAll('[data-floats] button')).filter((b) => { const s = getComputedStyle(b); const r = b.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && !b.closest('[hidden]'); });
  for (const b of btns) {
    const q = b.getBoundingClientRect();
    for (const c of document.querySelectorAll('.card:not(.ghost), .td-suggest, .pl-card, .fi-card')) {
      const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        for (const t of rg.getClientRects()) {
          if (t.width < 1 || t.height < 1) continue;
          const x = Math.min(t.right, q.right) - Math.max(t.left, q.left), y = Math.min(t.bottom, q.bottom) - Math.max(t.top, q.top);
          if (x > 1 && y > 1) { out.push('the floating ' + (b.getAttribute('aria-label') || 'button') + ' sits over "' + n.textContent.trim().slice(0, 30) + '"'); break; }
        }
      }
    }
  }
  return out;
}
async function floatsClear(page, where, scrollSel) {
  for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    await page.evaluate(([sel, f]) => { const s = document.querySelector(sel); if (s) s.scrollTop = (s.scrollHeight - s.clientHeight) * f; }, [scrollSel, f]);
    await settle(page, 120);
    const hits = await page.evaluate(floatHits);
    if (hits.length) { problem(where, hits[0] + ' (scrolled ' + Math.round(f * 100) + '%)'); break; }
  }
  await page.evaluate((sel) => { const s = document.querySelector(sel); if (s) s.scrollTop = 0; }, scrollSel);
  await settle(page, 120);
}
// The bottom bar runs to the bottom edge (no dark strip), and what's behind everything is the bar's own color.
async function barToEdge(page, where, size) {
  const b = await page.evaluate(() => {
    const bar = document.querySelector('.bar'), r = bar.getBoundingClientRect(), after = getComputedStyle(bar, '::after');
    return { bottom: r.bottom, h: innerHeight, html: getComputedStyle(document.documentElement).backgroundColor, bar: getComputedStyle(bar).backgroundColor, after: after.display !== 'none' && parseFloat(after.height) > 0 };
  });
  expect(where, Math.abs(b.bottom - b.h) < 0.6, 'the bottom bar should run to the bottom edge (it ends ' + (b.h - b.bottom).toFixed(1) + ' above it)');
  expect(where, b.html === b.bar && b.after, 'the color behind the app and below the bar should be the bar\'s own color, so no dark strip can show (behind: ' + b.html + ', bar: ' + b.bar + ')');
}
async function settle(page, ms) { await page.waitForTimeout(ms || 450); }
async function look(page, where, size) { for (const p of await page.evaluate(inspect, size)) problem(where, p); await sizes(page, where, size); }
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
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
async function newContext(browser, scheme, size, extra) {
  extra = Object.assign({}, extra);
  const startAt = extra.at || NOW;
  delete extra.at;
  if (extra.isMobile && !extra.userAgent) extra.userAgent = IPHONE_UA;
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
    // A made-up Face ID that works like an iPhone's, so every check runs the way his phone does: the passkey
    // gives its secret only on Face ID after it's made, and fakeface.no in storage makes it say "not now"
    // (like a phone that wants a tap first). The test browser has no real one, and can't keep a lock in storage.
    const no = () => { try { return localStorage.getItem('fakeface.no') === '1'; } catch (e) { return false; } };
    const refuse = () => { const e = new Error('not now'); e.name = 'NotAllowedError'; return e; };
    const cred = (secret) => ({ rawId: new Uint8Array([9, 8, 7, 6]).buffer, getClientExtensionResults: () => ({ prf: secret ? { enabled: true, results: { first: secret } } : { enabled: true } }) });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      async create() { if (no()) throw refuse(); return cred(null); },
      async get(o) {
        if (no()) throw refuse();
        const p = o.publicKey.extensions && o.publicKey.extensions.prf;
        return p ? cred(new Uint8Array(p.eval.first).map((b) => b ^ 0x5a).buffer) : { rawId: new Uint8Array([9, 8, 7, 6]).buffer, getClientExtensionResults: () => ({}) };
      },
    } });
    window.PublicKeyCredential = window.PublicKeyCredential || function () {};
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
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
// ---- The data key's Face ID lock (Josh's pick, Nov 26), with a made-up Face ID that works like an iPhone's ----
// Uses the made-up Face ID every check context has (see newContext).
async function faceLock(browser, base, edges, phone) {
  const F = 'Face ID lock';
  console.log('Checking the Face ID lock');
  const ctx = await newContext(browser, 'light', phone, { hasTouch: true, isMobile: true });
  const ready = (pg) => pg.waitForFunction(() => document.documentElement.dataset.loaded === 'yes', null, { timeout: 8000 }).then(() => true).catch(() => false);
  const plainKeyKept = (pg) => pg.evaluate(() => Object.keys(localStorage).some((k) => /saving-key/.test(localStorage.getItem(k) || '')));

  // 1. Paste a key: it's locked with Face ID straight away and never kept as plain text.
  let pg = await ctx.newPage();
  await pg.goto(base); await pg.addStyleTag({ content: edges });
  await pg.waitForFunction(() => document.documentElement.dataset.loaded);
  await pg.fill('#connect-key', 'saving-key');
  await pg.tap('#connect-go');
  expect(F, await ready(pg), 'the Hub did not open after pasting a key');
  const st = await pg.evaluate(() => ({ mode: (JSON.parse(localStorage.getItem('hub2.lock.v1')) || {}).mode, plain: localStorage.getItem('hub2.databoxKey') }));
  expect(F, st.mode === 'faceid' && !st.plain, 'a pasted key should be locked with Face ID, with no plain copy (got ' + JSON.stringify(st) + ')');
  expect(F, !(await plainKeyKept(pg)), 'the key is kept somewhere on the phone as plain text');
  expect(F, await pg.locator('#lockcard').isHidden(), 'the lock screen should not show once the key is locked');
  await pg.close();

  // 2. Opening the Hub again asks Face ID and opens with no tap.
  pg = await ctx.newPage();
  await pg.goto(base);
  expect(F, await ready(pg), 'the Hub did not open with Face ID');
  expect(F, await pg.locator('#lockcard').isHidden() && await pg.locator('#connect').isHidden(), 'Face ID worked, but a lock or key screen still showed');
  const pass = await pg.evaluate(() => document.querySelector('[data-tab="todo"]') && document.documentElement.dataset.todo);
  expect(F, pass === 'ready', 'the TO-DO page did not load after Face ID');
  await pg.close();

  // 3. Face ID says "not now": the unlock screen shows, looks right, and its button opens the Hub.
  pg = await ctx.newPage();
  await pg.addInitScript(() => { if (!sessionStorage.getItem('once')) { sessionStorage.setItem('once', '1'); localStorage.setItem('fakeface.no', '1'); } });
  await pg.goto(base); await pg.addStyleTag({ content: edges });
  await pg.waitForFunction(() => document.documentElement.dataset.lock === 'unlock', null, { timeout: 8000 }).catch(() => problem(F, 'the unlock screen did not show when Face ID said not now'));
  expect(F, /Unlock with/.test(await pg.locator('#lock-go').textContent()), 'the unlock button should say "Unlock with ..."');
  await look(pg, F + ' unlock screen', phone);
  await pg.screenshot({ path: path.join(OUT, 'light-unlock.png') });
  await pg.evaluate(() => localStorage.removeItem('fakeface.no'));
  await pg.tap('#lock-go');
  expect(F, await ready(pg), 'tapping Unlock did not open the Hub');
  expect(F, await pg.locator('#lockcard').isHidden(), 'the unlock screen stayed up after Face ID');
  await pg.close();
  await ctx.close();

  // 4. A key kept as plain text by an earlier version: the Hub asks to lock it, and locking removes the plain copy.
  const c2 = await newContext(browser, 'dark', phone, { hasTouch: true, isMobile: true });
  await c2.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('hub2.databoxKey', 'saving-key'); localStorage.setItem('fakeface.no', '1'); }
    const no = () => localStorage.getItem('fakeface.no') === '1';
    const refuse = () => { const e = new Error('not now'); e.name = 'NotAllowedError'; return e; };
    const cred = (secret) => ({ rawId: new Uint8Array([1, 2]).buffer, getClientExtensionResults: () => ({ prf: secret ? { enabled: true, results: { first: secret } } : {} }) });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      async create() { if (no()) throw refuse(); return cred(new Uint8Array(32).fill(3).buffer); },
      async get() { if (no()) throw refuse(); return cred(new Uint8Array(32).fill(3).buffer); } } });
    window.PublicKeyCredential = window.PublicKeyCredential || function () {};
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  });
  pg = await c2.newPage();
  await pg.goto(base); await pg.addStyleTag({ content: edges });
  await pg.waitForFunction(() => document.documentElement.dataset.lock === 'lock', null, { timeout: 8000 }).catch(() => problem(F, 'a plain-text key did not ask to be locked'));
  await look(pg, F + ' lock screen (dark)', phone);
  await pg.screenshot({ path: path.join(OUT, 'dark-lock-key.png') });
  await pg.evaluate(() => localStorage.removeItem('fakeface.no'));
  await pg.tap('#lock-go');
  await pg.waitForFunction(() => document.documentElement.dataset.lock === 'done', null, { timeout: 5000 }).catch(() => problem(F, 'tapping Lock did not lock the key'));
  const s2 = await pg.evaluate(() => ({ mode: (JSON.parse(localStorage.getItem('hub2.lock.v1')) || {}).mode, plain: localStorage.getItem('hub2.databoxKey') }));
  expect(F, s2.mode === 'faceid' && !s2.plain, 'locking should leave no plain copy (got ' + JSON.stringify(s2) + ')');
  await pg.close();
  await c2.close();

  // 5. No Face ID and a browser that can't keep a lock (this test browser can't): the Hub still opens at once,
  // and the key is used for that visit only, never saved as plain text.
  const c3 = await newContext(browser, 'light', phone, { hasTouch: true, isMobile: true });
  await c3.addInitScript(() => { window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => false; });
  pg = await c3.newPage();
  await pg.goto(base);
  await pg.waitForFunction(() => document.documentElement.dataset.loaded);
  await pg.fill('#connect-key', 'saving-key');
  await pg.tap('#connect-go');
  expect(F, await ready(pg), 'with no Face ID, the Hub did not open after pasting a key');
  expect(F, !(await plainKeyKept(pg)), 'with no Face ID, the key was kept as plain text');
  expect(F, await pg.locator('#lockcard').isHidden(), 'with no way to lock, the lock screen should not show');
  await pg.close();
  await c3.close();

  // 6. A Windows PC (found Nov 26): it says Windows Hello, never "look at your phone", waits for a click, says what
  // really went wrong, and after two tries puts "Use my key instead" first.
  const W2 = 'PC unlock (Windows)';
  const c4 = await newContext(browser, 'dark', { W: 1440, H: 900 }, { userAgent: WINDOWS_UA });
  await c4.addInitScript(() => {
    localStorage.setItem('hub2.lock.v1', JSON.stringify({ mode: 'gate', cred: 'AQc=', salt: 'AAAA', iv: 'AAAA', box: 'AAAA' }));
    localStorage.setItem('hub2.lock.cred', JSON.stringify({ cred: 'AQc=', prf: 'no' }));
    window.__asks = 0; window.__secretAsks = 0; window.__creates = 0; window.__createSecret = 0;
    const refuse = () => { const e = new Error('The operation either timed out or was not allowed.'); e.name = 'NotAllowedError'; return e; };
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      async create(o) { window.__creates++; if (o.publicKey.extensions && o.publicKey.extensions.prf) window.__createSecret++; throw refuse(); },
      async get(o) { window.__asks++; if (o.publicKey.extensions && o.publicKey.extensions.prf) window.__secretAsks++; throw refuse(); } } });
  });
  pg = await c4.newPage();
  await pg.goto(base);
  await pg.waitForFunction(() => document.documentElement.dataset.lock === 'unlock', null, { timeout: 8000 }).catch(() => problem(W2, 'the unlock screen did not show on a locked PC'));
  await pg.waitForTimeout(400);
  const w1 = await pg.evaluate(() => ({ why: document.getElementById('lock-why').textContent, go: document.getElementById('lock-go').textContent, asks: window.__asks }));
  expect(W2, /Windows Hello/.test(w1.why) && !/phone/i.test(w1.why) && w1.go === 'Unlock with Windows Hello', 'a Windows PC should say Windows Hello, not "look at your phone" (got ' + JSON.stringify(w1) + ')');
  expect(W2, w1.asks === 0, 'a PC should wait for a click before asking Windows Hello (it asked ' + w1.asks + ' times on its own)');
  await look(pg, W2 + ' unlock screen', { W: 1440, H: 900, TOP: 0, BOTTOM: 0 });
  await pg.screenshot({ path: path.join(OUT, 'dark-pc-unlock.png') });
  await pg.click('#lock-go');
  await pg.waitForFunction(() => /didn/.test(document.getElementById('lock-error').textContent), null, { timeout: 5000 }).catch(() => {});
  const w2 = await pg.evaluate(() => ({ err: document.getElementById('lock-error').textContent, other: document.getElementById('lock-other').textContent }));
  expect(W2, !/NotAllowedError/.test(w2.err) && /didn't open the Hub/.test(w2.err) && /Set up Windows Hello again/.test(w2.err), 'a refused try on a PC should say plainly what to do, not the raw error (got "' + w2.err + '")');
  // Found Nov 27: when Windows Hello refuses this PC's passkey, the first way out makes a new one, with no key to paste.
  const w3 = await pg.evaluate(() => { const r = document.getElementById('lock-redo'), o = document.getElementById('lock-other'), g = document.getElementById('lock-go'); return { redo: !r.hidden && r.textContent, redoQuiet: r.classList.contains('quiet'), other: o.textContent, otherQuiet: o.classList.contains('quiet'), goQuiet: g.classList.contains('quiet'), secretAsks: window.__secretAsks }; });
  expect(W2, w3.redo === 'Set up Windows Hello again' && !w3.redoQuiet && w3.goQuiet && w3.otherQuiet && w3.other === 'Use my key instead', 'after Windows Hello refuses, "Set up Windows Hello again" should come first, with "Use my key instead" under it (got ' + JSON.stringify(w3) + ')');
  expect(W2, w3.secretAsks === 0, 'a PC locked the gate way must never be asked for the secret (asked ' + w3.secretAsks + ' times)');
  await look(pg, W2 + ' unlock screen after a refusal', { W: 1440, H: 900, TOP: 0, BOTTOM: 0 });
  await pg.screenshot({ path: path.join(OUT, 'dark-pc-unlock-stuck.png') });
  await pg.click('#lock-redo');
  await pg.waitForFunction(() => window.__creates > 0 && /set up again/.test(document.getElementById('lock-error').textContent), null, { timeout: 5000 }).catch(() => {});
  const w4 = await pg.evaluate(() => ({ creates: window.__creates, createSecret: window.__createSecret, err: document.getElementById('lock-error').textContent }));
  expect(W2, w4.creates === 1 && w4.createSecret === 0, '"Set up Windows Hello again" should make one new passkey without asking for the secret (got ' + JSON.stringify(w4) + ')');
  expect(W2, /wasn't set up again/.test(w4.err) && /key instead/.test(w4.err) && !/NotAllowedError/.test(w4.err), 'a cancelled set-up should say so and offer the key (got "' + w4.err + '")');
  await pg.click('#lock-other');
  expect(W2, await pg.locator('#connect').isVisible(), '"Use my key instead" should open the key screen');
  await pg.close();
  await c4.close();

  // 7. A PC locked the older 'faceid' way (found Nov 27): Windows Hello is never asked for the secret; the Hub says
  // the lock is an older kind and asks for the key once.
  const c5 = await newContext(browser, 'dark', { W: 1440, H: 900 }, { userAgent: WINDOWS_UA });
  await c5.addInitScript(() => {
    localStorage.setItem('hub2.lock.v1', JSON.stringify({ mode: 'faceid', cred: 'AQc=', salt: 'AAAA', iv: 'AAAA', box: 'AAAA' }));
    window.__asks = 0; window.__secretAsks = 0;
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      async create() { throw new Error('not expected'); },
      async get(o) { window.__asks++; if (o.publicKey.extensions && o.publicKey.extensions.prf) window.__secretAsks++; const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } } });
  });
  pg = await c5.newPage();
  await pg.goto(base);
  await pg.waitForFunction(() => document.documentElement.dataset.lock === 'unlock', null, { timeout: 8000 }).catch(() => problem(W2, 'the unlock screen did not show on a PC with an older lock'));
  await pg.click('#lock-go');
  await pg.waitForTimeout(600);
  const w5 = await pg.evaluate(() => ({ secretAsks: window.__secretAsks, connect: !document.getElementById('connect').hidden, text: document.getElementById('connect').textContent }));
  expect(W2, w5.secretAsks === 0, 'a PC with an older lock must never be asked for the secret (asked ' + w5.secretAsks + ' times)');
  expect(W2, w5.connect && /older way/.test(w5.text), 'a PC with an older lock should ask for the key once and say why (got ' + JSON.stringify(w5) + ')');
  await pg.close();
  await c5.close();
}

// The missed-charge pop-up opens by itself over whatever page he's on. Flows that aren't testing it close it.
async function closeMissed(page) {
  await page.waitForFunction(() => document.documentElement.dataset.finance === 'ready', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (await page.locator('#sheet-fin').isVisible() && /missed charge/.test(await page.locator('#fin-sheet-title').textContent())) {
    await page.click('#sheet-fin .sheet-top [data-close]');
    await page.waitForTimeout(250);
  }
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
  await closeMissed(page);
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

// Dark only (his pick, Nov 26) covers every pop-up too. Found Nov 27: the small note at the bottom was white
// because of a leftover line from before dark only. Hidden ones count as well, since they show later.
async function popupsDark(page, where) {
  const bad = await page.evaluate(() => {
    const lum = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3 || (m.length > 3 && m[3] < 0.3)) return null; return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const out = [];
    for (const el of document.querySelectorAll('#toast, .toast, .sheet-card, .pl-bubble, .menu, [role="dialog"], [role="alertdialog"], .card.ghost')) {
      const s = getComputedStyle(el), l = lum(s.backgroundColor);
      if (l !== null && l > 90) out.push((el.id ? '#' + el.id : el.className) + ' is light (' + s.backgroundColor + '); everything is dark only');
      const ink = lum(s.color);
      if (l !== null && ink !== null && ink < 120) out.push((el.id ? '#' + el.id : el.className) + ' has dark writing (' + s.color + ')');
    }
    return out;
  });
  for (const b of bad) problem(where, b);
}

// The key's name stays on one line, so it never reads as two names (found Nov 27: it broke at its hyphen).
async function keyOnOneLine(page, where, sel) {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'missing' };
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const m = n.textContent.match(/ends in (\S+?)\)/);
      if (!m) continue;
      const i = n.textContent.indexOf(m[1]);
      const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + m[1].length);
      const tops = new Set(Array.from(rg.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top)));
      return { ok: tops.size <= 1 && !/-/.test(m[1]), why: m[1] + ' on ' + tops.size + ' lines' };
    }
    return { ok: false, why: 'no key name in "' + el.textContent.trim() + '"' };
  }, sel);
  expect(where, r.ok, "the key's name should stay on one line and use a hyphen that can't break (" + r.why + ')');
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
      // The switch stays in place, on and greyed, so the row doesn't jump (found Nov 27: it vanished and left a gap).
      const ov = await page.evaluate(() => { const s = document.querySelector('.only'); return s ? { shown: s.offsetParent !== null && getComputedStyle(s).visibility !== 'hidden', on: s.getAttribute('aria-pressed') === 'true', locked: s.disabled } : null; });
      expect(T + ' Overdue tab', !!ov && ov.shown && ov.on && ov.locked, 'the Only overdue switch should stay in place on the Overdue tab, on and greyed (' + JSON.stringify(ov) + ')');
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
  await floatsClear(page, T + ' All', '.td-scroll');
  await popupsDark(page, T);
  // The approved header (canvas TodoAB): ? and gear in a row under the title, next to Only overdue; only the + floats.
  const hd = await page.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const only = document.querySelector('.td-tools .only'), tools = Array.from(document.querySelectorAll('.td-tools .round')).filter((b) => b.offsetParent);
    const fabs = Array.from(document.querySelectorAll('.td-fabs button')).filter((b) => b.offsetParent);
    const h1 = document.querySelector('#page-todo h1');
    return { tools: tools.length, row: !!only && tools.every((b) => Math.abs(mid(b) - mid(only)) < 4), under: !!only && !!h1 && only.getBoundingClientRect().top >= h1.getBoundingClientRect().bottom,
      fabs: fabs.map((b) => b.getAttribute('aria-label')).join(', ') };
  });
  expect(T, hd.tools === 2 && hd.row && hd.under, 'the ? and gear should sit in a row under the title, next to Only overdue (' + JSON.stringify(hd) + ')');
  expect(T, hd.fabs === 'Add task', 'only the + should float (floating now: ' + hd.fabs + ')');
  // The count line counts every tab, so its overdue number is the Overdue tab's, whichever tab shows (his pick, Nov 26).
  const lineOver = async () => +((await page.locator('.td-sub').textContent()).match(/(\d+) overdue/) || [0, -1])[1];
  const onAll = await lineOver();
  await tapTab(page, 'overdue');
  const overCards = (await cardIds(page)).length, onOver = await lineOver();
  await tapTab(page, 'all');
  expect(T, onAll === overCards && onOver === overCards, 'the count line\'s overdue number should match the Overdue tab (line says ' + onAll + ' on All and ' + onOver + ' on Overdue; the tab has ' + overCards + ')');

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
  expect(T + ' tick', /1 change waiting to save: the key here \(ends in [-\u2011]key\) can only read/.test(await page.locator('.td-pending').textContent()), 'the waiting line should count the change and say which key can only read (got "' + (await page.locator('.td-pending').textContent()) + '")');
  await keyOnOneLine(page, T + ' tick', '.td-pending');
  await keyOnOneLine(page, T + ' tick note', '#toast');
  await popupsDark(page, T + ' tick note');
  await page.tap('.done-toggle');
  await settle(page, 200);
  // A finished card is flat and quiet, so Done never looks like more to do (found Nov 27).
  const dn = await page.evaluate(() => { const c = document.querySelector('.done-list .card'); if (!c) return null; const s = getComputedStyle(c), p = c.querySelector('.pic'); return { img: s.backgroundImage, shadow: s.boxShadow, pic: p ? getComputedStyle(p).filter : 'none' }; });
  expect(T + ' Done', !!dn && dn.img === 'none' && dn.shadow === 'none' && (!dn.pic || dn.pic === 'none' || /grayscale/.test(dn.pic)), 'a finished card should be flat with its picture faded (' + JSON.stringify(dn) + ')');
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
  expect(T + ' step', await page.locator('#sheet-edit').isHidden(), 'ticking a step should not open the edit sheet');
  // Steps sit close together so a card with steps stays small (found Nov 27: each step was 44 high).
  const stepH = (await page.locator('.card[data-id="c"] .sub[data-sub="1"]').boundingBox() || { height: 99 }).height;
  expect(T + ' step', stepH <= 36, 'each step should be at most 36 high (got ' + Math.round(stepH) + ')');

  // Tapping a task opens its edit sheet, filled in (his pick, Nov 28; found Nov 27: a tap on a card did nothing).
  const dTitle = TASKS.d.title, dDue = await page.locator('.card[data-id="d"] .due').textContent().catch(() => '');
  await page.tap('.card[data-id="d"] .t');
  await settle(page, 300);
  const ed = await page.evaluate(() => ({ open: !document.getElementById('sheet-edit').hidden, name: document.getElementById('edit-name').value }));
  expect(T + ' edit', ed.open && ed.name === dTitle, 'tapping a task should open "Edit task" with its name filled in (' + JSON.stringify(ed) + ')');
  if (ed.open) {
    await look(page, T + ' edit sheet', size);
    await popupsDark(page, T + ' edit sheet');
    await page.screenshot({ path: path.join(OUT, scheme + '-todo-edit.png') });
    await page.fill('#edit-name', 'Sample renamed');
    await page.tap('#edit-form .wide');
    await settle(page, 250);
    expect(T + ' edit', await page.locator('#sheet-edit').isHidden(), 'Save should close the edit sheet');
    expect(T + ' edit', (await page.locator('.card[data-id="d"] .t').textContent()).trim() === 'Sample renamed', 'Save did not change the name');
    expect(T + ' edit', (await page.locator('.card[data-id="d"] .due').textContent().catch(() => '')) === dDue, 'changing only the name moved the due date');
    await page.tap('.card[data-id="d"] .t');
    await settle(page, 300);
    await page.fill('#edit-name', dTitle);
    await page.tap('#edit-form .wide');
    await settle(page, 250);
  }

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
  await popupsDark(page, T + ' add form');
  // The + form says which boxes can stay empty, and where the task goes reads at full size (found Nov 27).
  const af = await page.evaluate(() => ({ labels: Array.from(document.querySelectorAll('#add-form .fld > span')).map((s) => s.textContent),
    where: (() => { const w = document.getElementById('add-where'); return w ? parseFloat(getComputedStyle(w).fontSize) : 0; })() }));
  expect(T + ' add form', af.labels.filter((l) => /optional/i.test(l)).length === 3 && !/optional/i.test(af.labels[0] || ''), 'Due date, Time and Note should say (optional), and Name should not (' + af.labels.join(', ') + ')');
  expect(T + ' add form', af.where >= 15, 'the line saying where the task goes should be at least 15 (got ' + af.where + ')');
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
  expect(T + ' reorder', await page.locator('#sheet-edit').isHidden(), 'letting go of a dragged card should not open the edit sheet');
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
  expect(T + ' drag', !(await page.locator('.td-fabs .plus').isVisible()), 'the + should step aside while a card is dragged, so it never sits over the card');
  const ghostBg = await page.evaluate(() => { const g = document.querySelector('.card.ghost'); return g ? getComputedStyle(g).backgroundColor : 'none'; });
  expect(T + ' drag', /^rgb\(/.test(ghostBg), 'the card being dragged has no solid background (got ' + ghostBg + ')');
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-dragging.png') });
  const tr = await page.locator('.td-trash').boundingBox();
  if (tr) await page.mouse.move(tr.x + tr.width / 2, tr.y + tr.height / 2, { steps: 10 });
  await page.waitForTimeout(80); await page.mouse.up(); await settle(page, 250);
  expect(T + ' trash', !(await cardIds(page)).includes(gone), 'a card dropped on the trash stayed');

  // ?, the menu, the Archive, Settings, the waiting list.
  await page.tap('.td-tools [data-open="sheet-questions"]');
  await settle(page, 250);
  expect(T + ' ?', (await page.locator('#q-list').textContent()).includes('Is the sample still on?'), 'the question list is missing a question');
  await look(page, T + ' questions', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-questions.png') });
  // A written question is answered right here (found Nov 27: it said "answer in chat").
  const qf = page.locator('#q-list form.q-answer');
  expect(T + ' ?', (await qf.count()) === 1 && !/answer in chat/i.test(await page.locator('#sheet-questions').textContent()), 'a written question should have a box to type the answer in');
  if (await qf.count()) {
    await qf.locator('input').fill('Yes, still on');
    await qf.locator('button').tap();
    await settle(page, 300);
    expect(T + ' answer', !(await page.locator('#q-list').textContent()).includes('Is the sample still on?'), 'an answered question should leave the list');
    expect(T + ' answer', /next check/.test(await page.locator('#toast').textContent()), 'sending an answer should say when Claude reads it');
  }
  await page.tap('#sheet-questions [data-close]');
  await page.tap('.td-tools [data-open="sheet-menu"]');
  await settle(page, 250);
  await look(page, T + ' menu', size);
  // Each menu row has its icon and the last one has no line under it (found Nov 27: it looked bare).
  const mn = await page.evaluate(() => { const items = Array.from(document.querySelectorAll('#sheet-menu .menu-item')).filter((b) => b.offsetParent);
    return { n: items.length, icons: items.filter((b) => b.querySelector('svg')).length, last: items.length ? parseFloat(getComputedStyle(items[items.length - 1]).borderBottomWidth) : -1 }; });
  expect(T + ' menu', mn.n > 0 && mn.icons === mn.n && mn.last === 0, 'every menu row should have an icon and the last should have no line under it (' + JSON.stringify(mn) + ')');
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-menu.png') });
  await page.tap('#sheet-menu [data-open="sheet-archive"]');
  await settle(page, 250);
  const arch = await page.locator('#archive-list').textContent();
  expect(T + ' Archive', arch.includes('Old finished one') && arch.includes('A deleted one'), 'the Archive is missing finished or deleted tasks');
  expect(T + ' Archive', arch.includes(goneTitle), 'a task trashed on screen should show in the Archive');
  await look(page, T + ' Archive', size);
  await page.screenshot({ path: path.join(OUT, scheme + '-todo-archive.png') });
  await page.tap('#sheet-archive [data-close]');
  await page.tap('.td-tools [data-open="sheet-menu"]');
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

// How dark the page is: 0 is black, 255 is white. Used to check that the app is always dark.
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
    // Week blocks are color only (his pick, Nov 28): no name inside, and the name read out for a screen reader.
    for (const b of document.querySelectorAll('#page-plan .pl-wev')) {
      if (!b.offsetParent) continue;
      if (b.textContent.trim()) out.push('a week block should be color only, but shows "' + b.textContent.trim() + '"');
      if (!b.getAttribute('aria-label')) out.push('a week block has no name for a screen reader');
    }
    for (const b of document.querySelectorAll('#page-plan .pl-ev, #page-plan .pl-wchip')) {
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
// Hidden means hidden, everywhere (found Nov 28: a hidden PC-only button still showed, because the PC line won).
async function hiddenHides(page, where) {
  const bad = await page.evaluate(() => Array.from(document.querySelectorAll('[hidden]'))
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => el.id || el.className || el.tagName));
  for (const b of bad) problem(where, 'something marked hidden still shows: ' + b);
}
// Where a card's hours sit: the hour at the top and the middle of what shows, and whether the red now line is in sight.
const planSpot = (page, which) => page.evaluate((which) => {
  const sc = document.querySelector('.pl-' + which + 'card .pl-scroll'), g = sc.firstElementChild;
  const hr = g.offsetHeight / 24, top = (sc.scrollTop - g.offsetTop) / hr;
  const now = sc.querySelector('.pl-now');
  const r = sc.getBoundingClientRect(), n = now && now.getBoundingClientRect();
  return { shown: sc.clientHeight > 0, top: Math.round(top * 10) / 10, hours: Math.round(sc.clientHeight / hr * 10) / 10,
    nowSeen: !!n && n.top >= r.top && n.bottom <= r.bottom };
}, which);
// Each view opens near now on today (found Nov 28: the week, the PC, and Week back to Day all opened at midnight).
async function opensNearNow(page, where, which) {
  await settle(page, 250);
  const sp = await planSpot(page, which);
  expect(where, sp.shown && sp.top > 1 && sp.nowSeen, 'the ' + which + ' view should open near now with the red line in sight, not at midnight (top at hour ' + sp.top + ')');
}
// Every hour has its label, midnight too, written the same in the day and the week ("3 PM", "Noon").
async function hourWords(page, where, which) {
  const labels = await page.locator('.pl-' + which + 'card .pl-hr').allTextContents();
  expect(where, labels.length === 24 && labels[0] === '12 AM' && labels[12] === 'Noon' && labels[15] === '3 PM' && labels.every((t) => /^(\d{1,2} (AM|PM)|Noon)$/.test(t)),
    'the ' + which + ' hours should run 12 AM, 1 AM … Noon … 11 PM (got ' + labels.slice(0, 3).join(', ') + ' … ' + labels.length + ' labels)');
  const fit = await page.evaluate((which) => Array.from(document.querySelectorAll('.pl-' + which + 'card .pl-hr')).filter((h) => h.scrollWidth > h.clientWidth + 1 || h.getBoundingClientRect().top < h.closest('.pl-scroll').getBoundingClientRect().top - 9999).length, which);
  expect(where, !fit, 'an hour label is cut off in the ' + which + ' view');
}
async function phonePlan(page, scheme, size) {
  const P = scheme + ' Plan';
  await page.tap('.tab[data-tab="plan"]');
  await settle(page);
  await planReady(page);
  // Opens on today, in the day view.
  if ((await page.locator('.pl-wrap').getAttribute('data-view')) !== 'day') { await page.tap('[data-view-pick="day"]'); await settle(page, 200); }
  const headRow = async () => page.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const h1 = document.querySelector('#page-plan .pl-head h1');
    const btns = Array.from(document.querySelectorAll('#page-plan .pl-nav button')).filter((b) => b.offsetParent && !b.closest('[hidden]') && getComputedStyle(b).display !== 'none' && !b.closest('.pc-only'));
    const t = document.querySelector('#page-plan .pl-titles').getBoundingClientRect();
    const off = btns.filter((b) => mid(b) < t.top || mid(b) > t.bottom).map((b) => b.getAttribute('aria-label') || b.textContent.trim());
    const pill = document.querySelector('#page-plan .pl-dline .pl-today');
    return { n: btns.length, off, pill: !!pill && !pill.hidden && getComputedStyle(pill).display !== 'none', right: btns.every((b) => b.getBoundingClientRect().left > h1.getBoundingClientRect().right) };
  });
  const hr = await headRow();
  expect(P, hr.n >= 4 && !hr.off.length && hr.right, 'the Plan header should be one row: Plan and the date on the left, back, Day and Week, forward on the right (off the row: ' + hr.off.join(', ') + '; ' + hr.n + ' buttons)');
  expect(P, !hr.pill, 'the Today button should only show when a day other than today is open');
  await page.tap('#page-plan .pl-next');
  await settle(page, 200);
  const hr2 = await headRow();
  expect(P, hr2.pill && !hr2.off.length, 'away from today, the header should stay one row with a Today button by the date (' + JSON.stringify(hr2) + ')');
  await page.tap('#page-plan .pl-dline .pl-today');
  await settle(page, 200);
  const text = await planText(page);
  expect(P, text.includes('Work (Midtown)') && text.includes('Creekside Eatery Breakfast') && text.includes('Dorm Night'), 'today\'s events do not show by name');
  expect(P, !text.includes('Print the bus pass') && !text.includes('Foothills Josh F') && !text.includes('New Event 8/26'), 'something that should be left out shows (a ticked task\'s calendar copy, the store\'s calendar or the Blackboard copy)');
  // The top bar: message Claude, with today's due count in sight (the Hub has no brief of its own, Nov 26).
  expect(P, (await page.locator('.pl-hl').textContent()).trim() === 'Message Claude about your calendar', 'the top bar should offer to message Claude about the calendar');
  expect(P, (await page.locator('.pl-ask [data-line="plan"]').textContent()).trim() === Plan.dueLine(Plan.dueToday(TASKS, NOW).length), "the top bar should show today's due count");
  expect(P, (await page.locator('.pl-msg, #sheet-brief').count()) === 0, 'the old brief and the small message button should be gone');
  const late = page.locator('.pl-daycard .pl-late');
  expect(P, (await late.isVisible()) && (await late.textContent()).trim() === LATE_N + ' overdue', 'today should show a yellow "' + LATE_N + ' overdue" button');
  // Slimmer top (his pick, Nov 28): the message line stays on one line, and the day shows at least 7 hours.
  const slim = await page.evaluate(() => { const h = document.querySelector('.pl-hl'); return { h: h.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(h).lineHeight) }; });
  expect(P, slim.h <= slim.lh + 1, 'the message bar\'s words should sit on one line (' + slim.h + 'px tall)');
  const sp0 = await planSpot(page, 'day');
  expect(P, sp0.hours >= 7, 'the phone\'s day should show at least 7 hours under the top (shows ' + sp0.hours + ')');
  await opensNearNow(page, P + ' day', 'day');
  await hourWords(page, P + ' day', 'day');
  expect(P, (await page.locator('.pl-chev path').getAttribute('d')) === 'M9 6l6 6-6 6', 'the message bar\'s arrow should point right (it opens), not up');
  await hiddenHides(page, P);
  await lookPlan(page, P + ' day', size, scheme + '-plan-day');
  // A long event keeps its name in sight when scrolled to its middle (found Nov 28: the work shift was a plain block).
  const stick = await page.evaluate(() => {
    const sc = document.querySelector('.pl-daycard .pl-scroll'), g = sc.firstElementChild;
    const ev = Array.from(g.querySelectorAll('.pl-ev')).sort((a, b) => b.offsetHeight - a.offsetHeight)[0];
    if (!ev || ev.offsetHeight < sc.clientHeight / 2) return { skip: true };
    sc.scrollTop = g.offsetTop + ev.offsetTop + ev.offsetHeight / 3;
    const r = sc.getBoundingClientRect(), n = ev.querySelector('.nm').getBoundingClientRect(), b = ev.getBoundingClientRect();
    return { name: ev.dataset.tip, seen: n.top >= r.top - 1 && n.bottom <= b.bottom + 1 && n.top <= r.top + 12 };
  });
  if (stick.skip) console.log('  note: no event long enough to check that its name stays in sight');
  else expect(P, stick.seen, 'scrolled into the middle of "' + stick.name + '", its name should stay at the top of what shows');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-longname.png') });
  // Tapping a block shows just its name.
  await page.evaluate(() => { document.querySelector('.pl-daycard .pl-scroll').scrollTop = document.querySelector('.pl-grid').offsetHeight * 9 / 24; });
  await settle(page, 150);
  await page.locator('.pl-daycard .pl-ev', { hasText: /Work \(Mid\u00AD?town\)/ }).tap();
  await settle(page, 200);
  const tip = await page.evaluate(() => { const b = document.querySelector('.pl-bubble'); return { shown: !b.hidden, text: b.innerText }; });
  expect(P, tip.shown && /Work \(Midtown\)/.test(tip.text), 'tapping a block did not show its name (' + JSON.stringify(tip) + ')');
  expect(P, !(await page.locator('#sheet-overdue').isVisible()), 'tapping a block should only show its name, not open anything');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-tap.png') });
  await page.tap('.pl-date');
  await settle(page, 150);
  expect(P, await page.locator('.pl-bubble').isHidden(), 'the name bubble did not go away');
  // The top bar opens the message box.
  await page.tap('.pl-ask');
  await settle(page, 300);
  expect(P, await page.locator('#sheet-planmsg').isVisible(), 'tapping the top bar did not open the message box');
  await page.tap('#sheet-planmsg [data-close]');
  await settle(page, 250);
  // The yellow button opens a plain overdue list.
  await page.tap('.pl-daycard .pl-late');
  await settle(page, 400);
  expect(P, await page.locator('#sheet-overdue').isVisible(), 'the overdue button did not open the overdue list');
  expect(P, (await page.locator('#overdue-body .pl-row.late').count()) === LATE_N, 'the overdue list should show every overdue task');
  expect(P, (await page.locator('#overdue-body .due.late').count()) === LATE_N, 'every overdue task should have its date in yellow');
  expect(P, !(await page.locator('#overdue-body .due.late').allTextContents()).some((t) => /overdue/i.test(t)), 'an overdue date should not say "Overdue"');
  await underlines(page, P + ' overdue list', '#overdue-body .pl-row');
  await lookSheet(page, P + ' overdue list', size, '#sheet-overdue');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-overdue.png') });
  // Swipe down to close (a finger, as far as the test browser can play one).
  const swiped = await page.evaluate(async () => {
    const card = document.querySelector('#sheet-overdue .sheet-card');
    if (typeof Touch !== 'function' || typeof TouchEvent !== 'function') return 'no touch';
    const t = (y) => new Touch({ identifier: 1, target: card, clientX: 200, clientY: y });
    card.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], bubbles: true, cancelable: true }));
    card.dispatchEvent(new TouchEvent('touchmove', { touches: [t(460)], bubbles: true, cancelable: true }));
    card.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById('sheet-overdue').hidden ? 'closed' : 'open';
  }).catch((e) => 'error: ' + e.message);
  if (swiped === 'closed') console.log('  ok: swiping down closes the overdue list');
  else {
    if (swiped === 'open') problem(P, 'swiping down did not close the overdue list');
    else console.log('  note: the test browser could not play a swipe (' + swiped + '), so the × button was checked instead');
    await page.tap('#sheet-overdue [data-close]');
    await settle(page, 300);
  }
  expect(P, await page.locator('#sheet-overdue').isHidden(), 'the overdue list did not close');
  // Arrows move a day; Today comes back.
  const d0 = await page.locator('.pl-date').textContent();
  await page.tap('.pl-next');
  await settle(page, 200);
  expect(P, (await page.locator('.pl-date').textContent()) !== d0 && await page.locator('.pl-today.phone-only').isVisible(), 'the › arrow did not move to the next day, or Today did not show');
  expect(P, (await planText(page)).includes('Introduction to College Writing'), "tomorrow's class does not show on tomorrow");
  await page.tap('.pl-today.phone-only');
  await settle(page, 200);
  expect(P, (await page.locator('.pl-date').textContent()) === d0, 'Today did not go back to today');
  // Week view.
  await page.tap('[data-view-pick="week"]');
  await settle(page, 300);
  expect(P, (await page.locator('.pl-wday').count()) === 7 && (await page.locator('.pl-wev').count()) >= 7, 'the week grid should show 7 days with blocks');
  await opensNearNow(page, P + ' week', 'week');
  await hourWords(page, P + ' week', 'week');
  const wl = page.locator('.pl-weekcard .pl-late');
  expect(P, (await wl.isVisible()) && (await wl.textContent()).trim() === LATE_N + ' overdue' && !/\blate\b/.test(await planText(page)),
    'the week should show the same yellow "' + LATE_N + ' overdue" button as the day, never "late"');
  const wlw = await page.evaluate(() => { const b = document.querySelector('.pl-weekcard .pl-late').getBoundingClientRect(), c = document.querySelector('.pl-weekcard').getBoundingClientRect(); return c.width - b.width; });
  expect(P, wlw < 30, 'the week\'s overdue button should run the width of the week');
  await hiddenHides(page, P + ' week');
  await lookPlan(page, P + ' week', size, scheme + '-plan-week');
  // Tapping a block in the week opens that day, centered on that event, and it glows for a moment (his pick, Nov 28).
  await page.evaluate(() => { const sc = document.querySelector('.pl-weekcard .pl-scroll'); sc.scrollTop = sc.firstElementChild.offsetHeight * 7 / 24; });
  await settle(page, 150);
  const pickW = await page.evaluate(() => {
    const sc = document.querySelector('.pl-weekcard .pl-scroll').getBoundingClientRect();
    const all = Array.from(document.querySelectorAll('.pl-wev')).filter((b) => { const r = b.getBoundingClientRect(); return r.top > sc.top + 4 && r.bottom < sc.bottom - 4 && r.height > 20; });
    const today = document.querySelector('.pl-wday.today');
    const b = all.find((x) => !today || x.dataset.day !== today.dataset.day) || all[0];
    if (!b) return null;
    b.setAttribute('data-test-pick', '1');
    return { k: b.dataset.k, day: b.dataset.day, label: b.getAttribute('aria-label') };
  });
  expect(P, !!pickW, 'there should be a week block in sight to tap');
  if (pickW) {
    await page.locator('[data-test-pick]').tap();
    await settle(page, 400);
    const got = await page.evaluate((k) => {
      const ev = Array.from(document.querySelectorAll('.pl-daycard .pl-ev')).find((e) => e.dataset.k === k);
      const el = document.querySelector('.pl-daycard .pl-scroll'), sc = el.getBoundingClientRect();
      const r = ev && ev.getBoundingClientRect();
      const atEnd = el.scrollTop < 2 || el.scrollTop > el.scrollHeight - el.clientHeight - 2;
      return { view: document.querySelector('.pl-wrap').dataset.view, found: !!ev, mid: r ? (atEnd ? 0 : Math.abs((r.top + r.bottom) / 2 - (sc.top + sc.bottom) / 2)) : 999,
        inView: !!r && r.top >= sc.top - 1 && r.top < sc.bottom, flash: !!ev && ev.classList.contains('pl-flash'), bubble: !document.querySelector('.pl-bubble').hidden };
    }, pickW.k);
    expect(P, got.view === 'day' && got.found && got.inView && got.mid < 40, 'tapping a week block should open that day centered on "' + pickW.label + '" (' + JSON.stringify(got) + ')');
    expect(P, got.flash, 'the event opened from the week should glow for a moment');
    await page.screenshot({ path: path.join(OUT, scheme + '-plan-week-tap.png') });
    if (await page.locator('.pl-today.phone-only').isVisible()) await page.tap('.pl-today.phone-only');
    await settle(page, 200);
    await page.tap('[data-view-pick="week"]');
    await settle(page, 300);
  }
  // Weeks past the calendar copy say so.
  for (let i = 0; i < 4; i++) { await page.tap('.pl-next'); await settle(page, 120); }
  expect(P, await page.locator('.pl-wnote').isVisible(), 'a week past the calendar copy should say it isn\'t copied yet');
  await look(page, P + ' week not copied yet', size);
  await page.tap('.pl-today.phone-only');
  await settle(page, 200);
  // Tapping a day in the week opens that day.
  await page.locator('.pl-wday').nth(0).tap();
  await settle(page, 250);
  expect(P, (await page.locator('.pl-wrap').getAttribute('data-view')) === 'day', 'tapping a day in the week should open that day');
  if (await page.locator('.pl-today.phone-only').isVisible()) await page.tap('.pl-today.phone-only'); // hidden when that day is today
  await settle(page, 200);
  await page.tap('[data-view-pick="week"]');
  await settle(page, 250);
  await page.tap('[data-view-pick="day"]');
  await opensNearNow(page, P + ' Week back to Day', 'day');
  const dk = await page.evaluate(() => { const m = getComputedStyle(document.getElementById('page-plan')).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); });
  expect(P, dk < 50, 'Plan should be dark, even on a phone set to ' + scheme + ' (got ' + dk + ')');
}
async function pcPlan(pp, scheme, size) {
  const P = scheme + ' PC Plan';
  await pp.click('.tab[data-tab="plan"]');
  await settle(pp);
  await planReady(pp);
  const lay = await pp.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const d = r('.pl-daycard'), w = r('.pl-weekcard'), k = r('.pl-key'), b = r('.pl-ask'), h = r('.pl-head');
    return { side: d.width > 0 && w.width > 0 && d.right <= w.left && Math.abs(d.top - w.top) < 2, key: k.width > 0 && k.right <= d.left, askTop: b.bottom <= d.top,
      keyUp: Math.round(k.top - h.top),
      bg: (() => { const m = getComputedStyle(document.getElementById('page-plan')).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); })(),
      switches: document.querySelectorAll('#page-plan input[type="checkbox"], #page-plan [role="switch"]').length };
  });
  expect(P, lay.side, 'the day and the week should sit side by side');
  expect(P, lay.key && lay.askTop, 'the calendar list should be on the left and the message bar on top');
  expect(P, Math.abs(lay.keyUp) <= 2, 'the calendar list should start at the top, level with the title (it starts ' + lay.keyUp + 'px lower)');
  expect(P, await pp.locator('.pl-today.pc-only').isHidden(), 'the Today button should not show while today is open');
  await hiddenHides(pp, P);
  await opensNearNow(pp, P + ' day', 'day');
  await opensNearNow(pp, P + ' week', 'week');
  await hourWords(pp, P, 'week');
  // On a PC a week block moves the day beside it to that event.
  const pk = await pp.evaluate(() => { const b = Array.from(document.querySelectorAll('.pl-wev')).find((x) => x.offsetHeight > 20 && !x.closest('.today')); if (!b) return null; b.setAttribute('data-test-pick', '1'); return b.dataset.k; });
  if (pk) {
    await pp.locator('[data-test-pick]').scrollIntoViewIfNeeded();
    await pp.click('[data-test-pick]');
    await settle(pp, 400);
    const ok = await pp.evaluate((k) => { const ev = Array.from(document.querySelectorAll('.pl-daycard .pl-ev')).find((e) => e.dataset.k === k); const sc = document.querySelector('.pl-daycard .pl-scroll').getBoundingClientRect(); const r = ev && ev.getBoundingClientRect(); return !!r && r.top >= sc.top - 1 && r.top < sc.bottom; }, pk);
    expect(P, ok, 'clicking a week block on a PC should move the day to that event');
    if (await pp.locator('.pl-today.pc-only').isVisible()) await pp.click('.pl-today.pc-only');
    await settle(pp, 300);
  }
  expect(P, lay.switches === 0, 'Plan should have no hide switches');
  expect(P, lay.bg < 50, 'a PC should always be dark (got ' + lay.bg + ')');
  await lookPlan(pp, P, size, scheme + '-pc-plan');
  await pp.click('.pl-daycard .pl-late');
  await settle(pp, 300);
  expect(P, await pp.locator('#sheet-overdue').isVisible(), 'the overdue list did not open on a PC');
  await underlines(pp, P + ' overdue list', '#overdue-body .pl-row');
  await lookSheet(pp, P + ' overdue list', size, '#sheet-overdue');
  await pp.screenshot({ path: path.join(OUT, scheme + '-pc-plan-overdue.png') });
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
  await graphParts(page, F);
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
  // Found Nov 26: the polish pass dropped the bar's look, so Debt's paid-off bar and each wishlist bar showed nothing.
  const flatBars = await page.evaluate(() => Array.from(document.querySelectorAll('#page-finance .fi-bar')).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 4 || r.width < 20; }).length);
  expect(F + ' Debt', flatBars === 0, flatBars + ' progress bar(s) on Debt are not showing');
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
  await wishParts(page, F + ' Wishlists');
  await floatsClear(page, F + ' Wishlists', '#page-finance');
  await page.locator('[data-aside-pick]').first().tap();
  await settle(page, 250);
  await lookSheet(page, F + ' set money aside', size, '#sheet-fin');
  await page.tap('#sheet-fin .sheet-top [data-close]');
  await settle(page, 200);
  await page.tap('.fi-tabs [data-fi-tab="spending"]');
  await settle(page, 200);
  // Plan's message box.
  await page.tap('.tab[data-tab="plan"]');
  await settle(page);
  await page.tap('.pl-ask');
  await settle(page, 250);
  expect(scheme + ' Plan message', await page.locator('#sheet-planmsg').isVisible(), 'the Plan message button did not open its box');
  await lookSheet(page, scheme + ' Plan message', size, '#sheet-planmsg');
  await page.screenshot({ path: path.join(OUT, scheme + '-plan-message.png') });
  await page.tap('#sheet-planmsg [data-close]');
  await settle(page, 200);
}
// Wishlists, his pick C (canvas WishC2): a slim "Your wishlist" row with Add, no total card, each item filling up, its
// amount once, a plain line for each move saying where it came from (with its date), only Bought it on each item, and
// one round + for Set money aside. Fails if one move's amount shows twice, or a move has no where-from line.
async function wishParts(page, where) {
  const items = FIN.wishlists.lists.flatMap((l) => l.items).filter((i) => !i.bought);
  const got = await page.evaluate((items) => {
    const out = [];
    const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const count = (t, x) => t.split(x).length - 1;
    const row = document.querySelector('#page-finance .fi-wrow');
    if (!row || !/Your wishlist/.test(row.textContent) || !row.querySelector('[data-add-wish]')) out.push('the slim "Your wishlist" row with Add is missing');
    if (document.querySelector('#page-finance .fi-big')) out.push('the old Set aside total card is still there');
    if (document.querySelectorAll('#page-finance [data-floats] [data-aside-pick]').length !== 1) out.push('there should be one round + for Set money aside');
    if (document.querySelector('#page-finance [data-aside]')) out.push('an item still has its own Set money aside button');
    for (const it of items) {
      const c = document.querySelector('#page-finance .fi-wish[data-wish="' + it.id + '"]');
      if (!c) { out.push(it.name + ' is missing'); continue; }
      const t = c.textContent, moves = it.setAside || [];
      for (const m of moves) {
        const shown = count(t, money(m.amount)), allowed = (moves.length > 1 ? moves.filter((x) => x.amount === m.amount).length : 0) + (Math.abs((it.saved || 0) - m.amount) < 0.005 ? 1 : 0);
        if (shown > allowed) out.push(it.name + ': the move of ' + money(m.amount) + ' shows ' + shown + ' times');
      }
      const lines = Array.from(c.querySelectorAll('.fi-move')).map((l) => l.textContent.trim());
      if (lines.length !== moves.length || lines.some((l) => !/(paycheck|savings|by hand|[A-Za-z]+, )/.test(l) || !/(January|February|March|April|May|June|July|August|September|October|November|December) \d/.test(l))) out.push(it.name + ': each move needs a line saying where it came from, with its date (got ' + JSON.stringify(lines) + ')');
      const btns = Array.from(c.querySelectorAll('button')).map((b) => b.textContent.trim());
      if (btns.join('|') !== 'Bought it') out.push(it.name + ': should keep only Bought it (got ' + btns.join(', ') + ')');
      const fill = c.querySelector('.fi-fill i');
      if (!fill || !fill.style.height) out.push(it.name + ' should fill up like a bucket');
      const bar = c.querySelector('.fi-bar'), br = bar && bar.getBoundingClientRect();
      if (!bar || br.height < 4 || br.width < 20) out.push(it.name + ': its progress bar is not showing');
    }
    return out;
  }, items);
  for (const g of got) problem(where, g);
}
// Every part of the approved graph (canvas: graph C with B's pins) and bucket cards is there, and the graph keeps
// its shape: never stretched, so it grows taller as it gets wider and its dots stay round.
// The date row under the balance graph: no two dates touch, and every date sits inside the graph
// (found Nov 28: "October 29" ran into "November 6" on his phone).
async function dateRow(page, where) {
  const r = await page.evaluate(() => {
    const svg = document.querySelector('.fi-chart .fi-graph');
    if (!svg) return null;
    const g = svg.getBoundingClientRect();
    const b = Array.from(svg.querySelectorAll('[data-date-label]')).map((t) => { const x = t.getBoundingClientRect(); return { t: t.textContent, l: x.left, r: x.right }; }).sort((p, q) => p.l - q.l);
    const out = [];
    b.forEach((x, i) => { if (x.l < g.left - 0.5 || x.r > g.right + 0.5) out.push('"' + x.t + '" runs off the graph'); if (i && x.l < b[i - 1].r + 4) out.push('"' + b[i - 1].t + '" and "' + x.t + '" touch'); });
    return { out, n: b.length };
  });
  if (!r) { problem(where, 'the balance graph is missing'); return; }
  expect(where, r.n >= 1, 'the graph has no dates under it');
  for (const o of r.out) problem(where, 'the dates under the graph collide: ' + o);
}
// A move between the bank and savings changes the two lines by the same amount, opposite ways, on its day
// (spec, Spending): it's in an account the green line counts, and the blue line steps by exactly the day's moves.
// Run on the sample and, in the real-data check, on his own rows, so a new kind of savings move can't slip past.
function graphMovesMatch(fin, months, now, where) {
  const w = Money.work(fin, months, null, now);
  if (!w.bal || !w.savingsLine) return;
  const tx = Money.allTx(months), rules = (((fin || {}).storeRules) || {}).items || [];
  const counted = new Set(Object.keys(((fin || {}).tracker || {}).anchors || {}));
  const moves = tx.filter((t) => Money.bucketOf(t, rules) === 'savings' && t.d >= w.bal.days[0] && t.d <= w.bal.end);
  for (const t of moves) if (!counted.has(t.k)) problem(where, 'a move to or from savings on ' + t.d + ' is in an account the balance line does not count, so the green line misses it');
  const days = w.bal.days;
  for (let i = 1; i < days.length; i++) {
    const d = days[i], want = -moves.filter((t) => t.d === d).reduce((a, t) => a + t.a, 0);
    const got = w.savingsLine[d] - w.savingsLine[days[i - 1]];
    if (Math.abs(got - want) > 0.01) problem(where, 'on ' + d + ' the blue Savings line stepped by a different amount than the money moved in or out of savings, so the two lines do not match');
  }
}
// Savings tags (his pick, Nov 28): each savings move on the graph gets a blue tag at its step that says which way
// the money went, shown as plain blue amounts (his pick, Nov 28) that never cover a line, a paycheck amount or the dates, on the phone and a PC, at every range.
// The Hub reloads itself when a newer version is out (found Nov 28: his PC's DuckDuckGo tab kept running the Hub from
// before the unlock fix until a Ctrl+F5). The server here can hand out a "newer" page: it's the same app with one
// version mark changed, so the check can tell the old page from the new one.
async function freshReload(browser, base, edges, size) {
  const F = 'Self-reload';
  const ctx = await newContext(browser, 'dark', size, { hasTouch: true, isMobile: true });
  const html = fs.readFileSync(path.join(ROOT, 'v2', 'index.html'), 'utf8');
  const S = { serve: 'same', fetchOnly: '', docs: 0, fetches: 0 };
  const newer = (h, tag) => h.replace(/app\.js\?v=(\d+)/, 'app.js?v=$1' + tag);
  await ctx.route((u) => /\/my-app\/v2\/(index\.html)?$/.test(u.pathname), (route) => {
    const doc = route.request().resourceType() === 'document';
    if (doc) S.docs++; else S.fetches++;
    let body = S.serve === 'same' ? html : newer(html, S.serve);
    if (!doc && S.fetchOnly) body = newer(html, S.fetchOnly); // a mixed-up server: the check says newer, the page stays old
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  const pg = await openConnected(ctx, base, edges);
  const appMark = () => pg.evaluate(() => (document.querySelector('script[src^="app.js"]') || {}).getAttribute('src'));
  const state = () => pg.evaluate(() => ({ fresh: document.documentElement.dataset.fresh || '', looked: +(document.documentElement.dataset.freshLooked || 0), kept: !!window.__keep }));
  const comeBack = () => pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // 1. Nothing newer: it looks when the Hub opens, finds it current, and doesn't reload.
  await pg.waitForFunction(() => +(document.documentElement.dataset.freshLooked || 0) >= 1, null, { timeout: 8000 }).catch(() => {});
  await pg.evaluate(() => { window.__keep = 1; });
  let st = await state();
  expect(F, st.looked >= 1 && st.fresh === 'current', 'the Hub should look for a newer version when it opens, and find none (got ' + JSON.stringify(st) + ')');
  const first = await appMark();
  // 2. A newer version is out, but a sheet is open: it waits and doesn't reload under him.
  S.serve = '1';
  await pg.tap('.td-fabs .plus');
  await settle(pg, 300);
  await pg.fill('#add-form input', 'Half typed');
  await comeBack();
  await pg.waitForFunction(() => /^waiting-/.test(document.documentElement.dataset.fresh || ''), null, { timeout: 8000 }).catch(() => {});
  await settle(pg, 3500);
  st = await state();
  expect(F, st.kept && /^waiting-(sheet|typing)$/.test(st.fresh), 'with a sheet open, the Hub should wait instead of reloading (got ' + JSON.stringify(st) + ')');
  // 3. Once the sheet closes, it reloads by itself onto the newer version, and the Hub opens again as normal.
  const reloaded = pg.waitForEvent('load', { timeout: 15000 }).then(() => true).catch(() => false);
  await pg.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await pg.tap('#sheet-add [data-close]');
  const did = await reloaded;
  await pg.waitForFunction(() => document.documentElement.dataset.loaded === 'yes', null, { timeout: 8000 }).catch(() => {});
  await closeMissed(pg);
  const second = await appMark();
  st = await state();
  expect(F, did && !st.kept && second !== first && /v=\d+1$/.test(second || ''), 'after the sheet closed, the Hub should have reloaded itself onto the newer version (reloaded: ' + did + ', now ' + second + ', was ' + first + ')');
  await pg.waitForFunction(() => +(document.documentElement.dataset.freshLooked || 0) >= 1, null, { timeout: 8000 }).catch(() => {});
  st = await state();
  expect(F, st.fresh === 'current', 'after reloading, the Hub should find itself current (got ' + JSON.stringify(st) + ')');
  expect(F, await pg.evaluate(() => !/fresh=/.test(location.href)), 'the address should be plain again after a reload');
  // 4. A mixed-up server that keeps saying "newer" while sending the old page: two tries at most, then it stops.
  await pg.evaluate(() => { window.__keep = 1; });
  S.fetchOnly = '2'; S.docs = 0;
  for (let k = 0; k < 4; k++) {
    await comeBack();
    await pg.waitForLoadState('load').catch(() => {});
    await settle(pg, 1800);
    await closeMissed(pg).catch(() => {});
  }
  st = await state();
  expect(F, S.docs <= 2 && st.fresh === 'gave-up', 'when the server keeps sending the old page, the Hub should try twice at most, then stop (reloads: ' + S.docs + ', state: ' + st.fresh + ')');
  await ctx.close();
}

// An amount on the graph must never sit on the green or blue line (his picks, Nov 28: plain amounts with no box, so
// a line running through one would make it hard to read). Every point of each amount's text box is tested against
// both lines as drawn.
const ON_LINE = () => {
  window.__onLine = (svg, sel) => {
    const out = [];
    const strokes = Array.from(svg.querySelectorAll('.fi-lineg, [data-savings-line]'));
    const pt = svg.createSVGPoint();
    for (const t of svg.querySelectorAll(sel)) {
      const b = t.getBBox();
      let hit = false;
      for (let px = b.x; px <= b.x + b.width && !hit; px += 1.5) for (let py = b.y + 2; py <= b.y + b.height - 1 && !hit; py += 1.5) {
        pt.x = px; pt.y = py;
        if (strokes.some((s) => s.isPointInStroke(pt))) hit = true;
      }
      if (hit) out.push('the amount "' + t.textContent + '" sits on a line');
    }
    return out;
  };
};
async function savingsTags(browser, base, scheme, size, extra, edges) {
  const where = scheme + (size.W > 1000 ? ' PC' : '') + ' savings tags';
  const ctx = await newContext(browser, scheme, size, extra);
  const m = ctx.box.files['data/fin.config.months.json'];
  const add = (t) => (m[t.d.slice(0, 7)] = m[t.d.slice(0, 7)] || { txns: [] }).txns.push(Object.assign({ m: 0, p: 0, c: 'savings', cat: 'savings', u: 'savings' }, t));
  add({ id: 'st1', d: dayN(-5), a: -93, k: 'First National Bank Alaska', s: 'To savings x0000' });
  add({ id: 'st2', d: dayN(-4), a: -25, k: 'Cash App', s: 'Moved to Cash App Savings' });
  add({ id: 'st3', d: dayN(-1), a: 50, k: 'First National Bank Alaska', s: 'From savings x0000' });
  const pg = await openConnected(ctx, base, edges);
  await closeMissed(pg);
  await (extra.hasTouch ? pg.tap('.tab[data-tab="finance"]') : pg.click('.tab[data-tab="finance"]'));
  await settle(pg);
  await finReady(pg);
  await pg.evaluate(ON_LINE);
  for (const n of ['30', '90', '0']) {
    const btn = '.fi-seg [data-range="' + n + '"]';
    if (await pg.locator(btn).count()) { await (extra.hasTouch ? pg.tap(btn) : pg.click(btn)); await settle(pg, 250); }
    const r = await pg.evaluate(() => {
      const svg = document.querySelector('.fi-chart .fi-graph'), g = svg.getBoundingClientRect();
      const box = (el) => el.getBoundingClientRect();
      const tags = Array.from(svg.querySelectorAll('[data-savings-tag]')).map((t) => ({ day: t.dataset.savingsTag, amount: +t.dataset.amount, text: t.querySelector('text').textContent, b: box(t.querySelector('text')), extra: t.querySelectorAll('rect, line, circle, path').length, fill: getComputedStyle(t.querySelector('text')).fill }));
      const others = Array.from(svg.querySelectorAll('.fi-pin text, [data-date-label]')).map(box);
      const out = [];
      tags.forEach((t) => {
        if (t.extra) out.push('the amount on ' + t.day + ' has a box, line or dot (his pick: just the amount)');
        if (t.fill !== 'rgb(100, 160, 255)') out.push('the amount on ' + t.day + ' should be blue (got ' + t.fill + ')');
      });
      for (const o of window.__onLine ? window.__onLine(svg, '[data-savings-tag] text, .fi-pin text') : []) out.push(o);
      tags.forEach((t, i) => {
        if (t.b.left < g.left - 0.5 || t.b.right > g.right + 0.5 || t.b.top < g.top - 0.5) out.push('the tag on ' + t.day + ' runs off the graph');
        if (others.some((o) => t.b.left < o.right && o.left < t.b.right && t.b.top < o.bottom && o.top < t.b.bottom)) out.push('the tag on ' + t.day + ' covers a pin or a date');
        tags.slice(0, i).forEach((u) => { if (t.b.left < u.b.right && u.b.left < t.b.right && t.b.top < u.b.bottom && u.b.top < t.b.bottom) out.push('the tags on ' + u.day + ' and ' + t.day + ' overlap'); });
      });
      return { tags: tags.map((t) => [t.day, t.amount, t.text]), out };
    });
    const R = (n === '0' ? 'All' : n + ' days');
    for (const o of r.out) problem(where + ' ' + R, o);
    const want = { [dayN(-5)]: [93, '\u2212$93'], [dayN(-4)]: [25, '\u2212$25'], [dayN(-1)]: [-50, '+$50'] };
    for (const [d, [a, t]] of Object.entries(want)) {
      const got = r.tags.find((x) => x[0] === d);
      expect(where + ' ' + R, got && Math.abs(got[1] - a) < 0.01 && got[2] === t, 'the move on ' + d + ' should show just "' + t + '" in blue (got ' + JSON.stringify(got || null) + ')');
    }
    expect(where + ' ' + R, r.tags.length === 3, 'only days with a savings move should get a tag (got ' + JSON.stringify(r.tags) + ')');
    if (n === '30') { await look(pg, where, size); await pg.screenshot({ path: path.join(OUT, scheme + (size.W > 1000 ? '-pc' : '') + '-finance-savings-tags.png') }); }
  }
  await ctx.close();
}
async function graphParts(page, where) {
  await page.evaluate(ON_LINE);
  const g = await page.evaluate(() => {
    const svg = document.querySelector('.fi-chart .fi-graph');
    if (!svg) return null;
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
    const dates = Array.from(svg.querySelectorAll('[data-date-label]')).map((t) => t.textContent);
    const tiles = document.querySelectorAll('.fi-buckets .fi-tile').length;
    const fills = Array.from(document.querySelectorAll('.fi-buckets .fi-tile .fi-fill i')).filter((i) => i.style.height !== '').length;
    return { ratio: (r.width / r.height) / (vb.width / vb.height), h: r.height, w: r.width,
      pins: svg.querySelectorAll('.fi-pin').length, pinText: Array.from(svg.querySelectorAll('.fi-pintext')).map((t) => t.textContent),
      pinColor: Array.from(svg.querySelectorAll('.fi-pintext')).map((t) => { const c = getComputedStyle(t); return c.fill + '|' + c.stroke; }),
      extra: svg.querySelectorAll('.fi-pin rect, .fi-pin line, .fi-pin circle').length,
      onLine: window.__onLine ? window.__onLine(svg, '.fi-pin text, [data-savings-tag] text') : ['the line check did not load'],
      dollars: svg.querySelectorAll('.fi-glabel:not([data-date-label])').length, grid: svg.querySelectorAll('.fi-gline').length,
      savings: !!svg.querySelector('[data-savings-line]'), key: (document.querySelector('.fi-chart .fi-key') || {}).textContent || '',
      dates, tiles, fills, bars: document.querySelectorAll('.fi-buckets .fi-bar').length,
      edge: (() => { const c = document.querySelector('.fi-chart').getBoundingClientRect(); return Math.abs(r.left - c.left) < 1 && Math.abs(r.right - c.right) < 1; })() };
  });
  if (!g) { problem(where, 'the balance graph is missing'); return; }
  await dateRow(page, where);
  expect(where, Math.abs(g.ratio - 1) < 0.02, 'the graph is stretched (its shape is ' + g.ratio.toFixed(2) + ' times its drawing\'s, ' + Math.round(g.w) + ' by ' + Math.round(g.h) + ')');
  expect(where, g.edge, 'the graph should run edge to edge across its card');
  expect(where, g.pins >= 1 && g.extra === 0 && g.pinText.length === g.pins && g.pinText.every((t) => /^\+\$[\d,]+$/.test(t)), 'each paycheck should show just its amount, with no box, line or dot, his pick Nov 28 (pins: ' + JSON.stringify(g.pinText) + ', extra parts: ' + g.extra + ')');
  expect(where, g.pinColor.every((c) => /^rgb\(48, 209, 88\)\|none$/.test(c)), 'each paycheck amount should be plain green, his pick Nov 28 (got ' + JSON.stringify(g.pinColor) + ')');
  for (const o of g.onLine) problem(where, o);
  expect(where, g.dollars >= 1 && g.grid >= 1, 'the graph should have faint dollar labels inside it');
  expect(where, g.savings && /Balance \$/.test(g.key) && /Savings \$/.test(g.key), 'the graph should have the blue Savings line and a key with both amounts (key: "' + g.key + '")');
  expect(where, g.dates.length >= 2 && g.dates[1] === 'Today', 'the date row should show the first day, the paycheck dates and "Today" (got ' + JSON.stringify(g.dates) + ')');
  expect(where, g.tiles >= 4 && g.fills === g.tiles && g.bars === 0, 'each bucket card should fill up from the bottom, with no bar (' + g.fills + ' of ' + g.tiles + ' fill, ' + g.bars + ' bars)');
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
    const cols = [...document.querySelectorAll('.fi-cols > .fi-col')].map((c) => Math.round(c.getBoundingClientRect().height) + ' (' + [...c.children].map((k) => (k.className.split(' ').pop()) + ' ' + Math.round(k.getBoundingClientRect().height) + (k.children.length > 1 && k.children.length < 6 ? ' [' + [...k.children].map((j) => Math.round(j.getBoundingClientRect().height)).join('/') + ']' : '')).join(', ') + ')');
    const m = getComputedStyle(p).backgroundColor.match(/[\d.]+/g).map(Number);
    return { left: side.width > 0 && side.right <= main.left, sideBySide: chart.right <= bk.left && Math.abs(chart.top - bk.top) < 4,
      fits: p.scrollHeight <= p.clientHeight + 1, over: p.scrollHeight - p.clientHeight, cols: cols.join(' and '), phoneTabs: getComputedStyle(document.querySelector('.fi-tabs')).display,
      bg: Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) };
  });
  expect(F, lay.left, 'the Finance tabs should run down the left');
  expect(F, lay.phoneTabs === 'none', 'the phone tab row should not show on a PC');
  expect(F, lay.sideBySide, 'Spending should show the graph side and the buckets side by side');
  expect(F, lay.fits, 'Spending should fit on one screen (it runs ' + lay.over + ' pixels past the bottom; the two sides are ' + lay.cols + ' pixels tall)');
  expect(F, lay.bg < 50, 'a PC should always be dark (got ' + lay.bg + ')');
  await graphParts(pp, F);
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

async function fillsScreen(browser, base, at1440) {
  const where = 'dark PC 1920 by 1080';
  const share = (pg) => pg.evaluate(() => {
    const z = parseFloat(document.documentElement.style.zoom) || 1, k = window.hubScale ? window.hubScale() : 1;
    const wrap = document.querySelector('#page-finance .fi-wrap').getBoundingClientRect(), svg = document.querySelector('.fi-graph').getBoundingClientRect();
    // On-screen size, whichever way this browser reports a zoomed page.
    const px = (v) => v * z / k;
    const p = document.getElementById('page-finance');
    return { wrap: px(wrap.width) / innerWidth, graphH: px(svg.height) / innerWidth, zoom: z, over: p.scrollHeight - p.clientHeight };
  });
  await at1440.click('.tab[data-tab="finance"]');
  await settle(at1440);
  const a = await share(at1440);
  const ctx = await newContext(browser, 'dark', { W: 1920, H: 1080 }, {});
  const pg = await openConnected(ctx, base);
  await pg.click('.tab[data-tab="finance"]');
  await settle(pg);
  await finReady(pg);
  const b = await share(pg);
  // Everything grows by the same amount (as far as the height allows), so the proportions can't change.
  expect(where, Math.abs(b.zoom - Math.min(1920 / 1440, 1080 / 900)) < 0.01, 'a bigger PC screen should grow everything to match, as far as its height allows (zoom ' + b.zoom + ')');
  expect(where, b.wrap >= 0.8 && a.wrap >= 0.9, 'the PC should fill the screen, not sit in a narrow column (Finance fills ' + (b.wrap * 100).toFixed(0) + '% of this screen and ' + (a.wrap * 100).toFixed(0) + '% at 1440)');
  await graphParts(pg, where);
  // A common 1920 by 1080 screen is shorter for its width than 1440 by 900, and Spending still fits on it.
  expect(where, b.over <= 1, 'Spending should fit on one screen here too (it runs ' + b.over + ' pixels past the bottom)');
  await pg.screenshot({ path: path.join(OUT, 'dark-pc-1920-finance.png') });
  await ctx.close();
}
async function darkness(page) {
  return page.evaluate(() => {
    const read = (el) => { const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number); return Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]); };
    return { body: read(document.body), todo: read(document.getElementById('page-todo')) };
  });
}

// ---- 1d. The robot's keep and undo rules, on their own ----
function robotRules() {
  console.log('Checking the keep and undo rules');
  const R = 'robot rules';
  const open = Robot.openLines(LOG, NOW).map((l) => l.id);
  expect(R, same(open.slice().sort(), ['rb1', 'rb2', 'rb3', 'rb4', 'rb5']), 'tags should show for open robot changes from the last 7 days only: got ' + open);
  const L = (sets, file) => ({ id: 'x', who: 'robot', file: file || 'data/fin.json', robot: { kind: 'debt', ref: 'd1', sets } });
  const owed = [{ path: ['debts', 'items', { id: 'd1' }, 'owed'], before: 160, after: 120 }];
  let r = Robot.undo('data/fin.json', FIN, L(owed), at(0));
  expect(R, r.result === 'undone' && r.data.debts.items[0].owed === 160 && FIN.debts.items[0].owed === 120, 'undo should put the old value back (on a copy)');
  const again = Robot.undo('data/fin.json', r.data, L(owed), at(0));
  expect(R, again.result === 'undone' && again.data === null, 'undoing twice should change nothing the second time');
  const moved = JSON.parse(JSON.stringify(FIN)); moved.debts.items[0].owed = 99;
  r = Robot.undo('data/fin.json', moved, L(owed.concat([{ path: ['tracker', 'anchors', 'Cash App', 'amount'], before: 25.1, after: 21.6 }])), at(0));
  expect(R, r.result === 'changed' && r.data === null, 'if anything changed since the robot did it, undo must touch nothing (newest data wins)');
  r = Robot.undo('data/tasks.json', TASKS, L([{ path: ['l', 'myNote'], after: 'From the class email' }], 'data/tasks.json'), at(0));
  expect(R, r.result === 'undone' && !('myNote' in r.data.l) && r.shrink > 0, 'undoing a field the robot added should take that field away, and only it');
  r = Robot.undo('data/tasks.json', TASKS, L([{ path: ['m'], added: true }], 'data/tasks.json'), at(0));
  expect(R, r.data && r.data.m.status === 'dropped' && r.data.m.droppedBy === 'undo' && Object.keys(r.data).length === Object.keys(TASKS).length, 'undoing a task the robot added should move it to Deleted, not wipe it');
  r = Robot.undo('data/fin.config.months.json', MONTHS, L([{ path: [MONTH12, 'txns', { id: 't12' }], added: true }], 'data/fin.config.months.json'), at(0));
  expect(R, r.data && !Money.allTx(r.data).some((t) => t.id === 't12') && Robot.size(r.data) > Robot.size(MONTHS), 'undoing a charge the robot added should leave it out of the pages without deleting it');
}

function fakeIDB() {
  const store = new Map();
  return { open() {
    const req = {};
    setTimeout(() => {
      req.result = { createObjectStore() {}, close() {}, transaction() {
        const tx = {}, os = { get: (k) => ({ result: store.get(k) }), put: (v, k) => { store.set(k, v); return {}; }, delete: (k) => { store.delete(k); return {}; } };
        tx.objectStore = () => os;
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
        return tx;
      } };
      if (req.onupgradeneeded) req.onupgradeneeded();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  } };
}
// A device for the lock to run on. kind 'iphone': the passkey gives its secret. kind 'windows': like Windows Hello,
// it can't give the secret, and asking for it fails the whole sign-in even after the right PIN.
function lockDevice(kind) {
  const vm = require('vm');
  const mem = new Map();
  const dev = { kind, creates: 0, gets: 0, secretAsks: 0, refuse: false, gone: new Set(), ids: 0, made: [], anyAsks: 0 };
  const refuse = (msg) => { const e = new Error(msg || 'The operation either timed out or was not allowed.'); e.name = 'NotAllowedError'; return e; };
  const sandbox = {
    console, setTimeout, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder, TextDecoder, crypto: require('crypto').webcrypto, location: { hostname: 'torrentialrain.github.io' },
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    indexedDB: fakeIDB(),
    PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
    navigator: { userAgent: kind === 'windows' ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', credentials: {
      async create() {
        if (dev.refuse) throw refuse();
        dev.creates++;
        const id = new Uint8Array([++dev.ids, 7]);
        dev.made.push(Buffer.from(id).toString('hex'));
        return { rawId: id.buffer, getClientExtensionResults: () => (kind === 'iphone' ? { prf: { enabled: true } } : { prf: { enabled: false } }) };
      },
      async get(o) {
        dev.gets++;
        if (dev.refuse) throw refuse();
        // An empty list means "any of this site's passkeys": the device offers its newest one that still exists.
        const allow = o.publicKey.allowCredentials || [];
        if (!allow.length) dev.anyAsks++;
        const id = allow.length ? Buffer.from(allow[0].id).toString('hex') : dev.made.filter((m) => !dev.gone.has(m)).pop();
        if (!id || dev.gone.has(id)) throw refuse();
        const rawId = Uint8Array.from(Buffer.from(id, 'hex')).buffer;
        const p = o.publicKey.extensions && o.publicKey.extensions.prf;
        if (p) dev.secretAsks++;
        if (p && kind === 'windows') throw refuse();
        const out = p ? { prf: { results: { first: new Uint8Array(p.eval.first).map((b) => b ^ 0x5a).buffer } } } : {};
        return { rawId, getClientExtensionResults: () => out };
      } } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lock.js'), 'utf8'), sandbox);
  dev.lock = sandbox.KeyLock; dev.mem = mem;
  dev.cred = () => JSON.parse(mem.get('hub2.lock.cred') || 'null');
  return dev;
}
async function lockRules() {
  const L = 'Lock rules';
  const tryIt = async (fn) => { try { return { v: await fn() }; } catch (e) { return { e }; } };
  // 1. A Windows PC: locked the way that needs no secret, and the right PIN opens it with no ask for the secret.
  const pc = lockDevice('windows');
  let r = await tryIt(() => pc.lock.lock('saving-key'));
  expect(L, r.v === 'gate', 'a Windows PC should lock the key the way that needs no secret (got ' + (r.v || r.e) + ')');
  pc.secretAsks = 0;
  r = await tryIt(() => pc.lock.unlock());
  expect(L, r.v === 'saving-key', 'on a Windows PC the right PIN should open the Hub (got ' + (r.v || (r.e && r.e.reason) || r.e) + ')');
  expect(L, pc.secretAsks === 0, 'a PC unlock must never ask Windows Hello for the secret (it asked ' + pc.secretAsks + ' times)');
  // 2. Locking again (a new key) uses the same passkey, so passkeys never pile up.
  await pc.lock.clear();
  r = await tryIt(() => pc.lock.lock('saving-key-2'));
  expect(L, r.v === 'gate' && pc.creates === 1, 'locking a new key should use this device\'s passkey again (passkeys made: ' + pc.creates + ')');
  // 3. A PC locked by the older version (no record of its passkey) still opens with the right PIN.
  pc.mem.delete('hub2.lock.cred');
  r = await tryIt(() => pc.lock.unlock());
  expect(L, r.v === 'saving-key-2', 'a PC locked by the older version should open with the right PIN (got ' + (r.v || (r.e && r.e.reason) || r.e) + ')');
  // 4. A failed try says why, in the browser's words, and counts; two in a row are what bring up "Use my key instead".
  pc.refuse = true;
  r = await tryIt(() => pc.lock.unlock());
  expect(L, r.e && r.e.code === 'needtap' && /NotAllowedError/.test(r.e.reason || '') && pc.lock.fails() === 1, 'a failed unlock should keep the real reason and count it (got ' + JSON.stringify(r.e && { code: r.e.code, reason: r.e.reason }) + ', ' + pc.lock.fails() + ')');
  await tryIt(() => pc.lock.unlock());
  expect(L, pc.lock.fails() === 2, 'two failed unlocks should count as two');
  pc.refuse = false;
  await pc.lock.unlock();
  expect(L, pc.lock.fails() === 0, 'an unlock that works should reset the count');
  // 5. An iPhone still gets the full Face ID lock, and opens with it.
  const ph = lockDevice('iphone');
  r = await tryIt(() => ph.lock.lock('saving-key'));
  expect(L, r.v === 'faceid', 'an iPhone should lock the key with Face ID\'s secret (got ' + (r.v || r.e) + ')');
  r = await tryIt(() => ph.lock.unlock());
  expect(L, r.v === 'saving-key', 'an iPhone should open with Face ID (got ' + (r.v || r.e) + ')');
  // 6. A device whose passkey turns out not to give the secret: two fails mark it, and locking again goes the way
  // that needs no secret, with the same passkey.
  const odd = lockDevice('iphone');
  await odd.lock.lock('saving-key');
  odd.refuse = true;
  await tryIt(() => odd.lock.unlock()); await tryIt(() => odd.lock.unlock());
  expect(L, (odd.cred() || {}).prf === 'no', 'two failed Face ID unlocks should mark this device\'s passkey as one that can\'t give the secret');
  odd.refuse = false;
  await odd.lock.clear();
  r = await tryIt(() => odd.lock.lock('saving-key'));
  expect(L, r.v === 'gate' && odd.creates === 1, 'after two fails, locking again should use the same passkey the way that needs no secret (got ' + (r.v || r.e) + ', passkeys made: ' + odd.creates + ')');
  // 7. This device's passkey was deleted: locking again makes a new one instead of getting stuck.
  const del = lockDevice('windows');
  await del.lock.lock('saving-key');
  del.gone.add('0107');
  await del.lock.clear();
  // Windows can't tell a deleted passkey from Cancel: the first try says so and forgets it, the next try makes a new one.
  r = await tryIt(() => del.lock.lock('saving-key'));
  if (r.e && r.e.code === 'needtap') r = await tryIt(() => del.lock.lock('saving-key'));
  expect(L, r.v === 'gate' && del.creates === 2, 'if this device\'s passkey was deleted, locking again should make a new one (got ' + (r.v || r.e) + ', passkeys made: ' + del.creates + ')');
  // 8. The backstop (found Nov 28): on a PC any of his Hub passkeys opens the Hub, not only the saved one. Here the
  // saved passkey is gone but another Hub passkey is on the PC: the unlock still works, and the saved one follows it.
  const two = lockDevice('windows');
  await two.lock.lock('saving-key');
  await two.lock.redo(); // a second Hub passkey on the same PC; the saved one is now the second
  const second = JSON.parse(two.mem.get('hub2.lock.v1')).cred;
  two.gone.add(two.made[1]);
  two.made.push(two.made.shift()); // only the first passkey is left, and the device offers it
  two.anyAsks = 0;
  r = await tryIt(() => two.lock.unlock());
  const after = JSON.parse(two.mem.get('hub2.lock.v1')).cred;
  expect(L, r.v === 'saving-key' && two.anyAsks === 1, 'on a PC any of his Hub passkeys should open the Hub (got ' + (r.v || (r.e && r.e.reason) || r.e) + ', asked for any: ' + two.anyAsks + ')');
  expect(L, after !== second && (two.cred() || {}).cred === after, 'after a PC opens with another Hub passkey, that one should become the saved one');
  // An iPhone still names its own passkey, so Face ID's secret comes from the right one.
  const ip = lockDevice('iphone');
  await ip.lock.lock('saving-key');
  ip.anyAsks = 0;
  await ip.lock.unlock();
  expect(L, ip.anyAsks === 0, 'an iPhone should still ask for its own passkey by name');
}

async function run() {
  rules();
  stampRules();
  await lockRules();
  robotRules();
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

  await faceLock(browser, base, edges, phone);
  await freshReload(browser, base, edges, phone);

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
    expect(scheme + ' connect', /can only read/.test(await page.locator('#connect-why').textContent()), 'a key that can only read was not spotted on the key screen (it said: "' +
      (await page.locator('#connect-error').textContent()) + '", lock: ' + (await page.evaluate(() => document.documentElement.dataset.lock || 'none')) + ')');
    if (await page.locator('#connect-cancel').isVisible()) await page.tap('#connect-cancel');
    if (!(await page.locator('#connect').isHidden())) problem(scheme + ' connect', 'the Connect screen did not close');

    // 2b. Missed charges (his pick, Nov 25): the pop-up opens by itself once the key screen is gone.
    await settle(page, 2200);
    const mt = (await page.locator('#sheet-fin').isVisible()) ? (await page.locator('#fin-sheet-title').textContent()) : '';
    expect(scheme + ' missed charges', mt === 'You have 1 missed charge', 'opening the Hub with a charge nobody sorted should pop up "You have 1 missed charge" (got "' + mt + '")');
    if (mt) {
      await lookSheet(page, scheme + ' missed charges', phone, '#sheet-fin');
      await page.screenshot({ path: path.join(OUT, scheme + '-missed-charges.png') });
      await page.tap('#sheet-fin [data-label-now]');
      await settle(page, 300);
      expect(scheme + ' missed charges', /Fix this charge/.test(await page.locator('#fin-sheet-title').textContent()), 'Label now should open "Fix this charge"');
      expect(scheme + ' missed charges', (await page.locator('#sheet-fin [name="always"]').count()) === 0, 'money sent to a person should not offer an "always" store rule');
      await page.tap('#sheet-fin .sheet-top [data-close]');
      await settle(page, 250);
    }
    // The Questions inbox: the badge counts what's waiting, and the charge sits there to label any time.
    const qb = await page.locator('.td-tools [data-open="sheet-questions"] .qbadge').textContent().catch(() => '');
    expect(scheme + ' questions inbox', qb === '2', 'the Questions badge should count 1 question and 1 charge (got "' + qb + '")');
    const dot = await page.locator('.bar .tab[data-tab="todo"] .qdot').isVisible().catch(() => false);
    expect(scheme + ' questions inbox', dot, 'the TO-DO tab should show a dot while questions wait');
    const dotsElsewhere = await page.locator('.bar .tab:not([data-tab="todo"]) .qdot').count();
    expect(scheme + ' questions inbox', dotsElsewhere === 0, 'only the TO-DO tab should get a dot');
    await page.tap('.td-tools [data-open="sheet-questions"]');
    await settle(page, 300);
    const inbox = await page.locator('#q-list').textContent();
    expect(scheme + ' questions inbox', /Charges to label/.test(inbox) && /Label now/.test(inbox) && /Is the sample still on\?/.test(inbox), 'the Questions inbox should list the charge to label and the question (got "' + inbox + '")');
    await lookSheet(page, scheme + ' questions inbox', phone, '#sheet-questions');
    await page.screenshot({ path: path.join(OUT, scheme + '-questions-inbox.png') });
    await page.tap('#sheet-questions [data-close]');
    await settle(page, 250);
    const ph = await darkness(page);
    expect(scheme + ' phone colors', ph.body < 50 && ph.todo < 50, 'the app should be dark, even on a phone set to ' + scheme + ' (got ' + JSON.stringify(ph) + ')');
    await barToEdge(page, scheme + ' bottom bar', phone);

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
    // PC cards match the PC board (his pick, Nov 26): the due tag at the card's right end and steps side by side,
    // and the tab list starts level with the title (found Nov 27: the tag sat under the name and the tabs sat low).
    const pcl = await pp.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.td-list .card')).find((c) => c.querySelector('.meta')), due = card && card.querySelector('.meta'), t = card && card.querySelector('.t');
      if (!card) return { dueRight: false, at: 'no card with a date', stepsRow: false, tabsGap: 0 };
      const c = card.getBoundingClientRect(), d = due ? due.getBoundingClientRect() : null, tt = t.getBoundingClientRect();
      const subs = Array.from(document.querySelectorAll('.td-list .card[data-id="c"] .sub')).map((s) => Math.round(s.getBoundingClientRect().top));
      const tabs = document.querySelector('.td-tabs .tdtab').getBoundingClientRect(), h1 = document.querySelector('#page-todo h1').getBoundingClientRect();
      return { dueRight: !!d && d.left >= tt.right - 1 && c.right - d.right < 140 && Math.abs((d.top + d.bottom) / 2 - (tt.top + tt.bottom) / 2) < 14,
        at: d && [Math.round(tt.right), Math.round(d.left), Math.round(c.right - d.right), Math.round(d.top - tt.top)],
        stepsRow: subs.length > 1 && new Set(subs).size < subs.length, tabsGap: Math.round(tabs.top - h1.top) };
    });
    expect(scheme + ' PC', pcl.dueRight, 'on a PC the due tag should sit at the right end of the card, level with the name (' + JSON.stringify(pcl) + ')');
    expect(scheme + ' PC', pcl.stepsRow, 'on a PC a card\'s steps should sit side by side');
    expect(scheme + ' PC', pcl.tabsGap < 90, 'on a PC the tab list should start near the title, not far below it (' + pcl.tabsGap + ' lower)');
    await popupsDark(pp, scheme + ' PC');
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
    if (scheme === 'dark') await fillsScreen(browser, base, pp);
    await pctx.close();
    await savingsTags(browser, base, scheme, phone, { hasTouch: true, isMobile: true }, edges);
    await savingsTags(browser, base, scheme, pc, {}, '');
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

  // The robot's keep and undo tags: on the changed thing; X puts it back, the check keeps it; each answer is one log line.
  const RB = 'keep and undo';
  const rbSaved = (where) => sp.waitForFunction(() => document.documentElement.dataset.robot === 'saved', null, { timeout: 8000 })
    .catch(async () => problem(where, 'the answer did not save (' + (await sp.evaluate(() => document.documentElement.dataset.robot)) + ')'));
  const answers = () => (sctx.box.files['data/log.json'].items || []).filter((l) => l.answers);
  await tapTab(sp, 'all');
  expect(RB, await sp.locator('.card[data-id="l"] .rb-tag').isVisible(), 'the robot\'s note on a task should carry a keep and undo tag');
  expect(RB, !(await sp.locator('.card[data-id="b"] .rb-tag, .card[data-id="c"] .rb-tag').count()), 'a tag older than 7 days, or already kept, should not show');
  await look(sp, RB + ' TO-DO tag', phone);
  await sp.screenshot({ path: path.join(OUT, 'light-todo-robot-tag.png') });
  await sp.tap('.card[data-id="l"] .rb-undo');
  await rbSaved(RB + ' undo a task change');
  expect(RB, !('myNote' in sctx.box.files['data/tasks.json'].l), 'undo should take the robot\'s note off the task');
  await settle(sp, 400);
  expect(RB, !(await sp.locator('.card[data-id="l"] .rb-tag').count()) && !/class email/.test(await sp.locator('.card[data-id="l"]').textContent()), 'after undo the tag and the note should be gone from the card');
  await sp.tap('.tab[data-tab="finance"]');
  await settle(sp);
  await finReady(sp);
  await sp.tap('.fi-tabs [data-fi-tab="spending"]');
  await settle(sp, 200);
  expect(RB, await sp.locator('#page-finance .fi-chips + .rb-tag').first().isVisible(), 'the robot\'s balance fix should carry a tag');
  await sp.tap('.fi-tabs [data-fi-tab="activity"]');
  await settle(sp, 200);
  expect(RB, await sp.locator('[data-tx="t12"] + .rb-tag').isVisible(), 'the robot\'s charge name should carry a tag under its row');
  await look(sp, RB + ' Activity tags', phone);
  await sp.screenshot({ path: path.join(OUT, 'light-finance-robot-tags.png') });
  const monthsBefore = JSON.stringify(sctx.box.files['data/fin.config.months.json']);
  await sp.tap('[data-tx="t12"] + .rb-tag .rb-keep');
  await rbSaved(RB + ' keep a charge name');
  expect(RB, JSON.stringify(sctx.box.files['data/fin.config.months.json']) === monthsBefore, 'keep should change nothing in the money files');
  expect(RB, answers().filter((l) => l.answers === 'rb2' && l.answer === 'kept').length === 1, 'keep should add one line to the change log');
  await sp.tap('.fi-tabs [data-fi-tab="debt"]');
  await settle(sp, 200);
  await sp.tap('[data-debt="d1"] .rb-undo');
  await rbSaved(RB + ' undo a debt change');
  expect(RB, sctx.box.files['data/fin.json'].debts.items.find((d) => d.id === 'd1').owed === 160, 'undo should put the debt back to what it was');
  await settle(sp, 400);
  expect(RB, /\$160\.00 left/.test(await sp.locator('[data-debt="d1"]').textContent()), 'the Debt page should show the amount put back');
  await sp.tap('.tab[data-tab="plan"]');
  await settle(sp);
  await planReady(sp);
  expect(RB, await sp.locator('[data-rb-plan] .rb-tag').isVisible() && await sp.locator('[data-ev="main:din"].rb-mark').count() > 0, 'a calendar change should list its tag above the calendar and outline the event');
  await lookPlan(sp, RB + ' Plan tag', phone, 'light-plan-robot-tag');
  await sp.tap('[data-rb-plan] .rb-undo');
  await rbSaved(RB + ' undo a calendar change');
  expect(RB, answers().some((l) => l.answers === 'rb5' && l.answer === 'undone' && l.request === true) && !(await sp.locator('[data-rb-plan]').isVisible()), 'undoing a calendar change should ask the robot to put it back, and the tag should go');
  expect(RB, answers().filter((l) => l.answers !== 'rb7').length === 4 && new Set(answers().map((l) => l.answers)).size === answers().length, 'each answer should be one log line');
  await sp.tap('.tab[data-tab="todo"]');
  await settle(sp);

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
  expect(FS, /Waiting/.test(await sp.locator('#page-finance .fi-notes').textContent()), 'the sent note should show as Waiting');
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
  await sp.tap('.pl-ask');
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
  if (SAMPLE['data/fin.json'] && SAMPLE['data/fin.config.months.json']) graphMovesMatch(SAMPLE['data/fin.json'], SAMPLE['data/fin.config.months.json'], new Date(), 'real Spending graph');
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
    await tap('.pl-ask'); await settle(pg, 350);
    await look(pg, 'real ' + label + ' Plan message box', size);
    if (pg.isClosed()) continue;
    await pg.keyboard.press('Escape').catch(() => {});
    await tap('.tab[data-tab="finance"]'); await settle(pg);
    await finReady(pg);
    for (const n of ['30', '90', '0']) {
      if (await pg.locator('.fi-seg [data-range="' + n + '"]').count()) { await tap('.fi-seg [data-range="' + n + '"]'); await settle(pg, 250); }
      await dateRow(pg, 'real ' + label + ' graph ' + (n === '0' ? 'All' : n + ' days'));
    }
    if (ctx.wrote || ctx.badPaths.length) problem('real ' + label, 'the app tried to save while only looking');
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(problems.length ? problems.length + ' problem(s) with the real data.' : 'Real data: all good.');
  process.exit(problems.length ? 1 : 0);
}

(REAL ? realRun() : run()).catch((e) => { console.error(REAL ? 'The real-data check stopped: ' + e.name : e); process.exit(1); });
