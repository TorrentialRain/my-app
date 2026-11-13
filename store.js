// The Store: reads and saves the app's data in the private data box
// (the GitHub repo TorrentialRain/my-app-data).
//
// - The key that opens the data box is typed in once per device and kept
//   inside the Vault (scrambled with the sign-on). It is never in this code.
// - Every file that gets read is also kept on the device, so the app still
//   opens with no signal.
// - Saving checks that nobody else (a robot, the other device) changed the
//   file first. If they did, it grabs the fresh copy and tries again.
//
// Use after sign-in:
//   await Store.read('tasks.json')                      -> data, or undefined if the file is missing
//   await Store.write('tasks.json', (old) => newData)   -> saves what the function returns
(function () {
  const REPO = 'TorrentialRain/my-app-data';
  const BRANCH = 'main';
  const API = (typeof window !== 'undefined' && window.__HUB_API) || 'https://api.github.com';

  const toB64 = (str) => {
    let bin = '';
    new TextEncoder().encode(str).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const fromB64 = (b64) =>
    new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  let online = null; // null = not checked yet, true / false after the last try

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  function key() {
    const box = Vault.get('databox');
    return box && box.key;
  }

  async function call(method, path, body, useKey) {
    const k = useKey || key();
    if (!k) throw fail('nokey', 'The data box is not connected on this device.');
    let res;
    try {
      res = await fetch(`${API}/repos/${REPO}/contents/${path}` + (method === 'GET' ? `?ref=${BRANCH}` : ''), {
        method,
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + k, Accept: 'application/vnd.github+json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      online = false;
      throw fail('offline', 'No connection to the data box right now.');
    }
    online = true;
    if (res.status === 401) throw fail('badkey', 'GitHub did not accept that key. It may be mistyped or expired.');
    if (res.status === 403) throw fail('denied', 'That key is not allowed to do this. It needs Contents set to Read and write.');
    return res;
  }

  // Fetch one file straight from the data box. Returns { data, sha } or null if missing.
  // `asText` hands back the file as plain text instead of reading it as JSON.
  async function fetchFile(path, useKey, asText) {
    const res = await call('GET', path, null, useKey);
    if (res.status === 404) return null;
    if (!res.ok) throw fail('server', 'The data box answered with an error (' + res.status + ').');
    const j = await res.json();
    const text = fromB64(j.content);
    return { data: asText ? text : JSON.parse(text), sha: j.sha };
  }

  // Keep a copy on this device for when there is no signal.
  const fetchedAt = {};
  async function remember(path, file) {
    fetchedAt[path] = Date.now();
    try {
      await Vault.saveItem('file:' + path, file ? { data: file.data, sha: file.sha, at: fetchedAt[path] } : { missing: true, at: fetchedAt[path] });
    } catch (e) { /* a full or blocked device database must never stop the app */ }
  }

  async function readAny(path, asText) {
    try {
      const file = await fetchFile(path, null, asText);
      await remember(path, file);
      return file ? file.data : undefined;
    } catch (e) {
      if (e.code !== 'offline') throw e;
      const kept = await Vault.loadItem('file:' + path).catch(() => undefined);
      if (kept === undefined) throw e;
      fetchedAt[path] = kept.at;
      return kept.missing ? undefined : kept.data;
    }
  }

  const Store = {
    isConnected() { return !!key(); },
    isOnline() { return online; },

    // First-time setup on a device: check the key works, then keep it in the Vault.
    async connect(newKey) {
      newKey = (newKey || '').trim();
      if (!newKey) throw fail('badkey', 'Paste the key first.');
      const file = await fetchFile('meta/app.json', newKey);
      if (!file) throw fail('norepo', 'That key works, but it cannot see the data box. Make sure it was made for my-app-data.');
      await Vault.set('databox', { key: newKey, connectedAt: Date.now() });
      await remember('meta/app.json', file);
      return file.data;
    },

    async disconnect() { await Vault.set('databox', null); },

    // Read a JSON file. With no signal it hands back the copy kept on this device.
    read(path) { return readAny(path, false); },

    // Same, for a plain text file (like the app's pages).
    readText(path) { return readAny(path, true); },

    // When was this file last fetched on this device? (milliseconds, or null)
    lastFetched(path) { return fetchedAt[path] || null; },

    // Save a file. `change` gets the newest data and returns what to save.
    async write(path, change, note) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        const file = await fetchFile(path);
        const data = change(file ? file.data : undefined);
        const res = await call('PUT', path, {
          message: note || 'App: update ' + path,
          content: toB64(JSON.stringify(data, null, 2) + '\n'),
          branch: BRANCH,
          sha: file ? file.sha : undefined,
        });
        if (res.ok) {
          const j = await res.json();
          await remember(path, { data, sha: j.content.sha });
          return data;
        }
        // 409 / 422 = someone else saved first. Go around again with the fresh copy.
        if (res.status !== 409 && res.status !== 422) {
          throw fail('server', 'The data box would not save (' + res.status + ').');
        }
      }
      throw fail('busy', 'The data box kept changing while saving. Try again in a moment.');
    },
  };

  if (typeof window !== 'undefined') window.Store = Store;
  if (typeof module !== 'undefined') module.exports = Store;
})();
