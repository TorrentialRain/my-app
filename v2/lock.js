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
// Passkeys are how a home-screen web app uses Face ID; the passkey stays in his iPhone's keychain. On a PC the
// same passkey is made with Windows Hello (his PC PIN or face).
//
// Found Nov 26 (his PC, the right PIN still failed): Windows Hello can't give back the secret, so the PC was locked
// the 'gate' way, but every unlock still asked for the secret, hoping to move up to 'faceid'. Windows fails the whole
// sign-in when asked for something it can't do, so even the right PIN failed, every time. Fixes built in:
//   - the secret is only asked for where the passkey said it can give one; 'gate' never asks for it;
//   - each device keeps one Hub passkey and uses it again when a key is locked again, so passkeys never pile up;
//   - a failed unlock keeps the browser's own reason, so the lock screen can say what really went wrong;
//   - two failed unlocks in a row mark this device's passkey as one that can't give the secret, so the next lock
//     here uses the 'gate' way, which needs no secret.
//
// Found Nov 27 (his PC still failed after the right PIN): that fix only stopped asking for the secret in the 'gate'
// way. A PC could still be set up the 'faceid' way, because Windows says "yes, I can give the secret" when the passkey
// is made, and then every unlock asked Windows for it and Windows failed the whole sign-in. And when Windows refused
// a passkey, the only way out was pasting the key. Fixes built in:
//   - on a Windows PC the secret is never asked for at all (not when the passkey is made, not on unlock): a PC is
//     always locked the 'gate' way, whatever Windows says it can do. The iPhone is unchanged.
//   - a PC with an older 'faceid' lock isn't asked something Windows can't do: it says so and asks for the key once,
//     and the new lock is the 'gate' way;
//   - when Windows Hello refuses this PC's passkey, "Set up Windows Hello again" makes a new one (that needs his PIN
//     or face too, so it's just as safe) and opens the Hub, with no key to paste.
(function () {
  const BOX = 'hub2.lock.v1';
  const CRED = 'hub2.lock.cred'; // this device's own Hub passkey; kept when a key is replaced, so it's used again
  const FAILS = 'hub2.lock.fails';
  const DB = 'hub2-lock';
  const INFO = 'Josh\'s Hub data key';
  // A Windows PC: Windows Hello is only ever used as a yes/no, never asked for the secret.
  const WIN = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent || '');

  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  function fail(code, message) { const e = new Error(message); e.code = code; return e; }

  function readBox() { try { return JSON.parse(localStorage.getItem(BOX)) || null; } catch (e) { return null; } }
  function writeBox(box) { localStorage.setItem(BOX, JSON.stringify(box)); }
  function readCred() { try { return JSON.parse(localStorage.getItem(CRED)) || null; } catch (e) { return null; } }
  function writeCred(c) { try { localStorage.setItem(CRED, JSON.stringify(c)); } catch (e) { /* only a convenience */ } }
  function fails() { try { return +localStorage.getItem(FAILS) || 0; } catch (e) { return 0; } }
  function setFails(n) { try { if (n) localStorage.setItem(FAILS, String(n)); else localStorage.removeItem(FAILS); } catch (e) { /* only a convenience */ } }

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
  // Did the passkey say it can give the secret at all? (Windows Hello says no; an iPhone says yes.)
  const prfOf = (cred) => {
    const r = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    return !!(r && r.prf && r.prf.enabled);
  };
  const secretOf = (cred) => {
    const r = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    return r && r.prf && r.prf.results && r.prf.results.first ? new Uint8Array(r.prf.results.first) : null;
  };
  // Face ID (or Windows Hello). A "no" (he looked away, tapped Cancel, or the phone wants a tap first) comes back as
  // 'needtap'. The browser's own words are kept on the error as .reason, so the lock screen can show them.
  // withSecret asks for the secret too; only ask where the passkey can give it.
  // anyHub: on a PC the passkey is only a yes or no (the 'gate' way), so any of his Hub passkeys on that PC will do,
  // not only the one saved here (found Nov 28: a PC kept failing while the saved passkey id was out of step; this is
  // the backstop if that ever happens again). The browser picks from this site's own passkeys only.
  async function askFace(box, withSecret, anyHub) {
    const publicKey = {
      challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: anyHub ? [] : [{ type: 'public-key', id: unb64(box.cred) }] };
    if (withSecret) publicKey.extensions = { prf: { eval: { first: unb64(box.salt) } } };
    try {
      return await navigator.credentials.get({ publicKey });
    } catch (e) {
      const err = fail(e && e.name === 'NotAllowedError' ? 'needtap' : 'noface', 'Face ID didn\'t open the Hub.');
      err.reason = ((e && e.name) || 'Error') + (e && e.message ? ': ' + e.message : '');
      throw err;
    }
  }
  async function makePasskey(salt) {
    const ext = WIN ? {} : { extensions: { prf: { eval: { first: salt } } } };
    return navigator.credentials.create({ publicKey: Object.assign({
      challenge: rand(32), rp: { name: 'Josh\'s Hub', id: location.hostname },
      user: { id: rand(16), name: 'Josh\'s Hub', displayName: 'Josh\'s Hub' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000 }, ext) });
  }

  const KeyLock = {
    has() { const b = readBox(); return !!(b && b.box && b.iv); },
    mode() { const b = readBox(); return (b && b.mode) || null; },
    fails,

    // Lock a key. Needs a tap on the phone (making a passkey asks for Face ID).
    async lock(key) {
      if (!(await canFaceId())) {
        const sealed = await seal(await newPhoneLock(), key);
        writeBox(Object.assign({ mode: 'device', at: new Date().toISOString() }, sealed));
        return 'device';
      }
      const salt = rand(32);
      const base = { salt: b64(salt), at: new Date().toISOString() };
      let secret = null, canSecret = false;
      // This device already has a Hub passkey: use it again, so passkeys never pile up.
      const known = readCred();
      if (known && known.cred) {
        const reuse = async (withSecret) => {
          const c = await askFace({ cred: known.cred, salt: base.salt }, withSecret);
          base.cred = known.cred; canSecret = withSecret; secret = withSecret ? secretOf(c) : null;
        };
        try {
          await reuse(!WIN && known.prf !== 'no');
        } catch (e) {
          let err = e;
          if (!WIN && known.prf !== 'no') {
            // It may not be able to give the secret after all: try it the 'gate' way, which needs none.
            try { await reuse(false); writeCred({ cred: known.cred, prf: 'no' }); err = null; } catch (e2) { err = e2; }
          }
          if (err) {
            // Cancelled, or the passkey was deleted from this device: forget it, so the next try makes a new one.
            try { localStorage.removeItem(CRED); } catch (e3) { /* nothing kept */ }
            if (err.code === 'needtap') throw err;
          }
        }
      }
      if (!base.cred) {
        let cred;
        try {
          cred = await makePasskey(salt);
        } catch (e) {
          if (e && e.name === 'NotAllowedError') throw fail('needtap', 'Face ID wasn\'t set up for the Hub.');
          // Face ID can't make a passkey here at all: lock it inside the phone instead, so it's still never plain text.
          const sealed = await seal(await newPhoneLock(), key);
          writeBox(Object.assign({ mode: 'device', at: new Date().toISOString() }, sealed));
          return 'device';
        }
        base.cred = b64(cred.rawId);
        secret = secretOf(cred);
        canSecret = !WIN && (!!secret || prfOf(cred));
        if (WIN) secret = null;
        // Some phones only give the secret on the first Face ID after the passkey is made. Only ask where the
        // passkey said it can give one (Windows Hello says it can't, and asking makes it fail).
        if (!secret && canSecret) {
          try { secret = secretOf(await askFace(base, true)); } catch (e) { secret = null; }
        }
        writeCred({ cred: base.cred, prf: canSecret ? 'yes' : 'no' });
      }
      setFails(0);
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
      // An older PC lock made the 'faceid' way: Windows can't be asked for the secret, so don't ask something that
      // can only fail. The key is asked for once, and the new lock is the 'gate' way.
      if (WIN && box.mode === 'faceid') throw fail('rekey', 'This PC\'s lock is an older kind Windows Hello can\'t open.');
      let cred;
      try {
        cred = await askFace(box, box.mode === 'faceid', WIN && box.mode === 'gate');
      } catch (e) {
        const n = fails() + 1;
        setFails(n);
        // Two in a row: this device's passkey likely can't give the secret, so the next lock here goes the 'gate' way.
        if (n >= 2 && box.mode === 'faceid') writeCred({ cred: box.cred, prf: 'no' });
        e.fails = n;
        throw e;
      }
      setFails(0);
      if (box.mode === 'faceid') {
        const secret = secretOf(cred);
        if (!secret) throw fail('broken', 'Face ID worked, but the passkey didn\'t give back what opens the key.');
        writeCred({ cred: box.cred, prf: 'yes' });
        return open(await faceLock(secret), box);
      }
      // 'gate': Face ID (or Windows Hello) said yes, so open the key with the lock kept on this device.
      const lock = await phoneLock();
      if (!lock) throw fail('broken', 'The locked key couldn\'t be opened on this device.');
      // The passkey Windows used becomes the saved one, so the record here stays in step with the PC.
      const used = cred && cred.rawId ? b64(cred.rawId) : box.cred;
      if (used !== box.cred) writeBox(Object.assign({}, box, { cred: used }));
      writeCred({ cred: used, prf: 'no' });
      return open(lock, box);
    },

    // Windows Hello refused this device's passkey: make a new one (it needs the PIN or face too, so it's just as safe),
    // then open the key with the lock kept on this device. Only for the 'gate' way, where the passkey is just a yes/no.
    canRedo() { const b = readBox(); return WIN && !!(b && b.mode === 'gate'); },
    async redo() {
      const box = readBox();
      if (!box || box.mode !== 'gate') throw fail('rekey', 'This lock can\'t be set up again without the key.');
      let cred;
      try { cred = await makePasskey(unb64(box.salt)); } catch (e) {
        const err = fail('needtap', 'Windows Hello wasn\'t set up again.');
        err.reason = ((e && e.name) || 'Error') + (e && e.message ? ': ' + e.message : '');
        throw err;
      }
      const lock = await phoneLock();
      if (!lock) throw fail('broken', 'The locked key couldn\'t be opened on this device.');
      const key = await open(lock, box);
      const id = b64(cred.rawId);
      writeBox(Object.assign({}, box, { cred: id }));
      writeCred({ cred: id, prf: 'no' });
      setFails(0);
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
