// The app is the Hub, full screen, with Settings over it.

// A page inside a frame can't see the phone's safe areas (the notch and the
// home bar), so measure them out here and hand them to the Hub as CSS values.
function passSafeAreas() {
  const frame = document.getElementById('hub-frame');
  const doc = frame.contentDocument;
  if (!doc || !doc.documentElement) return;
  const mine = getComputedStyle(document.getElementById('app'));
  ['--sat', '--sar', '--sab', '--sal'].forEach((name) => {
    doc.documentElement.style.setProperty(name, mine.getPropertyValue(name).trim() || '0px');
  });
}
window.addEventListener('resize', passSafeAreas);
window.addEventListener('orientationchange', () => setTimeout(passSafeAreas, 250));

const sheet = document.getElementById('sheet');
const gear = document.getElementById('gear');

function openSettings() {
  sheet.hidden = false;
  gear.setAttribute('aria-expanded', 'true');
  refreshBox();
  refreshFaceRow();
}

function closeSettings() {
  sheet.hidden = true;
  gear.setAttribute('aria-expanded', 'false');
}

let hubLoaded = false;

// Sign-in cover. The app stays hidden until the Vault opens.
// - Not signed in: the cover shows the sign-in form ("Create your sign-on" the first time on a device).
// - "Stay signed in" on: the key stays on this device. Each time the app opens, the cover shows for about a
//   second, Face ID (when it's set up) unlocks it, and it fades into the Hub.
// - Lock app signs out for real: the kept key is thrown away and the password is needed again.
const lock = document.getElementById('lock');
const appEl = document.getElementById('app');
const lockForm = document.getElementById('lock-form');
const lockUser = document.getElementById('lock-user');
const lockPass = document.getElementById('lock-pass');
const lockPass2 = document.getElementById('lock-pass2');
const lockStay = document.getElementById('lock-stay');
const lockError = document.getElementById('lock-error');
const lockGo = document.getElementById('lock-go');
const unlockBox = document.getElementById('lock-unlock');
const setupBox = document.getElementById('lock-setup');
const FACE = 'hub.faceid';          // this device's Face ID passkey id
const FACE_SKIP = 'hub.faceid.skip'; // "Not now" was tapped: don't ask again on every sign-in
const STAY = 'hub.stay';
let coverShownAt = 0;

// The clock on the cover
function tickCover() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
  document.getElementById('cv-hm').textContent = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  document.getElementById('cv-ap').textContent = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
  document.getElementById('cv-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
tickCover();
setInterval(tickCover, 15000);

function setMode(mode) {
  lock.dataset.mode = mode;
  lockForm.hidden = mode !== 'form';
  unlockBox.hidden = mode !== 'unlock';
  setupBox.hidden = mode !== 'setup';
}

function showLock(mode) {
  mode = mode || 'form';
  if (mode === 'form') {
    const firstTime = !Vault.exists();
    document.getElementById('lock-title').textContent = firstTime ? 'Create your sign-on' : 'Sign in';
    document.getElementById('lock-hint').textContent = firstTime
      ? 'Pick the username and password for this device. There is no reset, so do not forget them.'
      : '';
    lockPass.autocomplete = firstTime ? 'new-password' : 'current-password';
    lockPass2.hidden = !firstTime;
    lockPass2.required = firstTime;
    lockGo.textContent = firstTime ? 'Create' : 'Sign in';
    lockError.textContent = '';
    lockPass.value = '';
    lockPass2.value = '';
    lockStay.checked = localStorage.getItem(STAY) !== '0';
  }
  if (lock.hidden || lock.classList.contains('gone')) coverShownAt = Date.now();
  lock.classList.remove('gone', 'leaving');
  lock.hidden = false;
  tickCover();
  setMode(mode);
  closeSettings();
}

// ---- Face ID (a passkey kept on this phone; it only says "it's really you" before the kept key is used) ----
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
async function canFaceId() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (e) { return false; }
}
async function faceIdCheck() {
  await navigator.credentials.get({ publicKey: {
    challenge: rand(32),
    allowCredentials: [{ type: 'public-key', id: unb64(localStorage.getItem(FACE)) }],
    userVerification: 'required',
    timeout: 60000,
  } });
}
async function faceIdCreate(name) {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rand(32),
    rp: { name: "Josh's Hub" },
    user: { id: rand(16), name: name || 'josh', displayName: name || 'Josh' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    attestation: 'none',
    timeout: 60000,
  } });
  localStorage.setItem(FACE, b64(cred.rawId));
  localStorage.removeItem(FACE_SKIP);
}

// Fade the cover once the Hub has had a moment to load underneath (at least ~1 second of cover).
let revealing = false;
function reveal() {
  if (revealing) return;
  revealing = true;
  lock.classList.add('leaving');
  const loaded = new Promise((res) => { hubFrame.addEventListener('load', res, { once: true }); setTimeout(res, 2500); });
  const minWait = new Promise((res) => setTimeout(res, Math.max(0, 1000 - (Date.now() - coverShownAt))));
  Promise.all([loaded, minWait]).then(() => {
    lock.classList.add('gone');
    setTimeout(() => { lock.hidden = true; lock.classList.remove('gone', 'leaving'); revealing = false; }, 320);
  });
}

function enterApp(thenReveal) {
  appEl.hidden = false;
  startApp();
  if (thenReveal !== false) reveal();
}

lockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  lockError.textContent = '';
  const user = lockUser.value.trim();
  const pass = lockPass.value;
  lockGo.disabled = true;
  try {
    if (!Vault.exists()) {
      if (pass !== lockPass2.value) {
        lockError.textContent = 'The two passwords do not match.';
        lockPass.value = '';
        lockPass2.value = '';
        return;
      }
      await Vault.create(user, pass);
    } else if (!(await Vault.open(user, pass))) {
      lockError.textContent = 'Wrong username or password.';
      lockPass.value = '';
      return;
    }
    lockPass.value = '';
    lockPass2.value = '';
    const stay = lockStay.checked;
    localStorage.setItem(STAY, stay ? '1' : '0');
    try { if (stay) await Vault.remember(); else await Vault.forget(); } catch (err) { /* stays signed in for this visit only */ }
    // First time with "Stay signed in" on a phone that has Face ID: offer to turn it on (it needs a tap).
    if (stay && !localStorage.getItem(FACE) && !localStorage.getItem(FACE_SKIP) && await canFaceId()) {
      lockUser.dataset.name = user;
      enterApp(false);
      setMode('setup');
      return;
    }
    enterApp();
  } catch (err) {
    lockError.textContent = 'Something went wrong. Close the app and try again.';
  } finally {
    lockGo.disabled = false;
  }
});

document.getElementById('faceid-setup').addEventListener('click', async () => {
  const err = document.getElementById('setup-error');
  err.textContent = '';
  try { await faceIdCreate(lockUser.dataset.name); reveal(); }
  catch (e) { err.textContent = 'Face ID wasn\'t set up. You can try again in Settings.'; setTimeout(reveal, 1800); }
});
document.getElementById('faceid-skip').addEventListener('click', () => { localStorage.setItem(FACE_SKIP, '1'); reveal(); });

async function unlockWithFaceId() {
  const err = document.getElementById('unlock-error');
  err.textContent = '';
  try {
    await faceIdCheck();
  } catch (e) {
    setMode('unlock');
    if (e && e.name !== 'NotAllowedError') err.textContent = 'Face ID didn\'t work. Try again or use your password.';
    return;
  }
  if (await Vault.openRemembered()) { setMode('splash'); enterApp(); }
  else { await Vault.forget(); showLock('form'); }
}
document.getElementById('faceid-go').addEventListener('click', unlockWithFaceId);
document.getElementById('use-pass').addEventListener('click', () => showLock('form'));

// Settings: turn Face ID on or off for this device.
const faceRow = document.getElementById('faceid-row');
async function refreshFaceRow() {
  const can = await canFaceId();
  faceRow.hidden = !can || !Vault.hasRemembered();
  document.getElementById('faceid-label').textContent = localStorage.getItem(FACE) ? 'Turn off Face ID' : 'Set up Face ID';
}
faceRow.addEventListener('click', async () => {
  if (localStorage.getItem(FACE)) { localStorage.removeItem(FACE); localStorage.setItem(FACE_SKIP, '1'); }
  else { try { await faceIdCreate(lockUser.value.trim() || 'josh'); } catch (e) { /* cancelled */ } }
  refreshFaceRow();
});

document.getElementById('lock-now').addEventListener('click', async () => {
  closeHub();
  closeSettings();
  Vault.lock();
  await Vault.forget();
  appEl.hidden = true;
  showLock('form');
});

// On open: signed in and kept on this device? Splash, Face ID if it's set up, then into the Hub.
async function boot() {
  if (Vault.hasRemembered()) {
    showLock('splash');
    if (localStorage.getItem(FACE)) { await unlockWithFaceId(); return; }
    if (await Vault.openRemembered()) { enterApp(); return; }
    await Vault.forget();
  }
  appEl.hidden = true;
  showLock('form');
}

gear.addEventListener('click', openSettings);
document.getElementById('sheet-close').addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSettings(); });

// ---- Data box and the Hub ----
const boxStatus = document.getElementById('box-status');
const boxForm = document.getElementById('box-form');
const boxKey = document.getElementById('box-key');
const boxError = document.getElementById('box-error');
const boxConnect = document.getElementById('box-connect');
const syncStatus = document.getElementById('sync-status');
const hubFrame = document.getElementById('hub-frame');
const hubWait = document.getElementById('hub-wait');
const hubMsg = document.getElementById('hub-msg');
const importStatus = document.getElementById('import-status');

function clock(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function refreshBox() {
  boxError.textContent = '';
  const on = Store.isConnected();
  boxForm.hidden = on;
  boxStatus.textContent = on
    ? 'Connected on this device.'
    : 'Not connected on this device yet. Paste the key you made on GitHub for my-app-data.';
  refreshSync();
}

function refreshSync() {
  if (!Store.isConnected()) { syncStatus.textContent = ''; return; }
  const n = HubDB.waiting();
  const problem = HubDB.problem();
  if (problem) syncStatus.textContent = 'Could not save: ' + problem;
  else if (n) syncStatus.textContent = n + (n === 1 ? ' change is' : ' changes are') + ' waiting to be sent' + (Store.isOnline() === false ? ' (no signal).' : '.');
  else syncStatus.textContent = Store.isOnline() === false ? 'No signal. Showing what was saved on this device.' : 'Everything is saved.';
}
window.addEventListener('hubdb', refreshSync);

function closeHub() {
  hubLoaded = false;
  hubFrame.hidden = true;
  hubFrame.removeAttribute('srcdoc');
  hubWait.hidden = false;
  gear.hidden = true;
  HubDB.stop();
}

// Load the Hub's pages from the data box and show them.
async function openHub() {
  gear.hidden = false;
  if (!Store.isConnected()) {
    hubMsg.textContent = 'Connect the data box in Settings first.';
    openSettings();
    return;
  }
  hubMsg.textContent = 'Loading…';
  try {
    const html = await Store.readText('app/hub.html');
    if (!html) { hubMsg.textContent = 'The data box does not have the Hub pages yet.'; return; }
    await HubDB.start();
    // The pages ask "window.claude" for their database; point that at this app instead.
    hubFrame.srcdoc = html.replace(/<body>/i, (m) => m + '<script>window.claude = window.parent.AppClaude;<\/script>');
    hubFrame.addEventListener('load', passSafeAreas);
    hubLoaded = true;
    hubFrame.hidden = false;
    hubWait.hidden = true;
    passSafeAreas();
  } catch (e) {
    hubMsg.textContent = 'Could not load the Hub. ' + e.message;
  }
}

function startApp() {
  closeSettings();
  refreshBox();
  openHub();
}

boxForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  boxError.textContent = '';
  boxConnect.disabled = true;
  try {
    await Store.connect(boxKey.value);
    boxKey.value = '';
    refreshBox();
    closeSettings();
    openHub();
  } catch (err) {
    boxError.textContent = err.message;
  } finally {
    boxConnect.disabled = false;
  }
});

// Change password (Settings > Data box card).
const pwOpen = document.getElementById('pw-open');
const pwForm = document.getElementById('pw-form');
const pwMsg = document.getElementById('pw-msg');
pwOpen.addEventListener('click', () => {
  const show = pwForm.hidden;
  pwForm.hidden = !show;
  pwOpen.setAttribute('aria-expanded', String(show));
  pwMsg.textContent = '';
  pwMsg.classList.remove('ok');
  if (show) document.getElementById('pw-user').focus();
});
pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  pwMsg.classList.remove('ok');
  pwMsg.textContent = '';
  const user = document.getElementById('pw-user').value.trim();
  const oldPw = document.getElementById('pw-old');
  const newPw = document.getElementById('pw-new');
  const newPw2 = document.getElementById('pw-new2');
  if (newPw.value !== newPw2.value) { pwMsg.textContent = 'The two new passwords do not match.'; newPw.value = ''; newPw2.value = ''; return; }
  if (newPw.value === oldPw.value) { pwMsg.textContent = 'The new password is the same as the current one.'; return; }
  const go = document.getElementById('pw-go');
  go.disabled = true;
  try {
    if (!(await Vault.changePassword(user, oldPw.value, newPw.value))) {
      pwMsg.textContent = 'Wrong username or current password.';
      oldPw.value = '';
      return;
    }
    pwForm.reset();
    pwForm.hidden = true;
    pwOpen.setAttribute('aria-expanded', 'false');
    pwMsg.classList.add('ok');
    pwMsg.textContent = 'Password changed. Use the new one next time you sign in.';
  } catch (err) {
    pwMsg.textContent = 'Something went wrong, so nothing was changed. Try again.';
  } finally {
    go.disabled = false;
  }
});

document.getElementById('box-forget').addEventListener('click', async () => {
  closeHub();
  gear.hidden = false;
  await Store.disconnect();
  hubMsg.textContent = 'Connect the data box in Settings first.';
  openSettings();
});

// Back up now: save everything in the data box as one file on this device.
document.getElementById('backup-now').addEventListener('click', async () => {
  if (!Store.isConnected()) { importStatus.textContent = 'Connect the data box first.'; return; }
  importStatus.textContent = 'Gathering your data…';
  try {
    const all = await HubDB.exportAll();
    const d = new Date();
    const name = 'app-backup-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
    const file = new File([JSON.stringify(all)], name, { type: 'application/json' });
    const count = Object.keys(all.docs).length;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // On iPhone this opens the share sheet: pick "Save to Files".
      await navigator.share({ files: [file] });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    importStatus.textContent = 'Backup made: ' + name + ' (' + count + ' items).';
  } catch (err) {
    importStatus.textContent = err && err.name === 'AbortError' ? 'Backup cancelled.' : 'Backup failed. ' + (err && err.message ? err.message : '');
  }
});

// Import: pick a backup file, or the export file saved from the Hub, and its data replaces what is in the data box.
document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || parsed.kind !== 'hub-export' || !parsed.docs) throw new Error('That file is not a Hub export.');
    const count = Object.keys(parsed.docs).length;
    const from = parsed.source === 'app-backup' ? 'backup' : 'Hub export';
    const when = parsed.exportedAt ? clock(Date.parse(parsed.exportedAt)) : 'an unknown time';
    if (!window.confirm('Replace what is in the data box with this ' + from + ' from ' + when + '? (' + count + ' items)')) {
      importStatus.textContent = 'Import cancelled.';
      return;
    }
    importStatus.textContent = 'Importing ' + count + ' items…';
    const files = await HubDB.importAll(parsed.docs, (name, i, total) => {
      importStatus.textContent = 'Importing ' + name + ' (' + i + ' of ' + total + ')…';
    });
    importStatus.textContent = 'Imported ' + count + ' items into ' + files + ' files, ' + clock(Date.now()) + '.';
  } catch (err) {
    importStatus.textContent = 'Import failed. ' + err.message;
  }
});

boot();

// Offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
