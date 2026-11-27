// The Finance page's math, in one place (fix 14: one calculation feeds every part, so Quick-budget, Spending,
// Activity and Debt always agree). Pure: it only reads what it's given and never saves anything.
// Ported from the old Spending page's rules, plus the rebuild's picks (Medical as its own part of Needs,
// set-aside money really held, the buckets adding up to what's in the bank).
(function () {
  const TZ = 'America/Anchorage';
  const r2 = (n) => Math.round(n * 100) / 100;
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayISO = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(now == null ? Date.now() : now));
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
  const dayNameFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
  const monthDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
  const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  // Every Finance label is spelled out (his pick): "Tuesday, December 1", never "Tue 12/1".
  const longDay = (iso) => dayFmt.format(utc(iso));
  const dayName = (iso) => dayNameFmt.format(utc(iso));
  const monthDay = (iso) => monthDayFmt.format(utc(iso));
  const money = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (n) => (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- One label list (fix 12): the app, the robot and chat all use these ----------
  // Categories say what a charge was. Each one belongs to a group for the pie.
  const CATS = {
    groceries: { name: 'Groceries', group: 'needs' },
    gas: { name: 'Gas', group: 'needs' },
    subscriptions: { name: 'Subscriptions', group: 'needs' },
    gym: { name: 'Gym', group: 'needs' },
    medical: { name: 'Medical', group: 'needs' },
    bills: { name: 'Bills', group: 'needs' },
    school: { name: 'School', group: 'needs' },
    laundry: { name: 'Laundry', group: 'needs' },
    food: { name: 'Food', group: 'wants' },
    shopping: { name: 'Shopping', group: 'wants' },
    beauty: { name: 'Piercing and nails', group: 'wants' },
    fun: { name: 'Games and fun', group: 'wants' },
    pc: { name: 'PC parts', group: 'wants' },
    hangouts: { name: 'Hangouts', group: 'wants' },
    other: { name: 'Other', group: 'wants' },
    people: { name: 'Sent to people', group: 'unsorted' },
    savings: { name: 'Moved to savings', group: 'savings' },
    debt: { name: 'Debt payment', group: 'debt' },
    income: { name: 'Money in', group: null },
    transfer: { name: 'Transfer', group: null },
  };
  // Buckets say which money a charge came out of.
  const BUCKETS = {
    '50': 'Needs', gas: 'Gas', subs: 'Subscriptions', gym: 'Subscriptions', medical: 'Medical', '30': 'Wants', spoils: 'Future spoils',
    debt: 'Debt', savings: 'Savings', income: 'Money in', transfer: 'Transfer (not spending)',
  };
  const PICK_CATS = ['groceries', 'gas', 'subscriptions', 'gym', 'medical', 'bills', 'school', 'laundry', 'food', 'shopping', 'beauty', 'fun', 'pc', 'hangouts', 'people', 'other', 'savings', 'debt', 'income', 'transfer'];
  const PICK_BUCKETS = ['50', 'gas', 'subs', 'medical', '30', 'spoils', 'debt', 'savings', 'income', 'transfer'];
  // Old names (from the old app and the robot) mapped onto the one list.
  const OLD = { mtgfood: 'food', mtg: 'food', doordash: 'food', subs: 'subscriptions', income: 'income', transfer: 'transfer' };
  const isPaycheck = (t) => /paycheck|payroll|arctic/i.test((t.n || '') + ' ' + (t.s || ''));
  const isMedMoney = (t) => t.a > 0 && /medical|reimburs/i.test((t.n || '') + ' ' + (t.s || '')) && !isPaycheck(t);
  const storeKey = (t) => cleanName(t.s || '').toLowerCase();

  // His own store rules (fin.storeRules): only his answers make them, and an undone one stops counting.
  function myRule(t, rules) {
    if (t.lb === 'josh') return null;
    const k = storeKey(t);
    return (rules || []).find((r) => !r.undone && r.store && r.store.toLowerCase() === k) || null;
  }
  function rawCat(t) {
    const s = (t.s || '').toLowerCase();
    if (/payrange/.test(s)) return 'laundry';      // his word: PayRange is always laundry (Needs)
    if (t.cat === 'bills' && (t.u === 'subs' || t.c === 'subs')) return 'subscriptions';
    if (t.cat && CATS[t.cat] && t.cat !== 'other') return t.cat;
    if (t.cat && OLD[t.cat]) return OLD[t.cat];
    if (/doordash/.test(s) && !/dashpass/.test(s)) return 'food';
    const c = t.c;
    if (c === 'groceries') return 'groceries';
    if (c === 'mtgfood') return 'food';
    if (c === 'subs') return 'subscriptions';
    if (c && CATS[c] && c !== 'other') return c;
    if (t.cat === 'other') return 'other';
    return t.a > 0 ? 'income' : 'other';
  }
  // Money he adds to his own Cash App from the bank card shows at the bank as "CASH APP*JOSHUA". It's always a move
  // between his own accounts, whatever label a robot gave it (found Nov 27: a $44 top-up counted in Wants as a
  // missed charge, and an older one from Nov 7 had no label at all). Only his own fix or store rule changes that.
  const OWN_MOVE = /cash ?app\s*\*\s*joshua/i;
  const ownMove = (t) => !!t && t.lb !== 'josh' && OWN_MOVE.test(t.s || '');
  // A bank alert that names no store (First National's alerts never do). Found Nov 27: the robot called one a
  // missed charge the moment it came in, before the bank or a receipt could name it. It now waits 2 days to be
  // matched to its name (his screenshots, a receipt, a Cash App "added" email) before it's ever asked about.
  const unnamed = (t) => !!t && !t.name && (t.unnamed === true || /named no store/i.test(t.s || ''));
  const NAME_WAIT = 2;
  const daysApart = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
  const waitingForName = (t, today) => !!today && unnamed(t) && daysApart(t.d, today) < NAME_WAIT;
  function catOf(t, rules) {
    const r = myRule(t, rules);
    if (r && r.cat) return r.cat;
    if (ownMove(t)) return 'transfer';
    const c = rawCat(t);
    // Money moved between his own accounts, or into savings, isn't spending whatever the category says.
    const u = t.u;
    if (u === 'transfer') return 'transfer';
    if (u === 'savings') return 'savings';
    if (u === 'income' && t.a > 0) return 'income';
    if (u === 'debt') return 'debt';
    return c;
  }
  function bucketOf(t, rules) {
    const r = myRule(t, rules);
    if (r && r.u) return r.u;
    if (ownMove(t)) return 'transfer';
    const c = rawCat(t);
    // Medical bills draw from the Medical money first (his pick), even when an older label said Needs.
    if (c === 'medical' && (!t.u || t.u === '50')) return 'medical';
    if (t.u) return t.u === 'gym' ? 'subs' : t.u;
    if (c === 'gas') return 'gas';
    if (c === 'gym' || c === 'subscriptions') return 'subs';
    if (c === 'medical') return 'medical';
    if (c === 'debt') return 'debt';
    if (c === 'savings') return 'savings';
    if (c === 'transfer') return 'transfer';
    if (c === 'income') return isPaycheck(t) || t.c === 'income' ? 'income' : 'transfer';
    if (CATS[c] && CATS[c].group === 'needs') return '50';
    return '30';
  }
  const bucketName = (b, fin) => {
    if (String(b).startsWith('x:')) {
      const x = ((fin && fin.exceptions && fin.exceptions.items) || []).find((i) => i.id === b.slice(2));
      return 'Quick-budget' + (x ? ': ' + x.name : '');
    }
    return BUCKETS[b] || 'Wants';
  };

  // A short, readable name for a charge: his own fix first, then the store from the bank's text.
  const BRANDS = [[/doordash|^dd /i, 'DoorDash'], [/circle ?k/i, 'Circle K'], [/taco bell/i, 'Taco Bell'], [/mcdonald/i, 'McDonald\'s'], [/spotify/i, 'Spotify'],
    [/apple\.com/i, 'Apple'], [/steam/i, 'Steam'], [/ulta/i, 'Ulta'], [/walgreens/i, 'Walgreens'], [/fred.?meyer/i, 'Fred Meyer'], [/afterpay/i, 'Afterpay'],
    [/anthropic|claude/i, 'Claude'], [/odom corp/i, 'Vending machine'], [/sagaya/i, 'New Sagaya'], [/payrange/i, 'PayRange'], [/arctic self storage|arcticorp/i, 'Arctic Self Storage'],
    [/planet fitness|abc p pf/i, 'Planet Fitness'], [/bear bubble/i, 'Bear Bubble Tea'], [/sara'?s? ?(too|sand)/i, 'Sara\'s Sandwiches'], [/anchorage bariat/i, 'Anchorage Bariatrics'],
    [/cinemark/i, 'Cinemark'], [/fandango/i, 'Fandango'], [/subway/i, 'Subway'], [/carrs/i, 'Carrs'], [/to savings/i, 'Moved to savings'], [/from (personal )?savings/i, 'From savings'],
    [/venmo cashout/i, 'Venmo cash out'], [/venmo add funds/i, 'Venmo add money'], [/venmo fernand/i, 'Venmo transfer'], [/cash app\*?joshua/i, 'To Cash App']];
  function cleanName(s) {
    const raw = String(s || '');
    for (const [re, name] of BRANDS) if (re.test(raw)) return name;
    let x = raw.split(' · ')[0].trim();
    const chk = x.match(/^check\s*#?\s*(\d+)/i);
    if (chk) return 'Check #' + chk[1];                        // each check keeps its number, so they're told apart
    if (/^venmo\s+none\b/i.test(x)) return 'Venmo payment';   // the bank shows no name for some Venmo payments
    const toPerson = x.match(/^cash app\*? ?([a-z]+)( [a-z])?\b/i);
    if (toPerson && !/^(joshua|to|from)$/i.test(toPerson[1])) x = 'Cash App to ' + toPerson[1];
    x = x.replace(/^(CHK |POS |ACH )?(PREAUTH |RETURN |PURCHASE |DEBIT )?/i, '').replace(/^(DD|SQ|TST|PY|WL|CTLP|LS)\b\*? ?/i, '').replace(/^PAYPAL \*/i, '');
    x = x.replace(/[#*].*$/, '').replace(/\s+\d{1,2}\/\d{1,2}.*$/, '').replace(/\s+\d{3,}.*$/, '').replace(/\s+n\d+$/i, '');
    x = x.replace(/\s+(San Francisco|San Jose|San|Oakland|Anchorage|New York|Seattle)(\s+[A-Z]{2})?$/i, '').replace(/\s+[A-Z]{2}$/, '').trim();
    x = x.split(' ').map((w) => (/^[A-Z][A-Z'&.]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
    return x || 'Charge';
  }
  function nameOf(t) {
    if (t.name) return t.name;
    if (catOf(t) === 'people' && t.k === 'Venmo' && t.s && !/·/.test(t.s)) return t.s; // a Venmo payment names the person
    return cleanName(t.s);
  }

  // ---------- Balances (fix 1: every balance has a date; charges after it always count) ----------
  function allTx(months) {
    const out = [];
    for (const k of Object.keys(months || {})) for (const t of ((months[k] || {}).txns || [])) if (t && t.d && typeof t.a === 'number' && !t.undone) out.push(t); // undone: a robot-added charge he undid
    return out;
  }
  function dailySeries(tx, anchor, upTo) {
    // A charge on the reading's own day, made after the balance was read (t later than set), comes off after it.
    const late = (t) => t.d === anchor.date && t.t && anchor.set && t.t > anchor.set;
    const byDay = {}; let lateSum = 0;
    for (const t of tx) { if (late(t)) lateSum += t.a; else byDay[t.d] = (byDay[t.d] || 0) + t.a; }
    const days = Object.keys(byDay).sort();
    const first = days.length && days[0] < anchor.date ? days[0] : anchor.date;
    let last = days.length && days[days.length - 1] > anchor.date ? days[days.length - 1] : anchor.date;
    if (upTo && upTo > last) last = upTo;
    const out = {}; let b = +anchor.amount || 0; out[anchor.date] = r2(b + lateSum); let d = anchor.date;
    while (d > first) { b -= (byDay[d] || 0); d = addDays(d, -1); out[d] = r2(b); }
    b = (+anchor.amount || 0) + lateSum; d = anchor.date;
    while (d < last) { d = addDays(d, 1); b += (byDay[d] || 0); out[d] = r2(b); }
    return out;
  }
  const SHORT = { 'First National Bank Alaska': 'Bank', 'Cash App': 'Cash App', Venmo: 'Venmo' };
  function balances(fin, months, today) {
    const anchors = (fin && fin.tracker && fin.tracker.anchors) || {};
    const tx = allTx(months);
    const accts = Object.keys(anchors);
    if (!accts.length) return null;
    const lastTx = tx.reduce((m, t) => (t.d > m ? t.d : m), '');
    const end = [lastTx, today, ...accts.map((a) => anchors[a].date)].filter((d) => d && d <= today).sort().pop() || today;
    const series = {}, each = [];
    for (const a of accts) {
      const s = dailySeries(tx.filter((t) => t.k === a), anchors[a], end);
      // Days before this account's first known day count as $0, so the total line never jumps.
      for (const [d, v] of Object.entries(s)) if (d <= end) series[d] = r2((series[d] || 0) + v);
      each.push({ account: a, name: SHORT[a] || a, amount: s[end] == null ? +anchors[a].amount : s[end] });
    }
    const days = Object.keys(series).sort();
    return { days, series, end, current: r2(series[end] || 0), each };
  }

  // ---------- Paychecks ----------
  function nextPayday(start) {
    let d = addDays(start, 7);
    while (!/-(01|16)$/.test(d)) d = addDays(d, 1);
    return d;
  }
  function paychecks(tx, rules, today) {
    return tx.filter((t) => t.a > 0 && t.d <= today && bucketOf(t, rules) === 'income' && isPaycheck(t)).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  }
  function period(tx, rules, today) {
    const pay = paychecks(tx, rules, today)[0];
    if (!pay) return null;
    const next = nextPayday(pay.d);
    return { start: pay.d, check: pay.a, checkTxId: pay.id, next, end: addDays(next, -1), estimate: !!pay.estimate };
  }
  // The next paycheck date for the header, even before the first paycheck is on file.
  function nextPaycheck(tx, rules, today) {
    const P = period(tx, rules, today);
    if (P && P.next > today) return P.next;
    let d = today;
    while (!/-(01|16)$/.test(d) || d === today) d = addDays(d, 1);
    return d;
  }

  // ---------- The buckets for this paycheck ----------
  // 50% Needs, 30% Wants, 20% Savings. Gas, Subscriptions and Medical are parts of Needs with their own money.
  // When a part runs out it draws from its parent, then where the parent draws from (his rule);
  // Gas and Subscriptions are never drained. Set-aside money (Quick-budget, wishlists, debt due before payday)
  // is held, so the buckets' "left" amounts add up to what's in the bank.
  const DEFAULTS = { gas: 120, medical: 300, gymYearly: 49.15, gymYearlyMonth: 10 };
  function settings(fin) {
    const r = (fin && fin.rules) || {};
    return { gas: +r.gas > 0 ? +r.gas : DEFAULTS.gas, medical: +r.medical > 0 ? +r.medical : DEFAULTS.medical, gymYearly: r.gymYearly != null ? +r.gymYearly : DEFAULTS.gymYearly,
      gymYearlyMonth: +r.gymYearlyMonth || DEFAULTS.gymYearlyMonth, subs: Array.isArray(r.subs) ? r.subs : [] };
  }
  function budget(fin, months, today, bal) {
    const tx = allTx(months);
    const rules = storeRules(fin);
    const P = period(tx, rules, today);
    if (!P) return null;
    const R = settings(fin);
    const C = P.check;
    const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const subsParts = R.subs.map((it) => {
      const mo = +it.monthly || 0;
      if (!it.billDay) return { name: it.name, amount: r2(mo / 2), billDay: null };
      const hit = [P.start, P.end].some((d) => {
        const day = Math.min(+it.billDay, dim(+d.slice(0, 4), +d.slice(5, 7)));
        const iso = d.slice(0, 7) + '-' + pad2(day);
        return iso >= P.start && iso <= P.end;
      });
      return { name: it.name, amount: hit ? mo : 0, billDay: +it.billDay };
    });
    const mid = addDays(P.start, 3);
    const yearly = +mid.slice(8) <= 15 && +mid.slice(5, 7) === R.gymYearlyMonth ? R.gymYearly : 0;
    if (yearly) subsParts.push({ name: 'Gym yearly fee', amount: yearly, billDay: null });
    const subsRes = r2(subsParts.reduce((s, x) => s + x.amount, 0));

    // Quick-budget amounts planned for this paycheck.
    const exAll = ((fin && fin.exceptions && fin.exceptions.items) || []);
    const ex = exAll.filter((x) => (x.applied ? x.applied === P.start : (x.when && x.when !== 'next' && x.when >= P.start && x.when < P.next)));
    const ex50 = ex.filter((x) => x.bucket === '50').reduce((s, x) => s + +x.amount, 0);
    const ex30 = ex.filter((x) => x.bucket !== '50' && x.bucket !== '20').reduce((s, x) => s + +x.amount, 0);

    const n50 = C * 0.5, w30 = C * 0.3, s20 = C * 0.2;
    const base50 = n50 - R.gas - subsRes - ex50;
    const rest30 = Math.max(0, w30 - ex30), disc = rest30 / 2, spoilsAdd = rest30 / 2;

    const inPeriod = tx.filter((t) => t.d >= P.start && t.d <= P.end && t.id !== P.checkTxId);
    const sp = { '50': 0, gas: 0, subs: 0, medical: 0, '30': 0, spoils: 0, debt: 0 }, sx = {};
    const parts = { '50': {}, gas: {}, subs: {}, medical: {}, '30': {}, spoils: {} };
    let medIn = 0;
    for (const t of inPeriod) {
      if (isMedMoney(t)) { medIn += t.a; continue; }
      const b = bucketOf(t, rules);
      if (b.startsWith('x:')) { sx[b.slice(2)] = (sx[b.slice(2)] || 0) - t.a; continue; }
      if (b in sp) {
        sp[b] -= t.a;
        if (parts[b]) { const c = catOf(t, rules); parts[b][c] = (parts[b][c] || 0) - t.a; }
      }
    }
    let over50 = 0, over30 = 0;
    const exLeft = ex.map((x) => {
      const used = sx[x.id] || 0, left = +x.amount - used;
      if (left < 0) { if (x.bucket === '50') over50 -= left; else if (x.bucket !== '20') over30 -= left; }
      return { id: x.id, name: x.name, amount: +x.amount, used: r2(used), left: r2(Math.max(0, left)) };
    });
    // Medical: filled by the medical money that came in this paycheck. Past that, it draws from Needs.
    const medOf = r2(medIn);
    const medLeft = medOf - sp.medical;
    const left50 = base50 - sp['50'] - over50 - Math.max(0, -medLeft);
    const hold = { needs: left50, gas: R.gas - sp.gas, subs: subsRes - sp.subs, medical: Math.max(0, medLeft), wants: disc - sp['30'] - over30, spoils: spoilsAdd - sp.spoils };
    const cov = { spoils: 0, needs: 0, wants: 0, medical: 0 };
    let short = 0;
    for (const k of ['needs', 'wants', 'spoils', 'gas', 'subs']) if (hold[k] < 0) { short -= hold[k]; hold[k] = 0; }
    // An overspent bucket is covered by Future spoils, then Needs, then Wants (his rule). Gas and Subscriptions never.
    const drain = (amt) => {
      for (const k of ['spoils', 'needs', 'wants', 'medical']) {
        if (amt <= 0.005) break;
        const take = Math.min(hold[k], amt);
        hold[k] = r2(hold[k] - take); cov[k] = r2(cov[k] + take); amt -= take;
      }
      return amt;
    };
    let uncovered = drain(short);

    const excLeft = r2(exLeft.reduce((s, x) => s + x.left, 0));
    // Wishlist money already moved into a savings pot outside these accounts (like Cash App Savings) is held
    // there, not here, so it isn't held a second time out of the balance (found Nov 25).
    const keptElsewhere = (i) => (i.setAside || []).filter((x) => x.in).reduce((s, x) => s + (+x.amount || 0), 0);
    const wishHeld = r2(wishItems(fin).filter((i) => !i.bought).reduce((s, i) => s + Math.max(0, (+i.saved || 0) - keptElsewhere(i)), 0));
    // Debt is kept apart from the balance: a debt payment counts like a purchase when it comes out, so nothing is
    // held back for payments due before payday (Josh, Nov 25: "I think of debt like a purchase").
    const alsoHeld = r2(excLeft + wishHeld);
    const balance = bal ? bal.current : null;
    const held = () => hold.needs + hold.gas + hold.subs + hold.medical + hold.wants + hold.spoils + alsoHeld;
    // Money that left outside the buckets (more than the bank has): the buckets give it back the same way.
    if (balance != null && held() > balance + 0.005) uncovered += drain(held() - balance);
    // Still more on paper than in the accounts: the accounts themselves are short. His rule that Gas and
    // Subscriptions never cover other spending is about one bucket going over; it doesn't let them show money
    // that isn't there. So, in this order, what isn't covered: Quick-budget plans, wishlist money set aside,
    // then Subscriptions, and Gas last (Josh's yes, Nov 25).
    const shortBy = balance != null && held() > balance + 0.005 ? r2(held() - balance) : 0;
    const notCovered = { planned: 0, wish: 0, subs: 0, gas: 0, more: 0 };
    if (shortBy) {
      let rest = shortBy;
      const take = (k, have) => { const t = r2(Math.min(Math.max(0, have), rest)); notCovered[k] = t; rest = r2(rest - t); return t; };
      take('planned', excLeft);
      take('wish', wishHeld);
      hold.subs -= take('subs', hold.subs);
      hold.gas -= take('gas', hold.gas);
      notCovered.more = r2(Math.max(0, rest));
    }
    // Money counted as held that isn't really in the accounts (so buckets + held - missing = the accounts).
    const missing = r2(notCovered.planned + notCovered.wish + notCovered.more);
    // To invest (his picks, Nov 26): the paycheck's 20%, minus every move into savings this paycheck, minus spending
    // no other bucket covered (that comes out of To invest last). It can never be more than the cash left after the
    // other buckets, not counting money taken out of savings this paycheck: borrowed money never counts as money to
    // invest, and it stays on Debt as owed to Savings. Wishlist money moved to its own pot isn't a move into savings.
    const isWish = wishTest(fin);
    const savMoves = inPeriod.filter((t) => bucketOf(t, rules) === 'savings' && !isWish(t));
    const movedIn = r2(savMoves.filter((t) => t.a < 0).reduce((n, t) => n - t.a, 0));
    const takenOut = r2(savMoves.filter((t) => t.a > 0).reduce((n, t) => n + t.a, 0));
    const spentPast = r2(Math.max(0, uncovered));
    const investPlan = r2(Math.max(0, s20 - movedIn - spentPast));
    const cashLeft = balance == null ? null : r2(balance - held() - takenOut);
    const toInvest = balance == null ? null : r2(Math.max(0, Math.min(investPlan, cashLeft)));
    const investCapped = balance != null && cashLeft < investPlan - 0.005;
    for (const k in hold) hold[k] = r2(hold[k]);

    const tile = (key, name, group, left, of, extra) => Object.assign({ key, name, group, left: r2(left), of: r2(of) }, extra || {});
    const tiles = [
      tile('needs', 'Needs', 'needs', hold.needs, Math.max(0, base50), { share: 50, whole: r2(n50) }),
      tile('gas', 'Gas', 'needs', hold.gas, R.gas),
      tile('subs', 'Subscriptions', 'needs', hold.subs, subsRes),
      tile('medical', 'Medical', 'needs', hold.medical, medOf),
      tile('wants', 'Wants', 'wants', hold.wants, disc, { share: 30, whole: r2(w30) }),
      tile('spoils', 'Future spoils', 'wants', hold.spoils, spoilsAdd),
      tile('invest', 'To invest', 'savings', Math.max(0, toInvest || 0), s20, { share: 20, whole: r2(s20) }),
    ];
    // What each tile's money went to, for its Breakdown.
    const breakdown = {
      needs: { set: [['Half of the paycheck', n50], ['Gas', -R.gas], ['Subscriptions', -subsRes]].concat(ex50 ? [['Quick-budget', -ex50]] : []), spent: parts['50'], covered: cov.needs },
      gas: { set: [['Each paycheck', R.gas]], spent: parts.gas },
      subs: { set: subsParts.filter((x) => x.amount).map((x) => [x.name, x.amount]), spent: parts.subs },
      medical: { set: medOf ? [['Medical money this paycheck', medOf]] : [], spent: parts.medical, note: medLeft < 0 ? 'Past the medical money, ' + money(-medLeft) + ' came out of Needs.' : '' },
      wants: { set: [['30% of the paycheck', w30]].concat(ex30 ? [['Quick-budget', -ex30]] : []).concat([['Half goes to Future spoils', -spoilsAdd]]), spent: parts['30'], covered: cov.wants },
      spoils: { set: [['Half of Wants', spoilsAdd]], spent: parts.spoils, covered: cov.spoils },
      invest: { set: [['20% of the paycheck', s20]].concat(movedIn ? [['Moved into savings', -movedIn]] : []).concat(spentPast ? [['Spending no other bucket covered', -spentPast]] : []),
        note: investCapped ? 'Only ' + money(Math.max(0, cashLeft)) + ' is left in the bank after the other buckets' + (takenOut ? ', not counting money taken out of savings' : '') + ', so that\'s all that shows here.' : 'Ready to move to savings. Each move into savings comes off here.' },
    };
    return { P, C, tiles, breakdown, hold, cov, subsParts, subsRes, medOf, ex: exLeft, excLeft, wishHeld, alsoHeld, balance, toInvest, movedIn, takenOut, cashLeft, investPlan,
      shortBy, notCovered, missing, uncovered: r2(Math.max(0, uncovered)) };
  }

  // ---------- Where the money went (the pie) ----------
  const GROUPS = { needs: 'Needs', wants: 'Wants', savings: 'Savings', debt: 'Debt payments', unsorted: 'Not sorted yet' };
  function pieFor(fin, months, from, to) {
    const rules = storeRules(fin);
    const isWish = wishTest(fin);
    const rows = {};
    let total = 0, takenOut = 0;
    for (const t of allTx(months)) {
      if (t.d < from || t.d > to) continue;
      // Money taken back out of savings (wishlist pots aside). The Savings slice stays sized by money put in.
      if (t.a > 0) { if (bucketOf(t, rules) === 'savings' && !isWish(t)) takenOut += t.a; continue; }
      const b = bucketOf(t, rules);
      if (b === 'transfer' || b === 'income') continue;
      let c = catOf(t, rules);
      if (b === 'savings') c = 'savings';
      if (b === 'debt') c = 'debt';
      if (c === 'income' || c === 'transfer') continue;
      // Money sent to a person stays "not sorted yet" until he says what it was for.
      const g = c === 'people' && t.lb !== 'josh' ? 'unsorted' : c === 'people' ? (b === '50' ? 'needs' : 'wants') : (CATS[c] || CATS.other).group || 'wants';
      const amt = -t.a;
      rows[g] = rows[g] || { group: g, name: GROUPS[g], total: 0, cats: {} };
      rows[g].total += amt;
      rows[g].cats[c] = (rows[g].cats[c] || 0) + amt;
      total += amt;
    }
    const order = ['needs', 'wants', 'savings', 'debt', 'unsorted'];
    const groups = order.filter((g) => rows[g] && rows[g].total > 0.005).map((g) => ({
      group: g, name: rows[g].name, total: r2(rows[g].total), share: total ? rows[g].total / total : 0,
      cats: Object.entries(rows[g].cats).map(([c, v]) => ({ cat: c, name: (CATS[c] || CATS.other).name, total: r2(v) })).sort((a, b) => b.total - a.total),
    }));
    const sav = groups.find((g) => g.group === 'savings');
    if (sav) { sav.putIn = sav.total; sav.out = r2(takenOut); sav.kept = r2(sav.total - takenOut); }
    return { total: r2(total), groups, takenOut: r2(takenOut) };
  }
  // The pay periods to pick from in the pie: this paycheck, the one before, and so on.
  function payPeriods(fin, months, today) {
    const tx = allTx(months);
    const pays = [...new Set(paychecks(tx, storeRules(fin), today).map((t) => t.d))].sort();
    const out = [];
    for (let i = pays.length - 1; i >= 0; i--) out.push({ start: pays[i], end: i === pays.length - 1 ? today : addDays(pays[i + 1], -1) });
    return out;
  }

  // ---------- Missed charges (his pick, Nov 25) ----------
  // A charge nobody could sort: flagged for review, or money sent to a person with no label. It counts in
  // Wants until he labels it. When he opens the Hub, a pop-up lists the new ones: Label now, or Label later.
  // Every one not labelled yet also sits in the Questions inbox, answerable any time, until it's labelled.
  // One rule feeds the pop-up, the inbox and Activity's "What was it for?" tag, so they can never disagree.
  function needsLabel(t, rules, today) {
    if (!t || t.lb === 'josh' || t.a >= 0 || myRule(t, rules) || ownMove(t) || waitingForName(t, today)) return false;
    const c = rawCat(t);
    // A review flag only counts while nothing sorts the charge: once a store word or his answer gives it a
    // real category (PayRange is laundry), the flag is stale and the charge isn't asked about again.
    if (t.rv) return c === 'other' || c === 'people';
    return c === 'people' && !t.lb;
  }
  function missed(fin, months, today) {
    const rules = storeRules(fin);
    const list = allTx(months).filter((t) => t.d <= today && needsLabel(t, rules, today))
      .map((t) => ({ id: t.id, name: nameOf(t), d: t.d, a: t.a, account: SHORT[t.k] || t.k || '', later: !!t.later }));
    list.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    return { all: list, now: list.filter((m) => !m.later) };
  }

  // ---------- Activity ----------
  // Every charge, newest first, with the Balance (all accounts) after it.
  function activity(fin, months, today, bal) {
    const rules = storeRules(fin);
    const tx = allTx(months).filter((t) => t.d <= today);
    tx.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    const byDay = new Map();
    for (const t of tx) { if (!byDay.has(t.d)) byDay.set(t.d, []); byDay.get(t.d).push(t); }
    const days = [];
    for (const [d, list] of byDay) {
      let after = bal && bal.series[d] != null ? bal.series[d] : null;
      const rows = list.map((t) => {
        const c = catOf(t, rules), b = bucketOf(t, rules);
        const row = { id: t.id, name: nameOf(t), cat: c, catName: (CATS[c] || CATS.other).name, bucket: b, bucketName: bucketName(b, fin), amount: t.a, balance: after,
          pending: !!t.p, account: SHORT[t.k] || t.k || '', ask: needsLabel(t, rules, today), naming: waitingForName(t, today), mine: t.lb === 'josh', ruled: !!myRule(t, rules) };
        if (after != null) after = r2(after - t.a);
        return row;
      });
      days.push({ day: d, rows });
    }
    // Same amount, same place, same day: "double?" (fix 16).
    for (const g of days) {
      const seen = {};
      for (const r of g.rows) { const k = r.amount + '|' + r.name.toLowerCase(); (seen[k] = seen[k] || []).push(r); }
      for (const k in seen) if (seen[k].length > 1) seen[k].forEach((r) => { r.double = true; });
    }
    return days;
  }
  // The last 7 days of spending, one bar per day. Transfers, savings moves and debt payoffs are left out.
  function lastWeek(fin, months, today) {
    const rules = storeRules(fin);
    const tx = allTx(months);
    const out = [];
    for (let k = 6; k >= 0; k--) {
      const d = addDays(today, -k);
      const spent = tx.filter((t) => t.d === d && t.a < 0 && !['transfer', 'savings', 'debt', 'income'].includes(bucketOf(t, rules))).reduce((s, t) => s - t.a, 0);
      out.push({ day: d, label: k === 0 ? 'Today' : dayName(d), spent: r2(spent) });
    }
    return { days: out, total: r2(out.reduce((s, x) => s + x.spent, 0)) };
  }

  // ---------- Debt ----------
  // Money taken out of savings is debt owed to Savings (Josh, Nov 26), worked out from the records every time,
  // so nothing has to remember to add it: a move out adds to it, a move back in pays it down (never below zero).
  // Wishlist money kept in a savings pot (like the GPU money in Cash App Savings) is left out both ways:
  // spending it on its item isn't debt (his pick, Nov 26: "No to wishlist").
  function wishPots(fin) {
    const names = new Set();
    for (const i of wishItems(fin)) for (const s of (i.setAside || [])) if (s.in) names.add(String(s.in).toLowerCase());
    const other = ((fin && fin.savings) || {}).other;
    for (const o of (Array.isArray(other) ? other : [])) if (o && o.goal && o.name) names.add(String(o.name).toLowerCase());
    return [...names];
  }
  function wishTest(fin) {
    const pots = wishPots(fin);
    return (t) => !!t.wish || pots.some((p) => ((t.n || '') + ' ' + (t.s || '')).toLowerCase().includes(p));
  }
  function owedToSavings(fin, months) {
    const rules = storeRules(fin);
    const isWish = wishTest(fin);
    const moves = allTx(months).filter((t) => bucketOf(t, rules) === 'savings' && !isWish(t)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    let owed = 0, total = 0, since = null, paidOff = null;
    for (const t of moves) {
      if (t.a > 0) { if (owed <= 0.005) { total = 0; since = t.d; } owed += t.a; total += t.a; }
      else if (owed > 0.005) { owed = Math.max(0, owed + t.a); if (owed <= 0.005) { owed = 0; paidOff = t.d; } }
    }
    owed = r2(owed); total = r2(total);
    if (!total) return null;
    return { id: 'owed-to-savings', name: 'Taken from savings', owedTo: 'Savings', owed, total, paidShare: total > 0 ? Math.max(0, Math.min(1, 1 - owed / total)) : 1,
      next: null, fromEmail: false, auto: true, since, paidOff: owed > 0.005 ? null : paidOff,
      note: 'Worked out from money moved out of savings since ' + (since ? monthDay(since) : 'the start') + '. Moving money back into savings pays it down.' };
  }
  // A hand-made debt to savings is covered by the worked-out one above, so it isn't counted twice.
  const isSavingsDebt = (d) => /^savings$/i.test((d.owedTo || '').trim()) || /from savings/i.test(d.name || '');
  function debts(fin, today, months) {
    const D = (fin && fin.debts) || {};
    const pays = (D.payments || []).filter((p) => !p.undone);
    const auto = months ? owedToSavings(fin, months) : null;
    const items = (D.items || []).filter((d) => !d.undone && !(auto && isSavingsDebt(d) && +d.owed > 0.005)).map((d) => {
      const mine = pays.filter((p) => p.debtId === d.id);
      const next = mine.filter((p) => !p.paid).sort((a, b) => (a.due < b.due ? -1 : 1))[0] || null;
      const paidSum = mine.filter((p) => p.paid).reduce((s, p) => s + +p.amount, 0);
      const owed = +d.owed || 0;
      const total = +d.total > 0 ? +d.total : r2(owed + paidSum);
      return { id: d.id, name: d.name, owedTo: d.owedTo || '', owed, total, paidShare: total > 0 ? Math.max(0, Math.min(1, 1 - owed / total)) : 1,
        next: next ? { amount: +next.amount, due: next.due } : null, fromEmail: d.source === 'email', note: d.note || '' };
    });
    if (auto) items.push(auto);
    const open = items.filter((d) => d.owed > 0.005).sort((a, b) => ((a.next && a.next.due) || '9') < ((b.next && b.next.due) || '9') ? -1 : 1);
    const totalOwed = r2(open.reduce((s, d) => s + d.owed, 0));
    const totalAll = open.reduce((s, d) => s + d.total, 0);
    const nextDue = open.map((d) => d.next).filter(Boolean).sort((a, b) => (a.due < b.due ? -1 : 1))[0] || null;
    const lastPaid = pays.filter((p) => p.paid && p.paidAt).map((p) => p.paidAt.slice(0, 10)).sort().pop() || null;
    return { open, done: items.filter((d) => d.owed <= 0.005), totalOwed, paidShare: totalAll > 0 ? 1 - totalOwed / totalAll : 1, nextDue, debtFreeSince: open.length ? null : lastPaid };
  }

  // ---------- Wishlists ----------
  function wishItems(fin) {
    const lists = ((fin && fin.wishlists) || {}).lists || [];
    const out = [];
    for (const l of lists) for (const i of (l.items || [])) if (!i.undone) out.push(Object.assign({ list: l.id, listName: l.name }, i));
    return out;
  }
  // The day a wishlist move happened, for its "where it came from" line (his pick C, Nov 26). Saves from the app keep
  // the day (on). Found Nov 26: the GPU move was written down on Nov 25 for money moved on Nov 19, and only the day it was
  // written down was kept, so an older move without that day uses the day named in its own note, then the day it was
  // written down, then its paycheck.
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function moveDay(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.on || '')) return s.on;
    const wrote = s.at ? localDay(s.at) : null;
    const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b/i.exec(s.note || '');
    if (m && wrote) {
      let y = +wrote.slice(0, 4);
      const day = y + '-' + String(MON[m[1].toLowerCase()]).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0');
      if (day > wrote) y -= 1; // a note never names a day after it was written
      return y + day.slice(4);
    }
    return wrote || s.paycheck || null;
  }
  function localDay(at) {
    const d = new Date(at);
    if (isNaN(d)) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function wishlists(fin) {
    const items = wishItems(fin);
    const open = items.filter((i) => !i.bought).map((i) => ({ id: i.id, list: i.list, listName: i.listName, name: i.name, amount: +i.amount || 0, saved: +i.saved || 0,
      share: +i.amount > 0 ? Math.min(1, (+i.saved || 0) / +i.amount) : 0, from: (i.setAside || []).map((s) => ({ paycheck: s.paycheck, amount: +s.amount, label: s.label || '', inPot: s.in || '', day: moveDay(s) })) }));
    return { open, bought: items.filter((i) => i.bought), setAside: r2(open.reduce((s, i) => s + i.saved, 0)), lists: (((fin && fin.wishlists) || {}).lists || []).map((l) => ({ id: l.id, name: l.name })) };
  }

  function storeRules(fin) { return ((fin && fin.storeRules) || {}).items || []; }

  // Everything the page needs, worked out once.
  function work(fin, months, notes, now) {
    const today = todayISO(now);
    const tx = allTx(months);
    const rules = storeRules(fin);
    const bal = balances(fin, months, today);
    const B = budget(fin, months, today, bal);
    const D = debts(fin, today, months);
    if (B) B.tiles.push({ key: 'debt', name: 'Total debt', group: 'debt', left: D.totalOwed, of: D.totalOwed, paidShare: D.paidShare });
    const periods = payPeriods(fin, months, today);
    const savings = savingsTotal(fin);
    return {
      today, bal, budget: B, debts: D, wish: wishlists(fin), periods,
      savingsLine: bal ? savingsLine(fin, months, bal, savings.total) : null,
      nextPaycheck: nextPaycheck(tx, rules, today),
      paydays: paychecks(tx, rules, today).map((t) => ({ day: t.d, amount: t.a })),
      week: lastWeek(fin, months, today),
      activity: activity(fin, months, today, bal),
      savings,
      rules: rules.filter((r) => !r.undone),
      planned: (((fin && fin.exceptions) || {}).items || []).filter((x) => !x.applied || x.applied >= addDays(today, -31)),
      notes: (((notes || {}).items) || []).filter((n) => n.page === 'finance'),
    };
  }
  // Savings for each day of the balance graph: today's savings, walked back through each move in or out of
  // savings (wishlist pots aside), so it steps only on the days money moved.
  function savingsLine(fin, months, bal, total) {
    const rules = storeRules(fin);
    const isWish = wishTest(fin);
    const netIn = {};
    for (const t of allTx(months)) if (bucketOf(t, rules) === 'savings' && !isWish(t)) netIn[t.d] = (netIn[t.d] || 0) - t.a;
    const out = {};
    let v = total;
    for (let i = bal.days.length - 1; i >= 0; i--) {
      const d = bal.days[i];
      out[d] = r2(v);
      v -= netIn[d] || 0;
    }
    return out;
  }
  function savingsTotal(fin) {
    const s = (fin && fin.savings) || {};
    const rows = Object.keys(s).filter((k) => s[k] && typeof s[k] === 'object' && s[k].saved != null).map((k) => ({ id: k, name: /x6510|fnb|first national/i.test(s[k].account || '') ? 'Bank savings' : (s[k].account || k), amount: +s[k].saved, asOf: s[k].asOf || '' }));
    // Other savings he has (like Cash App Savings), each with the day it was read.
    for (const o of (Array.isArray(s.other) ? s.other : [])) if (o && +o.amount > 0) rows.push({ id: o.name, name: o.name, amount: +o.amount, asOf: o.asOf || '', goal: o.goal || '' });
    return { total: r2(rows.reduce((a, r) => a + r.amount, 0)), rows };
  }

  const Money = { TZ, CATS, BUCKETS, PICK_CATS, PICK_BUCKETS, GROUPS, r2, todayISO, addDays, longDay, dayName, monthDay, money, money0, signed,
    allTx, catOf, bucketOf, bucketName, nameOf, cleanName, storeKey, balances, period, nextPayday, budget, pieFor, payPeriods, activity, lastWeek, debts, owedToSavings, wishlists, needsLabel, missed, work, savingsLine, paychecks };
  if (typeof window !== 'undefined') window.Money = Money;
  if (typeof module !== 'undefined') module.exports = Money;
})();
