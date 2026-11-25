// Saving for the Finance page and the message boxes (Finance's Quick-budget notes and Plan's messages).
// Same safety as TO-DO's saving (see changes.js):
//   1. Every change has its own id, and the thing it changes remembers it, so a change can never land twice.
//   2. Saving reads the newest copy first and writes "only if nobody changed it since"; if the robot or another
//      phone saved in between, it reads again and puts the change in again.
//   3. One save at a time. Anything not saved yet waits on this phone and is tried again; the page shows it.
//   4. A save may only add to a file, never shrink it. Nothing here deletes: undoing a store rule switches it off.
// Files it may write: the money file, the charges file, the notes file (made on the first note), and the
// change log (made on the first change). The change log is hidden from his pages: every change saved here
// adds one line to it (when, who, what, why), so anything can be traced later. It only ever grows.
(function () {
  const WAITING = 'hub2.finWaiting';
  const KEEP_IDS = 30;
  const FILES = { fin: 'data/fin.json', months: 'data/fin.config.months.json', notes: 'data/notes.json', log: 'data/log.json' };
  const OPTIONAL = { notes: true, log: true }; // made on first use
  const newId = (p) => (p || 'c') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stamp = (obj, id) => { obj.changeIds = (obj.changeIds || []).concat(id).slice(-KEEP_IDS); };
  const has = (obj, id) => !!obj && (obj.changeIds || []).includes(id);

  // Each kind of change, put into a copy of its file. Pure: same input, same result.
  const KINDS = {
    // Fix a charge: his own name, category or bucket. Marked as his, so nothing guesses over it later.
    fixCharge: { file: 'months', put(m, c) {
      for (const k of Object.keys(m || {})) for (const t of ((m[k] || {}).txns || [])) {
        if (t.id !== c.txId || has(t, c.id)) continue;
        if (c.name != null) { if (c.name) t.name = c.name; else delete t.name; }
        if (c.cat) t.cat = c.cat;
        if (c.bucket) t.u = c.bucket;
        t.lb = 'josh'; t.lbAt = c.at;
        stamp(t, c.id);
      }
    } },
    addDebt: { file: 'fin', put(f, c) {
      f.debts = f.debts || { items: [], payments: [] };
      f.debts.items = f.debts.items || []; f.debts.payments = f.debts.payments || [];
      if (f.debts.items.some((d) => d.id === c.item.id)) return;
      f.debts.items.push(Object.assign({}, c.item, { changeIds: [c.id] }));
      if (c.payment) f.debts.payments.push(Object.assign({}, c.payment));
      f.debts.updatedAt = c.at;
    } },
    addWish: { file: 'fin', put(f, c) {
      f.wishlists = f.wishlists || { lists: [] };
      let list = f.wishlists.lists.find((l) => l.id === c.listId) || f.wishlists.lists[0];
      if (!list) { list = { id: 'l_other', name: 'Other', items: [] }; f.wishlists.lists.push(list); }
      list.items = list.items || [];
      if (f.wishlists.lists.some((l) => (l.items || []).some((i) => i.id === c.item.id))) return;
      list.items.push(Object.assign({}, c.item, { changeIds: [c.id] }));
      f.wishlists.updatedAt = c.at;
    } },
    // Set money aside for a wishlist item: it's held from then on, so it can't be spent by accident.
    setAside: { file: 'fin', put(f, c) {
      for (const l of ((f.wishlists || {}).lists || [])) for (const i of (l.items || [])) {
        if (i.id !== c.itemId || has(i, c.id)) continue;
        i.saved = Math.round(((+i.saved || 0) + c.amount) * 100) / 100;
        i.setAside = (i.setAside || []).concat({ paycheck: c.paycheck, amount: c.amount, at: c.at });
        stamp(i, c.id);
        f.wishlists.updatedAt = c.at;
      }
    } },
    bought: { file: 'fin', put(f, c) {
      for (const l of ((f.wishlists || {}).lists || [])) for (const i of (l.items || [])) {
        if (i.id !== c.itemId || has(i, c.id)) continue;
        i.bought = c.at.slice(0, 10);
        stamp(i, c.id);
        f.wishlists.updatedAt = c.at;
      }
    } },
    // A store rule from his own answer. Undo switches it off (it stays in the list, so nothing shrinks).
    addRule: { file: 'fin', put(f, c) {
      f.storeRules = f.storeRules || { items: [] };
      if (f.storeRules.items.some((r) => r.id === c.rule.id)) return;
      for (const r of f.storeRules.items) if (!r.undone && r.store.toLowerCase() === c.rule.store.toLowerCase()) r.undone = c.at; // the newest answer wins
      f.storeRules.items.push(Object.assign({}, c.rule, { changeIds: [c.id] }));
      f.storeRules.updatedAt = c.at;
    } },
    undoRule: { file: 'fin', put(f, c) {
      const r = ((f.storeRules || {}).items || []).find((x) => x.id === c.ruleId);
      if (!r || has(r, c.id)) return;
      r.undone = c.at; stamp(r, c.id);
      f.storeRules.updatedAt = c.at;
    } },
    // A note for Claude (Finance's Quick-budget, or Plan's message box).
    addNote: { file: 'notes', put(n, c) {
      n.items = n.items || [];
      if (n.items.some((x) => x.id === c.note.id)) return;
      n.items.push(Object.assign({}, c.note, { status: 'waiting', changeIds: [c.id] }));
      n.updatedAt = c.at;
    } },
    // One line in the hidden change log.
    log: { file: 'log', put(l, c) {
      l.items = l.items || [];
      if (l.items.some((x) => x.id === c.id)) return;
      l.items.push(Object.assign({ id: c.id, at: c.at }, c.entry));
      l.updatedAt = c.at;
    } },
  };

  function apply(file, data, changes) {
    const out = clone(data || (OPTIONAL[file] ? { items: [] } : {}));
    for (const c of changes) if (KINDS[c.type] && KINDS[c.type].file === file) KINDS[c.type].put(out, c);
    return out;
  }
  // How big a file is, for the "never shrink" check: every list's length, added up.
  function size(o) {
    if (Array.isArray(o)) return o.length + o.reduce((s, x) => s + size(x), 0);
    if (o && typeof o === 'object') return Object.keys(o).length + Object.values(o).reduce((s, x) => s + size(x), 0);
    return 0;
  }
  function describe(c) {
    return ({
      fixCharge: 'Fix a charge' + (c.name ? ' ("' + c.name + '")' : ''),
      addDebt: 'Add the debt "' + ((c.item || {}).name || '') + '"',
      addWish: 'Add "' + ((c.item || {}).name || '') + '" to a wishlist',
      setAside: 'Set money aside for a wishlist item',
      bought: 'Mark a wishlist item bought',
      addRule: 'Make a store rule for ' + ((c.rule || {}).store || 'a store'),
      undoRule: 'Undo a store rule',
      addNote: 'Send the note "' + ((c.note || {}).text || '').slice(0, 40) + '"',
    })[c.type] || 'A Finance change';
  }

  let pending = [];
  let saving = false, readOnly = false, era = 0;
  function load() { try { return JSON.parse(localStorage.getItem(WAITING)) || []; } catch (e) { return []; } }
  function keep() { try { localStorage.setItem(WAITING, JSON.stringify(pending)); } catch (e) { /* stays in memory */ } }

  async function save(store) {
    const mine = era;
    if (readOnly) return { saved: false, why: 'readonly' };
    if (saving || !pending.length) return { saved: false, why: saving ? 'busy' : 'nothing' };
    saving = true;
    const files = {};
    try {
      for (const file of ['fin', 'months', 'notes', 'log']) {
        const path = FILES[file];
        let done = false;
        for (let tries = 0; tries < 3 && !done; tries++) {
          const batch = pending.filter((c) => KINDS[c.type] && KINDS[c.type].file === file);
          if (!batch.length) { done = true; break; }
          const { data, version } = await store.readWithVersion(path, !!OPTIONAL[file]);
          if (data == null && !OPTIONAL[file]) return { saved: false, why: 'unsafe', files };
          const next = apply(file, data, batch);
          if (data != null && size(next) < size(data)) return { saved: false, why: 'unsafe', files };
          if (data != null && JSON.stringify(next) === JSON.stringify(data)) {
            pending = pending.filter((c) => !batch.includes(c)); keep(); files[file] = next; done = true; break;
          }
          const ok = await store.writeIfUnchanged(path, next, version, 'New Hub ' + ({ notes: 'notes', log: 'change log' }[file] || 'Finance') + ': ' + batch.length + ' change(s) from the app');
          if (ok) { pending = pending.filter((c) => !batch.includes(c)); keep(); files[file] = next; done = true; }
        }
        if (!done) return { saved: false, why: 'busy-elsewhere', files };
      }
      return { saved: true, files };
    } catch (e) {
      if (e && e.code === 'readonly' && mine === era) readOnly = true;
      return { saved: false, why: (e && e.code) || 'error', error: e, files };
    } finally {
      saving = false;
    }
  }

  const FinSave = {
    FILES, newId, apply, size, describe,
    start() { pending = load(); readOnly = false; era++; return pending.slice(); },
    isReadOnly() { return readOnly; },
    // Every change also queues its line for the change log. who: the app is used by Josh, so app changes say so.
    add(change) {
      const c = Object.assign({ id: newId(), at: new Date().toISOString() }, change);
      pending.push(c);
      if (KINDS[c.type] && c.type !== 'log') pending.push({ type: 'log', id: newId('l'), at: c.at, entry: {
        who: c.who || 'Josh, in the new Hub', what: describe(c), why: c.why || 'Changed by hand on the ' + (c.page || 'Finance') + ' page',
        file: FILES[KINDS[c.type].file], changeId: c.id } });
      keep(); return c;
    },
    list() { return pending.slice(); },
    save,
  };
  if (typeof window !== 'undefined') window.FinSave = FinSave;
  if (typeof module !== 'undefined') module.exports = FinSave;
})();
