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

  // The remembered key lives in its own little database, apart from the app's saved files.
  const REMEMBER = 'hub.vault.remember';
  function kdb(mode, work) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('hub-remember', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('k');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('k', mode);
        const req = work(tx.objectStore('k'));
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

    // Change password: check the current one, then re-scramble everything (the saved app data
    // and every item in the browser's database) under a key made from the new one.
    // Returns false if the current username + password are wrong.
    async changePassword(username, oldPassword, newPassword) {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY));
      const oldKey = await makeKey(username, oldPassword, fromB64(stored.salt));
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(stored.iv) }, oldKey, fromB64(stored.box));
      } catch (e) {
        return false;
      }
      // Unscramble every item first, so nothing is half-changed if one can't be read.
      const names = await idb('readonly', (st) => st.getAllKeys());
      const items = {};
      for (const name of names || []) {
        const rec = await idb('readonly', (st) => st.get(name));
        try {
          const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, oldKey, rec.box);
          items[name] = JSON.parse(dec.decode(p));
        } catch (e) { /* unreadable leftover: skip it */ }
      }
      // Build the new saved copy completely before swapping it in, in one step.
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const newKey = await makeKey(username, newPassword, salt);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, newKey, plain);
      localStorage.setItem(STORE_KEY, JSON.stringify({ salt: toB64(salt), iv: toB64(iv), box: toB64(box) }));
      key = newKey;
      data = JSON.parse(dec.decode(plain));
      for (const name of Object.keys(items)) await this.saveItem(name, items[name]);
      // "Stay signed in" / Face ID keep the key itself, so swap in the new one.
      if (localStorage.getItem(REMEMBER) === '1') await this.remember();
      return true;
    },

    // "Stay signed in": the secret key itself (not the password) is kept on this device in the
    // browser's database, so the app can open again without the password. The key can't be read
    // out of the browser, only used. forget() throws it away (Lock app does this).
    hasRemembered() { return localStorage.getItem(REMEMBER) === '1' && this.exists(); },
    async remember() {
      if (!key) throw new Error('Vault is locked');
      await kdb('readwrite', (st) => st.put(key, 'key'));
      localStorage.setItem(REMEMBER, '1');
    },
    async forget() {
      localStorage.removeItem(REMEMBER);
      try { await kdb('readwrite', (st) => st.delete('key')); } catch (e) { /* nothing saved */ }
    },
    async openRemembered() {
      try {
        const k = await kdb('readonly', (st) => st.get('key'));
        if (!k) return false;
        const stored = JSON.parse(localStorage.getItem(STORE_KEY));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(stored.iv) }, k, fromB64(stored.box));
        key = k;
        data = JSON.parse(dec.decode(plain));
        return true;
      } catch (e) {
        return false;
      }
    },

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
