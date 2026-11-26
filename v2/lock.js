// The data key's lock (Josh's pick, Nov 26: "Face ID"). The key is never kept on the phone as plain text.
//
// How it's locked, best first:
//   'faceid' - Face ID itself opens it: a passkey saved for the Hub gives back a secret only after Face ID,
//              and the key is sealed with that secret. Without his face the sealed key is just noise.
//   'gate'   - this phone can do Face ID but not that secret yet: the key is sealed with a lock kept inside
//              this phone's storage that can't be copied out, and the Hub asks for Face ID before opening it.
//              The next unlock that gets the secret moves it up to 'faceid' by itself.
//   'device' - no Face ID or fingerprint here (like the phone check, or a computer without one): sealed the
//              same way as 'gate', opened with no question. Still never plain text.
// Passkeys are how a home-screen web app uses Face ID; the passkey stays in his iPhone's keychain.
(function () {
  const BOX = 'hub2.lock.v1';
  const DB = 'hub2-lock';
  const INFO = 'Josh\'s Hub data key';

  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  function fail(code, message) { const e = new Error(message); e.code = code; return e; }

  function readBox() { try { return JSON.parse(localStorage.getItem(BOX)) || null; } catch (e) { return null; } }
  function writeBox(box) { localStorage.setItem(BOX, JSON.stringify(box)); }

  // A lock kept in this phone's storage that can't be copied out (the old app's way, kept for 'gate' and 'device').
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(fail('nostore', 'This browser can\'t keep a lock.')); return; }
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('k'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        let tx, req;
        try {
          tx = db.transaction('k', mode);
          req = fn(tx.objectStore('k'));
        } catch (e) {
          // Some browsers can't keep a lock in storage at all (it throws right away): say so, never hang.
          db.close(); reject(fail('nostore', 'This browser can\'t keep a lock.')); return;
        }
        tx.oncomplete = () => { db.close(); resolve(req && req.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(fail('nostore', 'This browser can\'t keep a lock.')); };
      };
    });
  }
  const phoneLock = () => idb('readonly', (s) => s.get('key'));
  async function newPhoneLock() {
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb('readwrite', (s) => s.put(k, 'key'));
    return k;
  }
  const dropPhoneLock = () => idb('readwrite', (s) => s.delete('key')).catch(() => {});

  // The secret the passkey gives back after Face ID, turned into a lock.
  async function faceLock(secret) {
    const raw = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(INFO) },
      raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(lock, text) {
    const iv = rand(12);
    const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, lock, new TextEncoder().encode(text));
    return { iv: b64(iv), box: b64(box) };
  }
  async function open(lock, sealed) {
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, lock, unb64(sealed.box));
      return new TextDecoder().decode(plain);
    } catch (e) { throw fail('broken', 'The locked key couldn\'t be opened on this phone.'); }
  }

  async function canFaceId() {
    try {
      return !!(window.PublicKeyCredential && navigator.credentials && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { return false; }
  }
  const secretOf = (cred) => {
    const r = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    return r && r.prf && r.prf.results && r.prf.results.first ? new Uint8Array(r.prf.results.first) : null;
  };
  // Face ID. A "no" (he looked away, tapped Cancel, or the phone wants a tap first) comes back as 'needtap'.
  async function askFace(box) {
    try {
      return await navigator.credentials.get({ publicKey: {
        challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
        allowCredentials: [{ type: 'public-key', id: unb64(box.cred) }],
        extensions: { prf: { eval: { first: unb64(box.salt) } } } } });
    } catch (e) {
      throw fail(e && e.name === 'NotAllowedError' ? 'needtap' : 'noface', 'Face ID didn\'t open the Hub.');
    }
  }

  const KeyLock = {
    has() { const b = readBox(); return !!(b && b.box && b.iv); },
    mode() { const b = readBox(); return (b && b.mode) || null; },

    // Lock a key. Needs a tap on the phone (making a passkey asks for Face ID).
    async lock(key) {
      if (!(await canFaceId())) {
        const sealed = await seal(await newPhoneLock(), key);
        writeBox(Object.assign({ mode: 'device', at: new Date().toISOString() }, sealed));
        return 'device';
      }
      const salt = rand(32);
      let cred;
      try {
        cred = await navigator.credentials.create({ publicKey: {
          challenge: rand(32), rp: { name: 'Josh\'s Hub', id: location.hostname },
          user: { id: rand(16), name: 'Josh\'s Hub', displayName: 'Josh\'s Hub' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
          timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
      } catch (e) {
        if (e && e.name === 'NotAllowedError') throw fail('needtap', 'Face ID wasn\'t set up for the Hub.');
        // Face ID can't make a passkey here at all: lock it inside the phone instead, so it's still never plain text.
        const sealed = await seal(await newPhoneLock(), key);
        writeBox(Object.assign({ mode: 'device', at: new Date().toISOString() }, sealed));
        return 'device';
      }
      const base = { cred: b64(cred.rawId), salt: b64(salt), at: new Date().toISOString() };
      let secret = secretOf(cred);
      if (!secret) {
        // Some phones only give the secret on the first Face ID after the passkey is made.
        try { secret = secretOf(await askFace(base)); } catch (e) { secret = null; }
      }
      if (secret) {
        writeBox(Object.assign({ mode: 'faceid' }, base, await seal(await faceLock(secret), key)));
        await dropPhoneLock();
        return 'faceid';
      }
      writeBox(Object.assign({ mode: 'gate' }, base, await seal(await newPhoneLock(), key)));
      return 'gate';
    },

    // Open the locked key. Face ID first, unless this device has none.
    async unlock() {
      const box = readBox();
      if (!box) throw fail('nolock', 'No locked key on this phone.');
      if (box.mode === 'device') {
        const lock = await phoneLock();
        if (!lock) throw fail('broken', 'The locked key couldn\'t be opened on this phone.');
        return open(lock, box);
      }
      const cred = await askFace(box);
      const secret = secretOf(cred);
      if (box.mode === 'faceid') {
        if (!secret) throw fail('broken', 'Face ID worked, but the passkey didn\'t give back what opens the key.');
        return open(await faceLock(secret), box);
      }
      // 'gate': Face ID said yes. If the secret came back this time, move up to 'faceid'.
      const lock = await phoneLock();
      if (!lock) throw fail('broken', 'The locked key couldn\'t be opened on this phone.');
      const key = await open(lock, box);
      if (secret) {
        try {
          writeBox(Object.assign({}, box, { mode: 'faceid' }, await seal(await faceLock(secret), key)));
          await dropPhoneLock();
        } catch (e) { /* stays as it was; works either way */ }
      }
      return key;
    },

    // A new key replaces the old one, or the lock is broken: throw the locked copy away.
    async clear() {
      try { localStorage.removeItem(BOX); } catch (e) { /* nothing kept */ }
      await dropPhoneLock();
    },
  };

  if (typeof window !== 'undefined') window.KeyLock = KeyLock;
})();
