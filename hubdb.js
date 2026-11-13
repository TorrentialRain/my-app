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
    // Replace whole collections at once (used by "Import from Hub").
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

  // What the Hub's pages ask for. Only the database exists outside Claude;
  // the pages already know how to cope when the other pieces are missing.
  const AppClaude = { use: async (name) => (name === 'db' ? db : null) };

  window.HubDB = HubDB;
  window.AppClaude = AppClaude;
})();
