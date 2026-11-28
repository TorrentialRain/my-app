// New Hub frame: three pages, a bottom bar, and swiping between pages.
(function () {
  const ORDER = ['todo', 'finance', 'plan'];
  const LAST = 'hub2.lastPage';
  const pages = document.getElementById('pages');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let aiming = null, aimTimer;

  function saved() {
    try { const i = ORDER.indexOf(localStorage.getItem(LAST)); return i < 0 ? 0 : i; } catch (e) { return 0; }
  }
  function mark(i) {
    current = i;
    tabs.forEach((t) => {
      if (t.dataset.tab === ORDER[i]) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    try { localStorage.setItem(LAST, ORDER[i]); } catch (e) { /* not remembered this time */ }
  }
  // While a tapped page slides in, the halfway points of the slide don't count as a swipe,
  // so the bar and the remembered page can't flip to the page it slid past.
  function go(i, smooth) {
    aiming = i;
    clearTimeout(aimTimer);
    aimTimer = setTimeout(() => { aiming = null; landed(); }, 1200);
    pages.scrollTo({ left: i * pages.clientWidth, behavior: smooth && !calm.matches ? 'smooth' : 'auto' });
    mark(i);
  }
  function landed() {
    const i = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
    if (aiming !== null) { if (i === aiming) { aiming = null; clearTimeout(aimTimer); } return; }
    if (i !== current && i >= 0 && i < ORDER.length) mark(i);
  }

  // Open on the page used last, placed before it shows so it doesn't slide in.
  // The pages may not be laid out yet on the first frame (width 0, or a style still loading), so
  // keep placing until the page really sits there, and again whenever the pages change size.
  pages.classList.add('placing');
  mark(saved());
  let placed = false;
  function place() {
    const w = pages.clientWidth;
    if (!w) return;
    pages.scrollLeft = current * w;
    if (Math.abs(pages.scrollLeft - current * w) < 2) {
      placed = true;
      pages.classList.remove('placing');
    }
  }
  (function tryPlace(n) {
    place();
    if (!placed && n < 120) requestAnimationFrame(() => tryPlace(n + 1));
    else pages.classList.remove('placing');
  })(0);
  window.addEventListener('load', place);
  if (window.ResizeObserver) new ResizeObserver(() => { if (!aiming) place(); }).observe(pages);

  tabs.forEach((t, i) => t.addEventListener('click', () => go(i, true)));

  // Swiping: when the pages settle, the bar follows.
  let settle;
  pages.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(landed, 80);
  }, { passive: true });

  // A finger on the pages takes over from a tap that is still sliding.
  pages.addEventListener('touchstart', () => { aiming = null; clearTimeout(aimTimer); }, { passive: true });

  // While a TO-DO card is held, the pages stay put (see todo.js).

  // Turning the phone or resizing keeps the same page in view.
  window.addEventListener('resize', place);

  // ---- A PC fills the screen in the phone's proportions (his pick, Nov 26) ----
  // Every PC layout is drawn for a 1440 by 900 screen, and a bigger screen grows all of it to match (text, cards,
  // pictures, gaps, the graph), so it's never a narrow column in the middle. It grows only as far as the screen's
  // height allows too (found Nov 26: on a 1920 by 1080 screen, growing with the width alone pushed Spending 280
  // pixels off the bottom, because that screen is shorter for its width). Smaller PC screens keep their sizes.
  const pc = window.matchMedia('(min-width: 900px)');
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    const z = pc.matches ? Math.max(1, Math.min(w / 1440, h / 900)) : 1;
    document.documentElement.style.zoom = z === 1 ? '' : z.toFixed(4);
    document.documentElement.dataset.zoom = z.toFixed(4);
  }
  fit();
  window.addEventListener('resize', () => { fit(); place(); });
  // Screen points per style pixel, for the few things placed by hand (Plan's name bubble, a dragged TO-DO card).
  // Measured, because browsers differ in whether a zoomed page reports positions zoomed or not.
  window.hubScale = function () {
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    if (z === 1) return 1;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:1px;visibility:hidden';
    document.body.appendChild(probe);
    const k = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return k;
  };

  // ---- The 3D tilt, on every page (it used to work only on TO-DO) ----
  // Each card's picture shifts a little as the phone tilts. iPhone asks for motion permission once, from a tap.
  // Off under Reduce Motion.
  let base0 = null;
  function onTilt(e) {
    if (calm.matches || e.beta == null) return;
    if (!base0) base0 = { b: e.beta, g: e.gamma };
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const root = document.documentElement.style;
    root.setProperty('--tx', clamp((e.gamma - base0.g) / 25).toFixed(3));
    root.setProperty('--ty', clamp((e.beta - base0.b) / 25).toFixed(3));
  }
  (function startTilt() {
    if (calm.matches || pc.matches) return;
    const D = window.DeviceOrientationEvent;
    if (!D) return;
    if (typeof D.requestPermission !== 'function') { window.addEventListener('deviceorientation', onTilt); return; }
    let asked = '';
    try { asked = localStorage.getItem('hub2.motion') || ''; } catch (e) { /* not remembered */ }
    if (asked === 'granted') { window.addEventListener('deviceorientation', onTilt); }
    if (asked) return;
    const ask = () => {
      document.removeEventListener('click', ask, true);
      D.requestPermission().then((r) => {
        try { localStorage.setItem('hub2.motion', r); } catch (e) { /* asked again next time */ }
        if (r === 'granted') window.addEventListener('deviceorientation', onTilt);
      }).catch(() => {});
    };
    document.addEventListener('click', ask, true);
  })();

  // ---- Data (read-only) ----
  const lines = {};
  document.querySelectorAll('[data-line]').forEach((el) => { lines[el.dataset.line] = el; });
  function say(page, text, bad) {
    lines[page].textContent = text;
    lines[page].classList.toggle('bad', !!bad);
  }

  const connect = document.getElementById('connect');
  const connectWhy = document.getElementById('connect-why');
  const connectErr = document.getElementById('connect-error');
  const connectKey = document.getElementById('connect-key');

  const connectCancel = document.getElementById('connect-cancel');
  const firstWhy = connectWhy.textContent;
  function askForKey(why, canCancel) {
    connectWhy.textContent = why || firstWhy;
    connectErr.textContent = '';
    connectCancel.hidden = !canCancel;
    connect.hidden = false;
  }

  // Settings > Change key (and the waiting list's button): put in a new key, e.g. one that can save.
  document.querySelectorAll('[data-change-key]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; });
    document.body.classList.remove('sheet-up');
    document.getElementById('toast').hidden = true;
    askForKey('Paste the new key. It replaces the one on this phone, and anything waiting to save saves right after.', Data.source() !== null);
    connectKey.focus();
  }));
  connectCancel.addEventListener('click', () => { connect.hidden = true; connectKey.value = ''; });

  function keyTrouble(e) {
    if (e.code === 'badkey' || e.code === 'noaccess') {
      if (Data.source() === 'own') Data.forgetOwnKey();
      askForKey(e.message + ' Paste a key that works.');
    }
  }

  async function load() {
    await Promise.all([
      Todo.load(Data).catch((e) => { say('todo', e.message, true); Todo.showError(e.message); keyTrouble(e); }),
      Plan.load(Data).catch((e) => { say('plan', e.message, true); Plan.showError(e.message); keyTrouble(e); }),
      Finance.load(Data).catch((e) => { say('finance', e.message, true); Finance.showError(e.message); keyTrouble(e); }),
      // The robot's keep and undo tags. A problem here never stops the pages.
      window.Robot ? Robot.load(Data).catch(() => {}) : null,
    ]);
    document.documentElement.dataset.loaded = 'yes';
  }

  document.getElementById('connect-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    connectErr.textContent = '';
    try {
      await Data.connect(connectKey.value);
      connectKey.value = '';
      // Ask straight away whether this key can save, so a key that can only read is spotted here, not on the first tick.
      let saves = null;
      try { saves = await Data.canSave(); } catch (e) { saves = null; }
      document.documentElement.dataset.keySaves = String(saves);
      if (saves === false) {
        connectWhy.textContent = 'Connected, but this key (ends in ' + Data.keyEnd() + ') can only read, so changes won\'t save.';
        connectErr.textContent = 'On GitHub, open this key and set Contents to "Read and write" for my-app-data, then paste it here again. Each phone or computer keeps its own key.';
        connectCancel.hidden = false;
      } else {
        connect.hidden = true;
      }
      await load();
      // Face ID wanted a tap before it could lock the new key: ask for that tap now.
      if (Data.needsLock()) showLock('lock');
    } catch (e) {
      connectErr.textContent = e.message;
    }
  });

  // ---- The Face ID lock (Josh's pick, Nov 26) ----
  const lockCard = document.getElementById('lockcard');
  const lockTitle = document.getElementById('lock-title');
  const lockWhy = document.getElementById('lock-why');
  const lockGo = document.getElementById('lock-go');
  const lockOther = document.getElementById('lock-other');
  const lockErr = document.getElementById('lock-error');
  const lockRedo = document.getElementById('lock-redo');
  // What this device calls its sign-in (found Nov 26: his PC was told to "look at your phone").
  const UA = navigator.userAgent;
  const IOS = /iPhone|iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  const FACE = IOS ? 'Face ID' : /Windows/.test(UA) ? 'Windows Hello' : /Macintosh/.test(UA) ? 'Touch ID' : /Android/.test(UA) ? 'your fingerprint' : 'this device\'s sign-in';
  const FACE_WHY = IOS ? 'Look at your phone to open your data.' : /Windows/.test(UA) ? 'Use Windows Hello (your PC PIN or face) to open your data.' : 'Use ' + FACE + ' to open your data.';
  // A phone asks straight away; a computer waits for a click (a browser can refuse an ask nobody clicked for).
  const ASK_AT_ONCE = IOS || /Android/.test(UA) || matchMedia('(pointer: coarse)').matches;
  const TAP = ASK_AT_ONCE ? 'Tap' : 'Click';
  const HERE = IOS || /Android/.test(UA) ? 'phone' : 'device';
  let lockJob = 'unlock';
  function showLock(job, err) {
    lockJob = job;
    if (job === 'unlock') {
      lockTitle.textContent = 'Unlock your Hub';
      lockWhy.textContent = FACE_WHY;
      lockGo.textContent = 'Unlock with ' + FACE;
      // After two tries that didn't work, the way out comes first, so the Hub is never stuck behind the lock.
      const stuck = window.KeyLock && KeyLock.fails() >= 2;
      lockOther.textContent = stuck ? 'Use my key instead' : 'Use a different key';
      lockOther.classList.toggle('quiet', !stuck);
      lockGo.classList.toggle('quiet', stuck);
      if (stuck) lockGo.textContent = 'Try ' + FACE + ' again';
      // A PC whose passkey Windows Hello refused (found Nov 27): the first way out makes a new one, no key needed.
      const redo = !!(window.KeyLock && KeyLock.canRedo && KeyLock.canRedo() && KeyLock.fails() >= 1);
      lockRedo.hidden = !redo;
      if (redo) { lockGo.classList.add('quiet'); lockOther.classList.add('quiet'); lockOther.textContent = 'Use my key instead'; }
    } else {
      lockTitle.textContent = 'Lock your data key';
      lockWhy.textContent = 'Lock the key with ' + FACE + ', so it\'s never kept on this ' + HERE + ' as plain text. After this, the Hub opens with ' + (IOS ? 'a look.' : FACE + '.');
      lockOther.classList.add('quiet'); lockGo.classList.remove('quiet');
      lockGo.textContent = 'Lock with ' + FACE;
    }
    lockOther.hidden = job !== 'unlock';
    if (job !== 'unlock') lockRedo.hidden = true;
    lockErr.textContent = err || '';
    lockCard.hidden = false;
    document.documentElement.dataset.lock = job;
  }
  function hideLock() { lockCard.hidden = true; lockErr.textContent = ''; document.documentElement.dataset.lock = 'done'; }

  async function unlockAndLoad() {
    try {
      await Data.unlock();
      hideLock();
      await load();
    } catch (e) {
      if (e.code === 'needtap' || e.code === 'noface') {
        // Say what really went wrong, in the browser's own words (found Nov 26: every failure looked the same).
        const why = e.reason ? ' ' + FACE + ' said: "' + String(e.reason).slice(0, 160) + '"' : '';
        const next = KeyLock.canRedo && KeyLock.canRedo() ? ' ' + TAP + ' "Set up ' + FACE + ' again" to fix it.' : KeyLock.fails() >= 2 ? ' You can use your key instead.' : ' ' + TAP + ' to try again.';
        showLock('unlock', lockCard.hidden ? '' : 'That didn\'t work.' + why + next);
        return;
      }
      if (e.code === 'rekey') {
        // An older PC lock Windows Hello can't open: ask for the key once; the new lock is the PC way.
        Data.forgetOwnKey();
        hideLock();
        askForKey('This PC\'s lock was set up an older way that ' + FACE + ' can\'t open. Paste your key once more and it gets locked the PC way, with ' + FACE + '.');
        document.documentElement.dataset.loaded = 'nokey';
        return;
      }
      // The locked key can't be opened here any more (like the passkey was deleted): ask for the key again.
      Data.forgetOwnKey();
      hideLock();
      askForKey('The locked key on this ' + HERE + ' couldn\'t be opened. Paste your key once more and it gets locked again.');
      document.documentElement.dataset.loaded = 'nokey';
    }
  }
  async function lockIfNeeded() {
    if (!Data.needsLock()) return;
    try { await Data.lockNow(); hideLock(); } catch (e) { showLock('lock', lockCard.hidden ? '' : 'That didn\'t lock it. ' + TAP + ' to try again.'); }
  }
  document.getElementById('lock-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    lockErr.textContent = '';
    if (lockJob === 'unlock') await unlockAndLoad();
    else await lockIfNeeded();
  });
  lockRedo.addEventListener('click', async () => {
    lockErr.textContent = '';
    try {
      await Data.redoLock();
      hideLock();
      await load();
    } catch (e) {
      const why = e.reason ? ' ' + FACE + ' said: "' + String(e.reason).slice(0, 160) + '"' : '';
      showLock('unlock', 'That didn\'t set it up.' + why + ' You can use your key instead.');
    }
  });
  lockOther.addEventListener('click', () => { hideLock(); askForKey('Paste your key. It replaces the locked one on this ' + HERE + ' and gets locked with ' + FACE + '.'); });

  (async () => {
    const found = await Data.start();
    if (found === 'locked') { if (ASK_AT_ONCE) await unlockAndLoad(); else showLock('unlock', ''); }
    else if (found) { await load(); await lockIfNeeded(); }
    else { askForKey(); document.documentElement.dataset.loaded = 'nokey'; }
  })();
})();
