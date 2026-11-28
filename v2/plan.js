// The Plan page of the new Hub: a top bar to message Claude about the calendar (with today's due count), a day view
// that scrolls like Google Calendar, and a week grid. The Hub has no brief of its own (his pick, Nov 26).
// Plan only READS. Nothing on this page saves or changes the data box.
(function () {
  const TZ = 'America/Anchorage';
  const MIN = 60000;

  // ---------- Calendars ----------
  // One list. Colors are stand-ins until the robot copies Josh's own Google Calendar colors.
  // Yellow is never a calendar color: yellow only ever means overdue.
  const KINDS = {
    work: { name: 'Work Schedule', color: '#C2410C', ink: '#FFFFFF' },
    class: { name: 'Class', color: '#7E22CE', ink: '#FFFFFF' },
    gym: { name: 'Gym', color: '#BE185D', ink: '#FFFFFF' },
    main: { name: 'Main', color: '#0F766E', ink: '#FFFFFF' },
    due: { name: 'Due tasks', color: '#475569', ink: '#FFFFFF' },
  };
  const LATE = { color: '#FFD60A', ink: '#1C1C1E' };
  // Left out on purpose: the store's calendar (every worker's shifts; his own are on Work Schedule)
  // and the Blackboard copy (classes twice over; its deadlines come in as tasks).
  const LEFT_OUT = [/storage/i, /university of alaska/i, /blackboard/i];
  // Any other calendar shows, in the main color, so a new calendar can never quietly go missing.
  function kindOf(name) {
    const n = String(name || '');
    if (LEFT_OUT.some((r) => r.test(n))) return null;
    if (/work/i.test(n)) return 'work';
    if (/class/i.test(n)) return 'class';
    if (/gym/i.test(n)) return 'gym';
    return 'main';
  }

  // ---------- Days, in Anchorage time ----------
  const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function wall(ms) { const p = {}; for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value; return p; }
  function dayKey(ms) { const p = wall(ms); return p.year + '-' + p.month + '-' + p.day; }
  function offset(ms) {
    const s = Math.floor(ms / 1000) * 1000;
    const p = wall(s);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - s;
  }
  function dayStart(key) {
    const [y, m, d] = key.split('-').map(Number);
    const u = Date.UTC(y, m - 1, d);
    return u - offset(u - offset(u));
  }
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function weekday(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function weekStart(key) { return addDays(key, -weekday(key)); } // weeks start on Sunday, like Google Calendar
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  function timeText(ms) { return timeFmt.format(new Date(ms)).replace(':00', ''); }
  const shortDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' });
  function shortDay(key) { // "Sat 11/21", the same way TO-DO writes it
    const [y, m, d] = key.split('-').map(Number);
    const p = {}; for (const x of shortDayFmt.formatToParts(new Date(Date.UTC(y, m - 1, d)))) p[x.type] = x.value;
    return p.weekday + ' ' + p.month + '/' + p.day;
  }
  const longDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
  function longDay(key) { const [y, m, d] = key.split('-').map(Number); return longDayFmt.format(new Date(Date.UTC(y, m - 1, d))); }
  const shortLongFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  function shortLong(key) { const [y, m, d] = key.split('-').map(Number); return shortLongFmt.format(new Date(Date.UTC(y, m - 1, d))); }

  // ---------- Tasks (the same rules as TO-DO) ----------
  const isTask = (t) => t && t.kind !== 'question';
  const isOpen = (t) => isTask(t) && t.status === 'open';
  const dueMs = (t) => { const d = t && t.due ? Date.parse(t.due) : NaN; return isNaN(d) ? null : d; };
  const isLate = (t, now) => isOpen(t) && dueMs(t) !== null && dueMs(t) < now;
  const noTime = (t) => !!t.dueNoTime || timeFmt.format(new Date(dueMs(t))) === '11:59 PM';
  const CLASS_SECTIONS = ['wrtg', 'mus', 'jpn'];
  const isClassTask = (t) => !!t.course || CLASS_SECTIONS.includes(t.section);
  function dueTag(t) { // the words on a due date: "Sat 11/21" or "Sat 11/21, 2 PM"
    const ms = dueMs(t);
    return noTime(t) ? shortDay(dayKey(ms)) : shortDay(dayKey(ms)) + ', ' + timeText(ms);
  }

  // ---------- Everything Plan shows, in one shape ----------
  // Calendar events. The calendar's "Due:" copies are left out: due items come straight from the task list,
  // so a ticked task leaves Plan at once and a renamed task can never show its old name.
  function eventsOf(calendar) {
    const out = [];
    for (const [cid, cal] of Object.entries(calendar || {})) {
      if (!cal || !Array.isArray(cal.events)) continue;
      const kind = kindOf(cal.name);
      if (!kind) continue;
      for (const e of cal.events) {
        if (!e || !e.start) continue;
        const name = String(e.summary || '(No title)').trim() || '(No title)';
        if (/^due:/i.test(name)) continue;
        const id = cid + ':' + (e.id || name);
        if (e.start.date && !e.start.dateTime) {
          const from = e.start.date;
          let to = (e.end && e.end.date) || addDays(from, 1);
          if (to <= from) to = addDays(from, 1);
          out.push({ id, name, kind, cal: cal.name, allDay: true, from, to });
        } else {
          const s = Date.parse(e.start.dateTime);
          if (isNaN(s)) continue;
          let en = Date.parse((e.end && e.end.dateTime) || '');
          if (isNaN(en) || en <= s) en = s + 30 * MIN;
          out.push({ id, name, kind, cal: cal.name, allDay: false, start: s, end: en });
        }
      }
    }
    return out;
  }
  // Open tasks with a due date. A due time is a 30-minute block ending then; no time (or 11:59 PM) sits in the all-day row.
  function dueOf(tasks, now) {
    const out = [];
    for (const [id, t] of Object.entries(tasks || {})) {
      if (!isOpen(t)) continue;
      const ms = dueMs(t);
      if (ms === null) continue;
      const base = { id: 'task:' + id, taskId: id, name: 'Due: ' + String(t.title || '').trim(), kind: isClassTask(t) ? 'class' : 'due', cal: 'Due tasks', task: true, late: ms < now, tag: dueTag(t) };
      if (noTime(t)) { const k = dayKey(ms); out.push(Object.assign(base, { allDay: true, from: k, to: addDays(k, 1) })); }
      else out.push(Object.assign(base, { allDay: false, start: ms - 30 * MIN, end: ms }));
    }
    return out;
  }
  function overdue(tasks, now) {
    return Object.entries(tasks || {}).filter(([, t]) => isLate(t, now))
      .sort((a, b) => dueMs(a[1]) - dueMs(b[1]))
      .map(([id, t]) => ({ id, name: String(t.title || '').trim(), tag: dueTag(t) }));
  }
  // Due later today (not overdue yet).
  function dueToday(tasks, now) {
    const today = dayKey(now);
    return Object.entries(tasks || {}).filter(([, t]) => isOpen(t) && dueMs(t) !== null && dueMs(t) >= now && dayKey(dueMs(t)) === today)
      .sort((a, b) => dueMs(a[1]) - dueMs(b[1]))
      .map(([id, t]) => ({ id, name: String(t.title || '').trim(), when: noTime(t) ? 'Today' : timeText(dueMs(t)), kind: isClassTask(t) ? 'class' : 'due' }));
  }
  const dueLine = (n) => (n ? n + ' due today' : 'Nothing due today');

  // The days the calendar copy covers. Days outside it say "not copied yet", never "nothing on".
  // Each calendar is checked on its own (fix, Nov 26): the main calendar is copied a year ahead and the others
  // 45 days, so a day counts as copied when ANY calendar covers it, and it shows every calendar that does.
  function rangeOf(calendar) {
    const cals = [];
    for (const cal of Object.values(calendar || {})) {
      if (!cal || !kindOf(cal.name) || !cal.from || !cal.to) continue;
      cals.push({ name: cal.name, from: String(cal.from).slice(0, 10), to: String(cal.to).slice(0, 10) });
    }
    const from = cals.length ? cals.map((c) => c.from).sort()[0] : null;
    const to = cals.length ? cals.map((c) => c.to).sort().pop() : null;
    return { from, to, cals };
  }
  // The calendars copied for one day.
  const coveredBy = (r, key) => (r.cals || []).filter((c) => key >= c.from && key <= c.to).map((c) => c.name);
  const loaded = (r, key) => !(r.cals && r.cals.length) || coveredBy(r, key).length > 0;

  // Side by side, like Google Calendar: things that overlap share the width.
  function layout(list) {
    let cluster = [], end = -1;
    const flush = () => {
      const cols = [];
      for (const it of cluster) {
        let c = cols.findIndex((last) => last <= it.a);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = it.z; it.col = c;
      }
      for (const it of cluster) it.cols = cols.length;
      cluster = [];
    };
    for (const it of list) {
      if (it.a >= end) { flush(); end = -1; }
      cluster.push(it); end = Math.max(end, it.z);
    }
    flush();
    return list;
  }
  // One day: its all-day row and its timed blocks (minutes from midnight; a block crossing midnight is cut there).
  function dayOf(items, key, minLen) {
    const s = dayStart(key), e = dayStart(addDays(key, 1)), len = (e - s) / MIN;
    const allDay = [], timed = [];
    for (const it of items) {
      if (it.allDay) { if (it.from <= key && key < it.to) allDay.push(it); continue; }
      if (!(it.start < e && it.end > s)) continue;
      const a = Math.max(0, (it.start - s) / MIN) * 1440 / len;
      const b = Math.min(len, (it.end - s) / MIN) * 1440 / len;
      timed.push(Object.assign({}, it, { a, b, z: Math.min(1440, Math.max(b, a + (minLen || 0))) }));
    }
    allDay.sort((x, y) => (y.late ? 1 : 0) - (x.late ? 1 : 0) || (x.task ? 1 : 0) - (y.task ? 1 : 0) || x.name.localeCompare(y.name));
    timed.sort((x, y) => x.a - y.a || y.z - x.z);
    return { key, allDay, timed: layout(timed) };
  }

  const Pure = { KINDS, kindOf, dayKey, dayStart, addDays, weekStart, eventsOf, dueOf, overdue, dueToday, dueLine, rangeOf, loaded, coveredBy, dayOf, shortDay };
  if (typeof module !== 'undefined') module.exports = Pure;
  if (typeof window === 'undefined') return;

  // ---------- The page ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept this time */ } },
  };
  const page = $('#page-plan');
  const wrap = $('.pl-wrap', page);
  const bubble = $('.pl-bubble');
  const pc = window.matchMedia('(min-width: 900px)');
  let fitting = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(fitting); fitting = requestAnimationFrame(() => { const pg = document.getElementById('page-plan'); if (pg) fitNames(pg); }); });
  const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  let calendar = null, ready = false;
  let view = store.get('hub2.planView', 'day') === 'week' ? 'week' : 'day';
  let picked = dayKey(Date.now());       // the day being looked at; opens on today
  let shownToday = picked;
  let focusK = '';                       // a week block tapped: the day opens centered on it

  function colorsOf(it) { return it.late ? LATE : (KINDS[it.kind] || KINDS.main); }
  function tipAttrs(it, when) {
    return ' data-tip="' + esc(it.name) + '" data-when="' + esc(when || '') + '"' + (it.id && !it.task ? ' data-ev="' + esc(it.id) + '"' : '');
  }
  function whenOf(it) {
    if (it.task) return (it.late ? 'Overdue · ' : 'Due ') + it.tag;
    if (it.allDay) return 'All day · ' + it.cal;
    return timeText(it.start) + ' – ' + timeText(it.end) + ' · ' + it.cal;
  }
  function style(it) { const c = colorsOf(it); return '--c:' + c.color + ';--k:' + c.ink; }
  // One event or due task, the same in the day and the week, so a tap in the week can find it in the day.
  const keyOf = (it) => it.id + '|' + (it.start || it.from || '');
  // Long words get split points of our own (a soft hyphen), so a word that's wider than its block breaks
  // with a "-" at a sensible place, the same on the iPhone and in the phone check (which has no hyphen dictionary).
  const VOW = /[aeiouy]/i, PAIR = /^(th|ch|sh|ck|ph|wh|gh|ng|qu|tr|br|cr|dr|fr|gr|pr|bl|cl|fl|gl|pl|sl|sc|sp|st|wr|kn)$/i, LET = /[a-z]/i;
  function splitWord(w) {
    if (w.length < 6) return w;
    const at = [];
    for (let i = 3; i <= w.length - 3; i++) {
      const a = w[i - 1], b = w[i];
      if (!LET.test(a) || !LET.test(b)) continue;
      if ((!VOW.test(a) && !VOW.test(b) && !PAIR.test(a + b)) || (VOW.test(a) && !VOW.test(b) && VOW.test(w[i + 1] || ''))) {
        if (at.length && i - at[at.length - 1] < 2) at.pop(); // never leave one letter on its own
        at.push(i);
      }
    }
    if (!at.length) at.push(Math.floor(w.length / 2));
    let out = '', from = 0;
    for (const i of at) { out += w.slice(from, i) + '\u00AD'; from = i; }
    return out + w.slice(from);
  }
  const breakable = (name) => esc(name).replace(/[A-Za-z]{6,}/g, splitWord);
  // The widest piece of a name that can't break any further (a word, or the part of a word up to a split, plus its "-").
  let measure = null;
  function widestPiece(nm) {
    if (measure === null) { try { measure = document.createElement('canvas').getContext('2d') || false; } catch (e) { measure = false; } }
    if (!measure) return 0;
    const cs = getComputedStyle(nm);
    measure.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    let max = 0;
    for (const word of nm.textContent.split(/\s+/)) {
      const bits = word.split('\u00AD');
      bits.forEach((b, i) => { max = Math.max(max, measure.measureText(i < bits.length - 1 ? b + '-' : b).width); });
    }
    return max;
  }
  // A block holds its name in one span; fitNames() then trims it to the lines that fit, ending in "…".
  function block(it, cls) {
    const pos = 'top:' + (it.a / 14.4) + '%;height:calc(' + ((it.z - it.a) / 14.4) + '% - 2px);' +
      'left:calc(var(--gut) + (100% - var(--gut)) * ' + it.col + ' / ' + it.cols + ');width:calc((100% - var(--gut)) / ' + it.cols + ' - 3px)';
    const short = it.z - it.a < 45 ? ' short' : '';
    const time = it.task ? timeText(it.end) : timeText(it.start) + ' – ' + timeText(it.end);
    return '<div class="' + cls + short + (it.late ? ' late' : '') + '" role="button" tabindex="0" style="' + pos + ';' + style(it) + '" data-time="' + esc(time) + '" data-k="' + esc(keyOf(it)) + '"' +
      tipAttrs(it, whenOf(it)) + '><span class="nm">' + breakable(it.name) + '</span></div>';
  }
  // Every block gets as many whole lines of its name as it has room for, the last one ending in "…".
  // The time line under a name shows only when a line of name still fits above it.
  function fitNames(root) {
    root.querySelectorAll('.pl-ev').forEach((b) => {
      const nm = b.firstElementChild;
      if (!nm) return;
      b.classList.remove('notime', 'tiny');
      nm.classList.remove('oneline');
      const room = () => { const cs = getComputedStyle(b); return b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); };
      const lh = parseFloat(getComputedStyle(nm).lineHeight) || 14;
      if (b.clientHeight <= 0) return;
      const after = getComputedStyle(b, '::after');
      const timeH = after.display === 'none' || !after.content || after.content === 'none' ? 0 : (parseFloat(after.lineHeight) || lh);
      let n = Math.floor((room() - timeH) / lh);
      if (n < 1) { b.classList.add('notime'); n = Math.floor(room() / lh); }
      if (n < 1) { b.classList.add('tiny'); n = 1; }
      nm.style.webkitLineClamp = String(n);
      // Too narrow for even one piece of a word: one line ending in "…", never a word broken mid-letter.
      nm.classList.toggle('oneline', widestPiece(nm) > nm.clientWidth + 0.5);
    });
  }
  // The same words in the day and the week (found Nov 28: the week said "3p" and "12p"). Midnight gets its "12 AM" too.
  function hourLabel(h) {
    if (h === 12) return 'Noon';
    return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  }
  function hours() {
    let s = '';
    for (let h = 0; h < 24; h++) s += '<span class="pl-hr" style="top:calc(var(--hr) * ' + h + ' - 8px)">' + hourLabel(h) + '</span>';
    return s;
  }
  function nowLine(now, key, left, width) {
    if (dayKey(now) !== key) return '';
    const m = (now - dayStart(key)) / MIN;
    // Kept inside the day, so just before midnight the dot doesn't poke out past the bottom.
    return '<div class="pl-now" style="top:min(' + (m / 14.4) + '%, calc(100% - 6px));left:' + left + ';width:' + width + '" aria-hidden="true"></div>';
  }

  function allItems(now) {
    const tasks = (window.Todo && Todo.tasks && Todo.tasks()) || {};
    return { tasks, items: eventsOf(calendar).concat(dueOf(tasks, now)) };
  }

  // ---- Day view ----
  function renderDay(items, tasks, now, range) {
    const today = dayKey(now);
    const d = dayOf(items, picked, 25);
    // The week strip (phone): seven days, the picked one filled.
    const ws = weekStart(picked);
    $('.pl-strip', page).innerHTML = DAY_LETTERS.map((l, i) => {
      const k = addDays(ws, i);
      return '<button type="button" class="pl-sday' + (k === picked ? ' on' : '') + (k === today ? ' today' : '') + '" data-day="' + k + '" aria-pressed="' + (k === picked) + '" aria-label="' + esc(longDay(k)) + '">' +
        '<span class="l">' + l + '</span><span class="n">' + Number(k.slice(8)) + '</span></button>';
    }).join('');
    $('.pl-dayname', page).textContent = picked === today ? 'Today' : longDay(picked);
    // All-day row: the yellow overdue button (today only), all-day events, and due items with no time.
    let top = '';
    if (picked === today) {
      const late = overdue(tasks, now).length;
      if (late) top += '<button type="button" class="pl-late" data-open="sheet-overdue" data-jump="overdue">' + late + ' overdue</button>';
    }
    if (!loaded(range, picked)) top += '<p class="pl-off">Calendar not copied for this day yet. Due tasks still show.</p>';
    top += d.allDay.map((it) => '<div class="pl-chip-ev' + (it.late ? ' late' : '') + '" role="button" tabindex="0" style="' + style(it) + '"' + tipAttrs(it, whenOf(it)) + '>' +
      esc(it.name) + '</div>').join('');
    const all = $('.pl-allday', page);
    all.innerHTML = top;
    all.hidden = !top;
    const empty = !d.timed.length && !d.allDay.length && loaded(range, picked) ? '<p class="pl-empty">Nothing on this day.</p>' : '';
    $('.pl-grid', page).innerHTML = hours() + d.timed.map((it) => block(it, 'pl-ev')).join('') + nowLine(now, picked, 'var(--gut)', 'calc(100% - var(--gut))') + empty;
    fitNames($('.pl-grid', page));
  }

  // ---- Week view ----
  function renderWeek(items, tasks, now, range) {
    const today = dayKey(now);
    const ws = weekStart(picked);
    const days = DAY_LETTERS.map((_, i) => addDays(ws, i));
    const lateN = overdue(tasks, now).length;
    $('.pl-whead', page).innerHTML = '<span class="pl-gut" aria-hidden="true"></span>' + days.map((k, i) =>
      '<button type="button" class="pl-wday' + (k === today ? ' today' : '') + (k === picked ? ' on' : '') + (loaded(range, k) ? '' : ' off') + '" data-day="' + k + '" data-go-day aria-label="' + esc(longDay(k)) + ', show the day">' +
      '<span class="l">' + DAY_LETTERS[i] + '</span><span class="n">' + Number(k.slice(8)) + '</span></button>').join('');
    const per = days.map((k) => dayOf(items, k, 25));
    let most = 0;
    const cols = per.map((d, i) => {
      const k = days[i];
      const chips = [];
      const room = 3;
      const show = d.allDay.length > room ? d.allDay.slice(0, room - 1) : d.allDay;
      for (const it of show) chips.push('<div class="pl-wchip' + (it.late ? ' late' : '') + '" role="button" tabindex="0" style="' + style(it) + '"' + tipAttrs(it, whenOf(it)) + '>' + esc(it.name) + '</div>');
      const rest = d.allDay.slice(show.length);
      if (rest.length) chips.push('<div class="pl-wchip more" role="button" tabindex="0" data-tip="' + esc(rest.map((x) => x.name).join(', ')) + '" data-when="' + rest.length + ' more">+' + rest.length + '</div>');
      most = Math.max(most, chips.length);
      return '<div class="pl-wcol' + (loaded(range, k) ? '' : ' off') + '">' + chips.join('') + '</div>';
    });
    const wall = $('.pl-wallday', page);
    wall.innerHTML = '<span class="pl-gut" aria-hidden="true"></span>' + cols.join('');
    wall.hidden = !most;
    // The week's overdue button: the same yellow "N overdue" as the day (found Nov 28: the week said "2 late").
    const wl = $('.pl-wlate', page);
    const thisWeek = weekStart(today) === ws && lateN > 0;
    wl.innerHTML = thisWeek ? '<button type="button" class="pl-late" data-open="sheet-overdue" data-jump="overdue">' + lateN + ' overdue</button>' : '';
    wl.hidden = !thisWeek;
    const anyOff = days.some((k) => !loaded(range, k));
    $('.pl-wnote', page).hidden = !anyOff;
    // The grid: seven columns of blocks.
    const colW = '(100% - var(--gut)) / 7';
    let grid = hours();
    per.forEach((d, i) => {
      const k = days[i];
      if (k === today) grid += '<div class="pl-tcol" style="left:calc(var(--gut) + ' + colW + ' * ' + i + ');width:calc(' + colW + ')" aria-hidden="true"></div>';
      if (!loaded(range, k)) grid += '<div class="pl-ocol" style="left:calc(var(--gut) + ' + colW + ' * ' + i + ');width:calc(' + colW + ')" aria-hidden="true"></div>';
      for (const it of d.timed) {
        const pos = 'top:' + (it.a / 14.4) + '%;height:calc(' + ((it.z - it.a) / 14.4) + '% - 1px);' +
          'left:calc(var(--gut) + ' + colW + ' * ' + i + ' + ' + colW + ' * ' + it.col + ' / ' + it.cols + ');width:calc(' + colW + ' / ' + it.cols + ' - 2px)';
        // Color only, no name (his pick, Nov 28): a tap opens that day, centered on this event.
        grid += '<div class="pl-wev' + (it.late ? ' late' : '') + '" role="button" tabindex="0" style="' + pos + ';' + style(it) + '" data-day="' + k + '" data-k="' + esc(keyOf(it)) + '"' +
          ' aria-label="' + esc(it.name + ', ' + whenOf(it) + '. Show it in the day') + '"></div>';
      }
      grid += nowLine(now, k, 'calc(var(--gut) + ' + colW + ' * ' + i + ')', 'calc(' + colW + ')');
    });
    $('.pl-wgrid', page).innerHTML = grid;
    fitNames($('.pl-wgrid', page));
    $('.pl-weekname', page).textContent = 'Week of ' + shortDay(ws).replace(/^\w+ /, '');
  }

  // ---- The top bar's due count, and the overdue list that slides up ----
  function renderTop(tasks, now) {
    const due = dueToday(tasks, now);
    const late = overdue(tasks, now);
    $('[data-line="plan"]', page).textContent = dueLine(due.length);
    $('.pl-chip', page).classList.toggle('none', !due.length);
    $('#overdue-body').innerHTML = '<ul class="pl-rows">' + (late.map((x) => '<li class="pl-row late"><span class="t">' + esc(x.name) + '</span><span class="due late">' + esc(x.tag) + '</span></li>').join('') ||
      '<li class="pl-row"><span class="t muted">Nothing overdue.</span></li>') + '</ul>';
  }

  function renderKey() {
    const kinds = ['work', 'class', 'gym', 'main', 'due'];
    const names = { work: 'Work Schedule', class: 'Class', gym: 'Gym', main: 'Main', due: 'Due tasks' };
    // Any calendar Josh adds later shows here with its own name.
    const extra = Object.values(calendar || {}).filter((c) => c && kindOf(c.name) === 'main' && !/^my calendar$/i.test(c.name)).map((c) => c.name);
    $('.pl-key', page).innerHTML = kinds.map((k) => '<span class="pl-keyrow"><span class="sq" style="background:' + KINDS[k].color + '" aria-hidden="true"></span>' + esc(names[k]) + '</span>').join('') +
      extra.map((n) => '<span class="pl-keyrow"><span class="sq" style="background:' + KINDS.main.color + '" aria-hidden="true"></span>' + esc(n) + '</span>').join('') +
      '<span class="pl-keyrow"><span class="sq" style="background:' + LATE.color + '" aria-hidden="true"></span>Overdue</span>';
  }

  function render() {
    if (!ready) return;
    const now = Date.now();
    const todayKey = dayKey(now);
    // A new day while Plan was open on today: follow along to the new today.
    if (todayKey !== shownToday) { if (picked === shownToday) picked = todayKey; shownToday = todayKey; }
    const { tasks, items } = allItems(now);
    const range = rangeOf(calendar);
    wrap.dataset.view = view;
    $$('[data-view-pick]', page).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewPick === view)));
    const away = !(weekStart(picked) === weekStart(todayKey) && (view === 'week' || pc.matches || picked === todayKey));
    // On the phone the date shares its line with Today, so it shortens ("Wed, Nov 25") while Today shows.
    $('.pl-date', page).textContent = away && !pc.matches ? shortLong(picked) : longDay(picked);
    $$('.pl-today', page).forEach((b) => { b.hidden = !away; });
    renderTop(tasks, now);
    renderDay(items, tasks, now, range);
    renderWeek(items, tasks, now, range);
    renderKey();
    lastItems = items;
    requestAnimationFrame(scrollCards);
    page.dataset.plan = 'ready';
    document.documentElement.dataset.plan = 'ready';
  }
  // Each card scrolls to a useful hour once per day (or week) shown: an hour before now on today, else just before the
  // first thing that day, or centered on a week block that was tapped. Found Nov 28: the scroll ran the moment a view
  // was switched, before that card had any height, so the week, the PC and Week back to Day all opened at midnight.
  // Now each card waits until it can really scroll, checks that the scroll took, and tries again when its size changes
  // (shown, switched to, the page opened, the screen turned). A card that comes back into view scrolls again.
  let lastItems = [];
  const cards = { day: { done: '', h: 0 }, week: { done: '', h: 0 } };
  function scrollCards() {
    if (!ready) return;
    const now = Date.now(), today = dayKey(now), mode = pc.matches ? 'pc' : 'phone';
    for (const which of ['day', 'week']) {
      const c = cards[which];
      const sc = $('.pl-' + which + 'card .pl-scroll', page);
      const g = sc && sc.firstElementChild;
      if (!g) continue;
      const shownH = sc.clientHeight;
      if (!shownH || !g.offsetHeight) { c.h = 0; continue; }  // hidden for now: scroll when it shows
      if (!c.h) c.done = '';                                  // just came into view
      c.h = shownH;
      const target = which === 'day' && focusK ? 'k:' + focusK : '';
      const spot = which + '|' + (which === 'day' ? picked : weekStart(picked)) + '|' + mode + '|' + target;
      if (c.done === spot) continue;
      let y;
      const el = target && $('.pl-grid [data-k="' + CSS.escape(focusK) + '"]', page);
      if (target && !el) focusK = '';                         // not in this day after all: its usual hour
      if (el) y = g.offsetTop + el.offsetTop + el.offsetHeight / 2 - shownH / 2;
      else {
        let m;
        const onNow = which === 'day' ? picked === today : weekStart(picked) === weekStart(today);
        if (onNow) m = (now - dayStart(today)) / MIN - 60;
        else { const first = which === 'day' && dayOf(lastItems, picked, 0).timed[0]; m = first ? first.a - 30 : 7 * 60; }
        y = g.offsetTop + g.offsetHeight * m / 1440 - 8;
      }
      const max = sc.scrollHeight - shownH;
      const want = Math.round(Math.max(0, Math.min(max, y)));
      sc.scrollTop = want;
      if (Math.abs(sc.scrollTop - want) > 2) continue;         // didn't take yet: the next size change tries again
      c.done = spot;
      if (el) {
        focusK = '';
        c.done = which + '|' + picked + '|' + mode + '|';     // a re-render later keeps this place
        el.classList.add('pl-flash');
        setTimeout(() => el.classList.toggle('pl-flash', false), 1600);
      }
    }
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => requestAnimationFrame(scrollCards));
    $$('.pl-scroll', page).forEach((sc) => ro.observe(sc));
  }

  // ---- Taps ----
  function showTip(el) {
    const name = el.dataset.tip;
    if (!name) return;
    bubble.innerHTML = '<span class="bn">' + esc(name) + '</span>' + (el.dataset.when ? '<span class="bw">' + esc(el.dataset.when) + '</span>' : '');
    bubble.hidden = false;
    const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect();
    // On a PC that grows to fill the screen, positions are worked out in screen points, then turned back into style pixels.
    const k = window.hubScale ? window.hubScale() : 1, z = parseFloat(document.documentElement.style.zoom) || 1;
    const vw = window.innerWidth * k / z, vh = window.innerHeight * k / z;
    let x = r.left + r.width / 2 - b.width / 2;
    x = Math.max(12, Math.min(vw - b.width - 12, x));
    let y = r.top - b.height - 8;
    if (y < 60) y = Math.min(vh - b.height - 12, r.bottom + 8);
    bubble.style.left = x / k + 'px';
    bubble.style.top = y / k + 'px';
    clearTimeout(showTip.t);
    showTip.t = setTimeout(hideTip, 4000);
  }
  function hideTip() { bubble.hidden = true; }
  page.addEventListener('click', (e) => {
    // A week block: open that day centered on it (on a PC the day sits beside the week, so it just moves there).
    const wev = e.target.closest('.pl-wev');
    if (wev) {
      picked = wev.dataset.day;
      focusK = wev.dataset.k || '';
      if (!pc.matches) { view = 'day'; store.set('hub2.planView', view); }
      cards.day.done = '';
      hideTip(); render(); return;
    }
    const day = e.target.closest('[data-day]');
    if (day) {
      picked = day.dataset.day;
      if (day.hasAttribute('data-go-day') && !pc.matches) { view = 'day'; store.set('hub2.planView', view); }
      hideTip(); render(); return;
    }
    const v = e.target.closest('[data-view-pick]');
    if (v) { view = v.dataset.viewPick; store.set('hub2.planView', view); hideTip(); render(); return; }
    if (e.target.closest('.pl-prev, .pl-next')) {
      const step = view === 'week' || pc.matches ? 7 : 1;
      picked = addDays(picked, e.target.closest('.pl-prev') ? -step : step);
      hideTip(); render(); return;
    }
    if (e.target.closest('.pl-today')) { picked = dayKey(Date.now()); hideTip(); render(); return; }
    const tip = e.target.closest('[data-tip]');
    if (tip && !tip.hasAttribute('data-open')) { showTip(tip); return; }
    hideTip();
  });
  page.addEventListener('keydown', (e) => {
    const tip = e.target.closest && e.target.closest('[data-tip][role="button"]');
    if (tip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tip.click(); }
  });
  page.addEventListener('scroll', hideTip, true);
  bubble.addEventListener('click', hideTip);
  // The overdue button (and the week's "late" chip) open the overdue list.
  page.addEventListener('click', (e) => {
    if (!e.target.closest('[data-jump]')) return;
    openOverdue();
  });

  // The overdue sheet: slides up over Plan. Swipe down (or tap outside, or ×) to close.
  const sheet = $('#sheet-overdue');
  const card = $('.sheet-card', sheet);
  function openOverdue() {
    $$('.sheet').forEach((s) => { s.hidden = s !== sheet; });
    document.body.classList.add('sheet-up');
    card.scrollTop = 0;
  }
  function closeOverdue() {
    sheet.hidden = true;
    if (!$$('.sheet').some((s) => !s.hidden)) document.body.classList.remove('sheet-up');
  }
  let y0 = null, dy = 0;
  card.addEventListener('touchstart', (e) => { y0 = card.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { e.preventDefault(); card.style.transform = 'translateY(' + dy + 'px)'; card.style.transition = 'none'; }
  }, { passive: false });
  card.addEventListener('touchend', () => {
    if (y0 === null) return;
    card.style.transition = '';
    card.style.transform = '';
    if (dy > 90) closeOverdue();
    y0 = null; dy = 0;
  });

  // Keep things current: tasks changed on TO-DO, the clock moved on, the app came back, the screen changed size.
  document.addEventListener('hub:tasks', render);
  setInterval(() => { if (!document.hidden) render(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  pc.addEventListener && pc.addEventListener('change', render);

  window.Plan = {
    Pure,
    closeOverdue,
    async load(Data) {
      const cal = await Data.read('data/calendar.json');
      calendar = cal || {};
      ready = true;
      render();
    },
    showError(message) {
      $('.pl-hl', page).textContent = message;
      page.dataset.plan = 'error';
      document.documentElement.dataset.plan = 'error';
    },
  };
})();
