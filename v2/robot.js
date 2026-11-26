// Keep and undo tags for the robot's changes (his pick, Nov 25: "a check or an X, just to keep or get rid of").
//
// The robot writes one line in the hidden change log for every change it makes. A robot line looks like:
//   { id, at, who: 'robot', what: 'Moved the due date to Friday', why, file: 'data/tasks.json',
//     robot: { kind: 'task', ref: '<the task id>',
//              sets: [ { path: ['<task id>', 'due'], before: '<old value>', after: '<new value>' } ] } }
//   - kind says where the tag shows: task (TO-DO card), charge (Activity row), balance (the account's
//     balance), debt (Debt card), note (Quick-budget note) or event (Plan; listed above the calendar).
//   - path walks into the file. A step like { id: 't9' } means "the item in this list whose id is t9".
//   - A field that didn't exist before has no "before". A whole record the robot added has { path, added: true }
//     (undo then marks it gone: a task goes to Deleted, anything else gets "undone", which the pages leave out).
//   - Calendar changes live in Google, not here: kind event with calendar: true. Undo then only asks; the robot
//     puts the event back on its next run.
// The tag shows on the changed thing until it's kept or undone, or for 7 days; after that it hides and the
// change stays. Keep or undo adds its own line to the log (answers: the robot line's id), so the log only grows.
//
// Saving follows the same safety as the other saves:
//   1. Undo puts a value back only if it is still the robot's value. If anything changed it since (Josh, or a
//      newer robot run), nothing is touched and the page says so: newest data wins.
//   2. Undo is all or nothing for one robot line, and doing it twice changes nothing the second time.
//   3. Reads the newest copy and writes "only if nobody changed it since"; tries again if someone did.
//   4. Waits on this phone if it can't save yet, and tries again later.
//   5. Never shrinks a file by more than the one field it puts back.
(function () {
  const LOG = 'data/log.json';
  const WAITING = 'hub2.robotWaiting';
  const SHOW_DAYS = 7;
  const FILES = ['data/tasks.json', 'data/suggestions.json', 'data/fin.json', 'data/fin.config.months.json', 'data/notes.json'];
  const PAGE_OF = { task: 'todo', charge: 'finance', balance: 'finance', debt: 'finance', note: 'finance', event: 'plan' };
  const newId = (p) => (p || 'a') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- The rules, on their own (pure, so the check can test them) ----------
  function isRobotLine(l) {
    return !!(l && l.who === 'robot' && l.robot && l.robot.kind && (l.robot.calendar || (FILES.includes(l.file) && Array.isArray(l.robot.sets) && l.robot.sets.length)));
  }
  // Robot lines still waiting for a keep or an undo, newest first.
  function openLines(log, now, answeredHere) {
    const items = (log && Array.isArray(log.items)) ? log.items : [];
    const answered = new Set(items.filter((l) => l && l.answers).map((l) => l.answers));
    const cutoff = now - SHOW_DAYS * 864e5;
    return items.filter((l) => isRobotLine(l) && !answered.has(l.id) && !(answeredHere && answeredHere[l.id]) && Date.parse(l.at) >= cutoff)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  function step(node, key) {
    if (node == null) return undefined;
    if (key && typeof key === 'object') return Array.isArray(node) ? node.find((x) => x && x.id === key.id) : undefined;
    return node[key];
  }
  function walk(data, path) { let n = data; for (const k of path) { n = step(n, k); if (n === undefined) return undefined; } return n; }
  function size(o) {
    if (Array.isArray(o)) return o.length + o.reduce((s, x) => s + size(x), 0);
    if (o && typeof o === 'object') return Object.keys(o).length + Object.values(o).reduce((s, x) => s + size(x), 0);
    return 0;
  }
  const isGone = (rec, file) => (file === 'data/tasks.json' ? rec.status === 'dropped' : !!rec.undone);

  // Undo one robot line on a copy of its file. Returns { result, data, shrink }:
  //   result 'undone'  : put back (data is the new copy, or null if it was already put back)
  //   result 'changed' : something changed it since the robot did; nothing touched
  function undo(file, data, line, at) {
    const out = clone(data);
    const sets = line.robot.sets;
    const plan = sets.map((s) => {
      if (s.added) {
        const rec = walk(out, s.path);
        if (!rec || typeof rec !== 'object') return 'done';
        return isGone(rec, file) ? 'done' : 'do';
      }
      const cur = walk(out, s.path);
      if (same(cur, s.after)) return 'do';
      if (('before' in s) ? same(cur, s.before) : cur === undefined) return 'done';
      return 'changed';
    });
    if (plan.includes('changed')) return { result: 'changed', data: null, shrink: 0 };
    if (!plan.includes('do')) return { result: 'undone', data: null, shrink: 0 };
    let shrink = 0;
    sets.forEach((s, i) => {
      if (plan[i] !== 'do') return;
      if (s.added) {
        const rec = walk(out, s.path);
        if (file === 'data/tasks.json') {
          rec.prevStatus = rec.status; rec.prevSection = rec.section;
          rec.status = 'dropped'; rec.section = 'done'; rec.droppedAt = at; rec.droppedBy = 'undo';
        } else rec.undone = at;
        return;
      }
      const parent = walk(out, s.path.slice(0, -1));
      const key = s.path[s.path.length - 1];
      if (parent == null || typeof key === 'object') return;
      if ('before' in s) parent[key] = clone(s.before);
      else { shrink += 1 + size(parent[key]); delete parent[key]; }
    });
    return { result: 'undone', data: out, shrink };
  }

  // ---------- On the page ----------
  let store = null;
  let log = null;
  let lines = [];
  let answeredHere = {};   // line id -> 'kept' | 'undone', so a tag goes away at once
  let pending = [];
  let saving = false;
  let readOnly = false;

  function loadWaiting() { try { return JSON.parse(localStorage.getItem(WAITING)) || []; } catch (e) { return []; } }
  function keepWaiting() { try { localStorage.setItem(WAITING, JSON.stringify(pending)); } catch (e) { /* stays in memory */ } }

  const ICON = {
    keep: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  function tagHtml(l) {
    const what = l.what || 'Changed this';
    return '<div class="rb-tag" data-rb="' + esc(l.id) + '" role="group" aria-label="Robot change: ' + esc(what) + '">' +
      '<span class="rb-what"><b>Robot</b> ' + esc(what) + '</span>' +
      '<button type="button" class="rb-keep" data-rb-keep aria-label="Keep: ' + esc(what) + '"><span class="rb-dot">' + ICON.keep + '</span></button>' +
      '<button type="button" class="rb-undo" data-rb-undo aria-label="Undo: ' + esc(what) + '"><span class="rb-dot">' + ICON.undo + '</span></button></div>';
  }
  const SPOT = { task: '#page-todo .card[data-id="R"]', charge: '#page-finance [data-tx="R"]', balance: '#page-finance [data-acct="R"]', debt: '#page-finance [data-debt="R"]', note: '#page-finance [data-note="R"]', event: '#page-plan [data-ev="R"]' };
  const cssId = (s) => String(s).replace(/["\\]/g, '\\$&');

  function decorate() {
    if (!document.body) return;
    const open = lines.filter((l) => !answeredHere[l.id]);
    const ids = new Set(open.map((l) => l.id));
    document.querySelectorAll('.rb-tag').forEach((t) => { if (!ids.has(t.dataset.rb)) t.remove(); });
    document.querySelectorAll('.rb-mark').forEach((m) => m.classList.remove('rb-mark'));
    const strip = document.querySelector('[data-rb-plan]');
    const events = [];
    for (const l of open) {
      const k = l.robot.kind;
      if (k === 'event') events.push(l);
      if (!SPOT[k]) continue;
      document.querySelectorAll(SPOT[k].replace('R', cssId(l.robot.ref))).forEach((el) => {
        if (k === 'event') { el.classList.add('rb-mark'); return; }
        // Where the tag goes: inside a card or note; just after a row or a balance (a button can't hold buttons).
        let host, where;
        if (k === 'task') { host = el.querySelector('.body') || el; where = 'beforeend'; }
        else if (k === 'debt' || k === 'note') { host = el; where = 'beforeend'; }
        else if (k === 'balance') { host = el.parentElement; where = 'afterend'; }
        else { host = el; where = 'afterend'; }
        const near = where === 'beforeend' ? host : host.parentElement;
        if (near && near.querySelector(':scope > [data-rb="' + cssId(l.id) + '"]')) return;
        host.insertAdjacentHTML(where, tagHtml(l));
      });
    }
    if (strip) {
      const want = events.map((l) => l.id).join(',');
      if (strip.dataset.ids !== want) {
        strip.dataset.ids = want;
        strip.innerHTML = events.map(tagHtml).join('');
      }
      strip.hidden = !events.length;
      const wrap = strip.closest('.pl-wrap');
      if (wrap) wrap.classList.toggle('has-rb', !!events.length);
    }
  }
  let soon;
  function decorateSoon() { clearTimeout(soon); soon = setTimeout(decorate, 0); }

  let toastTimer;
  function toast(text) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  function answer(id, kind) {
    const l = lines.find((x) => x.id === id);
    if (!l || answeredHere[id]) return;
    answeredHere[id] = kind;
    pending.push({ id: newId('a'), at: new Date().toISOString(), lineId: id, answer: kind, line: l });
    keepWaiting();
    decorate();
    document.documentElement.dataset.robot = 'saving';
    save();
  }

  async function addLog(item, result) {
    for (let tries = 0; tries < 3; tries++) {
      const { data, version } = await store.readWithVersion(LOG, true);
      const next = clone(data || { items: [] });
      next.items = next.items || [];
      if (next.items.some((x) => x.id === item.id)) return true;
      const l = item.line;
      const words = { kept: 'Kept', undone: l.robot.calendar ? 'Asked to undo' : 'Undid', changed: 'Couldn\'t undo (it changed since)' }[result];
      next.items.push({ id: item.id, at: item.at, who: 'Josh, in the new Hub', what: words + ': ' + (l.what || 'a robot change'),
        why: result === 'kept' ? 'Tapped the check on the robot\'s tag' : 'Tapped the X on the robot\'s tag', file: l.file || null,
        answers: l.id, answer: result, request: result === 'undone' && !!l.robot.calendar });
      next.updatedAt = item.at;
      if (data && size(next) < size(data)) throw Object.assign(new Error('unsafe'), { code: 'unsafe' });
      if (await store.writeIfUnchanged(LOG, next, version, 'New Hub: ' + result + ' a robot change')) { log = next; return true; }
    }
    return false;
  }
  async function undoInFile(item) {
    const l = item.line;
    for (let tries = 0; tries < 3; tries++) {
      const { data, version } = await store.readWithVersion(l.file);
      if (!data || typeof data !== 'object') throw Object.assign(new Error('unsafe'), { code: 'unsafe' });
      const r = undo(l.file, data, l, item.at);
      if (!r.data) return r.result;
      if (size(r.data) < size(data) - r.shrink) throw Object.assign(new Error('unsafe'), { code: 'unsafe' });
      if (await store.writeIfUnchanged(l.file, r.data, version, 'New Hub: undid a robot change')) return 'undone';
    }
    return null;
  }

  async function save() {
    if (saving || !pending.length || !store || readOnly) return;
    saving = true;
    try {
      for (const item of pending.slice()) {
        let result = item.answer;
        if (result === 'undone' && !item.line.robot.calendar) {
          result = item.result || await undoInFile(item);
          if (!result) break; // someone keeps saving at the same moment: try again later
          item.result = result; keepWaiting(); // the file part is done: a lost reply can't undo twice
        }
        if (!(await addLog(item, result))) break;
        pending = pending.filter((x) => x !== item); keepWaiting();
        if (result === 'changed') {
          toast('That changed since the robot did it, so it stays as it is now.');
        } else if (result === 'undone' && item.line.robot.calendar) {
          toast('Undo asked. The robot puts the event back on its next run.');
        } else if (result === 'undone') {
          reload(item.line.robot.kind);
        }
      }
    } catch (e) {
      if (e && e.code === 'readonly') { readOnly = true; toast('Your answer waits on this phone: this key can only read.'); }
    } finally {
      saving = false;
      document.documentElement.dataset.robot = pending.length ? 'waiting' : 'saved';
    }
  }
  function reload(kind) {
    const page = PAGE_OF[kind];
    const P = { todo: window.Todo, finance: window.Finance, plan: window.Plan }[page];
    if (P && P.load && store) P.load(store, { keepTab: true }).catch(() => {});
  }

  if (typeof document !== 'undefined') document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.rb-tag button');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    answer(b.closest('.rb-tag').dataset.rb, b.hasAttribute('data-rb-keep') ? 'kept' : 'undone');
  }, true);
  // Pages redraw often; the tags go back on after each redraw.
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const watch = () => ['page-todo', 'page-finance', 'page-plan'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) new MutationObserver((list) => { if (list.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !n.classList.contains('rb-tag')))) decorateSoon(); }).observe(el, { childList: true, subtree: true });
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  }
  if (typeof window !== 'undefined') setInterval(() => { if (pending.length && !document.hidden) save(); }, 120000);

  const Robot = {
    SHOW_DAYS, isRobotLine, openLines, walk, undo, size,
    async load(Data) {
      store = Data;
      readOnly = false;
      pending = loadWaiting();
      answeredHere = {};
      for (const p of pending) answeredHere[p.lineId] = p.answer;
      log = await Data.readOptional(LOG);
      lines = openLines(log, Date.now());
      decorate();
      document.documentElement.dataset.robot = pending.length ? 'waiting' : 'ready';
      if (pending.length) save();
    },
    open() { return lines.filter((l) => !answeredHere[l.id]); },
    waiting() { return pending.slice(); },
  };
  if (typeof window !== 'undefined') window.Robot = Robot;
  if (typeof module !== 'undefined') module.exports = Robot;
})();
