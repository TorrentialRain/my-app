// The TO-DO page of the new Hub.
// Reads the tasks and possible tasks, shows them in tabs, and lets Josh tick, add, drag, move and trash.
// Saving is off for now (see changes.js): every change stays on screen and in the "waiting to save" list.
(function () {
  const TZ = 'America/Anchorage';

  // The ONE list of tabs. Names, order and which data section each one holds all live here,
  // so a class has one name everywhere and no tab can be made up somewhere else.
  const TABS = [
    { id: 'all', name: 'All', section: 'active' },
    { id: 'overdue', name: 'Overdue' },
    { id: 'wrtg', name: 'WRTG', section: 'wrtg', course: 'WRTG A110' },
    { id: 'pop', name: 'POP', section: 'mus', course: 'MUS A110' },
    { id: 'jpn', name: 'JPN', section: 'jpn', course: 'JPN A101' },
    { id: 'waiting', name: 'Waiting', section: 'onhold' },
    { id: 'bucket', name: 'Bucket List', section: 'someday' },
  ];
  const CLASS_TABS = TABS.filter((t) => t.course);
  const KNOWN = new Set(['active', 'onhold', 'someday', 'done'].concat(CLASS_TABS.map((t) => t.section)));
  const tabById = (id) => TABS.find((t) => t.id === id) || TABS[0];
  const classOf = (t) => CLASS_TABS.find((c) => c.section === t.section) || CLASS_TABS.find((c) => c.course === t.course) || null;
  // A section the app doesn't know (a typo, an old name) lands in All, so no task can quietly vanish.
  const inAllSection = (s) => s === 'active' || s === 'onhold' || !KNOWN.has(s);

  // ---------- Pure helpers (the check tests these on their own) ----------
  const isTask = (t) => t && t.kind !== 'question';
  const isOpen = (t) => isTask(t) && t.status === 'open';
  const dueMs = (t) => { const d = t && t.due ? Date.parse(t.due) : NaN; return isNaN(d) ? null : d; };
  const isOverdue = (t, now) => isOpen(t) && dueMs(t) !== null && dueMs(t) < now;

  function inTab(t, tab, now) {
    if (!isOpen(t)) return false;
    switch (tab.id) {
      case 'overdue': return isOverdue(t, now);
      case 'all': return inAllSection(t.section);
      case 'waiting': return t.section === 'onhold';
      case 'bucket': return t.section === 'someday';
      default: // a class tab: its own section, plus that class's tasks moved to All
        return t.section === tab.section || (t.course === tab.course && inAllSection(t.section));
    }
  }

  // Soonest due first, no date last, then Claude's ranking. Josh's own drag order wins over both.
  function byDefault(a, b) {
    const da = dueMs(a[1]), db = dueMs(b[1]);
    if (da !== db) return da === null ? 1 : db === null ? -1 : da - db;
    return (Number(a[1].priority) || 0) - (Number(b[1].priority) || 0);
  }
  function ordered(entries) {
    const ranked = entries.filter((e) => e[1].myRank != null).sort((a, b) => a[1].myRank - b[1].myRank);
    const rest = entries.filter((e) => e[1].myRank == null).sort(byDefault);
    const out = [];
    while (ranked.length && rest.length) out.push(byDefault(rest[0], ranked[0]) < 0 ? rest.shift() : ranked.shift());
    return out.concat(ranked, rest);
  }
  // Returns groups: in All, Waiting tasks always sit at the bottom.
  function listFor(tasks, tabId, now) {
    const tab = tabById(tabId);
    const entries = Object.entries(tasks || {}).filter(([, t]) => inTab(t, tab, now));
    if (tab.id === 'all') {
      return [ordered(entries.filter(([, t]) => t.section !== 'onhold')), ordered(entries.filter(([, t]) => t.section === 'onhold'))];
    }
    return [ordered(entries)];
  }
  // Finished in the last day, for this tab's Done folder. Older ones live in the Archive.
  function doneFor(tasks, tabId, now) {
    const tab = tabById(tabId);
    if (tab.id === 'overdue') return [];
    return Object.entries(tasks || {}).filter(([, t]) => {
      if (!isTask(t) || t.status !== 'done') return false;
      const at = Date.parse(t.doneAt || '');
      if (isNaN(at) || now - at > 24 * 3600 * 1000) return false;
      return inTab(Object.assign({}, t, { status: 'open', section: t.prevSection || 'active' }), tab, now);
    }).sort((a, b) => Date.parse(b[1].doneAt) - Date.parse(a[1].doneAt));
  }
  function archive(tasks, now) {
    return Object.entries(tasks || {}).filter(([, t]) => isTask(t) && (t.status === 'dropped' ||
      (t.status === 'done' && !(now - Date.parse(t.doneAt || 0) <= 24 * 3600 * 1000))))
      .sort((a, b) => Date.parse(b[1].doneAt || b[1].droppedAt || 0) - Date.parse(a[1].doneAt || a[1].droppedAt || 0));
  }
  function questions(tasks) {
    // A question he already answered here waits for the robot, which acts on the answer and clears both.
    return Object.entries(tasks || {}).filter(([, t]) => t && t.status === 'open' && (t.kind === 'question' || typeof t.question === 'string') && !t.answer)
      .map(([id, t]) => ({ id, title: t.title, text: t.kind === 'question' ? (t.question || t.title) : t.question, about: t.kind === 'question' ? '' : t.title }));
  }
  function possible(sugs, now) {
    return Object.entries(sugs || {}).filter(([, s]) => s && s.kind === 'task' && !['accepted', 'expired', 'skipped'].includes(s.status) &&
      now - Date.parse(s.createdAt || 0) <= 14 * 24 * 3600 * 1000).slice(0, 8);
  }

  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  function dueText(t) {
    const ms = dueMs(t);
    if (ms === null) return '';
    const p = Object.fromEntries(dayFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const day = p.weekday + ' ' + p.month + '/' + p.day;
    const time = timeFmt.format(new Date(ms));
    return t.dueNoTime || time === '11:59 PM' ? day : day + ', ' + time;
  }
  function shortDay(iso) {
    const ms = Date.parse(iso || '');
    if (isNaN(ms)) return '';
    const p = Object.fromEntries(dayFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return p.month + '/' + p.day;
  }
  // The + form's date and time, read as Anchorage time. No time given = 11:59 PM, marked so the robot knows.
  function dueFrom(date, time) {
    if (!date) return null;
    const hm = time || '23:59';
    let off = '-09:00';
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
        .formatToParts(new Date(date + 'T12:00:00Z')).find((x) => x.type === 'timeZoneName').value; // "GMT-9"
      const m = name.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (m) off = m[1] + m[2].padStart(2, '0') + ':' + (m[3] || '00');
    } catch (e) { /* older phone: Alaska standard time */ }
    return { due: date + 'T' + hm + ':00' + off, dueNoTime: !time };
  }

  // The other way: a task's due date and time as the + form's boxes show them (Anchorage time). Used by the edit sheet.
  function dueParts(t) {
    const ms = dueMs(t);
    if (ms === null) return { date: '', time: '' };
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const time = p.hour + ':' + p.minute;
    return { date: p.year + '-' + p.month + '-' + p.day, time: t.dueNoTime || time === '23:59' ? '' : time };
  }

  // ---------- Card pictures ----------
  // Picked from the kind of task. When Claude has picked one (the task's "pic"), that wins.
  const ICONS = {
    phone: '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    car: '<path d="M4 16v-3l2-5h12l2 5v3z"/><path d="M4 13h16"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
    wait: '<path d="M6 2h12"/><path d="M6 22h12"/><path d="M7 2v4a5 5 0 0 0 10 0V2"/><path d="M7 22v-4a5 5 0 0 1 10 0v4"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    note: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    game: '<path d="M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2v-1a4 4 0 0 1 4-4z"/><path d="M8 11v4M6 13h4"/>',
    leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l7-7"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  // Colors stay off the ones already taken (money green is only for money; no red, yellow, gold or sky blue).
  const PAINT = {
    slate: ['#5D6B82', 'rgba(70,85,110,0.35)'], orange: ['#F27612', 'rgba(242,118,18,0.4)'], blue: ['#1E8BF0', 'rgba(30,139,240,0.35)'],
    green: ['#1F9D4C', 'rgba(31,157,76,0.35)'], teal: ['#0F8A8A', 'rgba(15,138,138,0.35)'], pink: ['#D6457E', 'rgba(214,69,126,0.35)'],
    brown: ['#9A6A3E', 'rgba(154,106,62,0.35)'], gray: ['#8E8E96', 'rgba(0,0,0,0.15)'],
  };
  const PICS = [
    ['phone', 'blue', /\b(call|phone|text)\b/],
    ['work', 'teal', /\b(work|shift|donna|joel|crystal|arctic|compensation)\b/],
    ['school', 'slate', /\b(fafsa|uaa|title ix|training|advis)/],
    ['money', 'green', /(\$|\bpay(ment|ments)?\b|klarna|afterpay|\bbank\b|gcu|\bloan|refund|insurance)/],
    ['lock', 'slate', /\b(password|account|deny)\b/],
    ['bag', 'orange', /\b(buy|shop|black friday|order)\b/],
    ['game', 'pink', /\b(play|game|runescape|minecraft|create mod|space station)\b/],
    ['leaf', 'teal', /\b(volunteer|plant|nature|garden)\b/],
    ['heart', 'pink', /\b(test|doctor|dentist|health|lenscrafters|clinic)\b/],
    ['car', 'slate', /\b(car|oil|tire)\b/],
    ['box', 'brown', /\b(grab|pick up|package|mailroom)\b/],
  ];
  function pictureFor(t) {
    if (t.pic && ICONS[t.pic.icon]) return { icon: t.pic.icon, paint: PAINT[t.pic.color] ? t.pic.color : 'orange' };
    if (t.section === 'onhold') return { icon: 'wait', paint: 'gray' };
    const cls = classOf(t);
    if (cls) return { icon: { jpn: 'book', pop: 'note', wrtg: 'pencil' }[cls.id] || 'school', paint: 'slate' };
    if (t.course === 'Shopping') return { icon: 'bag', paint: 'orange' };
    const title = (t.title || '').toLowerCase();
    for (const [icon, paint, re] of PICS) if (re.test(title)) return { icon, paint };
    return { icon: 'check', paint: 'orange' };
  }

  // The line under the title counts every tab, open and overdue, so its overdue number is always the Overdue
  // tab's number, whichever tab is showing (his pick, Nov 26). Every open task sits in exactly one tab's section.
  function lineCounts(tasks, now) {
    const all = Object.values(tasks || {});
    return { open: all.filter(isOpen).length, overdue: listFor(tasks, 'overdue', now).reduce((n, g) => n + g.length, 0) };
  }
  const Pure = { TABS, inTab, listFor, doneFor, archive, questions, possible, dueText, dueFrom, dueParts, pictureFor, isOverdue, lineCounts };
  if (typeof module !== 'undefined') module.exports = Pure;
  if (typeof window === 'undefined') return;

  // ---------- The page ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = (name, size, stroke) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (stroke || 'currentColor') +
    '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* this visit only */ } },
  };

  const page = $('#page-todo');
  const scroller = $('.td-scroll', page);
  const tabsEl = $('.td-tabs', page);
  const listEl = $('.td-list', page);
  const doneEl = $('.td-done', page);
  const subEl = $('.td-sub', page);
  const onlyBtns = $$('[data-only-overdue]', page);
  const pendingEl = $('.td-pending', page);
  const suggestEl = $('.td-suggest', page);
  const trash = $('.td-trash', page);

  let base = {};       // tasks as read from the data box
  let sugs = {};       // possible tasks as read
  let tasks = {};      // base + changes made on screen
  let tab = tabById(store.get('hub2.todoTab', 'all')).id;
  let onlyOverdue = store.get('hub2.todoOnlyOverdue', {});
  let doneOpen = false;

  function recompute() {
    tasks = Changes.apply(base, Changes.list().filter((c) => c.file !== 'suggestions'));
  }

  function tabButtons(now) {
    const counts = {};
    for (const t of TABS) counts[t.id] = listFor(tasks, t.id, now).reduce((n, g) => n + g.length, 0);
    tabsEl.innerHTML = TABS.map((t) => {
      const on = t.id === tab;
      const count = t.id === 'overdue'
        ? (counts.overdue ? '<span class="od-count">' + counts.overdue + '</span>' : '')
        : '<span class="cnt">' + counts[t.id] + '</span>';
      return '<button type="button" class="tdtab' + (on ? ' on' : '') + '" data-tab-id="' + t.id + '"' +
        (t.id !== 'overdue' ? ' data-drop-tab="' + t.id + '"' : '') + (on ? ' aria-current="true"' : '') + '>' +
        '<span class="tn">' + esc(t.name) + '</span>' + count + '</button>';
    }).join('');
  }

  function card(id, t, now, opts) {
    const pic = pictureFor(t);
    const [b, s] = PAINT[pic.paint];
    const done = t.status === 'done';
    const cls = classOf(t);
    const showClass = cls && (tab === 'all' || tab === 'overdue' || tab === 'waiting' || tab === 'bucket');
    const due = dueText(t);
    const subs = Array.isArray(t.subtasks) && t.subtasks.length
      ? '<ul class="subs">' + t.subtasks.map((st, i) => '<li><button type="button" class="sub' + (st.done ? ' did' : '') + '" data-sub="' + i + '" aria-pressed="' + !!st.done + '">' +
        '<span class="dot" aria-hidden="true">' + (st.done ? svg('check', 10) : '') + '</span><span class="n">' + esc(st.text) + '</span></button></li>').join('') + '</ul>'
      : '';
    // Overdue: the date turns yellow and the whole card gets a still yellow underline, edge to edge. The date
    // doesn't say "Overdue": the underline says it (Josh's picks, Nov 25). The old short line looked like a
    // loading bar, so this one never moves.
    const late = isOverdue(t, now);
    const meta = (due || showClass)
      ? '<span class="meta">' + (due ? '<span class="due' + (late ? ' late' : '') + '">' + esc(due) + '</span>' : '') + (showClass ? '<span class="due cls">' + esc(cls.name) + '</span>' : '') + '</span>'
      : '';
    return '<article class="card' + (done ? ' is-done' : '') + (late && !done ? ' is-late' : '') + '" data-id="' + esc(id) + '"' + (opts && opts.group != null ? ' data-group="' + opts.group + '"' : '') + '>' +
      '<span class="pic" style="--b:' + b + ';--s:' + s + '" aria-hidden="true">' + svg(pic.icon, 26, '#FFFFFF') + '</span>' +
      '<button type="button" class="tick" aria-pressed="' + done + '" aria-label="' + (done ? 'Mark not done: ' : 'Mark done: ') + esc(t.title) + '"><span>' + (done ? svg('check', 13) : '') + '</span></button>' +
      '<div class="body"><span class="t">' + esc(t.title) + '</span>' +
      (t.myNote ? '<span class="n">' + esc(t.myNote) + '</span>' : '') +
      subs + meta +
      (t.section === 'onhold' && tab !== 'waiting' ? '<span class="lbl">Waiting</span>' : '') +
      '</div></article>';
  }

  function render() {
    const now = Date.now();
    recompute();
    badge();
    tabButtons(now);
    const groups = listFor(tasks, tab, now);
    const only = tab !== 'overdue' && !!onlyOverdue[tab];
    const shown = groups.map((g) => (only ? g.filter(([, t]) => isOverdue(t, now)) : g));
    const C = lineCounts(tasks, now);
    subEl.textContent = C.open + ' open · ' + C.overdue + ' overdue';
    // On the Overdue tab the switch stays in its place, on and greyed out (everything there is overdue), so the
    // row of buttons never has a gap (found Nov 27: hiding it left ? and the gear alone on the right).
    onlyBtns.forEach((b) => {
      const od = tab === 'overdue';
      b.hidden = false;
      b.disabled = od;
      b.classList.toggle('locked', od);
      b.setAttribute('aria-pressed', String(od || only));
    });

    const html = shown.map((g, gi) => g.map(([id, t]) => card(id, t, now, { group: gi })).join('')).join('');
    listEl.innerHTML = html || '<p class="empty">' + (only ? 'Nothing overdue here.' : 'Nothing here.') + '</p>';

    const done = doneFor(tasks, tab, now);
    doneEl.hidden = !done.length;
    doneEl.classList.toggle('open', doneOpen);
    $('.done-count', doneEl).textContent = done.length;
    $('.done-toggle', doneEl).setAttribute('aria-expanded', String(doneOpen));
    $('.done-list', doneEl).innerHTML = done.map(([id, t]) => card(id, t, now)).join('');

    // Possible tasks: only on the tab a task would land in.
    const hiddenSugs = new Set(Changes.list().filter((c) => c.file === 'suggestions').map((c) => c.suggestionId));
    const here = possible(sugs, now).filter(([id, s]) => !hiddenSugs.has(id) && landsIn(s.proposed || {}) === tab);
    suggestEl.hidden = !here.length;
    if (here.length) {
      $('.sg-head span', suggestEl).textContent = here.length === 1 ? '1 possible task' : here.length + ' possible tasks';
      $('.sg-list', suggestEl).innerHTML = here.map(([id, s]) => '<div class="sg" data-sg="' + esc(id) + '"><div class="sg-text"><span class="t">' + esc(s.title) + '</span>' +
        (s.source ? '<span class="sg-src">' + esc(spotted(s.source)) + '</span>' : '') + '</div>' +
        '<button type="button" class="sg-skip">Skip</button><button type="button" class="sg-add">Add</button></div>').join('');
    }

    showSaving();
    document.documentElement.dataset.todo = 'ready';
    // Plan shows the same tasks (due items, overdue), so it redraws whenever they change here.
    document.dispatchEvent(new Event('hub:tasks'));
  }
  function landsIn(p) {
    const cls = CLASS_TABS.find((c) => c.section === p.section || c.course === p.course);
    if (cls) return cls.id;
    return (TABS.find((t) => t.section === p.section && !t.course) || TABS[0]).id;
  }
  function spotted(src) {
    const s = String(src).toLowerCase();
    if (s.includes('mail')) return 'Spotted in your email';
    if (s.includes('cal')) return 'Spotted on your calendar';
    if (s.includes('drive')) return 'Spotted in your Drive';
    return 'Spotted by Claude';
  }

  // Every change goes through here: it shows at once, is kept on this phone, and saves a moment later.
  function change(c) {
    Changes.add(c);
    render();
    saveSoon(700);
  }

  // ---------- Saving ----------
  // The line under the list says where saving stands: waiting, saving, saved, or why it can't.
  let dataStore = null;
  let saveTimer = null;
  let retryTimer = null;
  let savingNow = false;
  let justSaved = 0;
  let again = false;    // a change came in while a save was running: save once more right after
  let lastRead = 0;
  // The key's last letters, kept on one line (found Nov 27: "(ends in -key)" broke after the hyphen).
  const keyName = () => String((dataStore && dataStore.keyEnd()) || '?').replace(/-/g, '\u2011');
  function showSaving() {
    const n = Changes.list().length;
    const text = $('.pending-text', pendingEl);
    pendingEl.classList.toggle('is-bad', !!n && Changes.isReadOnly());
    if (n) {
      const count = n === 1 ? '1 change waiting to save' : n + ' changes waiting to save';
      text.textContent = Changes.isReadOnly() ? count + ': the key here (ends in ' + keyName() + ') can only read' : (savingNow ? 'Saving ' + (n === 1 ? '1 change' : n + ' changes') + '…' : count);
      pendingEl.hidden = false;
    } else if (Date.now() - justSaved < 2500) {
      text.textContent = 'All saved';
      pendingEl.hidden = false;
    } else {
      pendingEl.hidden = true;
    }
    pendingEl.dataset.state = !n ? (pendingEl.hidden ? 'none' : 'saved') : (Changes.isReadOnly() ? 'readonly' : (savingNow ? 'saving' : 'waiting'));
  }
  function saveSoon(ms) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, ms);
  }
  async function saveNow() {
    if (savingNow) { again = true; return; }
    if (!dataStore || !Changes.list().length || Changes.isReadOnly()) return;
    savingNow = true; showSaving();
    const r = await Changes.save(dataStore);
    savingNow = false;
    pendingEl.dataset.why = r.saved ? 'saved' : r.why + (r.error && r.error.message ? ': ' + r.error.message : '');
    // Show what was written, so the screen matches the data box (including anything the robot added).
    if (r.files && r.files['data/tasks.json']) { base = r.files['data/tasks.json']; lastRead = Date.now(); }
    if (r.files && r.files['data/suggestions.json']) sugs = r.files['data/suggestions.json'];
    const cameIn = again; again = false;
    if (r.saved) {
      justSaved = Date.now();
      $('#toast').hidden = true; // an old "can't save" note no longer holds
      setTimeout(showSaving, 2600);
      if (Changes.list().length) saveSoon(300); // more changes came in while saving
    } else if (cameIn && r.why !== 'readonly' && r.why !== 'badkey' && r.why !== 'unsafe') {
      saveSoon(300); // a new change came in while that try failed: try once more now, with both
    } else if (r.why === 'readonly') {
      toast('The key here (ends in ' + keyName() + ') can only read, so your changes are waiting. Put in a key that can save: gear, Settings, Change key.');
    } else if (r.why === 'badkey') {
      toast('GitHub stopped accepting the key on this phone. Your changes are waiting here. Put in a new key: Menu, Settings, Change key.');
    } else if (r.why !== 'busy' && r.why !== 'nothing') {
      // No signal, GitHub busy, or the file kept changing: try again in a while. Nothing is lost.
      clearTimeout(retryTimer);
      retryTimer = setTimeout(saveNow, 30000);
    }
    render();
  }
  // Back in the app, or the signal comes back: save what's waiting, and show the newest data.
  async function catchUp() {
    if (!dataStore || document.documentElement.dataset.todo !== 'ready') return;
    if (Changes.list().length) { saveNow(); return; }
    if (Date.now() - lastRead < 60000) { render(); return; }
    try {
      base = (await dataStore.read('data/tasks.json')) || base;
      sugs = (await dataStore.read('data/suggestions.json').catch(() => sugs)) || sugs;
      lastRead = Date.now();
    } catch (e) { /* keep what's on screen */ }
    render();
  }

  // ---------- Taps ----------
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab-id]');
    if (!b || dragging) return;
    tab = b.dataset.tabId; store.set('hub2.todoTab', tab);
    doneOpen = false;
    render();
    scroller.scrollTop = 0;
  });
  onlyBtns.forEach((b) => b.addEventListener('click', () => {
    onlyOverdue[tab] = !onlyOverdue[tab];
    store.set('hub2.todoOnlyOverdue', onlyOverdue);
    render();
  }));
  $('.done-toggle', doneEl).addEventListener('click', () => { doneOpen = !doneOpen; render(); });

  page.addEventListener('click', (e) => {
    const tick = e.target.closest('.tick');
    const sub = e.target.closest('.sub');
    const cardEl = e.target.closest('.card');
    if (tick && cardEl) {
      const id = cardEl.dataset.id;
      change({ type: tasks[id].status === 'done' ? 'untick' : 'tick', taskId: id });
    } else if (sub && cardEl) {
      const id = cardEl.dataset.id, i = +sub.dataset.sub;
      change({ type: 'subtask', taskId: id, index: i, done: !tasks[id].subtasks[i].done });
    }
    // Tap anywhere else on a card: the edit sheet (his picks, Nov 27: "Open an edit sheet", "A: same as +").
    else if (cardEl && !e.target.closest('button') && !cardEl.classList.contains('ghost') && Date.now() - lastDrop > 400) openEdit(cardEl.dataset.id);
    const sg = e.target.closest('.sg');
    if (sg && e.target.closest('.sg-skip')) change({ file: 'suggestions', type: 'skip', suggestionId: sg.dataset.sg });
    if (sg && e.target.closest('.sg-add')) {
      const s = sugs[sg.dataset.sg], p = s.proposed || {};
      change({ file: 'suggestions', type: 'accept', suggestionId: sg.dataset.sg });
      change({ type: 'add', taskId: 'n' + Date.now().toString(36), task: newTask(s.title, p.due || null, false, '', landsIn(p), { course: p.course || null, fromSuggestion: sg.dataset.sg, notes: p.notes || '' }) });
    }
  });
  page.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });

  function newTask(title, due, dueNoTime, note, tabId, extra) {
    const t = tabById(tabId === 'overdue' ? 'all' : tabId);
    return Object.assign({
      title, due, dueNoTime: !!dueNoTime, myNote: note || '', kind: 'task', status: 'open',
      section: t.section || 'active', course: t.course || null, source: 'manual', addedBy: 'josh',
      addedAt: new Date().toISOString(), priority: 999,
    }, extra || {});
  }

  // ---------- The edit sheet: the + form's three boxes, filled in, and Save. Moving and deleting stay drag only. ----------
  let editing = null;
  function openEdit(id) {
    const t = tasks[id];
    if (!t) return;
    editing = id;
    const d = dueParts(t);
    $('#edit-name').value = t.title || '';
    $('#edit-date').value = d.date;
    $('#edit-time').value = d.time;
    $('#edit-note').value = t.myNote || '';
    openSheet('sheet-edit');
  }
  $('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = editing && tasks[editing];
    const title = $('#edit-name').value.trim();
    if (!title) { $('#edit-name').focus(); return; }
    if (!t) { closeSheets(); return; }
    const d = dueFrom($('#edit-date').value, $('#edit-time').value);
    const was = dueParts(t);
    const sameDue = was.date === $('#edit-date').value && was.time === $('#edit-time').value;
    const next = { title, myNote: $('#edit-note').value.trim() };
    // An unchanged date keeps its exact time, so opening and saving never moves a task.
    if (!sameDue) { next.due = d ? d.due : null; next.dueNoTime = d ? d.dueNoTime : false; }
    const changed = next.title !== t.title || next.myNote !== (t.myNote || '') || !sameDue;
    closeSheets();
    if (changed) change(Object.assign({ type: 'edit', taskId: editing }, next));
    editing = null;
  });

  // ---------- Sheets (add form, questions, menu, archive, settings, waiting list) ----------
  let lastFocus = null;
  function openSheet(id) {
    lastFocus = document.activeElement;
    $$('.sheet').forEach((s) => { s.hidden = s.id !== id; });
    const s = document.getElementById(id);
    document.body.classList.add('sheet-up');
    const f = s.querySelector('[autofocus], input, button');
    if (f && !('ontouchstart' in window)) f.focus();
  }
  function closeSheets() {
    $$('.sheet').forEach((s) => { s.hidden = true; });
    document.body.classList.remove('sheet-up');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('.sheet').forEach((s) => s.addEventListener('click', (e) => {
    if (e.target === s || e.target.closest('[data-close]')) closeSheets();
  }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

  $$('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.open;
    if (id === 'sheet-questions') fillQuestions();
    if (id === 'sheet-archive') fillArchive();
    if (id === 'sheet-waiting') fillWaiting();
    if (id === 'sheet-settings' && dataStore) {
      const end = dataStore.keyEnd();
      $('#settings-key').textContent = end ? 'The key here ends in ' + end + (Changes.isReadOnly() ? ', and it can only read.' : '.') : 'No key here yet.';
    }
    if (id === 'sheet-add') { $('#add-form').reset(); $('#add-where').textContent = 'Goes in: ' + tabById(tab === 'overdue' ? 'all' : tab).name; }
    openSheet(id);
  }));
  $('#menu-print').addEventListener('click', () => { closeSheets(); printList(); });

  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#add-name').value.trim();
    if (!title) { $('#add-name').focus(); return; }
    const d = dueFrom($('#add-date').value, $('#add-time').value);
    change({ type: 'add', taskId: 'n' + Date.now().toString(36), task: newTask(title, d && d.due, d && d.dueNoTime, $('#add-note').value.trim(), tab) });
    closeSheets();
  });

  // The Questions inbox (his pick, Nov 25): everything waiting on him, answerable any time, kept until it's
  // answered. Charges still to label come from Finance (Label now opens Finance's fix sheet); written
  // questions come from the task list. The count shows on the Questions buttons that already exist, and a dot
  // on the TO-DO tab says something is waiting. No new buttons.
  const missedCharges = () => (window.Finance && Finance.missed ? Finance.missed() : []);
  function fillQuestions() {
    const qs = questions(tasks), ms = missedCharges();
    const money = (a) => (a < 0 ? '−$' : '+$') + Math.abs(a).toFixed(2);
    $('#q-list').innerHTML = (ms.length ? '<li class="q-head">Charges to label</li>' + ms.map((m) => '<li class="q-charge"><span class="t">' + esc(m.name) + ' · ' + money(m.a) + '</span>' +
        '<span class="n">' + esc(m.day) + ' · ' + esc(m.account) + '</span><button type="button" class="q-label" data-label-charge="' + esc(m.id) + '">Label now</button></li>').join('') : '') +
      (qs.length ? (ms.length ? '<li class="q-head">Questions</li>' : '') + qs.map((q) => '<li class="q-written"><span class="t">' + esc(q.text) + '</span>' + (q.about ? '<span class="n">About: ' + esc(q.about) + '</span>' : '') +
        '<form class="q-answer" data-answer="' + esc(q.id) + '" autocomplete="off"><input type="text" aria-label="Your answer" placeholder="Your answer" autocapitalize="sentences"><button type="submit">Send</button></form></li>').join('') : '') ||
      '<li class="empty">Nothing waiting on you.</li>';
  }
  // A written answer goes on the task. The robot reads it on its next run, does what it says, and clears it.
  document.getElementById('q-list').addEventListener('submit', (e) => {
    const f = e.target.closest('[data-answer]');
    if (!f) return;
    e.preventDefault();
    const text = f.querySelector('input').value.trim();
    if (!text) { f.querySelector('input').focus(); return; }
    change({ type: 'answer', taskId: f.dataset.answer, answer: text });
    fillQuestions();
    badge();
    toast('Sent. Claude reads it at the next check, 7:42 AM or 8:42 PM.');
  });
  function questionCount() { return questions(tasks).length + missedCharges().length; }
  function badge() {
    const n = questionCount();
    document.querySelectorAll('[data-open="sheet-questions"]').forEach((b) => {
      let el = b.querySelector('.qbadge');
      if (!el) { el = document.createElement('span'); el.className = 'qbadge'; el.setAttribute('aria-hidden', 'true'); b.appendChild(el); }
      el.textContent = n > 9 ? '9+' : String(n);
      el.hidden = !n;
      b.setAttribute('aria-label', n ? 'Questions: ' + n + ' waiting' : 'Questions');
    });
    // A small dot on the TO-DO tab in the page bar while anything waits (his pick, Nov 26: nothing new on screen).
    const tab = document.querySelector('.bar .tab[data-tab="todo"]');
    if (tab) {
      let dot = tab.querySelector('.qdot');
      if (!dot) { dot = document.createElement('span'); dot.className = 'qdot'; dot.setAttribute('aria-hidden', 'true'); tab.appendChild(dot); }
      dot.hidden = !n;
      tab.setAttribute('aria-label', n ? 'TO-DO, ' + n + ' waiting in Questions' : 'TO-DO');
    }
    const sh = document.getElementById('sheet-questions');
    if (sh && !sh.hidden) fillQuestions();
  }
  document.addEventListener('hub:questions', badge);
  document.getElementById('q-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-label-charge]');
    if (!b || !window.Finance) return;
    closeSheets();
    Finance.labelNow(b.dataset.labelCharge);
  });
  function fillArchive() {
    const items = archive(tasks, Date.now());
    $('#archive-list').innerHTML = items.length
      ? items.map(([, t]) => '<li><span class="t">' + esc(t.title) + '</span><span class="n">' +
        (t.status === 'dropped' ? 'Deleted ' + shortDay(t.droppedAt) : 'Done ' + shortDay(t.doneAt)) + '</span></li>').join('')
      : '<li class="empty">Nothing here yet.</li>';
  }
  function fillWaiting() {
    $('#waiting-hint').textContent = Changes.isReadOnly()
      ? "The key on this phone can only read, so these wait here. Put in a key that can save, and they save by themselves."
      : 'These are kept on this phone and save by themselves as soon as your data box can be reached.';
    $('#waiting-change-key').hidden = !Changes.isReadOnly();
    $('#waiting-list').innerHTML = Changes.list().map((c) => '<li>' + esc(c.file === 'suggestions'
      ? (c.type === 'skip' ? 'Skip a possible task' : 'Add a possible task') : Changes.describe(c, Object.assign({}, base, tasks))) + '</li>').join('');
  }

  // Print to PDF: Letter, Arial 12, round tick boxes, underlined TO-DO title.
  function printList() {
    const now = Date.now();
    const rows = listFor(tasks, tab, now).flat();
    $('#print').innerHTML = '<h1>TO-DO</h1><p class="ptab">' + esc(tabById(tab).name) + '</p><ul>' +
      rows.map(([, t]) => '<li><span class="box"></span>' + esc(t.title) + (dueText(t) ? ' <span class="pdue">(' + esc(dueText(t)) + ')</span>' : '') + '</li>').join('') + '</ul>';
    window.print();
  }

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }

  // ---------- Hold and drag: reorder, drop on a tab to move, drop on the trash to delete ----------
  let dragging = null;
  let press = null;
  let lastDrop = 0;
  const HOLD = 380;

  function pointFrom(e) { const p = e.touches ? e.touches[0] || e.changedTouches[0] : e; return { x: p.clientX, y: p.clientY }; }

  function onDown(e) {
    if (dragging || e.button > 0) return;
    const cardEl = e.target.closest('.td-list .card');
    if (!cardEl || e.target.closest('button')) return;
    const at = pointFrom(e);
    press = { cardEl, at, touch: !!e.touches, timer: setTimeout(() => begin(at), e.touches ? HOLD : HOLD) };
  }
  function onMove(e) {
    if (dragging) { e.preventDefault(); drag(pointFrom(e)); return; }
    if (!press) return;
    const p = pointFrom(e);
    const far = Math.hypot(p.x - press.at.x, p.y - press.at.y);
    if (press.touch && far > 10) cancelPress();         // a finger moving before the hold is a scroll
    else if (!press.touch && far > 6) begin(p);         // a mouse can drag right away
  }
  function onUp() { if (dragging) drop(); cancelPress(); }
  function cancelPress() { if (press) clearTimeout(press.timer); press = null; }

  function begin(at) {
    if (!press) return;
    const cardEl = press.cardEl;
    cancelPress();
    const r = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('ghost');
    const k = window.hubScale ? window.hubScale() : 1; // a PC grown to fill the screen (see app.js)
    ghost.style.width = r.width / k + 'px';
    document.body.appendChild(ghost);
    cardEl.classList.add('lifted');
    dragging = { cardEl, ghost, k, dx: at.x - r.left, dy: at.y - r.top, target: null, moved: false, group: cardEl.dataset.group };
    document.body.classList.add('dragging');
    document.getElementById('pages').classList.add('held');
    trash.hidden = false;
    drag(at);
    autoScroll();
  }
  function drag(p) {
    const d = dragging;
    d.p = p;
    d.ghost.style.transform = 'translate(' + (p.x - d.dx) / d.k + 'px,' + (p.y - d.dy) / d.k + 'px)';
    const el = document.elementFromPoint(p.x, p.y);
    $$('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    d.target = null;
    if (!el) return;
    const t = el.closest('[data-drop-tab]');
    if (t && t.dataset.dropTab !== tab) { t.classList.add('drop-on'); d.target = { tab: t.dataset.dropTab }; return; }
    if (el.closest('.td-trash')) { trash.classList.add('drop-on'); d.target = { trash: true }; return; }
    if (tab === 'overdue') return; // a mixed list: no reordering here
    const over = el.closest('.td-list .card');
    if (over && over !== d.cardEl && over.dataset.group === d.group) {
      const r = over.getBoundingClientRect();
      const after = p.y > r.top + r.height / 2;
      over.parentNode.insertBefore(d.cardEl, after ? over.nextSibling : over);
      d.moved = true;
    }
  }
  function autoScroll() {
    if (!dragging) return;
    const p = dragging.p;
    if (p) {
      const r = scroller.getBoundingClientRect();
      if (p.y < r.top + 90) scroller.scrollTop -= 8;
      else if (p.y > r.bottom - 140) scroller.scrollTop += 8;
    }
    requestAnimationFrame(autoScroll);
  }
  function drop() {
    const d = dragging;
    dragging = null;
    lastDrop = Date.now();
    d.ghost.remove();
    d.cardEl.classList.remove('lifted');
    document.body.classList.remove('dragging');
    document.getElementById('pages').classList.remove('held');
    trash.hidden = true;
    trash.classList.remove('drop-on');
    $$('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    const id = d.cardEl.dataset.id;
    if (d.target && d.target.trash) { change({ type: 'trash', taskId: id }); return; }
    if (d.target && d.target.tab) {
      const to = tabById(d.target.tab);
      change({ type: 'move', taskId: id, section: to.section, tabName: to.name });
      return;
    }
    if (d.moved) {
      // Josh's order for this list (or this part of All) sticks: every card in it gets its place.
      const ids = $$('.td-list .card[data-group="' + d.group + '"]').map((c) => c.dataset.id);
      change({ type: 'order', taskId: id, ids });
      return;
    }
    render();
  }
  page.addEventListener('touchstart', onDown, { passive: true });
  page.addEventListener('mousedown', onDown);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', () => { if (dragging) { dragging.target = null; dragging.moved = false; drop(); } cancelPress(); });
  document.addEventListener('mouseup', onUp);

  // The 3D tilt lives in the shared frame (app.js), so every page has it.

  // ---------- Start ----------
  window.Todo = {
    tasks() { return tasks; },
    Pure,
    async load(Data) {
      dataStore = Data;
      Changes.start();
      const [t, s] = await Promise.all([Data.read('data/tasks.json'), Data.read('data/suggestions.json').catch(() => ({}))]);
      base = t || {};
      sugs = s || {};
      lastRead = Date.now();
      render();
      if (Changes.list().length) saveSoon(300); // changes left waiting from last time
    },
    showError(message) {
      listEl.innerHTML = '<p class="empty bad">' + esc(message) + '</p>';
      document.documentElement.dataset.todo = 'error';
    },
  };
  // A new day: overdue marks and the Done folder catch up when the app comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
  window.addEventListener('online', () => catchUp());
})();
