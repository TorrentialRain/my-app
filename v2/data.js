// Data for the new Hub: reading, and (for TO-DO) saving.
//
// Saving only ever goes through writeIfUnchanged: it writes a file only if nobody changed it since
// this phone read it. If someone did (the robot, the old app, another phone), GitHub says no and the
// TO-DO page reads the newest copy and puts its changes in again. So a save can't wipe out anyone else's.
//
// Where the key comes from, in this order:
//   1. The key locked on this phone (lock.js), opened with Face ID (Josh's pick, Nov 26).
//   2. A key saved as plain text by an older version of the new Hub: used, then locked and the plain copy removed.
//   3. The key the old app already saved, if this phone's storage has it and "Stay signed in" is on.
//      It is read in memory, then locked for the new Hub, so the new Hub stops needing the old app.
//   4. None: the app shows its Connect screen.
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
  let cantLock = false;
  const READONLY = 'This key can only read, so it can\'t save. On GitHub, its Contents permission for my-app-data has to be "Read and write".';
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

  // Text <-> the base64 GitHub sends, keeping letters like é and emoji intact.
  const toB64 = (text) => { const bytes = new TextEncoder().encode(text); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  // GitHub said no to a save. Only "this key isn't allowed to write" means the key can only read;
  // anything else (too many tries, GitHub trouble) says what GitHub said, so it's never mistaken for a key problem.
  async function refusal(res) {
    let said = '';
    try { said = String((await res.json()).message || ''); } catch (e) { /* no words */ }
    if (res.status === 404 || /not accessible|permission|must have push|write access/i.test(said)) {
      const e = fail('readonly', READONLY); e.said = said; return e;
    }
    return fail('server', 'GitHub turned the save down (' + res.status + (said ? ': ' + said : '') + ').');
  }

  // Two writers spell the same text two ways: the robot writes letters like ’ as \u2019 and leaves no blank line at
  // the end; the old app writes ’ as-is and ends with a blank line. A save keeps whichever way the file is written now,
  // so it changes only what changed, and the writers never rewrite each other's spelling.
  const styleOf = (text) => ({ codes: /\\u[0-9a-fA-F]{4}/.test(text) || !/[^\x00-\x7f]/.test(text), endLine: /\n$/.test(text) });
  const asFileText = (data, style) => {
    const st = style || { codes: true, endLine: false };
    let t = JSON.stringify(data, null, 2);
    if (st.codes) t = t.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    return st.endLine ? t + '\n' : t;
  };
  const styles = {}; // path -> how that file was written when last read

  async function call(method, path, body) {
    if (!key) throw fail('nokey', 'No data box key on this phone yet.');
    try {
      return await fetch(`${API}/repos/${REPO}/contents/${path}` + (method === 'GET' ? `?ref=${BRANCH}` : ''), {
        method,
        cache: 'no-store',
        headers: Object.assign({ Authorization: 'Bearer ' + key, Accept: 'application/vnd.github+json' }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw fail('offline', "Can't reach your data right now.");
    }
  }

  const Data = {
    // Find a key. Returns true if one was found.
    async start() {
      if (window.KeyLock && KeyLock.has()) { key = null; keySource = 'locked'; return 'locked'; }
      key = ownKey();
      if (key) { keySource = 'own'; return true; }
      key = await oldAppKey();
      if (key) { keySource = 'old-app'; return true; }
      keySource = null;
      return false;
    },
    source() { return keySource; },
    // Open the locked key (Face ID). Throws 'needtap' if Face ID needs a tap or was cancelled.
    async unlock() {
      key = await KeyLock.unlock();
      keySource = 'own';
      return true;
    },
    // Windows Hello refused this PC's passkey: set Windows Hello up again (PIN or face) and open the Hub.
    async redoLock() {
      key = await KeyLock.redo();
      keySource = 'own';
      return true;
    },
    // Is the key in use here not locked yet?
    needsLock() { return !!key && !!window.KeyLock && !KeyLock.has() && !cantLock; },
    // This browser can't keep a locked key at all: the key is used for this visit only and never saved.
    cantLock() { return cantLock; },
    // Lock the key in use and remove any plain copy. Throws 'needtap' when the phone wants a tap first.
    async lockNow() {
      if (!key || !window.KeyLock) return null;
      let mode;
      try { mode = await KeyLock.lock(key); } catch (e) {
        if (e.code !== 'nostore') throw e;
        cantLock = true; // never kept as plain text: this visit only
        mode = 'memory';
      }
      try { localStorage.removeItem(OWN_KEY); } catch (e) { /* nothing plain kept */ }
      keySource = 'own';
      return mode;
    },
    // The key's last 4 letters, so Josh can tell which key a phone or computer is using.
    keyEnd() { return key ? String(key).slice(-4) : ''; },

    // From the Connect screen: check the key can read the data box, then keep it on this phone.
    async connect(newKey) {
      newKey = (newKey || '').trim();
      if (!newKey) throw fail('badkey', 'Paste the key first.');
      await get('meta/app.json', newKey);
      // Never saved as plain text: the new key replaces any locked one and is locked straight away.
      // If the phone wants a tap for Face ID first, it stays in memory until the lock screen's button.
      try { localStorage.removeItem(OWN_KEY); } catch (e) { /* nothing plain kept */ }
      if (window.KeyLock) await KeyLock.clear();
      key = newKey;
      keySource = 'own';
      try { await this.lockNow(); } catch (e) { if (e.code !== 'needtap') throw e; }
    },

    // A saved key stopped working: forget it so the Connect screen can take a new one.
    forgetOwnKey() {
      try { localStorage.removeItem(OWN_KEY); } catch (e) { /* nothing saved */ }
      if (window.KeyLock) KeyLock.clear();
      if (keySource === 'own' || keySource === 'locked') { key = null; keySource = null; }
    },

    read(path) { return get(path); },

    // A file that may not exist yet (the notes file and the change log are made on first use): null if missing.
    // Only for those files, and only once the main files read fine, so a missing file never looks like a bad key.
    async readOptional(path) {
      const res = await call('GET', path);
      if (res.status === 404) return null;
      if (res.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
      if (!res.ok) throw fail('server', 'GitHub answered with an error (' + res.status + ').');
      const j = await res.json();
      return JSON.parse(fromB64(j.content));
    },

    // The newest copy of a file, with its version, for saving. optional: a missing file comes back empty, to be made.
    async readWithVersion(path, optional) {
      const res = await call('GET', path);
      if (optional && res.status === 404) return { data: null, version: null };
      if (res.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
      if (!res.ok) throw fail('server', 'GitHub answered with an error (' + res.status + ').');
      const j = await res.json();
      const text = fromB64(j.content);
      styles[path] = styleOf(text);
      return { data: JSON.parse(text), version: j.sha };
    },

    // Can this key save? Asked without changing anything: it offers GitHub the file's own words back,
    // marked as an old version on purpose, so GitHub always turns the write down. How it turns it down
    // tells us: "that's not the newest version" = this key may save; "not allowed" = it can only read.
    asFileText,
    styleOf,
    async canSave() {
      const res = await call('GET', 'data/tasks.json');
      if (res.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
      if (!res.ok) throw fail('server', 'GitHub answered with an error (' + res.status + ').');
      const j = await res.json();
      const put = await call('PUT', 'data/tasks.json', {
        message: 'New Hub: can this key save? (never saved)',
        content: String(j.content).replace(/\s/g, ''),
        branch: BRANCH,
        sha: '0000000000000000000000000000000000000000',
      });
      if (put.status === 409 || put.status === 422) return true;
      if (put.status === 403 || put.status === 404) { const e = await refusal(put); if (e.code === 'readonly') return false; throw e; }
      if (put.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
      throw fail('server', 'GitHub answered with an error (' + put.status + ').');
    },

    // Write a file only if it is still the version read. Returns false if someone changed it since.
    // Written the same way the old app writes, so the two never fight over spacing.
    async writeIfUnchanged(path, data, version, note) {
      const res = await call('PUT', path, {
        message: note || 'New Hub: update ' + path,
        content: toB64(asFileText(data, styles[path])),
        branch: BRANCH,
        ...(version ? { sha: version } : {}), // no version: a new file, made only if it still doesn't exist
      });
      if (res.ok) return true;
      if (res.status === 409 || res.status === 422) return false;
      if (res.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
      if (res.status === 403 || res.status === 404) throw await refusal(res);
      throw fail('server', 'GitHub answered with an error (' + res.status + ').');
    },
  };

  // Small summaries, one per page. Kept apart from the reading so they can be tested on their own.
  const Summary = {
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
  if (typeof module !== 'undefined') module.exports = { Summary, asFileText, styleOf };
})();
