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
    const jobs = [
      ['finance', 'data/fin.json', Summary.finance],
      ['plan', 'data/calendar.json', Summary.plan],
    ];
    await Promise.all([
      Todo.load(Data).catch((e) => { say('todo', e.message, true); Todo.showError(e.message); keyTrouble(e); }),
      ...jobs.map(async ([page, path, sum]) => {
        try {
          say(page, sum(await Data.read(path)));
        } catch (e) {
          say(page, e.message, true);
          keyTrouble(e);
        }
      }),
    ]);
    document.documentElement.dataset.loaded = 'yes';
  }

  document.getElementById('connect-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    connectErr.textContent = '';
    try {
      await Data.connect(connectKey.value);
      connectKey.value = '';
      connect.hidden = true;
      await load();
    } catch (e) {
      connectErr.textContent = e.message;
    }
  });

  (async () => {
    if (await Data.start()) await load();
    else { askForKey(); document.documentElement.dataset.loaded = 'nokey'; }
  })();
})();
