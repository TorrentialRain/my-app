// HubDB: gives the Hub's pages the same "database" they had inside Claude,
// but backed by files in the private data box.
//
// How data is laid out in the data box:
//   a collection is one file          tasks            -> data/tasks.json
//   each document is one entry in it  tasks/abc123     -> { "abc123": { ... } }
//   deeper collections work the same  fin/config/months -> data/fin.config.months.json
//
// Changes show on screen right away, then get sent to the data box. With no
// signal they wait in a queue on this device and go out when it is back.
// Every minute (and when the app comes back to the front) it checks the data
// box for changes made by the robots or the other device.
(function () {
  const fileFor = (coll) => 'data/' + coll.replace(/\//g, '.') + '.json';
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const colls = new Map(); // collection path -> { docs, ready, listeners, pending, sending }
  let timer = null;
  let lastProblem = null;

  function merge(base, patch) {
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.__delete__ === true) { delete base[k]; return; }
        if (!base[k] || typeof base[k] !== 'object' || Array.isArray(base[k])) base[k] = {};
        merge(base[k], v);
      } else {
        base[k] = v;
      }
    });
    return base;
  }

  function applyOp(docs, op) {
    if (op.t === 'set') docs[op.id] = clone(op.data);
    else if (op.t === 'update') docs[op.id] = merge(docs[op.id] || {}, clone(op.data));
    else if (op.t === 'delete') delete docs[op.id];
  }

  function state(coll) {
    if (!colls.has(coll)) colls.set(coll, { docs: {}, ready: null, listeners: new Set(), pending: [], sending: false });
    return colls.get(coll);
  }

  function tell(st) { st.listeners.forEach((fn) => { try { fn(); } catch (e) { /* one page's error must not stop the others */ } }); }
  function announce() { window.dispatchEvent(new Event('hubdb')); }

  async function savePending() {
    const all = {};
    colls.forEach((st, coll) => { if (st.pending.length) all[coll] = st.pending; });
    try { await Vault.saveItem('pending', all); } catch (e) { /* keep going */ }
  }

  // Get the newest copy of a collection, then put any not-yet-sent changes back on top.
  async function load(coll) {
    const st = state(coll);
    const fresh = (await Store.read(fileFor(coll))) || {};
    st.pending.forEach((op) => applyOp(fresh, op));
    const changed = JSON.stringify(fresh) !== JSON.stringify(st.docs);
    st.docs = fresh;
    if (changed) tell(st);
  }

  function ready(coll) {
    const st = state(coll);
    if (!st.ready) st.ready = load(coll).catch((e) => { st.ready = null; throw e; });
    return st.ready;
  }

  // Send waiting changes for one collection to the data box.
  async function send(coll) {
    const st = state(coll);
    if (st.sending || !st.pending.length) return;
    st.sending = true;
    try {
      while (st.pending.length) {
        const batch = st.pending.slice();
        await Store.write(fileFor(coll), (old) => {
          const docs = old || {};
          batch.forEach((op) => applyOp(docs, op));
          return docs;
        }, 'App: update ' + coll);
        st.pending.splice(0, batch.length);
        await savePending();
      }
      lastProblem = null;
    } catch (e) {
      lastProblem = e.code === 'offline' ? null : e.message;
    } finally {
      st.sending = false;
      announce();
    }
  }

  function write(coll, op) {
    const st = state(coll);
    applyOp(st.docs, op);
    st.pending.push(op);
    tell(st);
    announce();
    savePending();
    send(coll);
    return Promise.resolve();
  }

  async function checkAll() {
    for (const [coll, st] of colls) {
      await send(coll);
      if (st.ready) { try { await load(coll); } catch (e) { /* offline: keep what we have */ } }
    }
    announce();
  }

  const docSnap = (id, data) => ({ id, exists: data !== undefined, data: () => clone(data) });
  const collSnap = (st) => {
    const docs = Object.keys(st.docs).map((id) => docSnap(id, st.docs[id]));
    return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
  };

  function listen(coll, makeSnap, cb, onErr) {
    const st = state(coll);
    const fn = () => cb(makeSnap(st));
    ready(coll).then(() => { st.listeners.add(fn); fn(); }, (e) => { if (onErr) onErr(e); });
    return () => st.listeners.delete(fn);
  }

  function docRef(path) {
    const parts = path.split('/');
    const id = parts.pop();
    const coll = parts.join('/');
    return {
      id,
      path,
      async get() { await ready(coll); return docSnap(id, state(coll).docs[id]); },
      set(data, opts) { return write(coll, { t: opts && opts.merge ? 'update' : 'set', id, data: clone(data) }); },
      update(data) { return write(coll, { t: 'update', id, data: clone(data) }); },
      delete() { return write(coll, { t: 'delete', id }); },
      onSnapshot(cb, onErr) { return listen(coll, (st) => docSnap(id, st.docs[id]), cb, onErr); },
      collection(name) { return collRef(path + '/' + name); },
    };
  }

  function newId() {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => abc[b % abc.length]).join('');
  }

  function collRef(path) {
    return {
      path,
      doc(id) { return docRef(path + '/' + (id || newId())); },
      async add(data) { const ref = docRef(path + '/' + newId()); await ref.set(data); return ref; },
      async get() { await ready(path); return collSnap(state(path)); },
      onSnapshot(cb, onErr) { return listen(path, collSnap, cb, onErr); },
    };
  }

  const db = { doc: docRef, collection: collRef };

  const HubDB = {
    db,
    // Call once after sign-in: bring back changes that were still waiting to be sent.
    async start() {
      const waiting = (await Vault.loadItem('pending').catch(() => undefined)) || {};
      Object.keys(waiting).forEach((coll) => { state(coll).pending = waiting[coll]; });
      if (!timer) {
        timer = setInterval(() => { if (!document.hidden) checkAll(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAll(); });
        window.addEventListener('online', checkAll);
      }
      colls.forEach((st, coll) => send(coll));
    },
    // Forget everything held in memory (used when the app locks).
    stop() { colls.clear(); },
    checkNow: checkAll,
    waiting() { let n = 0; colls.forEach((st) => { n += st.pending.length; }); return n; },
    problem() { return lastProblem; },
    // Gather everything in the data box into one object (used by "Back up now").
    // Same shape as a Hub export, so a backup can be put back with Import.
    async exportAll() {
      const names = ['tasks', 'board', 'suggestions', 'memory', 'courses', 'rules', 'meta', 'brief', 'fin', 'fin/config/months', 'calendar', 'requests'];
      const docs = {};
      for (const coll of names) {
        const file = (await Store.read(fileFor(coll))) || {};
        Object.keys(file).forEach((id) => { docs[coll + '/' + id] = file[id]; });
      }
      return { kind: 'hub-export', source: 'app-backup', exportedAt: new Date().toISOString(), docs };
    },

    // Replace whole collections at once (used by Import).
    async importAll(flatDocs, onStep) {
      const groups = {};
      Object.keys(flatDocs).forEach((path) => {
        const parts = path.split('/');
        const id = parts.pop();
        const coll = parts.join('/');
        (groups[coll] = groups[coll] || {})[id] = flatDocs[path];
      });
      const names = Object.keys(groups);
      for (let i = 0; i < names.length; i++) {
        if (onStep) onStep(names[i], i + 1, names.length);
        await Store.write(fileFor(names[i]), () => groups[names[i]], 'App: import ' + names[i] + ' from the Hub');
      }
      colls.forEach((st) => { st.pending = []; st.ready = null; });
      await savePending();
      await checkAll();
      for (const coll of names) { if (colls.has(coll)) { try { await load(coll); } catch (e) { /* shown next check */ } } }
      return names.length;
    },
  };

  // ---- Calendar stand-in ----
  // Inside Claude the Plan tab read Google Calendar live. Here a robot copies the
  // events into the data box (collection "calendar", one entry per calendar) and
  // the Plan tab reads them from there.
  function calendarResult(input) {
    const entry = state('calendar').docs[input.calendarId];
    const all = entry && Array.isArray(entry.events) ? entry.events : [];
    const from = String(input.startTime || '').slice(0, 10);
    const to = String(input.endTime || '').slice(0, 10);
    const dayOf = (t) => (t && (t.date || String(t.dateTime || '').slice(0, 10))) || '';
    const events = all.filter((e) => {
      const first = dayOf(e.start);
      const last = dayOf(e.end) || first;
      return (!to || first < to) && (!from || last >= from);
    });
    const at = entry && entry.fetchedAt ? Date.parse(entry.fetchedAt) : 0;
    return { payload: { events: clone(events) }, cache: { storedAt: at || Date.now() } };
  }

  const mcp = {
    async callTool(server, tool, input) {
      if (tool === 'list_events') { await ready('calendar'); return calendarResult(input || {}); }
      const e = new Error('Calendar changes go through the robot, not this app.');
      e.code = 'unavailable';
      throw e;
    },
    watchTool(server, tool, input, cb) {
      if (tool !== 'list_events') return () => {};
      return listen('calendar', () => null, () => cb({ type: 'data', result: calendarResult(input || {}) }),
        () => cb({ type: 'error', error: { code: 'server_unavailable' } }));
    },
    async invalidate() { await checkAll(); },
  };

  // ---- Requests: things the app asks the robot to do at the next sync ----
  // (Inside Claude, "Add an event" asked Claude on the spot. Here the note waits.)
  const requests = {
    async add(req) {
      const ref = collRef('requests').doc();
      await ref.set(Object.assign({ status: 'waiting', at: new Date().toISOString() }, clone(req)));
      return ref.id;
    },
    async cancel(id) { await docRef('requests/' + id).update({ status: 'cancelled', cancelledAt: new Date().toISOString() }); },
  };

  // What the Hub's pages ask for. The pages already know how to cope when a
  // piece is missing (asking for anything else gets "not available").
  const kit = { db, mcp, requests };
  const AppClaude = { use: async (name) => kit[name] || null };

  window.HubDB = HubDB;
  window.AppClaude = AppClaude;
})();
