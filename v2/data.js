// Data for the new Hub. READ-ONLY in this phase: there is no save function here at all,
// so nothing in the new app can change the data box by mistake.
//
// Where the key comes from, in this order:
//   1. A key saved for the new Hub on this phone (from its Connect screen).
//   2. The key the old app already saved, if this phone's storage has it and "Stay signed in" is on.
//      It is only used in memory, never copied.
//   3. Neither: the app shows its Connect screen.
(function () {
  const REPO = 'TorrentialRain/my-app-data';
  const BRANCH = 'main';
  const API = 'https://api.github.com';
  const OWN_KEY = 'hub2.databoxKey';

  function fail(code, message) { const e = new Error(message); e.code = code; return e; }

  function ownKey() {
    try { return localStorage.getItem(OWN_KEY) || null; } catch (e) { return null; }
  }

  // Read the old app's key without changing anything the old app keeps.
  async function oldAppKey() {
    let stored;
    try {
      if (localStorage.getItem('hub.vault.remember') !== '1') return null;
      stored = JSON.parse(localStorage.getItem('hub.vault.v1'));
    } catch (e) { return null; }
    if (!stored || !stored.iv || !stored.box || !window.indexedDB || !crypto.subtle) return null;
    const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    try {
      const cryptoKey = await new Promise((resolve, reject) => {
        const open = indexedDB.open('hub-remember');
        // If the old app's little database isn't here, stop without creating one.
        open.onupgradeneeded = () => { open.transaction.abort(); };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('k')) { db.close(); resolve(null); return; }
          const req = db.transaction('k', 'readonly').objectStore('k').get('key');
          req.onsuccess = () => { db.close(); resolve(req.result || null); };
          req.onerror = () => { db.close(); reject(req.error); };
        };
      });
      if (!cryptoKey) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(stored.iv) }, cryptoKey, fromB64(stored.box));
      const box = JSON.parse(new TextDecoder().decode(plain)).databox;
      return (box && box.key) || null;
    } catch (e) {
      return null;
    }
  }

  let key = null;
  let keySource = null;

  async function get(path, withKey) {
    const k = withKey || key;
    if (!k) throw fail('nokey', 'No data box key on this phone yet.');
    let res;
    try {
      res = await fetch(`${API}/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + k, Accept: 'application/vnd.github.raw+json' },
      });
    } catch (e) {
      throw fail('offline', "Can't reach your data right now.");
    }
    if (res.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
    if (res.status === 403 || res.status === 404) throw fail('noaccess', "That key can't see the data box. It needs to be made for my-app-data.");
    if (!res.ok) throw fail('server', 'GitHub answered with an error (' + res.status + ').');
    return res.json();
  }

  const Data = {
    // Find a key. Returns true if one was found.
    async start() {
      key = ownKey();
      if (key) { keySource = 'own'; return true; }
      key = await oldAppKey();
      if (key) { keySource = 'old-app'; return true; }
      keySource = null;
      return false;
    },
    source() { return keySource; },

    // From the Connect screen: check the key can read the data box, then keep it on this phone.
    async connect(newKey) {
      newKey = (newKey || '').trim();
      if (!newKey) throw fail('badkey', 'Paste the key first.');
      await get('meta/app.json', newKey);
      try { localStorage.setItem(OWN_KEY, newKey); } catch (e) { /* this visit only */ }
      key = newKey;
      keySource = 'own';
    },

    // A saved key stopped working: forget it so the Connect screen can take a new one.
    forgetOwnKey() {
      try { localStorage.removeItem(OWN_KEY); } catch (e) { /* nothing saved */ }
      if (keySource === 'own') { key = null; keySource = null; }
    },

    read(path) { return get(path); },
  };

  // Small summaries, one per page. Kept apart from the reading so they can be tested on their own.
  const Summary = {
    todo(tasks) {
      const n = Object.values(tasks || {}).filter((t) => t && t.status === 'open').length;
      return n === 1 ? '1 open task' : n + ' open tasks';
    },
    finance(fin) {
      const items = (fin && fin.debts && fin.debts.items) || [];
      const owed = items.filter((d) => Number(d.owed) > 0).length;
      if (!items.length) return 'No debts on file';
      if (!owed) return 'No debts owed right now (' + items.length + ' on file)';
      return owed === 1 ? '1 debt still owed' : owed + ' debts still owed';
    },
    plan(calendar) {
      const n = Object.keys(calendar || {}).length;
      return n === 1 ? '1 calendar found' : n + ' calendars found';
    },
  };

  if (typeof window !== 'undefined') { window.Data = Data; window.Summary = Summary; }
  if (typeof module !== 'undefined') module.exports = { Summary };
})();
