// The Hub keeps itself on the newest version (found Nov 28: his PC's DuckDuckGo tab still ran the Hub from before
// the Nov 27 unlock fix, so Windows Hello kept failing until a Ctrl+F5; nothing told an open tab a newer Hub was out).
// Each time the Hub opens or comes back into view, it asks the server for its own page, skipping the browser's saved
// copy, and compares the version marks (the ?v= on every script and style). If they differ, it reloads itself.
// It waits while something is half done: a sheet open, a box being typed in, a card held, or a save going out.
// Changes waiting to save are kept on the phone, so a reload never loses them.
// It tries at most twice for the same newer version (a plain reload, then a fresh address the browser can't have
// saved), so a server that keeps sending a mixed answer can't loop it.
(function () {
  const TRIED = 'hub2.freshTried';
  const GAP = 10 * 1000;      // a click back into the window looks at most this often
  const WAIT = 3 * 1000;      // while busy, look again this soon (no new download, just "still busy?")
  let lastLook = 0, waitTimer = null, looking = false, newer = '';

  function marks(doc) {
    return Array.from(doc.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
      .map((el) => (el.getAttribute('src') || el.getAttribute('href') || '').split('/').pop())
      .filter((s) => /\?v=/.test(s))
      .sort()
      .join(' ');
  }
  const mine = () => marks(document);

  function busy() {
    if (Array.from(document.querySelectorAll('.sheet')).some((s) => !s.hidden)) return 'sheet';
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return 'typing';
    if (document.body.classList.contains('dragging')) return 'dragging';
    if (window.Changes && window.Changes.isSaving && window.Changes.isSaving()) return 'saving';
    if (window.FinSave && window.FinSave.isSaving && window.FinSave.isSaving()) return 'saving';
    return '';
  }

  // Tries for one newer version: 1 = a plain reload, 2 = a reload from a fresh address the browser can't have saved,
  // then it gives up for that version (and says so on the page for the check).
  function tries(v) { try { const t = (sessionStorage.getItem(TRIED) || '').split('|'); return t[0] === v ? +t[1] || 0 : 0; } catch (e) { return triedHere[v] || 0; } }
  function markTry(v, n) { triedHere[v] = n; try { sessionStorage.setItem(TRIED, v + '|' + n); } catch (e) { /* kept for this visit only */ } }
  const triedHere = {};

  function reloadWhenFree() {
    clearTimeout(waitTimer);
    if (!newer || document.hidden) return;
    const why = busy();
    if (why) {
      document.documentElement.dataset.fresh = 'waiting-' + why;
      waitTimer = setTimeout(reloadWhenFree, WAIT);
      return;
    }
    const n = Math.max(tries(newer), triedHere[newer] || 0) + 1;
    markTry(newer, n);
    document.documentElement.dataset.fresh = 'reloading';
    if (n === 1) location.reload();
    else location.replace(location.pathname + '?fresh=' + Date.now() + location.hash);
  }

  async function look(force) {
    if (document.hidden || looking) return;
    const now = Date.now();
    if (!force && now - lastLook < GAP) return;
    looking = true; lastLook = now;
    let theirs = '';
    try {
      // "reload" goes to the server and refreshes the browser's saved copy, so the reload below gets the new page too.
      const r = await fetch(location.pathname, { cache: 'reload', credentials: 'same-origin' });
      if (r.ok) theirs = marks(new DOMParser().parseFromString(await r.text(), 'text/html'));
    } catch (e) { /* offline: try again next time */ }
    looking = false;
    document.documentElement.dataset.freshLooked = String(+(document.documentElement.dataset.freshLooked || 0) + 1);
    if (!theirs || theirs === mine()) { newer = ''; document.documentElement.dataset.fresh = 'current'; return; }
    if (Math.max(tries(theirs), triedHere[theirs] || 0) >= 2) { document.documentElement.dataset.fresh = 'gave-up'; return; }
    newer = theirs;
    reloadWhenFree();
  }

  // The fresh address is only for that one load: put the plain address back.
  if (/[?&]fresh=/.test(location.search)) { try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) { /* harmless */ } }
  window.HubFresh = { look: () => look(true), marks: mine, busy };
  // On open (also when a phone brings back a page it kept in memory), and each time the Hub comes back into view.
  window.addEventListener('pageshow', () => setTimeout(() => look(true), 800));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) look(true); else clearTimeout(waitTimer); });
  window.addEventListener('focus', () => look(false));
})();
