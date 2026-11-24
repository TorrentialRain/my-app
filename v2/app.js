// New Hub frame: three pages, a bottom bar, and swiping between pages.
(function () {
  const ORDER = ['todo', 'finance', 'plan'];
  const LAST = 'hub2.lastPage';
  const pages = document.getElementById('pages');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;

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
  function go(i, smooth) {
    pages.scrollTo({ left: i * pages.clientWidth, behavior: smooth && !calm.matches ? 'smooth' : 'auto' });
    mark(i);
  }

  // Open on the page used last, placed before it shows so it doesn't slide in.
  pages.classList.add('placing');
  mark(saved());
  requestAnimationFrame(() => {
    pages.scrollLeft = current * pages.clientWidth;
    pages.classList.remove('placing');
  });

  tabs.forEach((t, i) => t.addEventListener('click', () => go(i, true)));

  // Swiping: when the pages settle, the bar follows.
  let settle;
  pages.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      const i = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
      if (i !== current && i >= 0 && i < ORDER.length) mark(i);
    }, 80);
  }, { passive: true });

  // Turning the phone or resizing keeps the same page in view.
  window.addEventListener('resize', () => { pages.scrollLeft = current * pages.clientWidth; });

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

  function askForKey(why) {
    if (why) connectWhy.textContent = why;
    connect.hidden = false;
  }

  async function load() {
    const jobs = [
      ['todo', 'data/tasks.json', Summary.todo],
      ['finance', 'data/fin.json', Summary.finance],
      ['plan', 'data/calendar.json', Summary.plan],
    ];
    await Promise.all(jobs.map(async ([page, path, sum]) => {
      try {
        say(page, sum(await Data.read(path)));
      } catch (e) {
        say(page, e.message, true);
        if (e.code === 'badkey' || e.code === 'noaccess') {
          if (Data.source() === 'own') Data.forgetOwnKey();
          askForKey(e.message + ' Paste a key that works.');
        }
      }
    }));
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
