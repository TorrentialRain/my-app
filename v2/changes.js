// Changes made on the TO-DO page (tick, add, move, reorder, trash) and how they get saved.
//
// SAVING IS OFF. The key on the phone can only read, so changes stay on screen until the app closes.
// Turning saving on later is one step: put in a key that can save and set SAVING to true below.
// Everything else (the double-save checks, the "waiting to save" list) is already here.
//
// Double-save checks, so one change can never land twice or wipe out someone else's:
//   1. Every change has its own id. A task remembers the ids already put into it, and a change
//      whose id is already there is skipped. So tapping twice, a retry, or a second phone can't
//      add the same thing twice.
//   2. A new task made from the + form also can't land twice: if a task already holds that
//      change's id, it isn't added again.
//   3. Saving reads the newest copy of the data first and writes "only if nobody changed it since".
//      If the robot or another phone saved in between, it reads again and puts the changes in again.
//   4. Only one save runs at a time.
//   5. Anything that couldn't be saved stays in a "waiting to save" list on this phone and is
//      tried again later. The page shows that list, so nothing is quietly dropped.
(function () {
  const SAVING = false;
  const WAITING = 'hub2.waitingToSave';
  const KEEP_IDS = 30; // how many change ids each task remembers

  const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Put changes into a copy of the tasks. Pure: the same input always gives the same result.
  function apply(tasks, changes) {
    const out = clone(tasks || {});
    for (const c of changes) {
      if (c.type === 'add') {
        const already = Object.values(out).some((t) => t && (t.changeIds || []).includes(c.id));
        if (already) continue;
        const t = Object.assign({}, c.task, { changeIds: [c.id] });
        let id = c.taskId;
        while (out[id] && !(out[id].changeIds || []).includes(c.id)) id = c.taskId + '-' + Math.random().toString(36).slice(2, 5);
        out[id] = t;
        continue;
      }
      const t = out[c.taskId];
      if (!t) continue; // the task is gone (deleted elsewhere): nothing to change
      t.changeIds = t.changeIds || [];
      if (t.changeIds.includes(c.id)) continue;
      if (c.type === 'tick') {
        t.prevSection = t.section; t.section = 'done'; t.status = 'done'; t.doneAt = c.at; t.doneBy = 'josh';
      } else if (c.type === 'untick') {
        t.status = 'open'; t.section = t.prevSection || 'active'; delete t.doneAt; delete t.doneBy;
      } else if (c.type === 'move') {
        t.section = c.section; delete t.myRank;
      } else if (c.type === 'rank') {
        t.myRank = c.rank;
      } else if (c.type === 'trash') {
        t.prevStatus = t.status; t.prevSection = t.section; t.status = 'dropped'; t.section = 'done';
        t.droppedAt = c.at; t.droppedBy = 'josh';
      } else if (c.type === 'subtask') {
        if (t.subtasks && t.subtasks[c.index]) t.subtasks[c.index].done = !!c.done;
      }
      t.changeIds.push(c.id);
      if (t.changeIds.length > KEEP_IDS) t.changeIds = t.changeIds.slice(-KEEP_IDS);
    }
    return out;
  }

  // Possible tasks: Skip and Add mark them, once.
  function applySuggestions(sugs, changes) {
    const out = clone(sugs || {});
    for (const c of changes) {
      const s = out[c.suggestionId];
      if (!s || (s.changeIds || []).includes(c.id)) continue;
      s.status = c.type === 'skip' ? 'skipped' : 'accepted';
      s.decidedAt = c.at;
      s.changeIds = (s.changeIds || []).concat(c.id).slice(-KEEP_IDS);
    }
    return out;
  }

  // What each change says, in plain words, for the "waiting to save" list.
  function describe(c, tasks) {
    const title = c.type === 'add' ? c.task.title : ((tasks[c.taskId] || {}).title || 'a task');
    return ({
      add: 'Add "' + title + '"',
      tick: 'Mark "' + title + '" done',
      untick: 'Mark "' + title + '" not done',
      move: 'Move "' + title + '" to ' + (c.tabName || 'another tab'),
      rank: 'Put "' + title + '" in a new spot',
      trash: 'Delete "' + title + '"',
      subtask: (c.done ? 'Tick' : 'Untick') + ' a step on "' + title + '"',
    })[c.type] || 'Change "' + title + '"';
  }

  let pending = [];
  let saving = false;

  function loadWaiting() {
    if (!SAVING) return []; // with saving off, changes live on screen only
    try { return JSON.parse(localStorage.getItem(WAITING)) || []; } catch (e) { return []; }
  }
  function keepWaiting() {
    if (!SAVING) return;
    try { localStorage.setItem(WAITING, JSON.stringify(pending)); } catch (e) { /* stays in memory */ }
  }

  // Save: newest copy, put the changes in, write only if nobody changed it since. Off for now.
  async function save(store) {
    if (!SAVING) return { saved: false, why: 'off' };
    if (saving || !pending.length) return { saved: false, why: saving ? 'busy' : 'nothing' };
    saving = true;
    try {
      const files = [
        ['data/tasks.json', (c) => c.file !== 'suggestions', apply],
        ['data/suggestions.json', (c) => c.file === 'suggestions', applySuggestions],
      ];
      for (const [path, mine, put] of files) {
        let done = false;
        for (let tries = 0; tries < 3 && !done; tries++) {
          const batch = pending.filter(mine);
          if (!batch.length) { done = true; break; }
          const { data, version } = await store.readWithVersion(path);
          const ok = await store.writeIfUnchanged(path, put(data, batch), version, 'TO-DO: ' + batch.length + ' change(s) from the phone');
          if (ok) { pending = pending.filter((c) => !batch.includes(c)); keepWaiting(); done = true; }
        }
        if (!done) return { saved: false, why: 'busy-elsewhere' };
      }
      return { saved: true };
    } catch (e) {
      return { saved: false, why: 'error', error: e };
    } finally {
      saving = false;
    }
  }

  const Changes = {
    SAVING,
    newId,
    apply,
    applySuggestions,
    describe,
    start() { pending = loadWaiting(); return pending.slice(); },
    add(change) {
      const c = Object.assign({ id: newId(), at: new Date().toISOString() }, change);
      pending.push(c);
      keepWaiting();
      return c;
    },
    list() { return pending.slice(); },
    save,
  };

  if (typeof window !== 'undefined') window.Changes = Changes;
  if (typeof module !== 'undefined') module.exports = Changes;
})();
