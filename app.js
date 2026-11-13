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
}

function closeSettings() {
  sheet.hidden = true;
  gear.setAttribute('aria-expanded', 'false');
}

let hubLoaded = false;

// Sign-on screen. The app stays hidden until the Vault opens.
const lock = document.getElementById('lock');
const appEl = document.getElementById('app');
const lockForm = document.getElementById('lock-form');
const lockUser = document.getElementById('lock-user');
const lockPass = document.getElementById('lock-pass');
const lockPass2 = document.getElementById('lock-pass2');
const lockError = document.getElementById('lock-error');
const lockGo = document.getElementById('lock-go');

function showLock() {
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
  appEl.hidden = true;
  lock.hidden = false;
  closeSettings();
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
    lock.hidden = true;
    appEl.hidden = false;
    startApp();
  } catch (err) {
    lockError.textContent = 'Something went wrong. Close the app and try again.';
  } finally {
    lockGo.disabled = false;
  }
});

document.getElementById('lock-now').addEventListener('click', () => {
  closeHub();
  closeSettings();
  Vault.lock();
  showLock();
});

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

showLock();

// Offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
