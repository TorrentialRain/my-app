// Finance page: Spending, Activity, Wishlists, Debt and Quick-budget, plus Plan's message box.
// Everything is worked out by money.js from the money files; this file only draws it and sends his changes
// to finsave.js, which saves them safely and writes a line in the hidden change log for each one.
// Every label is spelled out and starts with a capital letter (his rule for Finance, Nov 25).
(function () {
  const M = window.Money;
  const S = window.FinSave;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (d, size) => '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    spending: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.5 6"/>',
    activity: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    wishlists: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7"/><path d="M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
    debt: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    quick: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    needs: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    gas: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h4"/>',
    subs: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
    medical: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
    wants: '<path d="M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0"/>',
    spoils: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    invest: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const TABS = [['spending', 'Spending'], ['activity', 'Activity'], ['wishlists', 'Wishlists'], ['debt', 'Debt'], ['quick', 'Quick-Budget']];
  const GROUP_OF = { needs: 'needs', gas: 'needs', subs: 'needs', medical: 'needs', wants: 'wants', spoils: 'wants', invest: 'invest', debt: 'debt' };
  // Pie shades: Needs blues, Wants purples, Savings green, Debt slate, not sorted gray.
  const SHADES = { needs: ['#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE'], wants: ['#7E22CE', '#9333EA', '#A855F7', '#C084FC', '#D8B4FE', '#E9D5FF'], savings: ['#16A34A', '#4ADE80'], debt: ['#64748B', '#94A3B8'], unsorted: ['#8E8E93', '#AEAEB2'] };
  const GROUP_COLOR = { needs: '#2563EB', wants: '#9333EA', savings: '#16A34A', debt: '#64748B', unsorted: '#8E8E93' };

  let store = null, base = { fin: null, months: null, notes: null }, W = null;
  let tab = 'spending', range = 30, pieAt = 0, openTile = null, openBreak = false, actDays = 10, showBought = false, showPaid = false;
  let saveTimer = null, retryTimer = null, savingNow = false, again = false, justSaved = 0, lastRead = 0, ready = false;

  const page = document.getElementById('page-finance');
  const bodyEl = $('.fi-body', page);
  const lineEl = $('[data-line="finance"]', page);
  const pendingEl = $('.fi-pending', page);
  const sheet = document.getElementById('sheet-fin');
  const sheetCard = $('.sheet-card', sheet);
  const msgSheet = document.getElementById('sheet-planmsg');

  // ---------- Working out what to show ----------
  // What's on screen = the saved files plus his changes still waiting to save, so a change shows at once.
  function view() {
    const pend = S.list();
    return {
      fin: S.apply('fin', base.fin, pend),
      months: S.apply('months', base.months, pend),
      notes: S.apply('notes', base.notes || { items: [] }, pend),
    };
  }
  function work() {
    const v = view();
    W = M.work(v.fin, v.months, v.notes, new Date());
    W._v = v;
    return W;
  }

  // ---------- Drawing ----------
  function tabsHtml() {
    return TABS.map(([k, name]) => '<button type="button" class="fi-tab" data-fi-tab="' + k + '" aria-pressed="' + (tab === k) + '">' + ic(ICON[k], 20) + '<span>' + name + '</span></button>').join('');
  }
  function render() {
    if (!base.fin) return;
    work();
    document.dispatchEvent(new Event('hub:questions')); // the inbox count on the Questions buttons
    $$('.fi-tabs, .fi-side', page).forEach((el) => { el.innerHTML = tabsHtml(); });
    lineEl.textContent = 'Next paycheck ' + M.longDay(W.nextPaycheck);
    lineEl.classList.remove('bad');
    page.dataset.tab = tab;
    bodyEl.innerHTML = ({ spending, activity, wishlists, debt, quick })[tab]();
    showSaving();
    fitGraph();
  }
  // On a PC the graph takes the height that's left on the left side, so Spending always fits on one screen
  // (Nov 15 rule) while the graph stays as tall as it can (his Nov 26 pick). The drawing is made at that shape,
  // so it's never stretched. Found Nov 26: a fixed shape ran 199 pixels past the bottom of a 1440 by 900 screen.
  let pcH = 236;
  function fitGraph() {
    if (!PC.matches || tab !== 'spending' || !W) return;
    for (let pass = 0; pass < 3; pass++) {
      const svg = bodyEl.querySelector('.fi-chart .fi-graph');
      const cols = bodyEl.querySelectorAll('.fi-cols > .fi-col');
      if (!svg || cols.length < 2) return;
      const k = window.hubScale ? window.hubScale() : 1;
      const left = cols[0].getBoundingClientRect().height / k, right = cols[1].getBoundingClientRect().height / k;
      const width = svg.getBoundingClientRect().width / k;
      if (!width) return;
      // How far the left side alone runs past the bottom (less than 0: room to spare).
      const over = page.scrollHeight - page.clientHeight - Math.max(0, right - left);
      const next = Math.max(120, Math.min(300, Math.round(pcH - over * (600 / width))));
      if (Math.abs(next - pcH) < 2) return;
      pcH = next;
      bodyEl.querySelector('.fi-chart').outerHTML = chart();
    }
  }
  let refit = 0;
  const refitSoon = () => { clearTimeout(refit); refit = setTimeout(fitGraph, 150); };
  window.addEventListener('resize', refitSoon);
  // A robot tag added after the page is drawn makes the left side taller, so the graph is fitted again then too.
  if (window.ResizeObserver) new ResizeObserver(refitSoon).observe(bodyEl);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitGraph());

  // ----- Spending -----
  function spending() {
    return '<div class="fi-cols"><div class="fi-col">' + chart() + totals() + pie() + '</div><div class="fi-col">' + buckets() + '</div></div>';
  }
  // Balance over time (his pick, Nov 26: graph C with B's pins). Edge to edge in its card, with faint dollar
  // lines inside. A pin on each paycheck's peak (and on big one-off income): a green tag with the amount, a short
  // line down and a ringed dot. A blue Savings line that steps only on days money moves in or out of savings.
  // The date row: the first day, each pin's day and Today. The picture keeps its shape at every width (dots stay
  // round), so it grows taller as the screen gets wider.
  const PC = window.matchMedia('(min-width: 900px)');
  const GREEN = '#30D158', BLUE = '#64A0FF';
  const r2 = (n) => Math.round(n * 100) / 100;
  // A line of parts ("Gas · Needs · Bank") never says a word twice (found Nov 28: "Gas · Gas · Bank" and
  // "Transfer · Transfer (not spending) · Bank"). A part that another part already says, or starts, is left out.
  function oneLine(parts) {
    const xs = parts.map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
    const low = (x) => x.toLowerCase();
    return xs.filter((x, i) => !xs.some((o, j) => j !== i && (low(o) === low(x) ? j < i : low(o).startsWith(low(x) + ' ')))).join(' · ');
  }
  // Whole percents that add up to 100 (found Nov 28: 56 + 28 + 15 = 99): the leftover goes to the biggest remainders.
  function percents(shares) {
    const raw = shares.map((x) => x * 100), base = raw.map(Math.floor);
    let left = Math.round(raw.reduce((a, b) => a + b, 0)) - base.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
    return base;
  }
  PC.addEventListener('change', () => { if (W) render(); }); // the picture's shape differs on the PC
  function niceStep(span) {
    const raw = span / 3, mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw) || mag * 10;
  }
  function pinsFor(days, vals) {
    // Paychecks and big one-off income only (his rule, Nov 26). Same-day income merges into one pin.
    const v = W._v, rules = (v.fin && v.fin.storeRules && v.fin.storeRules.items) || [];
    const byDay = {};
    for (const t of M.allTx(v.months)) {
      if (t.a <= 0 || t.d < days[0] || t.d > days[days.length - 1]) continue;
      if (M.bucketOf(t, rules) !== 'income') continue;
      const pay = (W.paydays || []).some((p) => p.day === t.d);
      if (!pay && t.a < 200) continue;
      byDay[t.d] = (byDay[t.d] || 0) + t.a;
    }
    return Object.keys(byDay).sort().map((d) => ({ day: d, i: days.indexOf(d), amount: byDay[d] })).filter((p) => p.i >= 0);
  }
  function chart() {
    const B = W.bal;
    if (!B || !B.days.length) return card('Balance over time', '<p class="fi-note">No balance on file yet.</p>');
    const days = range ? B.days.slice(-range) : B.days;
    const vals = days.map((d) => B.series[d]);
    const S = W.savingsLine || {};
    const sav = days.map((d) => (S[d] == null ? null : S[d]));
    const hasSav = sav.some((x) => x != null) && W.savings.total > 0;
    const all = vals.concat(hasSav ? sav.filter((x) => x != null) : []);
    // A wider drawing on a PC, so the left side keeps the graph, balances and pie on one screen; never stretched.
    const w = PC.matches ? 600 : 400, h = PC.matches ? pcH : 316;
    const top = 58, bot = h - 32, endIn = 14;
    let lo = Math.min(0, ...all), hi = Math.max(1, ...all);
    if (hi - lo < 1) hi = lo + 1;
    const x = (i) => (days.length < 2 ? (w - endIn) / 2 : (i / (days.length - 1)) * (w - endIn));
    const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
    const f = (n) => n.toFixed(1);
    const lines = [];
    vals.forEach((v, i) => lines.push([x(i), y(v)]));
    const savPts = [];
    if (hasSav) {
      let prev = null;
      sav.forEach((v, i) => {
        if (v == null) return;
        if (prev != null) savPts.push([x(i), y(prev)]);
        savPts.push([x(i), y(v)]);
        prev = v;
      });
    }
    // Every line as short dots, so a box can be tested against it.
    const dots = [];
    for (const pts of [lines, savPts]) {
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
        for (let j = 0; j <= n; j++) dots.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n]);
      }
    }
    // Faint dollar lines, inside the picture. Found Nov 28: on a PC's short graph "$500" and "$250" printed on top of
    // each other, and on the phone the blue line ran through "$250". Now the lines are spaced at least 24 apart, and each
    // label sits on the left, or on the right if a line runs through the left, or is left out if both are crossed.
    let step = niceStep(hi - lo);
    while (step / (hi - lo) * (bot - top) < 24) step = niceStep(step * 3.01);
    const onLine = (b) => dots.some(([px, py]) => px > b[0] - 3 && px < b[2] + 3 && py > b[1] - 3 && py < b[3] + 3);
    const gridBoxes = [];
    let grid = '';
    for (let g = Math.ceil(lo / step) * step; g <= hi + 0.01; g += step) {
      const gy = y(g);
      if (g <= lo + 0.01 && lo === 0) continue; // the bottom edge needs no line
      if (gy > bot - 14 || gy < top - 20) continue;
      const t = M.money0(g), tw = t.length * 7.8 + 2;
      const left = [10, gy - 18, 12 + tw, gy - 1], right = [w - 12 - tw, gy - 18, w - 10, gy - 1];
      const box = !onLine(left) ? left : !onLine(right) ? right : null;
      grid += '<line x1="0" x2="' + w + '" y1="' + f(gy) + '" y2="' + f(gy) + '" class="fi-gline"/>';
      if (!box) continue;
      gridBoxes.push(box);
      grid += box === left ? '<text x="12" y="' + f(gy - 5) + '" class="fi-glabel" data-grid-label>' + t + '</text>'
        : '<text x="' + f(w - 12) + '" y="' + f(gy - 5) + '" text-anchor="end" class="fi-glabel" data-grid-label>' + t + '</text>';
    }
    const pts = vals.map((v, i) => f(x(i)) + ',' + f(y(v)));
    const area = '<path d="M' + f(x(0)) + ',' + bot + ' L' + pts.join(' L') + ' L' + f(x(vals.length - 1)) + ',' + bot + ' Z" class="fi-area"/>';
    const line = '<polyline points="' + pts.join(' ') + '" class="fi-lineg"/>';
    // The Savings line: flat, stepping only on days money moved in or out of savings.
    let savPath = '', savEnd = '';
    if (hasSav) {
      let d = '', prev = null;
      sav.forEach((v, i) => {
        if (v == null) return;
        if (prev == null) d += 'M' + f(x(i)) + ',' + f(y(v));
        else { d += ' L' + f(x(i)) + ',' + f(y(prev)); if (v !== prev) d += ' L' + f(x(i)) + ',' + f(y(v)); }
        prev = v;
      });
      savPath = '<path d="' + d + '" class="fi-lines" data-savings-line/>';
      const last = sav.length - 1;
      if (sav[last] != null) savEnd = '<circle cx="' + f(x(last)) + '" cy="' + f(y(sav[last])) + '" r="4.5" fill="' + BLUE + '"/>';
    }
    // Amounts on the graph (his picks, Nov 28: "No dots or tag, just dollar amount in blue", "Same for spending").
    // Each paycheck shows only its amount (like +$941) in plain green just over its peak, and each savings move only its
    // amount (like −$93) in plain blue beside its step: no box, no line down, no dot. An amount never sits on a
    // line, another amount, a dollar label or the dates: it tries the spots next to its own peak or step first, then a
    // row higher, and if every spot is taken it is left out rather than cover anything.
    const taken = [[0, h - 24, w, h]].concat(gridBoxes); // the date row and the dollar labels
    const clear = (b) => b[0] >= 2 && b[2] <= w - 2 && b[1] >= 4 &&
      !taken.some((o) => b[0] < o[2] + 3 && o[0] < b[2] + 3 && b[1] < o[3] + 2 && o[1] < b[3] + 2) &&
      !dots.some(([px, py]) => px > b[0] - 3 && px < b[2] + 3 && py > b[1] - 3 && py < b[3] + 3);
    const textAt = (t, cx, base, size, width) => {
      const tw = t.length * width;
      return { box: [cx - tw / 2, base - size + 2, cx + tw / 2, base + 3], cx, base };
    };
    const pins = pinsFor(days, vals);
    let pinSvg = '';
    const placed = [];
    for (const p of pins) {
      const px = x(p.i), py = y(vals[p.i]);
      const label = '+' + M.money0(p.amount);
      const tw = label.length * 8.2;
      const spots = [];
      for (let up = 0; up < 4; up++) for (const dx of [0, tw / 2 + 4, -(tw / 2 + 4)]) spots.push(textAt(label, Math.max(tw / 2 + 3, Math.min(w - 3 - tw / 2, px + dx)), py - 9 - up * 18, 13, 8.2));
      const put = spots.find((s) => clear(s.box));
      placed.push({ day: p.day, x: px });
      if (!put) continue;
      taken.push(put.box);
      pinSvg += '<g class="fi-pin" data-pin="' + p.day + '"><text x="' + f(put.cx) + '" y="' + f(put.base) + '" text-anchor="middle" class="fi-pintext">' + label + '</text></g>';
    }
    let tagSvg = '';
    if (hasSav) {
      for (let i = 1; i < sav.length; i++) {
        if (sav[i] == null || sav[i - 1] == null) continue;
        const d = r2(sav[i] - sav[i - 1]);
        if (Math.abs(d) < 0.5) continue;
        // Read from savings' side: money going into savings is +, money taken out is − (his pick, Nov 28: "Swap the + and - for
        // savings my brain has it backwards", "I meant just on the graph").
        const amt = (d > 0 ? '+' : '−') + M.money0(Math.abs(d));
        const tw = amt.length * 7.9;
        const px = x(i), hiY = Math.min(y(sav[i]), y(sav[i - 1])), loY = Math.max(y(sav[i]), y(sav[i - 1]));
        const mid = (hiY + loY) / 2 + 4;
        // Every step gets its amount (found Nov 28: the $221 move on Nov 18 sat between two other moves a day apart and
        // next to a paycheck peak, found no clear spot in the few it tried, and was left out without a word). Now it tries
        // spots in widening rings around its own step, nearest first, so a label also stays by its step, and if none is
        // clear of the lines it still goes in the nearest spot that covers no other text.
        const spots = [];
        const cxs = [px, px + tw / 2 + 4, px - tw / 2 - 4, px + tw + 8, px - tw - 8];
        for (let up = 0; up < 9; up++) for (const cx of cxs) spots.push(textAt(amt, cx, hiY - 6 - up * 16, 13, 7.9));
        for (let dn = 0; dn < 6; dn++) for (const cx of cxs) spots.push(textAt(amt, cx, loY + 15 + dn * 16, 13, 7.9));
        spots.push(textAt(amt, px + tw / 2 + 5, mid, 13, 7.9), textAt(amt, px - tw / 2 - 5, mid, 13, 7.9));
        const far = (sp) => Math.hypot(sp.cx - px, Math.max(0, hiY - sp.base, sp.base - 13 - loY));
        spots.sort((p1, p2) => far(p1) - far(p2));
        const noText = (b) => b[0] >= 2 && b[2] <= w - 2 && b[1] >= 4 && b[3] <= h - 24 &&
          !taken.some((o) => b[0] < o[2] + 3 && o[0] < b[2] + 3 && b[1] < o[3] + 2 && o[1] < b[3] + 2);
        const put = spots.find((sp) => clear(sp.box)) || spots.find((sp) => noText(sp.box)) || spots[0];
        taken.push(put.box);
        tagSvg += '<g class="fi-stag" data-savings-tag="' + days[i] + '" data-amount="' + d + '" data-step-x="' + f(px) + '"><text x="' + f(put.cx) + '" y="' + f(put.base) + '" text-anchor="middle" class="fi-stagtext">' + amt + '</text></g>';
      }
    }
    const li = vals.length - 1;
    const endDot = '<circle cx="' + f(x(li)) + '" cy="' + f(y(vals[li])) + '" r="9" fill="' + GREEN + '" opacity="0.25"/><circle cx="' + f(x(li)) + '" cy="' + f(y(vals[li])) + '" r="4.5" fill="' + GREEN + '"/>';
    // The date row: the first day, each pin's day, and Today. Each date's width is worked out from its own
    // letters, and a date that would come within 10 of another is left out (found Nov 28: fixed spacing let
    // "October 29" run into "November 6").
    const dy = h - 8;
    const isToday = days[li] === W.today;
    const tw = (t) => t.length * 7.8 + 4; // 13px Inter is under 7.8 a letter
    const span = (l) => { const wd = tw(l.t); return l.a === 'start' ? [l.x, l.x + wd] : l.a === 'end' ? [l.x - wd, l.x] : [l.x - wd / 2, l.x + wd / 2]; };
    const labels = [{ x: 12, t: M.monthDay(days[0]), a: 'start' }, { x: w - 12, t: isToday ? 'Today' : M.monthDay(days[li]), a: 'end' }];
    if (span(labels[0])[1] + 10 > span(labels[1])[0]) labels.shift(); // too narrow for both: keep the newest
    for (const p of placed) {
      const l = { x: p.x, t: M.monthDay(p.day), a: 'middle' };
      const [a0, a1] = span(l);
      if (a0 < 4 || a1 > w - 4 || labels.some((o) => { const [b0, b1] = span(o); return a0 < b1 + 10 && b0 < a1 + 10; })) continue;
      labels.push(l);
    }
    const dates = labels.map((l) => '<text x="' + f(l.x) + '" y="' + dy + '" text-anchor="' + l.a + '" class="fi-glabel" data-date-label>' + l.t + '</text>').join('');
    const seg = [[30, '30 days'], [90, '90 days'], [0, 'All']].map(([n, t]) => '<button type="button" data-range="' + n + '" aria-pressed="' + (range === n) + '">' + t + '</button>').join('');
    const key = '<div class="fi-key"><span><i style="background:' + GREEN + '"></i>Balance ' + M.money0(B.current) + '</span>' +
      (hasSav ? '<span><i style="background:' + BLUE + '"></i>Savings ' + M.money0(W.savings.total) + '</span>' : '') + '</div>';
    const svg = '<svg class="fi-graph" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Balance over the last ' + (range ? range + ' days' : 'year') + ', now ' + M.money(B.current) + (hasSav ? ', savings ' + M.money(W.savings.total) : '') + '">' +
      '<defs><linearGradient id="fiArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + GREEN + '" stop-opacity="0.32"/><stop offset="1" stop-color="' + GREEN + '" stop-opacity="0.02"/></linearGradient></defs>' +
      grid + area + line + savPath + savEnd + pinSvg + tagSvg + endDot + dates + '</svg>';
    return '<section class="fi-card fi-chart"><div class="fi-cardhead"><h2>Balance over time</h2><div class="fi-seg" role="group" aria-label="How far back">' + seg + '</div></div>' + key + svg + '</section>';
  }
  function totals() {
    const B = W.bal;
    const each = B ? B.each.map((a) => '<span class="fi-chip" data-acct="' + esc(a.account) + '">' + esc(a.name) + ' ' + M.money(a.amount) + '</span>').join('') : '';
    const sav = W.savings.rows.map((r) => '<span class="fi-chip">' + esc(r.name) + ' ' + M.money(r.amount) + (r.goal ? ' · For the ' + esc(r.goal) : '') + '</span>').join('');
    const asOf = W.savings.rows.map((r) => r.asOf).filter(Boolean).sort().pop();
    return '<div class="fi-two">' +
      '<section class="fi-card"><p class="fi-cap">Total balance</p><p class="fi-big">' + M.money(B ? B.current : 0) + '</p><div class="fi-chips">' + each + '</div></section>' +
      '<section class="fi-card"><p class="fi-cap">Savings balance</p><p class="fi-big">' + M.money(W.savings.total) + '</p><div class="fi-chips">' + sav + '</div>' + (asOf ? '<p class="fi-note">Last read ' + M.longDay(asOf) + '</p>' : '') + '</section></div>';
  }
  function tileIcon(key) { return '<span class="fi-ticon g-' + GROUP_OF[key] + '">' + ic(ICON[key] || ICON.needs, 22) + '</span>'; }
  function buckets() {
    const Bd = W.budget;
    if (!Bd) return card('Buckets', '<p class="fi-note">The buckets start with the first paycheck on file.</p>');
    const tiles = Bd.tiles;
    let html = '';
    tiles.forEach((t, i) => {
      const isDebt = t.key === 'debt';
      const fill = isDebt ? (t.paidShare || 0) : (t.of > 0 ? Math.max(0, Math.min(1, t.left / t.of)) : 0);
      const amount = isDebt ? M.money(t.left) + ' owed' : M.money(t.left);
      const sub = isDebt ? Math.round((t.paidShare || 0) * 100) + '% paid off' : 'Left of ' + M.money(t.of);
      html += '<button type="button" class="fi-tile g-' + GROUP_OF[t.key] + '" data-tile="' + t.key + '" aria-expanded="' + (openTile === t.key) + '">' + tileIcon(t.key) +
        '<span class="fi-fill" aria-hidden="true"><i style="height:' + (fill * 100).toFixed(1) + '%"></i></span>' +
        '<span class="fi-tname">' + esc(t.name) + '</span><span class="fi-tamt' + (t.left < 0 ? ' neg' : '') + '">' + amount + '</span><span class="fi-tsub">' + sub + '</span></button>';
      // The tapped bucket opens one short line under its row, with the breakdown in a dropdown (his pick, Nov 24).
      const rowEnd = i % 2 === 1 || i === tiles.length - 1;
      const openHere = openTile && rowEnd && [tiles[i - (i % 2)], tiles[i]].some((x) => x && x.key === openTile);
      if (openHere) html += tileInfo(tiles.find((x) => x.key === openTile));
    });
    const NC = Bd.notCovered || {};
    const gaps = [['planned', ' of your Quick-Budget plans'], ['wish', ' set aside for wishlists'], ['subs', ' of Subscriptions'], ['gas', ' of Gas'], ['more', ' more']]
      .filter(([k]) => NC[k] > 0.005).map(([k, w]) => M.money(NC[k]) + w);
    const gapText = gaps.length ? ' Not covered until payday: ' + (gaps.length > 1 ? gaps.slice(0, -1).join(', ') + ' and ' + gaps[gaps.length - 1] : gaps[0]) + '.' : '';
    const short = Bd.shortBy > 0.005 ? '<p class="fi-warn">Your accounts are ' + M.money(Bd.shortBy) + ' short of this paycheck\'s plan.' + gapText + '</p>' : '';
    return '<section class="fi-card fi-buckets"><div class="fi-cardhead"><h2>Buckets</h2><span class="fi-note">Paycheck of ' + M.monthDay(Bd.P.start) + '</span></div>' + short + '<div class="fi-grid">' + html + '</div></section>';
  }
  function tileInfo(t) {
    if (!t) return '';
    const key = t.key === 'needs' ? 'needs' : t.key === 'wants' ? 'wants' : t.key;
    const bd = (W.budget.breakdown || {})[key] || {};
    const head = t.share ? t.name + ': ' + t.share + '% · ' + M.money0(t.whole || t.of) + ' this paycheck' : t.name + ': ' + M.money0(t.of) + ' this paycheck';
    const set = (bd.set || []).map(([n, a]) => '<li><span>' + esc(n) + '</span><span>' + (a < 0 ? M.signed(a) : M.money(a)) + '</span></li>').join('');
    const spent = Object.entries(bd.spent || {}).filter(([, a]) => a > 0.005).sort((a, b) => b[1] - a[1]).map(([c, a]) => '<li><span>Spent on ' + esc((M.CATS[c] || { name: c }).name) + '</span><span>' + M.signed(-a) + '</span></li>').join('');
    const covered = bd.covered > 0.005 ? '<li><span>Covered from other buckets</span><span>' + M.money(bd.covered) + '</span></li>' : '';
    const note = bd.note ? '<p class="fi-note">' + esc(bd.note) + '</p>' : '';
    const has = set || spent || covered || note;
    return '<div class="fi-info"><p class="fi-infohead">' + esc(head) + '</p>' + (has ? '<button type="button" class="fi-break" data-break aria-expanded="' + openBreak + '">Breakdown ' + ic(ICON.chev, 18) + '</button>' + (openBreak ? '<ul class="fi-list">' + set + spent + covered + '</ul>' + note : '') : '') + '</div>';
  }
  function pie() {
    const periods = W.periods;
    if (!periods.length) return '';
    const p = periods[Math.min(pieAt, periods.length - 1)];
    const v = W._v;
    const P = M.pieFor(v.fin, v.months, p.start, p.end);
    const names = periods.map((x, i) => i === 0 ? 'This paycheck' : i === 1 ? 'Last paycheck' : 'Paycheck of ' + M.monthDay(x.start));
    const sel = '<label class="fi-select"><select data-pie aria-label="Which paycheck">' + names.map((n, i) => '<option value="' + i + '"' + (i === pieAt ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>' + ic(ICON.chev, 18) + '</label>';
    const r = 70, C = 2 * Math.PI * r;
    let off = 0, arcs = '', lists = '';
    const pct = percents(P.groups.map((g) => g.share || 0));
    for (const [gi, g] of P.groups.entries()) {
      const shades = SHADES[g.group] || SHADES.unsorted;
      const rows = g.cats.map((c, i) => {
        const col = shades[Math.min(i, shades.length - 1)];
        const len = P.total ? (c.total / P.total) * C : 0;
        arcs += '<circle r="' + r + '" cx="90" cy="90" fill="none" stroke="' + col + '" stroke-width="30" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"/>';
        off += len;
        return '<li><i class="sq" style="background:' + col + '"></i><span>' + esc(c.name) + '</span><span>' + M.money(c.total) + '</span></li>';
      }).join('');
      const back = g.group === 'savings' && g.out > 0.005;
      const extra = back ? '<li class="fi-out"><i class="sq" aria-hidden="true"></i><span>Taken back out</span><span>' + M.signed(-g.out) + '</span></li><li class="fi-kept"><i class="sq" aria-hidden="true" style="background:' + GROUP_COLOR.savings + '"></i><span>Kept</span><span>' + M.money(g.kept) + '</span></li>' : '';
      const shown = back ? M.money(g.kept) + ' kept' : M.money(g.total);
      lists += '<div class="fi-group"><p class="fi-gname" style="--gc:' + GROUP_COLOR[g.group] + '">' + esc(g.name) + '</p><p class="fi-gsum" data-pct="' + pct[gi] + '">' + pct[gi] + '% · ' + shown + '</p><ul class="fi-list">' + rows + extra + '</ul></div>';
    }
    // The total sits inside the ring, drawn as part of the picture so nothing can slide over it.
    const donut = '<div class="fi-donut"><svg viewBox="0 0 180 180" role="img" aria-label="Spent ' + M.money(P.total) + ' since ' + M.monthDay(p.start) + '"><g transform="rotate(-90 90 90)"><circle r="' + r + '" cx="90" cy="90" fill="none" class="fi-ring" stroke-width="30"/>' + arcs + '</g>' +
      '<text x="90" y="88" text-anchor="middle" class="fi-midb">' + M.money(P.total) + '</text><text x="90" y="106" text-anchor="middle" class="fi-mids">Spent since</text><text x="90" y="119" text-anchor="middle" class="fi-mids">' + M.monthDay(p.start) + '</text></svg></div>';
    return '<section class="fi-card fi-pie"><div class="fi-cardhead"><h2>Where your money went</h2>' + sel + '</div>' + (P.groups.length ? '<div class="fi-piebody">' + donut + '<div class="fi-groups">' + lists + '</div></div>' : '<p class="fi-note">Nothing spent in this paycheck yet.</p>') + '</section>';
  }

  // ----- Activity -----
  function activity() {
    const B = W.bal;
    const each = B ? B.each.map((a) => '<span class="fi-chip" data-acct="' + esc(a.account) + '">' + esc(a.name) + ' ' + M.money(a.amount) + '</span>').join('') : '';
    const most = Math.max(1, ...W.week.days.map((d) => d.spent));
    const week = W.week.days.map((d) => '<li><span>' + esc(d.label) + '</span><span class="fi-wbar"><i style="width:' + (d.spent / most * 100).toFixed(1) + '%"></i></span><span class="num">' + M.money(d.spent) + '</span></li>').join('');
    const days = W.activity.slice(0, actDays).map((d) => {
      const label = d.day === W.today ? 'Today · ' + M.longDay(d.day) : d.day === M.addDays(W.today, -1) ? 'Yesterday · ' + M.longDay(d.day) : M.longDay(d.day);
      const rows = d.rows.map((r) => {
        const chips = (r.pending ? '<span class="fi-tag">Pending</span>' : '') + (r.ask ? '<span class="fi-tag on">What was it for?</span>' : '') + (r.naming ? '<span class="fi-tag">Name coming</span>' : '') + (r.double ? '<span class="fi-tag warn">Maybe counted twice</span>' : '') + (r.ruled ? '<span class="fi-tag">Store rule</span>' : '');
        return '<button type="button" class="fi-row" data-tx="' + esc(r.id) + '"><span class="fi-rname"><b>' + esc(r.name) + '</b><span>' + esc(oneLine([r.catName, r.bucketName, r.account])) + '</span>' + (chips ? '<span class="fi-tags">' + chips + '</span>' : '') + '</span>' +
          '<span class="num ' + (r.amount < 0 ? 'out' : 'in') + '">' + M.signed(r.amount) + '</span><span class="num"><span class="fi-bal' + (r.balance < 0 ? ' neg' : '') + '">' + (r.balance == null ? '' : M.money(r.balance)) + '</span></span></button>';
      }).join('');
      return '<section class="fi-card fi-day"><div class="fi-dayhead"><h3>' + label + '</h3><span>Amount</span><span>Balance</span></div>' + rows + '</section>';
    }).join('');
    const more = W.activity.length > actDays ? '<button type="button" class="fi-more" data-more>Show earlier days</button>' : '';
    return '<div class="fi-cols"><div class="fi-col">' +
      '<section class="fi-card"><p class="fi-cap">Total balance</p><p class="fi-big">' + M.money(B ? B.current : 0) + '</p><div class="fi-chips">' + each + '</div></section>' +
      '<section class="fi-card"><div class="fi-cardhead"><h2>Spent the last 7 days</h2><b class="num">' + M.money(W.week.total) + '</b></div><p class="fi-note">Leaves out transfers, savings moves and debt payoffs.</p><ul class="fi-week">' + week + '</ul></section>' +
      rulesCard() + '</div><div class="fi-col">' +
      '<p class="fi-hint">Tap a charge to fix its name, category or bucket.</p>' + days + more + '</div></div>';
  }
  function rulesCard() {
    const rows = W.rules.map((r) => '<li><span><b>' + esc(r.store) + '</b><span>' + esc(oneLine([(M.CATS[r.cat] || { name: 'Same category' }).name, M.BUCKETS[r.u] || 'Same bucket'])) + '</span></span><button type="button" class="fi-small" data-undo-rule="' + esc(r.id) + '">Undo</button></li>').join('');
    return '<section class="fi-card fi-last"><div class="fi-cardhead"><h2>Store rules</h2></div>' + (rows ? '<ul class="fi-rules">' + rows + '</ul>' : '<p class="fi-note">None yet. When you fix a charge, you can make that store always go the same way.</p>') + '</section>';
  }

  // ----- Wishlists -----
  // Wishlists, his pick C (Nov 26; canvas board WishC2): a slim "Your wishlist" row with Add, then each item filling up
  // like a bucket. Its amount shows once, with a plain line for each move saying where it came from and when; a move's
  // own amount shows only when the item has 2 or more moves. Each item keeps Bought it. Set money aside is the one round
  // + floating bottom right. Bought items fold into an archive at the bottom.
  function moveLine(f, many) {
    const when = f.day ? M.monthDay(f.day) : '';
    const where = f.paycheck ? 'From the paycheck of ' + M.monthDay(f.paycheck) : f.label ? f.label + (when ? ', ' + when : '') : f.inPot ? 'Moved to savings' + (when ? ', ' + when : '') : 'Set aside by hand' + (when ? ', ' + when : '');
    return '<li class="fi-move">' + (many ? '<b>' + M.money(f.amount) + '</b> · ' : '') + esc(where) + '</li>';
  }
  function wishlists() {
    const Wl = W.wish;
    const items = Wl.open.map((i) => {
      const many = i.from.length > 1;
      const moves = i.from.length ? '<ul class="fi-moves">' + i.from.map((f) => moveLine(f, many)).join('') + '</ul>' : '';
      return '<section class="fi-card fi-wish" data-wish="' + esc(i.id) + '"><span class="fi-fill" aria-hidden="true"><i style="height:' + (i.share * 100).toFixed(1) + '%"></i></span>' +
        '<span class="fi-wicon" aria-hidden="true">' + ic(ICON.wishlists, 24) + '</span>' +
        '<h2>' + esc(i.name) + '</h2><p class="fi-wamt"><b>' + M.money(i.saved) + '</b> of ' + M.money(i.amount) + ' set aside</p>' +
        '<span class="fi-bar fi-wishbar"><i style="width:' + (i.share * 100).toFixed(1) + '%"></i></span>' + moves +
        '<div class="fi-btns"><button type="button" class="fi-small" data-bought="' + esc(i.id) + '">Bought it</button></div></section>';
    }).join('');
    const bought = Wl.bought.length ? '<section class="fi-card fi-last"><button type="button" class="fi-fold" data-show-bought aria-expanded="' + showBought + '">Bought and archived · ' + Wl.bought.length + ic(ICON.chev, 18) + '</button>' +
      (showBought ? '<ul class="fi-list">' + Wl.bought.map((i) => '<li><span>' + esc(i.name) + '</span><span>' + (i.bought ? M.monthDay(i.bought) : '') + '</span></li>').join('') + '</ul>' : '') + '</section>' : '';
    const fab = Wl.open.length && W.budget ? '<div class="fi-fabs" data-floats><button type="button" class="plus" data-aside-pick aria-label="Set money aside">' + ic(ICON.plus, 28) + '</button></div>' : '';
    return '<div class="fi-wrow"><span class="fi-cap">Your wishlist</span><button type="button" class="fi-small fi-addw" data-add-wish>' + ic(ICON.plus, 18) + 'Add</button></div>' +
      '<div class="fi-wgrid' + (Wl.open.length === 1 ? ' one' : '') + '">' + (items || '<p class="fi-note">Nothing on your wishlists yet.</p>') + '</div>' + bought + fab;
  }


  // ----- Debt -----
  function debt() {
    const D = W.debts;
    // The soonest payment shows on the top card only with 2 or more debts; with one, its own card already says it
    // (found Nov 28: "Next due Wednesday, December 2 · $40.00" showed twice).
    const next = D.nextDue && D.open.length > 1 ? '<p class="fi-note">Next due ' + M.longDay(D.nextDue.due) + ' · ' + M.money(D.nextDue.amount) + '</p>' : '';
    const free = !D.open.length ? '<span class="fi-chip on">' + (D.debtFreeSince ? 'Debt-free since ' + M.longDay(D.debtFreeSince) : 'Debt-free') + '</span>' : '';
    const cards = D.open.map((d) => '<section class="fi-card fi-debtcard" data-debt="' + esc(d.id) + '"><div class="fi-cardhead"><div><h2>' + esc(d.name) + '</h2>' + (d.owedTo ? '<p class="fi-note">Owed to ' + esc(d.owedTo) + '</p>' : '') + '</div><div class="fi-right"><b>' + M.money(d.owed) + ' left</b><span class="fi-note">Of ' + M.money(d.total) + '</span></div></div>' +
      (d.next ? '<p class="fi-line2">Next: ' + M.money(d.next.amount) + ' on ' + M.longDay(d.next.due) + '</p>' : '') +
      (d.auto ? '<p class="fi-line2">Moved out of savings since ' + M.longDay(d.since) + '. Moving money back in pays it down.</p>' : '') +
      '<span class="fi-bar g-debt"><i style="width:' + (d.paidShare * 100).toFixed(1) + '%"></i></span><p class="fi-note">' + Math.round(d.paidShare * 100) + '% paid off</p>' +
      (d.fromEmail ? '<span class="fi-chip">Added from email</span>' : '') + '</section>').join('');
    const paid = D.done.length ? '<section class="fi-card fi-last"><button type="button" class="fi-fold" data-show-paid aria-expanded="' + showPaid + '">Paid off · ' + D.done.length + ic(ICON.chev, 18) + '</button>' +
      (showPaid ? '<ul class="fi-list">' + D.done.map((d) => '<li><span>' + esc(d.name) + '</span><span>' + (d.total ? M.money(d.total) : '') + '</span></li>').join('') + '</ul>' : '') + '</section>' : '';
    return '<div class="fi-cols"><div class="fi-col"><section class="fi-card"><div class="fi-cardhead"><div><p class="fi-cap">Total owed</p><p class="fi-big">' + M.money(D.totalOwed) + '</p></div><button type="button" class="addbtn" data-add-debt>' + ic(ICON.plus, 18) + 'Add</button></div>' + next + free + '</section>' + paid + '</div><div class="fi-col">' + cards + '</div></div>';
  }

  // ----- Quick-budget -----
  function quick() {
    const notes = W.notes.slice().reverse().map(noteRow).join('');
    const planned = W.planned.map((x) => '<li><span><b>' + esc(x.name) + '</b><span>' + (x.when ? M.longDay(x.when) : 'Next paycheck') + ' · From ' + esc(M.BUCKETS[x.bucket] || 'Wants') + '</span></span><span class="num">' + M.money(x.amount) + '</span></li>').join('');
    return '<div class="fi-cols"><div class="fi-col"><section class="fi-card"><form class="fi-noteform" data-note-form autocomplete="off"><label class="fld"><span>New note</span><textarea rows="3" maxlength="600" placeholder="For example: Lent $40 to a friend, paying me back December 5"></textarea></label>' +
      '<p class="fi-note">Claude reads notes at 7:42 AM and 8:42 PM.</p><button type="submit" class="wide">Send</button></form></section>' +
      (planned ? '<section class="fi-card"><div class="fi-cardhead"><h2>Planned</h2></div><ul class="fi-rules">' + planned + '</ul></section>' : '') + '</div><div class="fi-col">' +
      '<section class="fi-card"><div class="fi-cardhead"><h2>Notes</h2></div>' + (notes ? '<ul class="fi-notes">' + notes + '</ul>' : '<p class="fi-note">No notes yet.</p>') + '</section></div></div>';
  }
  function noteRow(n) {
    const st = n.status === 'done' ? ['Done', 'on'] : n.status === 'question' ? ['Question', 'q'] : ['Waiting', ''];
    return '<li data-note="' + esc(n.id) + '"><p>' + esc(n.text) + '</p><div class="fi-nmeta"><span class="fi-tag ' + st[1] + '">' + st[0] + '</span><span class="fi-note">' + (n.at ? M.longDay(M.todayISO(new Date(n.at))) : '') + '</span></div>' + (n.answer ? '<p class="fi-note">' + esc(n.answer) + '</p>' : '') + '</li>';
  }

  function card(title, inner) { return '<section class="fi-card"><div class="fi-cardhead"><h2>' + esc(title) + '</h2></div>' + inner + '</section>'; }

  // ---------- Sheets ----------
  const closeBtn = '<button type="button" class="round" data-close aria-label="Close">' + ic(ICON.close, 18) + '</button>';
  function openSheet(title, inner) {
    $$('.sheet').forEach((s) => { s.hidden = true; });
    sheetCard.innerHTML = '<div class="sheet-top"><h2 id="fin-sheet-title">' + esc(title) + '</h2>' + closeBtn + '</div>' + inner;
    sheet.hidden = false;
    document.body.classList.add('sheet-up');
    const f = $('input, textarea, select', sheetCard);
    if (f && !matchMedia('(pointer: coarse)').matches) f.focus();
  }
  function closeSheet(el) {
    fromMissed = false;
    (el || sheet).hidden = true;
    if (!$$('.sheet').some((s) => !s.hidden)) document.body.classList.remove('sheet-up');
  }
  const opts = (list, names, pick) => list.map((k) => '<option value="' + esc(k) + '"' + (k === pick ? ' selected' : '') + '>' + esc(names[k]) + '</option>').join('');
  const catNames = Object.fromEntries(Object.entries(M.CATS).map(([k, c]) => [k, c.name]));
  function findTx(id) { return M.allTx(W._v.months).find((t) => t.id === id); }

  function fixSheet(id, tick) {
    const t = findTx(id);
    if (!t) return;
    // A check or money sent to a person is a one-off: no "always" rule for it.
    const oneOff = /^check #/i.test(M.cleanName(t.s || '')) || M.catOf(t, []) === 'people';
    const rules = (W._v.fin.storeRules || {}).items || [];
    const cat = M.catOf(t, rules), bucket = M.bucketOf(t, rules) === 'gym' ? 'subs' : M.bucketOf(t, rules);
    const store = M.cleanName(t.s || '');
    openSheet('Fix this charge', '<form class="fi-form" data-fix="' + esc(id) + '" autocomplete="off">' +
      '<p class="hint">' + esc(M.longDay(t.d)) + ' · ' + M.signed(t.a) + ' · ' + esc(t.k || '') + '</p>' +
      '<label class="fld"><span>Name</span><input name="name" value="' + esc(t.name || '') + '" placeholder="' + esc(M.nameOf(t)) + '"></label>' +
      '<label class="fld"><span>Category</span><select name="cat">' + opts(M.PICK_CATS, catNames, cat) + '</select></label>' +
      '<label class="fld"><span>Bucket</span><select name="bucket">' + opts(M.PICK_BUCKETS, M.BUCKETS, bucket) + '</select></label>' +
      (oneOff ? '' : '<label class="fi-check"><input type="checkbox" name="always"' + (tick ? ' checked' : '') + '><i class="fi-box" aria-hidden="true"></i><span>Always do this for ' + esc(store) + '</span></label>') +
      '<button type="submit" class="wide">Save</button></form>');
  }
  // ---------- Missed charges pop-up (his pick, Nov 25) ----------
  // When he opens the Hub and some charges couldn't be sorted, this pops up once: Label now opens the fix
  // sheet (and comes back here for the rest), Label later leaves it in the Questions inbox for any time.
  // Closing it changes nothing; it asks again next time he opens the Hub.
  const shownMissed = new Set();
  let fromMissed = false;
  function missedList() { return W && W._v ? M.missed(W._v.fin, W._v.months, W.today) : { all: [], now: [] }; }
  function maybeMissed() {
    if (!ready || document.hidden || document.body.classList.contains('sheet-up')) return;
    if (($('#connect') && !$('#connect').hidden) || ($('#lockcard') && !$('#lockcard').hidden)) { setTimeout(maybeMissed, 1500); return; } // after the key or lock screen
    if (missedList().now.some((m) => !shownMissed.has(m.id))) missedSheet();
  }
  function missedSheet() {
    const L = missedList(), n = L.now.length;
    fromMissed = false;
    if (!n) { if (!sheet.hidden) closeSheet(); return; }
    L.now.forEach((m) => shownMissed.add(m.id));
    const title = 'You have ' + n + ' missed charge' + (n === 1 ? '' : 's');
    const rows = L.now.map((m) => '<li class="fi-missed" data-missed-id="' + esc(m.id) + '"><span><b>' + esc(m.name) + '</b><span>' + esc(M.longDay(m.d)) + ' · ' + esc(m.account) + '</span></span>' +
      '<span class="num out">' + M.signed(m.a) + '</span>' +
      '<div class="fi-btns"><button type="button" class="wide" data-label-now="' + esc(m.id) + '">Label now</button><button type="button" class="fi-small" data-label-later="' + esc(m.id) + '">Label later</button></div></li>').join('');
    openSheet(title, '<p class="hint">Claude couldn\'t sort ' + (n === 1 ? 'this charge' : 'these charges') + '. Until you label ' + (n === 1 ? 'it, it counts' : 'them, they count') + ' in Wants.</p>' +
      '<ul class="fi-rules">' + rows + '</ul><p class="fi-note">Label later keeps it in your Questions inbox, to answer any time.</p>');
  }
  function whoSheet() {
    const D = W.debts;
    const rows = D.open.map((d) => '<li><span><b>' + esc(d.owedTo || d.name) + '</b><span>' + esc(d.name) + (d.next ? ' · Next: ' + M.money(d.next.amount) + ' on ' + M.longDay(d.next.due) : '') + '</span></span><span class="num">' + M.money(d.owed) + '</span></li>').join('');
    openSheet('Who you owe', (rows ? '<ul class="fi-rules">' + rows + '</ul>' : '<p class="hint">You don\'t owe anyone right now.</p>') + '<button type="button" class="wide" data-go-debt>Open the Debt page</button>');
  }
  function addDebtSheet() {
    openSheet('Add a debt', '<form class="fi-form" data-add-debt-form autocomplete="off">' +
      '<label class="fld"><span>What it is</span><input name="name" required placeholder="For example: Klarna for the headphones"></label>' +
      '<label class="fld"><span>Who it\'s owed to (optional)</span><input name="owedTo" placeholder="For example: Klarna"></label>' +
      '<label class="fld"><span>Amount owed</span><input name="owed" required inputmode="decimal" placeholder="For example: $120"></label>' +
      '<div class="fld-row"><label class="fld"><span>Next payment (optional)</span><input name="pay" inputmode="decimal" placeholder="For example: $40"></label><label class="fld"><span>Due (optional)</span><input name="due" type="date"></label></div>' +
      '<p class="hint">Next payment and Due go together: fill in both, or leave both empty.</p>' +
      '<div class="fi-btns"><button type="button" class="fi-small" data-close>Cancel</button><button type="submit" class="wide">Save</button></div></form>');
  }
  function addWishSheet() {
    const lists = W.wish.lists;
    openSheet('Add to a wishlist', '<form class="fi-form" data-add-wish-form autocomplete="off">' +
      '<label class="fld"><span>What it is</span><input name="name" required></label>' +
      '<label class="fld"><span>Price</span><input name="amount" required inputmode="decimal" placeholder="For example: $60"></label>' +
      (lists.length ? '<label class="fld"><span>Wishlist</span><select name="list">' + lists.map((l) => '<option value="' + esc(l.id) + '">' + esc(l.name) + '</option>').join('') + '</select></label>' : '') +
      '<button type="submit" class="wide">Save</button></form>');
  }
  // The round + opens this: pick the item, then the amount (his pick C, Nov 26).
  function asideSheet(id) {
    const open = W.wish.open;
    if (!open.length || !W.budget) return;
    const pick = open.find((x) => x.id === id) || open[0];
    openSheet('Set money aside', '<form class="fi-form" data-aside-form autocomplete="off">' +
      '<label class="fld"><span>For</span><select name="item">' + open.map((i) => '<option value="' + esc(i.id) + '"' + (i.id === pick.id ? ' selected' : '') + '>' + esc(i.name) + ' · ' + M.money(i.saved) + ' of ' + M.money(i.amount) + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Amount</span><input name="amount" required inputmode="decimal" placeholder="For example: $25"></label>' +
      '<p class="hint">From the paycheck of ' + M.monthDay(W.budget.P.start) + '. It\'s held from then on, so it can\'t be spent by accident.</p>' +
      '<button type="submit" class="wide">Set aside</button></form>');
  }

  function boughtSheet(id) {
    const i = W.wish.open.find((x) => x.id === id);
    if (!i) return;
    openSheet('Bought it?', '<p class="hint">' + esc(i.name) + ' moves to the archive at the bottom of Wishlists.</p><div class="fi-btns"><button type="button" class="fi-small" data-close>Cancel</button><button type="button" class="wide" data-bought-yes="' + esc(id) + '">Yes, I bought it</button></div>');
  }
  const amt = (s) => { const n = parseFloat(String(s || '').replace(/[$,\s]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };

  // ---------- Taps ----------
  page.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fiTab) { tab = b.dataset.fiTab; openTile = null; render(); page.scrollTop = 0; return; }
    if (b.dataset.range != null) { range = +b.dataset.range; render(); return; }
    if (b.dataset.tile) { if (b.dataset.tile === 'debt') { whoSheet(); return; } openTile = openTile === b.dataset.tile ? null : b.dataset.tile; openBreak = false; render(); return; }
    if (b.hasAttribute('data-break')) { openBreak = !openBreak; render(); return; }
    if (b.dataset.tx) { fixSheet(b.dataset.tx); return; }
    if (b.hasAttribute('data-more')) { actDays += 10; render(); return; }
    if (b.dataset.undoRule) { add({ type: 'undoRule', ruleId: b.dataset.undoRule }); return; }
    if (b.hasAttribute('data-add-debt')) { addDebtSheet(); return; }
    if (b.hasAttribute('data-add-wish')) { addWishSheet(); return; }
    if (b.hasAttribute('data-aside-pick')) { asideSheet(); return; }
    if (b.dataset.bought) { boughtSheet(b.dataset.bought); return; }
    if (b.hasAttribute('data-show-bought')) { showBought = !showBought; render(); return; }
    if (b.hasAttribute('data-show-paid')) { showPaid = !showPaid; render(); return; }
    if (b.hasAttribute('data-fin-waiting')) { waitingSheet(); return; }
  });
  page.addEventListener('change', (e) => { if (e.target.matches('[data-pie]')) { pieAt = +e.target.value; render(); } });
  page.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.matches('[data-note-form]')) return;
    e.preventDefault();
    const ta = $('textarea', f);
    if (sendNote(ta.value, 'finance')) ta.value = '';
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) { closeSheet(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-go-debt')) { closeSheet(); tab = 'debt'; render(); page.scrollTop = 0; return; }
    if (b.dataset.boughtYes) { add({ type: 'bought', itemId: b.dataset.boughtYes }); closeSheet(); }
    if (b.dataset.labelNow) { fixSheet(b.dataset.labelNow, true); fromMissed = true; return; }
    if (b.dataset.labelLater) { const t = findTx(b.dataset.labelLater); add({ type: 'labelLater', txId: b.dataset.labelLater, name: t ? M.nameOf(t) : '' }); missedSheet(); return; }
  });
  sheet.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, v = (n) => (f.elements[n] ? f.elements[n].value.trim() : '');
    const at = new Date().toISOString();
    if (f.dataset.fix) {
      const t = findTx(f.dataset.fix);
      add({ type: 'fixCharge', txId: f.dataset.fix, name: v('name'), cat: v('cat'), bucket: v('bucket') });
      if (t && f.elements.always && f.elements.always.checked) add({ type: 'addRule', rule: { id: S.newId('r'), store: M.cleanName(t.s || ''), cat: v('cat'), u: v('bucket'), at, from: 'Josh, fixing a charge in the new Hub' } });
    } else if (f.hasAttribute('data-add-debt-form')) {
      const owed = amt(v('owed'));
      if (!v('name') || !owed) { f.reportValidity(); return; }
      const id = S.newId('d'), pay = amt(v('pay'));
      // A payment needs both its amount and its day; one alone used to be dropped without a word.
      const half = !!pay !== !!v('due');
      const other = f.elements[pay ? 'due' : 'pay'];
      other.setCustomValidity(half ? 'Fill in both, or leave both empty' : '');
      if (half) { other.reportValidity(); other.addEventListener('input', () => other.setCustomValidity(''), { once: true }); return; }
      add({ type: 'addDebt', item: { id, name: v('name'), owedTo: v('owedTo'), owed, total: owed, source: 'app', added: at },
        payment: pay && v('due') ? { id: S.newId('p'), debtId: id, name: v('name'), amount: pay, due: v('due'), paid: false } : null });
    } else if (f.hasAttribute('data-add-wish-form')) {
      const price = amt(v('amount'));
      if (!v('name') || !price) { f.reportValidity(); return; }
      add({ type: 'addWish', listId: v('list'), item: { id: S.newId('w'), name: v('name'), amount: price, saved: 0, added: at } });
    } else if (f.hasAttribute('data-aside-form')) {
      const a = amt(v('amount'));
      if (!a || !v('item')) { f.reportValidity(); return; }
      const d = new Date(), on = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      add({ type: 'setAside', itemId: v('item'), amount: a, paycheck: W.budget.P.start, on });
    } else return;
    if (fromMissed && f.dataset.fix) { missedSheet(); return; }
    closeSheet();
  });

  // ---------- Notes (Quick-budget and Plan's message box) ----------
  function sendNote(text, pg) {
    text = String(text || '').trim();
    if (!text) return false;
    add({ type: 'addNote', page: pg === 'plan' ? 'Plan' : 'Finance', note: { id: S.newId('n'), page: pg, text, at: new Date().toISOString() } });
    toast(pg === 'plan' ? 'Sent. Claude will see it.' : 'Note sent.');
    return true;
  }
  function planNotes() {
    const v = view();
    return ((v.notes || {}).items || []).filter((n) => n.page === 'plan').slice(-5).reverse();
  }
  function renderPlanMsg() {
    const list = planNotes();
    $('.pm-list', msgSheet).innerHTML = list.length ? list.map(noteRow).join('') : '';
    $('.pm-recent', msgSheet).hidden = !list.length;
    $('.pm-state', msgSheet).textContent = savingLine() || '';
  }
  if (msgSheet) {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-planmsg]');
      if (!b) return;
      $$('.sheet').forEach((s) => { s.hidden = true; });
      renderPlanMsg();
      msgSheet.hidden = false;
      document.body.classList.add('sheet-up');
    });
    msgSheet.addEventListener('click', (e) => { if (e.target === msgSheet || e.target.closest('[data-close]')) closeSheet(msgSheet); });
    $('form', msgSheet).addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = $('textarea', msgSheet);
      if (!base.fin) { toast('Still loading. Try again in a moment.'); return; }
      if (sendNote(ta.value, 'plan')) { ta.value = ''; renderPlanMsg(); }
    });
  }

  // ---------- Saving ----------
  function add(change) {
    S.add(Object.assign({ page: 'Finance' }, change));
    render();
    if (msgSheet && !msgSheet.hidden) renderPlanMsg();
    saveSoon(600);
  }
  function savingLine() {
    const n = S.list().filter((c) => c.type !== 'log').length;
    if (n) {
      const count = n === 1 ? '1 change waiting to save' : n + ' changes waiting to save';
      return S.isReadOnly() ? count + ': the key here can only read' : savingNow ? 'Saving…' : count;
    }
    return Date.now() - justSaved < 2500 ? 'All saved' : '';
  }
  function showSaving() {
    const t = savingLine();
    $('.fi-ptext', pendingEl).textContent = t;
    pendingEl.hidden = !t;
    pendingEl.classList.toggle('is-bad', S.isReadOnly() && !!S.list().length);
    pendingEl.dataset.state = !S.list().length ? (t ? 'saved' : 'none') : S.isReadOnly() ? 'readonly' : savingNow ? 'saving' : 'waiting';
    if (msgSheet && !msgSheet.hidden) $('.pm-state', msgSheet).textContent = t;
  }
  function waitingSheet() {
    const list = S.list().filter((c) => c.type !== 'log').map((c) => '<li><span>' + esc(S.describe(c)) + '</span></li>').join('');
    openSheet('Waiting to save', '<ul class="fi-list">' + list + '</ul><p class="hint">' + (S.isReadOnly() ? 'The key on this phone can only read. Put in a key that can save.' : 'These save as soon as your data can be reached.') + '</p>' +
      (S.isReadOnly() ? '<button type="button" class="wide" data-change-key-fin>Change key</button>' : ''));
    const ck = $('[data-change-key-fin]', sheetCard);
    const real = document.querySelector('[data-change-key]');
    if (ck && real) ck.addEventListener('click', () => real.click());
  }
  function toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function saveSoon(ms) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, ms); }
  async function saveNow() {
    if (savingNow) { again = true; return; }
    if (!store || !S.list().length || S.isReadOnly()) return;
    savingNow = true; showSaving();
    const r = await S.save(store);
    savingNow = false;
    pendingEl.dataset.why = r.saved ? 'saved' : r.why + (r.error && r.error.message ? ': ' + r.error.message : '');
    // Show what was written, so the screen matches the data (including anything a robot added in between).
    if (r.files) {
      if (r.files.fin) base.fin = r.files.fin;
      if (r.files.months) base.months = r.files.months;
      if (r.files.notes) base.notes = r.files.notes;
      lastRead = Date.now();
    }
    const cameIn = again; again = false;
    if (r.saved) {
      justSaved = Date.now();
      setTimeout(showSaving, 2600);
      if (S.list().length) saveSoon(300);
    } else if (cameIn && !['readonly', 'badkey', 'unsafe'].includes(r.why)) {
      saveSoon(300);
    } else if (r.why === 'readonly') {
      toast('The key here can only read, so your Finance changes are waiting. Put in a key that can save: Menu, Settings, Change key.');
    } else if (r.why === 'badkey') {
      toast('GitHub stopped accepting the key on this phone. Your changes are waiting here. Put in a new key: Menu, Settings, Change key.');
    } else if (r.why === 'unsafe') {
      toast('A Finance change was stopped because it would have removed something. Nothing was lost.');
    } else if (r.why !== 'busy' && r.why !== 'nothing') {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(saveNow, 30000); // no signal or GitHub busy: try again in a while. Nothing is lost.
    }
    render();
    if (msgSheet && !msgSheet.hidden) renderPlanMsg();
  }
  async function catchUp() {
    if (!ready || document.hidden) return;
    if (S.list().length) { saveNow(); return; }
    if (Date.now() - lastRead < 60000) return;
    try {
      const [fin, months, notes] = await Promise.all([store.read('data/fin.json'), store.read('data/fin.config.months.json'), store.readOptional('data/notes.json')]);
      base = { fin: fin || base.fin, months: months || base.months, notes: notes || base.notes };
      lastRead = Date.now();
    } catch (e) { /* keep what's on screen */ }
    render();
    maybeMissed();
  }
  document.addEventListener('visibilitychange', catchUp);
  window.addEventListener('online', catchUp);

  const Finance = {
    // keepTab: a reload after an undo stays on the tab he is looking at.
    async load(Data, opts) {
      store = Data;
      S.start();
      const [fin, months, notes] = await Promise.all([Data.read('data/fin.json'), Data.read('data/fin.config.months.json'), Data.readOptional('data/notes.json')]);
      base = { fin: fin || {}, months: months || {}, notes };
      lastRead = Date.now();
      if (!(opts && opts.keepTab)) tab = 'spending'; // Finance always opens on Spending (his pick, Nov 24)
      render();
      ready = true;
      document.documentElement.dataset.finance = 'ready';
      if (S.list().length) saveSoon(500);
      setTimeout(maybeMissed, 400); // after the pages are placed, so it opens over whichever page he's on
    },
    showError(text) { bodyEl.innerHTML = '<section class="fi-card"><p class="fi-note">' + esc(text) + '</p></section>'; },
    pick(t) { if (TABS.some(([k]) => k === t)) { tab = t; render(); } },
    // For the Questions inbox: charges still to label, and Label now from there.
    missed() { return missedList().all.map((m) => Object.assign({ day: M.longDay(m.d) }, m)); },
    labelNow(id) { fixSheet(id, true); },
  };
  window.Finance = Finance;
})();
