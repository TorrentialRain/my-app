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

showLock();

// Offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
