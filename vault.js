// The Vault: everything the app saves goes through here.
//
// How it works:
// - Your username + password are turned into a secret key (never saved anywhere).
// - All app data is scrambled with that key and kept in this device's storage.
// - No password, hash, or personal data ever lives in the code on GitHub.
//
// Use from other files after sign-in:
//   Vault.get('tasks')            -> saved value (or undefined)
//   await Vault.set('tasks', [..]) -> saves it, scrambled
(function () {
  const STORE_KEY = 'hub.vault.v1';
  const ROUNDS = 310000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  let key = null;   // secret key, memory only
  let data = null;  // unscrambled app data, memory only

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function makeKey(username, password, salt) {
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(username + '\n' + password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function save() {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
    stored.iv = toB64(iv);
    stored.box = toB64(box);
    localStorage.setItem(STORE_KEY, JSON.stringify(stored));
  }

  // Tiny helper around the browser's built-in database (IndexedDB).
  function idb(mode, work) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('hub-items', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('items');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('items', mode);
        const req = work(tx.objectStore('items'));
        tx.oncomplete = () => { open.result.close(); resolve(req ? req.result : undefined); };
        tx.onerror = () => { open.result.close(); reject(tx.error); };
      };
    });
  }

  const Vault = {
    // Has a sign-on been set up on this device yet?
    exists() { return localStorage.getItem(STORE_KEY) !== null; },
    isOpen() { return key !== null; },

    // First time on this device: make the sign-on.
    async create(username, password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await makeKey(username, password, salt);
      data = {};
      localStorage.setItem(STORE_KEY, JSON.stringify({ salt: toB64(salt) }));
      await save();
    },

    // Every time after: returns true if the username + password are right.
    async open(username, password) {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY));
      const tryKey = await makeKey(username, password, fromB64(stored.salt));
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromB64(stored.iv) }, tryKey, fromB64(stored.box)
        );
        key = tryKey;
        data = JSON.parse(dec.decode(plain));
        return true;
      } catch (e) {
        return false;
      }
    },

    lock() { key = null; data = null; },

    // Bigger things (copies of data box files) are kept one by one in the
    // browser's database, each scrambled with the same key.
    async saveItem(name, value) {
      if (!key) throw new Error('Vault is locked');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
      await idb('readwrite', (st) => st.put({ iv, box }, name));
    },

    async loadItem(name) {
      if (!key) throw new Error('Vault is locked');
      const rec = await idb('readonly', (st) => st.get(name));
      if (!rec) return undefined;
      try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.box);
        return JSON.parse(dec.decode(plain));
      } catch (e) {
        return undefined;
      }
    },

    async removeItem(name) { await idb('readwrite', (st) => st.delete(name)); },

    get(name) { return data ? data[name] : undefined; },

    async set(name, value) {
      if (!key) throw new Error('Vault is locked');
      data[name] = value;
      await save();
    },
  };

  if (typeof window !== 'undefined') window.Vault = Vault;
  if (typeof module !== 'undefined') module.exports = Vault;
})();
