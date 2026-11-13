// Tab switching: tapping a tab shows its screen and updates the big title.
const tabs = document.querySelectorAll('.tab');
const screens = document.querySelectorAll('.screen');
const title = document.getElementById('screen-title');

function show(name) {
  screens.forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  const current = document.getElementById('screen-' + name);
  title.textContent = current.dataset.title;
  document.querySelector('.screens').scrollTop = 0;
}

tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.screen)));

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
    show('home');
    refreshBox();
  } catch (err) {
    lockError.textContent = 'Something went wrong. Close the app and try again.';
  } finally {
    lockGo.disabled = false;
  }
});

document.getElementById('lock-now').addEventListener('click', () => {
  Vault.lock();
  showLock();
});

// Data box card on Home: connect this device, see the status, try a test save.
const boxStatus = document.getElementById('box-status');
const boxForm = document.getElementById('box-form');
const boxKey = document.getElementById('box-key');
const boxError = document.getElementById('box-error');
const boxTest = document.getElementById('box-test');
const boxConnect = document.getElementById('box-connect');

function clock(ms) {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  return 'Other device';
}

async function refreshBox() {
  boxError.textContent = '';
  if (!Store.isConnected()) {
    boxStatus.textContent = 'Not connected on this device yet. Paste the key you made on GitHub for my-app-data.';
    boxForm.hidden = false;
    boxTest.hidden = true;
    return;
  }
  boxForm.hidden = true;
  boxTest.hidden = false;
  boxStatus.textContent = 'Connected. Checking…';
  try {
    await Store.read('meta/app.json');
    const devices = await Store.read('meta/devices.json');
    const last = devices && devices.length ? devices[devices.length - 1] : null;
    if (Store.isOnline()) {
      boxStatus.textContent = 'Connected.' + (last ? ' Last test save: ' + last.device + ', ' + clock(Date.parse(last.at)) + '.' : ' No test save yet.');
    } else {
      boxStatus.textContent = 'Connected, but no signal right now. Showing what was saved on this device ' + clock(Store.lastFetched('meta/app.json')) + '.';
    }
  } catch (e) {
    boxStatus.textContent = 'Connected, but the data box could not be read.';
    boxError.textContent = e.message;
  }
}

boxForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  boxError.textContent = '';
  boxConnect.disabled = true;
  try {
    await Store.connect(boxKey.value);
    boxKey.value = '';
    await refreshBox();
  } catch (err) {
    boxError.textContent = err.message;
  } finally {
    boxConnect.disabled = false;
  }
});

boxTest.addEventListener('click', async () => {
  boxError.textContent = '';
  boxTest.disabled = true;
  try {
    await Store.write('meta/devices.json', (old) => {
      const list = Array.isArray(old) ? old : [];
      list.push({ device: deviceName(), at: new Date().toISOString() });
      return list.slice(-10);
    }, 'App: test save from ' + deviceName());
    await refreshBox();
  } catch (err) {
    boxError.textContent = err.message;
  } finally {
    boxTest.disabled = false;
  }
});

document.getElementById('box-forget').addEventListener('click', async () => {
  await Store.disconnect();
  show('home');
  refreshBox();
});

showLock();

// Offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
