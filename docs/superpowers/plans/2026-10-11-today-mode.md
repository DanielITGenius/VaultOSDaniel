# Today Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VaultOS opens on a Today mode with the date, a ZenQuotes quote, eight habits with a 7-day trend and streaks, a daily task list that rolls forward, and a server-held Pomodoro that auto-ticks habits at their focus goal. Each day is a markdown note in the vault.

**Architecture:**
- Pure modules in `lib/` parse and edit the vault files: `today-note`, `today-stats`, `today-quote` and `today-timer`.
- `lib/today-service.js` owns the file store, the per-file write queue, the timer schedule and the API payload. `server.js` only adds thin routes.
- The browser side is one new global, `Today` (`public/today.js`), wired into `app.js`'s `setMode`.
- The work comes in three phases (habits, then tasks, then timer). Each phase can be released on its own with Ben's OK.

**Tech Stack:** Node 22 (container) / 24 (host), CommonJS, Express 5, `node:test`, puppeteer from the npx cache for e2e, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-today-mode-design.md`. Read it before Task 1. Every value below comes from it.

**Workspace:** worktree `/opt/vault/board-today`, branch `today-mode`. All paths below are relative to it unless absolute. `/opt/vault/board` is the **live** checkout: never edit it, except during a release Ben has approved.

## Global Constraints

- London dates only. Use `londonDate`/`londonTime` from `lib/today-note.js` (`Intl.DateTimeFormat` with `timeZone: 'Europe/London'`). Today code never calls `getDate()`, `getHours()` or `toISOString().slice(0,10)` to get a calendar date. The container clock is UTC.
- Data root: `Personal/Today/` under `VAULT_DIR`. Files: `habits.md`, `.timer.json`, `days/YYYY-MM/YYYY-MM-DD.md`.
- A habit id matches `^[a-z0-9-]{1,32}$`. The focus goal is empty or a whole number from 5 to 600.
- Icons: `sun, dumbbell, tree, rocket, pill, book, cap, coffee-off, heart, moon, droplet, pen, music, walk, check`. An unknown icon renders as a plain dot.
- Pomodoro: 25 min focus, 5 min short break, 15 min long break after every 4th focus session. Breaks never start on their own.
- Quotes:
  - `https://zenquotes.io/api/today` and `https://zenquotes.io/api/random`
  - 4 s fetch timeout
  - one retry per 10 min after a failure
  - shuffle refused within 6 s of the last one (429)
  - text capped at 400 characters, author at 100
  - attribution link "Quotes from ZenQuotes" → `https://zenquotes.io/`
- Task text: trimmed, newlines removed, at most 200 characters.
- Streak lookback is at most 400 days.
- The toast for a timer event shows only if the event is under 2 minutes old and its id isn't in `sessionStorage['vaultboard.today.seen']`.
- Sound key: `localStorage['vaultboard.today.sound']`. Values are `'on'` or `'off'`, and missing means on.
- Phone breakpoint is `max-width: 700px`. CSS uses existing tokens only. A new colour gets a token with both a Dark (`:root`) and a Sepia (`:root[data-theme="light"]`) value.
- Anything read from the vault (habit names, task text, quotes, warnings) goes into the DOM with `textContent`, never `innerHTML`.
- E2E runs only against the preview at `http://127.0.0.1:7691`, **never** `:7684`. `TODAY_SECONDS_PER_MINUTE` (an integer from 1 to 60) is set only on the preview.
- Never merge to master and never `docker restart vault-board` without Ben's explicit OK (it kills his live Claude terminals). See **Releasing**.
- Code style: `'use strict'`, CommonJS, `node:test` + `node:assert/strict`, and the comment density of the surrounding code.
- Commits: message `Today: <what>`, ending with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` passes after every task. The baseline on 2026-10-11 was 439 passing.

## Review Focus

1. **A day note Ben edited in Obsidian.** It might have `* [ ]` bullets, CRLF line endings, extra blank lines, or task lines outside `## Tasks`. It must parse, and edits must leave his other lines byte-identical. Tested in Task 2 (`parseDay tolerates CRLF and * bullets`, `edits preserve unknown lines`).
2. **A broken `habits.md`.** It might have no table, a renamed column, a duplicate id or a bad goal. The page still loads, with warnings and no crash. Tested in Task 1 (`missing table`, `duplicate id`).
3. **Two devices, one stale.** Ticking an already-ticked habit is a no-op. Toggling a task whose line changed answers 409, and the page reloads the day. Tested in Task 2 (`setHabit is idempotent`), Task 10 (`toggle 409 on text mismatch`) and Task 11 (e2e T2 stale toggle).
4. **A tab left open over midnight.** The next load, with no date, returns the new London day and rolls tasks over from the last note. The page switches to the new day when it was showing "today". The server side is tested in Task 10 (`payload after midnight creates the new day with rollover`). The client side is a stated requirement in Task 8 Step 4, because e2e can't move the server's clock.
5. **ZenQuotes rate-limit replies.** When rate-limited, ZenQuotes answers with a fake quote: author `zenquotes.io`, text starting "Too many requests". That must count as a failure, not be saved. Tested in Task 4 (`normalizeQuote rejects the rate-limit quote`).

---

## Phase 1: habits, week, quote, landing

### Task 1: London dates and `habits.md`

**Files:**
- Create: `lib/today-note.js`
- Test: `test/today-note.test.js`

**Interfaces:**
- Produces (exported from `lib/today-note.js`):
  - `londonDate(d: Date) → 'YYYY-MM-DD'`
  - `londonTime(d: Date) → 'HH:MM'` (24 h)
  - `addDays(iso: string, n: number) → string` (calendar arithmetic in UTC on the date only)
  - `isISODate(s) → boolean` (correct shape and a real calendar date)
  - `weekdayShort(iso) → 'Mon'…'Sun'`
  - `ICONS: string[]` (the 15 names from Global Constraints)
  - `DEFAULT_HABITS_MD: string`: the spec's `habits.md` example **verbatim**, from `# Habits` through the `nocoffee` row, plus a trailing newline
  - `parseHabits(md) → { habits: [{ id, name, icon, goal: number|null }], warnings: string[] }`

- [ ] **Step 1: Write the failing tests** in `test/today-note.test.js`:

```js
test('londonDate crosses midnight in BST and GMT', () => {
  assert.equal(londonDate(new Date('2026-10-11T23:30:00Z')), '2026-10-12'); // BST
  assert.equal(londonDate(new Date('2026-12-11T23:30:00Z')), '2026-12-11'); // GMT
  assert.equal(londonTime(new Date('2026-10-25T00:30:00Z')), '01:30');      // BST ends 01:00 UTC that day
});
test('addDays and isISODate', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isISODate('2026-02-29'), false);
  assert.equal(isISODate('2026-10-11'), true);
  assert.equal(weekdayShort('2026-10-11'), 'Sun');
});
test('parseHabits reads the default file', () => {
  const { habits, warnings } = parseHabits(DEFAULT_HABITS_MD);
  assert.deepEqual(habits.map((h) => h.id), ['wake', 'gym', 'outside', 'business', 'vitamins', 'read', 'learn', 'nocoffee']);
  assert.deepEqual(habits.find((h) => h.id === 'read'), { id: 'read', name: 'Read 30m', icon: 'book', goal: 30 });
  assert.equal(habits.find((h) => h.id === 'wake').goal, null);
  assert.deepEqual(warnings, []);
});
test('parseHabits skips bad rows with warnings', () => {
  const md = '| id | Habit | Icon | Focus goal (min) |\n|---|---|---|---|\n| Bad Id | X | sun | |\n| ok | Fine | nope | 3 |\n| ok | Again | sun | |\n| fine | Fine | sun | 45 |\n';
  const { habits, warnings } = parseHabits(md);
  assert.deepEqual(habits.map((h) => h.id), ['fine']);
  assert.equal(warnings.length, 3);              // bad id, goal 3 out of range, duplicate id
  assert.equal(habits[0].icon, 'sun');
});
test('parseHabits: missing table', () => {
  assert.deepEqual(parseHabits('# Habits\n\nnothing here\n'), { habits: [], warnings: ['No habit table found in habits.md'] });
});
```

An unknown icon (`nope`) is kept as written. The UI draws the dot. Bad-row warnings name the row, for example `Row 1: id "Bad Id" must be lowercase letters, digits or dashes`.

- [ ] **Step 2: Run to see them fail.** `node --test test/today-note.test.js` should fail with `Cannot find module '../lib/today-note'`.
- [ ] **Step 3: Implement the exports above** in `lib/today-note.js`.
  - Dates use one cached `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`, read with `formatToParts`.
  - `parseHabits` takes the first run of `|`-rows that has a `---` separator row. Cells are trimmed. Column order is fixed: id, name, icon, goal.
- [ ] **Step 4: Run.** `node --test test/today-note.test.js` should pass. Then `npm test` should pass.
- [ ] **Step 5: Commit** with the message `Today: London dates and habits.md parsing`.

### Task 2: Day notes: parse, tick habits, quote section, new day

**Files:**
- Modify: `lib/today-note.js`
- Test: `test/today-note.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `parseDay(md) → { date: string|null, done: string[], quote: { text, by }|null, tasks: [{ index, text, done, moved, from: string|null }], focus: [{ time, min, target }] }`
    - Tasks are the `[-*] [ |x|X|>]` lines inside `## Tasks`, outside code fences. `index` is their 0-based order there.
    - `text` has the ` (from YYYY-MM-DD)` suffix removed, and `from` holds that date.
    - Focus entries are the lines matching `^- (\d\d:\d\d) (\d+)m (.+)$` inside `## Focus`. `target` is kept as written (`read`, `task: Renew car insurance` or `focus`).
  - `setHabit(md, id, on, order: string[]) → md`. Rewrites only the `habits:` line, as `[a, b]` in `order` order. Ids not in `order` that are already present are kept at the end. Ticking twice is a no-op.
  - `setQuote(md, { text, by }) → md`. Replaces the body of `## Quote` with `> text` and `> — by`. If the section is missing, inserts it right after the frontmatter.
  - `newDay(date, { carried = [], quote = null }) → md`. Frontmatter `date` plus `habits: []`, then `## Quote` (only if `quote` is set), `## Tasks` (with the `carried` lines as given), and `## Focus`, each followed by a blank line.
  - Section helpers stay private to this file. They find `## Heading` lines fence-aware, the way `insertInSection` in `server.js` does. Don't import `server.js`.

- [ ] **Step 1: Write the failing tests**:

```js
const NOTE = '---\ndate: 2026-10-11\nhabits: [wake, gym]\n---\n\n## Quote\n> Be one.\n> — Marcus Aurelius\n\n## Tasks\n- [x] Food shop\n- [ ] Dentist (from 2026-10-09)\n- [>] Old thing\n```\n- [ ] not a task\n```\n\n## Focus\n- 06:05 25m read\n- 07:20 25m task: Dentist\n\nmy own note\n';
test('parseDay reads every part', () => {
  const d = parseDay(NOTE);
  assert.equal(d.date, '2026-10-11');
  assert.deepEqual(d.done, ['wake', 'gym']);
  assert.deepEqual(d.quote, { text: 'Be one.', by: 'Marcus Aurelius' });
  assert.deepEqual(d.tasks.map((t) => [t.index, t.text, t.done, t.moved, t.from]),
    [[0, 'Food shop', true, false, null], [1, 'Dentist', false, false, '2026-10-09'], [2, 'Old thing', false, true, null]]);
  assert.deepEqual(d.focus, [{ time: '06:05', min: 25, target: 'read' }, { time: '07:20', min: 25, target: 'task: Dentist' }]);
});
test('parseDay tolerates CRLF and * bullets', () => {
  const d = parseDay(NOTE.replace(/\n/g, '\r\n').replace('- [x] Food shop', '* [x] Food shop'));
  assert.equal(d.tasks[0].text, 'Food shop');
  assert.deepEqual(d.done, ['wake', 'gym']);
});
test('setHabit is idempotent and keeps habits.md order', () => {
  const order = ['wake', 'gym', 'outside', 'read'];
  let md = setHabit(NOTE, 'read', true, order);
  md = setHabit(md, 'outside', true, order);
  assert.match(md, /^habits: \[wake, gym, outside, read\]$/m);
  assert.equal(setHabit(md, 'read', true, order), md);
  assert.match(setHabit(setHabit(setHabit(setHabit(md, 'wake', false, order), 'gym', false, order), 'outside', false, order), 'read', false, order), /^habits: \[\]$/m);
});
test('edits preserve unknown lines', () => {
  const md = setQuote(setHabit(NOTE, 'read', true, ['wake', 'gym', 'read']), { text: 'New', by: 'Someone' });
  assert.ok(md.endsWith('my own note\n'));
  assert.equal(md.split('\n').filter((l) => l.startsWith('> ')).length, 2);
  assert.deepEqual(parseDay(md).quote, { text: 'New', by: 'Someone' });
});
test('setQuote inserts after frontmatter when missing; newDay layout', () => {
  const fresh = newDay('2026-10-12', { carried: ['- [ ] Dentist (from 2026-10-09)'] });
  assert.equal(fresh, '---\ndate: 2026-10-12\nhabits: []\n---\n\n## Tasks\n- [ ] Dentist (from 2026-10-09)\n\n## Focus\n\n');
  assert.match(setQuote(fresh, { text: 'Q', by: 'A' }), /^---\n[\s\S]*?\n---\n\n## Quote\n> Q\n> — A\n\n## Tasks/);
});
```

- [ ] **Step 2: Run.** `node --test test/today-note.test.js` should show the new tests failing (`parseDay is not a function`).
- [ ] **Step 3: Implement** `parseDay`, `setHabit`, `setQuote` and `newDay` with the signatures above. Work on lines split by `/\r?\n/`. When writing, keep CRLF if the input had it.
- [ ] **Step 4: Run.** The file passes, then `npm test` passes.
- [ ] **Step 5: Commit** with the message `Today: day note parsing and habit/quote edits`.

### Task 3: Streaks, week and focus sums

**Files:**
- Create: `lib/today-stats.js`
- Test: `test/today-stats.test.js`

**Interfaces:**
- Consumes: `addDays` from Task 1.
- Produces:
  - `streaks(doneOn: (iso) => string[]|null, ids: string[], today: string) → { [id]: number }`. `doneOn` returns `null` when there's no note. Counting starts from today if today is ticked, otherwise from yesterday. It stops at the first unticked or missing day, and stops after 400 days.
  - `windowEnd(selected, today) → iso`. Returns `today` when `selected >= addDays(today, -6)`, otherwise `selected`.
  - `week(doneOn, end) → [{ date, done: string[] }]`. Seven entries, oldest first. A missing note gives `done: []`.
  - `focusByHabit(day) → { [id]: minutes }` and `focusByTask(day) → { [text]: minutes }`, summed from `day.focus`. `task: X` counts for task X, `focus` counts for neither, and anything else counts for that habit id.
  - `crossesGoal(before, after, goal) → boolean`, which is `goal != null && before < goal && after >= goal`.

- [ ] **Step 1: Write the failing tests**:

```js
const days = { '2026-10-11': [], '2026-10-10': ['read'], '2026-10-09': ['read'], '2026-10-08': ['gym'], '2026-10-06': ['read'] };
const doneOn = (d) => days[d] || null;
test('streak: unticked today does not break it; a gap ends it', () => {
  assert.deepEqual(streaks(doneOn, ['read', 'gym'], '2026-10-11'), { read: 2, gym: 0 });
  days['2026-10-11'] = ['read'];
  assert.equal(streaks(doneOn, ['read'], '2026-10-11').read, 3);
});
test('streak stops at 400 days', () => {
  assert.equal(streaks(() => ['x'], ['x'], '2026-10-11').x, 400);
});
test('week and windowEnd', () => {
  assert.equal(windowEnd('2026-10-05', '2026-10-11'), '2026-10-11');
  assert.equal(windowEnd('2026-10-04', '2026-10-11'), '2026-10-04');
  const w = week(doneOn, '2026-10-11');
  assert.deepEqual(w.map((d) => d.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepEqual(w[2].done, []);
});
test('focus sums and crossesGoal', () => {
  const day = { focus: [{ min: 25, target: 'read' }, { min: 25, target: 'read' }, { min: 25, target: 'task: Dentist' }, { min: 25, target: 'focus' }] };
  assert.deepEqual(focusByHabit(day), { read: 50 });
  assert.deepEqual(focusByTask(day), { Dentist: 25 });
  assert.equal(crossesGoal(25, 50, 30), true);
  assert.equal(crossesGoal(50, 75, 30), false);
  assert.equal(crossesGoal(0, 25, null), false);
});
```

- [ ] **Step 2: Run.** `node --test test/today-stats.test.js` should fail (module missing).
- [ ] **Step 3: Implement** `lib/today-stats.js` with the exports above.
- [ ] **Step 4: Run.** It passes, then `npm test` passes.
- [ ] **Step 5: Commit** with the message `Today: streaks, week window and focus sums`.

### Task 4: ZenQuotes client

**Files:**
- Create: `lib/today-quote.js`
- Test: `test/today-quote.test.js`

**Interfaces:**
- Produces:
  - `normalizeQuote(json) → { text, by } | null`. Reads `json[0].q` and `json[0].a`, trims them, folds whitespace to single spaces, and caps them at 400 and 100 characters.
    - Returns `null` for a non-array, an empty text, or the rate-limit quote (`a === 'zenquotes.io'` or `q` starting with `Too many requests`).
  - `createQuotes({ fetch, now = Date.now, timeoutMs = 4000 }) → { today(), random() }`
    - `today(): Promise<{text,by}|null>` resolves `null` on any failure and then skips fetching for 10 minutes.
    - `random(): Promise<{text,by}>` throws an `Error` with `.status = 429` if called within 6000 ms of the previous `random()`. It throws `.status = 502` on failure.
    - Each fetch uses `AbortSignal.timeout(timeoutMs)`.

- [ ] **Step 1: Write the failing tests.** Use a stub `fetch` that records URLs and returns `{ ok, json: async () => body }`, and a `now` you advance by hand:

```js
test('normalizeQuote rejects the rate-limit quote', () => {
  assert.equal(normalizeQuote([{ q: 'Too many requests. Obtain an auth key for unlimited access.', a: 'zenquotes.io' }]), null);
  assert.deepEqual(normalizeQuote([{ q: '  Be\n one. ', a: ' Marcus ' }]), { text: 'Be one.', by: 'Marcus' });
  assert.equal(normalizeQuote([{ q: 'x'.repeat(500), a: 'A' }]).text.length, 400);
});
test('today() backs off 10 minutes after a failure', async () => {
  let t = 0; const calls = [];
  const q = createQuotes({ now: () => t, fetch: async (u) => { calls.push(u); throw new Error('down'); } });
  assert.equal(await q.today(), null);
  t += 9 * 60e3; assert.equal(await q.today(), null); assert.equal(calls.length, 1);
  t += 2 * 60e3; await q.today(); assert.equal(calls.length, 2);
  assert.equal(calls[0], 'https://zenquotes.io/api/today');
});
test('random() refuses within 6 s and maps failures to 502', async () => {
  let t = 0;
  const q = createQuotes({ now: () => t, fetch: async () => ({ ok: true, json: async () => [{ q: 'Q', a: 'A' }] }) });
  assert.deepEqual(await q.random(), { text: 'Q', by: 'A' });
  t += 5000; await assert.rejects(q.random(), (e) => e.status === 429);
  const bad = createQuotes({ now: () => 0, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  await assert.rejects(bad.random(), (e) => e.status === 502);
});
```

- [ ] **Step 2: Run.** `node --test test/today-quote.test.js` should fail.
- [ ] **Step 3: Implement** `lib/today-quote.js`.
- [ ] **Step 4: Run.** It passes, then `npm test` passes.
- [ ] **Step 5: Commit** with the message `Today: ZenQuotes client with backoff and shuffle guard`.

### Task 5: The Today service (store, payload, habits, quote)

**Files:**
- Create: `lib/atomic-write.js`, holding `atomicWrite(full, text)` moved **unchanged** from `server.js:684-688`
- Create: `lib/today-service.js`
- Test: `test/today-service.test.js` (temp dir from `fs.mkdtempSync(path.join(os.tmpdir(), 'today-'))`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces `createToday({ dir, now = () => new Date(), quotes, timers = { set: setTimeout, clear: clearTimeout }, secondsPerMinute = 60 })`. It returns the methods below. Every method resolves to the **payload**, except `boot`. Errors are `Error` objects with `.status`.
  - `payload(date?, { canWrite })`
    - `date` defaults to today in London. It must satisfy `isISODate` and be `<= today` (otherwise 400).
    - When `canWrite` is set and `date === today`:
      - write `DEFAULT_HABITS_MD` if `habits.md` is missing
      - create today's note if missing (quote from `quotes.today()`; rollover is added in Task 10)
      - if the note has no `## Quote`, try `quotes.today()` and `setQuote` on success
    - When `canWrite` is not set, it never writes.
  - `setHabit(date, id, done)` gives 404 for an id not in `habits.md`. It creates a missing past note via `newDay(date, {})` first.
  - `shuffleQuote()` gives 400 unless today's note exists. Otherwise it calls `quotes.random()` and `setQuote` on today.
  - `boot()` is a no-op until Task 13.
- **Payload shape** (the frontend depends on these exact names):

```js
{ today, date, serverNow /* ms */, habits /* [{id,name,icon,goal}] */, warnings,
  day: { exists, done, tasks /* [{index,text,done,moved,from,min}] */, focus /* [{time,min,target,label}] */,
         quote /* {text,by,date}|null */, quoteFallback /* bool: quote came from an earlier day */ },
  week /* 7 × {date,done} ending at windowEnd(date,today) */, streaks, focusByHabit /* for `date` */,
  summary: { done, total, focusMin } /* always for today */, timer: null /* filled in Task 13 */ }
```

- Store rules:
  - The note path is `dir/days/<YYYY-MM>/<date>.md`. Directories are made with `fs.promises.mkdir(..., { recursive: true })`.
  - Reads are cached by `path → { mtimeMs, parsed }`.
  - Every write goes through `edit(file, fn)`. That's a per-path promise chain: read fresh, apply `fn(raw)`, `atomicWrite`, drop the cache entry.
  - Streaks and week read notes through the cache. A quote fallback walks back at most 30 days for the latest earlier `quote`.
  - `focus[].label` is the habit name, the task text (from `task: X`), or `Just focus`.

- [ ] **Step 1: Write the failing tests** (a stub `quotes` object; `now` fixed at `2026-10-11T07:00:00Z`):

```js
test('read path never writes', async () => {
  const t = mk(); await t.svc.payload(undefined, { canWrite: false });
  assert.equal(fs.existsSync(path.join(t.dir, 'habits.md')), false);
});
test('first authenticated load seeds habits.md and creates today with the quote', async () => {
  const t = mk({ today: { text: 'Q', by: 'A' } });
  const p = await t.svc.payload(undefined, { canWrite: true });
  assert.equal(fs.readFileSync(path.join(t.dir, 'habits.md'), 'utf8'), DEFAULT_HABITS_MD);
  assert.equal(p.today, '2026-10-11'); assert.equal(p.day.exists, true);
  assert.deepEqual(p.day.quote, { text: 'Q', by: 'A', date: '2026-10-11' });
  assert.equal(p.habits.length, 8); assert.equal(p.week.length, 7); assert.equal(p.summary.total, 8);
});
test('failed quote falls back to the latest earlier one, then fills in on retry', async () => {
  const t = mk({ today: null }); seedNote(t, '2026-10-09', { quote: { text: 'Old', by: 'B' } });
  let p = await t.svc.payload(undefined, { canWrite: true });
  assert.equal(p.day.quoteFallback, true); assert.equal(p.day.quote.date, '2026-10-09');
  t.quotes.next = { text: 'New', by: 'C' };
  p = await t.svc.payload(undefined, { canWrite: true });
  assert.equal(p.day.quoteFallback, false); assert.equal(p.day.quote.text, 'New');
});
test('setHabit: unknown id 404, past day created, future date 400', async () => {
  const t = mk(); await t.svc.payload(undefined, { canWrite: true });
  await assert.rejects(t.svc.setHabit('2026-10-11', 'nope', true), (e) => e.status === 404);
  const p = await t.svc.setHabit('2026-10-08', 'gym', true);
  assert.deepEqual(p.day.done, ['gym']); assert.equal(p.date, '2026-10-08');
  await assert.rejects(t.svc.payload('2026-10-12', { canWrite: true }), (e) => e.status === 400);
});
test('concurrent writes to one note both land', async () => {
  const t = mk(); await t.svc.payload(undefined, { canWrite: true });
  await Promise.all([t.svc.setHabit('2026-10-11', 'wake', true), t.svc.setHabit('2026-10-11', 'gym', true)]);
  assert.deepEqual((await t.svc.payload(undefined, { canWrite: false })).day.done, ['wake', 'gym']);
});
```

Small helpers in the test file:
- `mk(opts)` builds a temp dir, a stub `quotes` and the service. The stub is `const q = { next: opts.today ?? null, today: async () => q.next, random: async () => q.next }`, exposed as `t.quotes`.
- `seedNote(t, date, { quote, done, tasks, focus })` writes a note with `newDay` and the edit functions.
- `readNote(t, date)` returns the file's text.

- [ ] **Step 2: Run.** `node --test test/today-service.test.js` should fail.
- [ ] **Step 3: Implement** `lib/atomic-write.js` and `lib/today-service.js`. In `server.js`, replace the local `atomicWrite` with `const { atomicWrite } = require('./lib/atomic-write');`.
- [ ] **Step 4: Run.** The file passes, then `npm test` passes (the existing tests cover `server.js` users of `atomicWrite` indirectly). Also run `node -e "require('./server.js')"`. It should get as far as printing the "No config.json found" message or listening. A `SyntaxError` means it failed.
- [ ] **Step 5: Commit** with the message `Today: service with file store, payload, habit ticks and quotes`.

### Task 6: Routes, scan exclusion, boot hook

**Files:**
- Modify: `server.js` (Config block near line 14; `walk` at 188 and `walkKB` at 324; a new `// ---------- Today ----------` route block after the `/api` gate at line 952 and before `// ---------- Workspaces ----------`; the `app.listen` callback at 2320)
- Test: covered by Task 7's API smoke and Task 8's e2e. `server.js` has no unit harness.

**Interfaces:**
- Consumes: `createToday` (Task 5), `createQuotes` (Task 4).
- Produces these HTTP routes (bodies and errors as in the spec's Routes table):
  - `GET /api/today?date=`
  - `POST /api/today/habit` with `{ date, id, done }`
  - `POST /api/today/quote`
  - `POST /api/today/task` and `POST /api/today/timer`, which are registered in Tasks 10 and 13
  - Each returns the payload, or `{ error }` with `err.status || 400`.

- [ ] **Step 1: Add the constants and the service:**
  - `const TODAY_DIR = path.join(VAULT_DIR, 'Personal', 'Today');`
  - `const TODAY_SPM = (() => { const n = parseInt(process.env.TODAY_SECONDS_PER_MINUTE || '', 10); return n >= 1 && n <= 60 ? n : 60; })();`
  - `const today = createToday({ dir: TODAY_DIR, quotes: createQuotes({ fetch }), secondsPerMinute: TODAY_SPM });`
- [ ] **Step 2: Skip the folder in scans.** In `walk` and `walkKB`, skip the directory when `full === TODAY_DIR`, before recursing.
- [ ] **Step 3: Add the routes.**
  - `canWrite` is `!!(req.session && req.session.authed)`.
  - POST routes check `typeof` for each body field (400 on a wrong type).
  - Copy the try/catch shape of `/api/task/status` (`server.js:1366`).
- [ ] **Step 4: Boot.** In the `app.listen` callback, after the Board.md loop, add `today.boot().catch((err) => console.error('Today boot failed:', err.message));`.
- [ ] **Step 5: Check.** `npm test` passes, and `node --check server.js` exits 0.
- [ ] **Step 6: Commit** with the message `Today: API routes, scan exclusion, boot hook`.

### Task 7: Preview container and synthetic vault

**Files:**
- Create: `scripts/today-sandbox.js`
- Create, outside the repo: `/opt/vault/today-preview/` containing `compose.yml`, `config.json`, `lockout.json`, `workspace-visibility.json`, `mint-cookie.js`, `set-password.js` (copied) and `reset.sh`

**Interfaces:**
- Produces:
  - The preview at `http://127.0.0.1:7691`.
  - `node /opt/vault/today-preview/mint-cookie.js`, which prints a session cookie header.
  - `/opt/vault/today-preview/reset.sh`, which regenerates the vault and restarts the container. Later e2e tasks call it before each scenario.
  - `node scripts/today-sandbox.js <outDir> [--date=YYYY-MM-DD]`. It defaults to today in London.

- [ ] **Step 1: Write `scripts/today-sandbox.js`.** It is deterministic for a given `--date` (call it D):
  - `Personal/_tasks/Board.md` and one task, `Personal/1. apps/01-demo/task.md`, so the Board loads. Copy the shapes from `scripts/term-sandbox.js`.
  - `Personal/Today/habits.md` = `DEFAULT_HABITS_MD` (required from `../lib/today-note`) plus one extra row, `| Bad Id | Broken | sun | |`.
  - Day notes for D−11 to D−1, with **no** notes for D−3 and D−8.
    - `vitamins` is ticked on every note.
    - `read` is ticked on D−2 and D−1.
    - D−1 has `## Tasks` with `- [x] Wash the car` and `- [ ] Book dentist check-up (from <D−4>)`, and `## Quote` with `> Waste no more time arguing about what a good man should be. Be one.` and `> — Marcus Aurelius`.
  - **No** note for D itself, so the first authenticated load exercises rollover in Phase 2.
- [ ] **Step 2: Create `/opt/vault/today-preview/`.**
  - `compose.yml`: a copy of `/opt/vault/herdr-term-preview/compose.yml` with these changes:
    - `name`/`container_name`: `today-preview`
    - port `127.0.0.1:7691:8080`
    - `TERMINAL: "0"`, and no `HOME`, `SHELL` or `home` mount
    - add `TODAY_SECONDS_PER_MINUTE: "1"`
    - mounts point at `/opt/vault/board-today/{public,server.js,lib,scripts}`
  - Copy `mint-cookie.js` and `workspace-visibility.json` from the herdr preview, and copy `set-password.js` from the worktree.
  - Run `node set-password.js "$(openssl rand -hex 12)"` in that folder. Nobody needs the password, because the cookie is minted.
  - `reset.sh` is the herdr one, minus the `home` lines, calling `node /opt/vault/board-today/scripts/today-sandbox.js vault` and restarting `today-preview`.
  - Then `chown 1000:1000 config.json lockout.json workspace-visibility.json`, `chmod 600` on the same files plus `compose.yml`, and `docker compose -f compose.yml up -d`.
- [ ] **Step 3: API smoke.** Run `/opt/vault/today-preview/reset.sh`, then:
  - `curl -s -H "Cookie: $(node /opt/vault/today-preview/mint-cookie.js)" 127.0.0.1:7691/api/today | python3 -c 'import sys,json; p=json.load(sys.stdin); print(len(p["habits"]), len(p["warnings"]), p["day"]["exists"], p["streaks"]["vitamins"])'` should print `8 1 True 2`. The warning is `Row 9: id "Bad Id" must be lowercase letters, digits or dashes`. The vitamins streak is 2 because the note for D−3 is missing, and today isn't ticked yet.
  - `curl -s 127.0.0.1:7691/api/today` (no cookie, from this host) returns 200 and leaves no new file. Check with `ls /opt/vault/today-preview/vault/Personal/Today/days/*/`.
- [ ] **Step 4: Commit** `scripts/today-sandbox.js` with the message `Today: synthetic vault for the preview`. The preview folder sits outside the repo and isn't committed.

### Task 8: Today mode in the shell (landing, nav, date and quote card)

**Files:**
- Create: `public/today.js`
- Create: `scripts/today-e2e.js`
- Modify: `public/index.html` (lines 30–33 modes; next to `#board-view` at 151; `#mobile-nav` at 221; script tags at 329)
- Modify: `public/app.js` (`STATE.mode` at line 32; the `render()` count write at 665; `setMode` at 1071; mobile-nav observers at 1124; `restoreAfterReload` at 1869; login at 113 and startup at 2003)
- Modify: `public/styles.css` (a new `/* ---------- Today ---------- */` block at the end; `.mobile-nav` `repeat(4, 1fr)` → `repeat(5, 1fr)` at line 1501)

**Interfaces:**
- Consumes: the payload (Task 5), and `api()`, `$()`, `setMode()` and `STATE` (globals in `app.js`).
- Produces the global `Today = { init(), show(), hide(), reload() }`, plus these DOM ids, which later tasks and e2e use:
  - `#mode-today`, `#today-view`
  - `#td-dow`, `#td-dnum`, `#td-dmeta`, `#td-prev`, `#td-next`, `#td-back`
  - `#td-quote-text`, `#td-quote-by`, `#td-quote-from`, `#td-shuffle`
  - `#td-main`, the container later cards go into
- `Today` also owns `#count` while it's showing. Its text is `${summary.done}/${summary.total} habits`.

- [ ] **Step 1: Write the e2e harness and scenario T0.** `scripts/today-e2e.js` copies the harness from `scripts/term-e2e.js:1-60`, with these changes:
  - `PREVIEW` is `/opt/vault/today-preview` and the allowlisted base is `http://127.0.0.1:7691`.
  - The override env var is `TODAY_E2E_OTHER_BASE`, and the script still refuses `7684`.
  - Screenshots go to `/tmp/today-shots/`.
  - It runs `reset.sh` before each scenario.

  Usage is `node scripts/today-e2e.js [--phone] [--theme=sepia] T0 [T1 …]`. **T0** checks:
  - Fresh load lands on Today: `#mode-today.active` and `#today-view` visible.
  - `#td-dow` contains the London weekday of today.
  - `#td-quote-text` is non-empty.
  - `#count` matches `/^\d+\/8 habits$/`.
  - Clicking Board shows `#board-view` and `#count` matching `/open/`. Clicking Today again restores the habits count.
  - `--phone`: `#mobile-nav` has 5 buttons, the first labelled `Today`.
  - The ‹ button makes `#td-back` visible, and clicking it hides it again.
  - Refresh while on Board comes back on Board (reload-state), and a fresh tab comes back on Today.
  - Screenshot `t0-<theme>-<desk|phone>.png`.
- [ ] **Step 2: Run it.** `node scripts/today-e2e.js T0` should FAIL (no `#mode-today`).
- [ ] **Step 3: Wire the mode.**
  - `index.html`:
    - `<button id="mode-today" class="mode active" data-mode="today">Today</button>` goes first in `.modes`, and `#mode-board` loses its `active` class.
    - `<div id="today-view"></div>` goes before `#board-view`, and `#board-view` gets `class="hidden"`.
    - A mobile-nav button with `data-for="mode-today"` and a sunrise icon goes first. The icon path is in `data/today-mockup.html` (`IC.sunrise`) in the task folder. Move `class="active"` onto it.
    - `<script src="today.js"></script>` goes after `app.js`.
  - `app.js`:
    - `STATE.mode: 'today'`.
    - In `render()`, only write `#count` when `STATE.mode === 'board'`.
    - In `setMode`, toggle `#mode-today`/`#today-view`. Hide `#search` when the mode is `today` (with the existing `hidden` class) and show it otherwise. Call `Today.show()` or `Today.hide()`.
    - Add `'mode-today'` to the mobile-nav observer list.
    - `restoreAfterReload` returns `false` only when there's no saved state. A saved `board` is restored too.
    - Startup: `await load(); Today.init(); if (!restoreAfterReload()) setMode('today');`. The login submit does the same after `load()`, without the restore.
- [ ] **Step 4: Build `public/today.js`** (the date and quote cards only):
  - It loads with `api('/api/today' + (date ? '?date=' + date : ''))`.
  - It paints from the payload. The date meta reads `Week N · day D of 365|366`, computed from the ISO date string, not the local clock.
  - ‹ and › step the date and are disabled at today. Stepping back is unlimited.
  - Shuffle posts `/api/today/quote` and then disables itself for 6 s. It's only shown on today and when `day.exists`.
  - `#td-quote-from` shows `from <Wkd>` when `quoteFallback` is set. With no quote, it shows `No quote yet today.`
  - The attribution link points to `https://zenquotes.io/` and has `rel="noopener"`.
  - On `visibilitychange` to visible, and every 60 s while shown: reload. If `payload.today` changed while the page was on the old today, switch to the new today.
  - Layout and look follow the mockup's hero row. Port its CSS onto VaultOS tokens (`--panel`, `--line`, `--brand`, `--muted` and the rest), with `td-` prefixes.
- [ ] **Step 5: Run.** `node scripts/today-e2e.js T0` should PASS for all checks. Run it again with `--phone`, and with `--theme=sepia`. Look at the four screenshots: no clipping, no horizontal scroll, and the header doesn't wrap on the phone.
- [ ] **Step 6: Commit** with the message `Today: mode, landing, phone tab, date and quote cards`.

### Task 9: Habits card, score and streaks

**Files:**
- Modify: `public/today.js`, `public/styles.css` (Today block), `scripts/today-e2e.js` (scenario T1)

**Interfaces:**
- Consumes: `POST /api/today/habit` (Task 6), and the payload fields `habits`, `warnings`, `day.done`, `week`, `streaks` and `focusByHabit`.
- Produces this DOM:
  - `#td-habits`, containing `.td-hrow[data-id]`
  - `.td-tick[aria-pressed]`
  - `.td-cell[data-date][aria-pressed]`
  - `.td-streak`, `.td-prog` (goal habits only)
  - `#td-warn`, `#td-bars`, `#td-week`

- [ ] **Step 1: Write scenario T1.** Starting from the reset preview:
  - Tick `wake` → the today note's `habits:` line contains `wake`. Read the file from `/opt/vault/today-preview/vault/Personal/Today/days/…`.
  - Click the `gym` cell for D−2 → that note has `gym`.
  - The `vitamins` streak shows `2`. After ticking vitamins today it shows `3`.
  - `#td-warn` contains `Bad Id`.
  - `#td-week` shows a percentage.
  - On the phone, every `.td-tick` is at least 36 px square.
  - Screenshots.
- [ ] **Step 2: Run.** `node scripts/today-e2e.js T1` should FAIL.
- [ ] **Step 3: Implement the habits card**, ported from the mockup (`hrow`, cells, streak, score bars) with `td-` classes and tokens:
  - Icons: an `ICON_PATHS` map in `today.js` covers all 15 names in Global Constraints, as Lucide-style 24×24 strokes. Copy the eight in `data/today-mockup.html` (`IC.*`) and draw the other seven (heart, moon, droplet, pen, music, walk, check) the same way. An unknown name draws a 6 px dot.
  - The tick and the cells post `/api/today/habit`, then repaint from the response.
  - The **Focus** link on goal habits is rendered only after Task 14 makes the timer exist. Leave a `// Task 14` marker where it goes.
  - Progress shows `min / goal min` from `focusByHabit`.
  - The cell `title` and `aria-label` give `Wkd D · done|not done`.
- [ ] **Step 4: Run.** T1 and T0 PASS, on desktop and `--phone`, in Dark and Sepia. Look at the screenshots.
- [ ] **Step 5: Commit** with the message `Today: habits card with 7-day grid, streaks and score`.

**▶ Release point 1:** follow **Releasing** if Ben wants Phase 1 live now. Otherwise continue.

## Phase 2: today's tasks

### Task 10: Task edits and rollover

**Files:**
- Modify: `lib/today-note.js`, `lib/today-service.js`, `server.js` (register `POST /api/today/task` in the Today route block)
- Test: `test/today-note.test.js`, `test/today-service.test.js`

**Interfaces:**
- Produces in `today-note`:
  - `cleanTaskText(s) → string` (trim, newlines to spaces, cap 200; throws `.status=400` when empty)
  - `addTask(md, text) → md` (appends `- [ ] text` at the end of `## Tasks`)
  - `toggleTask(md, index, expectText) → md`
  - `deleteTask(md, index, expectText) → md`. Both throw `.status=409` with message `This day changed since you loaded it. Refreshed.` when the task at `index` has different text. `toggleTask` throws `.status=400` on a `[>]` line.
  - `rollover(prevMd, prevDate) → { carried: string[], prevMd }`. `carried` holds `- [ ] text (from F)`, where F is the line's existing `from` or else `prevDate`. In `prevMd`, those lines become `- [>]`.
- Produces in the service:
  - `task(date, { op, text, index })`, with `op` one of `add`, `toggle` or `delete`
  - When today's note is created, the service finds the latest earlier note (listing `days/*/` and looking back up to 400 days), writes the new note with `carried`, **then** writes `prevMd`.
  - The payload's `day.tasks[].min` comes from `focusByTask`.

- [ ] **Step 1: Write the failing tests**:

```js
test('toggle 409 on text mismatch; [>] cannot toggle', () => {
  assert.throws(() => toggleTask(NOTE, 1, 'Something else'), (e) => e.status === 409);
  assert.throws(() => toggleTask(NOTE, 2, 'Old thing'), (e) => e.status === 400);
  assert.match(toggleTask(NOTE, 1, 'Dentist'), /^- \[x\] Dentist \(from 2026-10-09\)$/m);
});
test('rollover keeps the first from-date and marks the source', () => {
  const { carried, prevMd } = rollover(NOTE, '2026-10-11');
  assert.deepEqual(carried, ['- [ ] Dentist (from 2026-10-09)']);
  assert.match(prevMd, /^- \[>\] Dentist \(from 2026-10-09\)$/m);
  assert.match(prevMd, /^- \[x\] Food shop$/m);
});
test('cleanTaskText', () => {
  assert.equal(cleanTaskText('  a\nb  '), 'a b');
  assert.equal(cleanTaskText('x'.repeat(300)).length, 200);
  assert.throws(() => cleanTaskText('   '), (e) => e.status === 400);
});
```

In `test/today-service.test.js`:

```js
test('payload after midnight creates the new day with rollover', async () => {
  const t = mk(); seedNote(t, '2026-10-09', { tasks: ['- [ ] Dentist', '- [x] Done thing'] }); // 10-10 skipped
  const p = await t.svc.payload(undefined, { canWrite: true });
  assert.deepEqual(p.day.tasks.map((x) => [x.text, x.from]), [['Dentist', '2026-10-09']]);
  assert.match(readNote(t, '2026-10-09'), /^- \[>\] Dentist$/m);
});
test('add, toggle, delete through the service', async () => {
  const t = mk(); await t.svc.payload(undefined, { canWrite: true });
  let p = await t.svc.task('2026-10-11', { op: 'add', text: 'Renew insurance' });
  p = await t.svc.task('2026-10-11', { op: 'toggle', index: 0, text: 'Renew insurance' });
  assert.equal(p.day.tasks[0].done, true);
  p = await t.svc.task('2026-10-11', { op: 'delete', index: 0, text: 'Renew insurance' });
  assert.equal(p.day.tasks.length, 0);
});
```

- [ ] **Step 2: Run.** `node --test test/today-note.test.js test/today-service.test.js` should show the new tests FAIL.
- [ ] **Step 3: Implement** the functions above and register the route. The route checks that `op` is one of the three strings, that `index` is an integer, and that `text` is a string.
- [ ] **Step 4: Run.** The files pass, then `npm test` passes. Then `reset.sh` and the curl from Task 7 Step 3: today's note should now hold `Book dentist check-up (from <D−4>)`, and D−1's copy should be `[>]`.
- [ ] **Step 5: Commit** with the message `Today: task edits and rollover`.

### Task 11: Tasks card

**Files:**
- Modify: `public/today.js`, `public/styles.css`, `scripts/today-e2e.js` (scenario T2)

**Interfaces:**
- Consumes: `POST /api/today/task` and `day.tasks`.
- Produces this DOM:
  - `#td-tasks`, containing `.td-trow[data-index]`
  - `.td-tchk`, `.td-tdel`
  - `.td-tfocus` (rendered from Task 14 on, behind the same marker as Task 9)
  - `#td-task-form`, `#td-task-input`
  - `#td-side`: the right-hand column. It now exists, and the habits card plus `#td-side` sit in a `.td-cols` two-column grid that becomes one column at `max-width: 820px` of `#today-view` (a container query, as in the mockup).

- [ ] **Step 1: Write scenario T2:**
  - The rolled task shows the tag `from <Wkd of D−4>`.
  - Adding `Renew car insurance` puts the line in the file. Ticking it gives `[x]`, and deleting it removes the line.
  - On D−1, the dentist row reads `moved to next day` and its checkbox is disabled.
  - **Stale toggle:** append a line to today's file on disk with `fs.appendFileSync`, rewrite the dentist line's text in the file, then click its checkbox. The UI shows the error text `This day changed since you loaded it. Refreshed.` in `#td-task-msg` and repaints with the file's current tasks.
  - Screenshots.
- [ ] **Step 2: Run.** `node scripts/today-e2e.js T2` should FAIL.
- [ ] **Step 3: Implement the tasks card** (ported from the mockup):
  - Tags:
    - The rolled-over tag reads `from <Wkd>` when the `from` date is within 6 days of the row's day, otherwise `from <D Mon>` (for example `from 9 Oct`).
    - `[>]` rows read `moved to next day`.
    - `min > 0` shows `<fmt> focus`.
  - Every write sends `{ date, op, index, text }` and repaints from the response.
  - On a 409, show the message and reload the day.
  - Enter in the input adds the task. The input clears on success.
  - The delete button is always visible on a phone (`@media (pointer: coarse)`).
- [ ] **Step 4: Run.** T2, T1 and T0 PASS on desktop and phone, in Dark and Sepia. Look at the screenshots.
- [ ] **Step 5: Commit** with the message `Today: tasks card with rollover tags`.

**▶ Release point 2:** **Releasing**, if Ben wants it now.

## Phase 3: focus timer

### Task 12: Timer state machine

**Files:**
- Create: `lib/today-timer.js`
- Test: `test/today-timer.test.js`

**Interfaces:**
- Produces:
  - `MINUTES = { focus: 25, short: 5, long: 15 }`
  - `initial(today) → { phase: 'focus', state: 'idle', target: 'focus', startedAt: null, endsAt: null, leftMs: null, cycle: 0, cycleDate: today, lastEvent: null }`
  - `durationMs(phase, spm = 60) → MINUTES[phase] * spm * 1000`
  - `apply(s, action, { nowMs, today, target, spm }) → s'`
    - `start`: from `idle`. Sets `startedAt`/`endsAt`, and takes `target` only in the focus phase.
    - `pause`: only while `running`. Stores `leftMs`.
    - `resume`: only while `paused`.
    - `skip`: focus → short break, any break → focus. Both land idle, and skip never counts a session.
    - `reset`: back to idle, same phase.
    - An invalid action for the state throws `.status=400`.
    - If `s.cycleDate !== today`, `cycle` resets to 0 first.
  - `complete(s, { nowMs, today }) → { state, logged }`
    - In the focus phase, `logged = { startedAt, min: MINUTES.focus, target }`. `cycle` goes up by one, and when it reaches 4 the next phase is `long` and `cycle` resets to 0. Otherwise the next phase is `short`.
    - In a break, `logged = null` and the next phase is `focus`.
    - The resulting state is always idle.

- [ ] **Step 1: Write the failing tests:**
  - `start→pause→resume keeps leftMs`: start at t=0 with spm 60, pause at t=60 000, then resume at t=100 000. `endsAt` should be `100000 + 1440000`.
  - `fourth completion goes to the long break`: run start+complete four times. After each, the phases go short, short, short, long, and `cycle` ends at 0.
  - `skip does not count a session`: after start then skip, `cycle` is still 0 and the phase is `short`.
  - `cycle resets on a new day`: `cycleDate` of yesterday with `cycle: 3`, then start → `cycle` is 0.
  - `invalid actions throw 400`: `pause` while idle, and `resume` while running.
  - `spm shrinks durations`: `durationMs('focus', 1)` equals `25000`.
- [ ] **Step 2: Run.** `node --test test/today-timer.test.js` should FAIL.
- [ ] **Step 3: Implement** `lib/today-timer.js`.
- [ ] **Step 4: Run.** It passes, then `npm test` passes.
- [ ] **Step 5: Commit** with the message `Today: Pomodoro state machine`.

### Task 13: Server-held timer: persistence, completion, auto-tick

**Files:**
- Modify: `lib/today-service.js`, `server.js` (register `POST /api/today/timer`)
- Test: `test/today-service.test.js`

**Interfaces:**
- Consumes: Task 12, `appendFocus` and `focusLine` (added here to `today-note`), and `crossesGoal` (Task 3).
- Produces:
  - `today-note.focusLine({ time, min, target }) → '- 06:05 25m read'`, with `task:X` written as `task: X`
  - `today-note.appendFocus(md, entry) → md`
  - In the service:
    - `timer(action, target)`, where `target` is a habit id, `task:<text>` or `focus`
    - `boot()`
    - `payload().timer` is `{ phase, state, target, targetLabel, startedAt, endsAt, leftMs, totalMs, cycle, lastEvent }`
  - The `lastEvent` texts are exactly:
    - `Session logged: 25 min on <label>.`
    - `<Habit name> ticked. <after> of <goal> minutes today.`
    - `Break over.`
  - `lastEvent` is `{ id: <increasing int>, kind: 'focus-done'|'break-done', at: <ISO>, text }`.
- Rules:
  - State is persisted to `dir/.timer.json` with `atomicWrite` after every change.
  - One `timers.set` is armed for `endsAt − now` and re-armed after each change.
  - On completion, the line goes in the note for the **start** date, at the start time, with `londonDate`/`londonTime` of `startedAt`. The note is created if it's missing. If the target is a goal habit and `crossesGoal(before, after, goal)` holds, the habit is ticked in the same edit.
  - On `boot()`, load the file. If `state === 'running'` and `endsAt <= now`, complete it straight away. Otherwise re-arm.
  - Starting with a target that isn't a goal habit, today's open task (`task:<text>`) or `focus` gives 400.

- [ ] **Step 1: Write the failing tests** (fake timers: `timers = { set: (fn, ms) => (armed = { fn, ms }), clear: () => (armed = null) }`):
  - `a session on read crosses the goal and auto-ticks`: seed today with `read` at 25 min. Start on `read`, then fire `armed.fn()`. The note gets `- 08:00 25m read` (07:00 UTC is 08:00 in London), the habits list contains `read`, and `lastEvent.text === 'Read 30m ticked. 50 of 30 minutes today.'`.
  - `unticking sticks`: untick `read`, run another session. `read` is not ticked, and the text is `Session logged: 25 min on Read 30m.`
  - `a session started 23:50 logs to its start day`: `now` at `2026-10-11T22:50:00Z` (23:50 BST), and completion at `23:15Z` the next day. The line lands in `2026-10-11.md` at `23:50`.
  - `boot completes an expired session`: write `.timer.json` running with `endsAt` in the past, call `boot()`, and the focus line exists.
  - `boot re-arms a live session`: with `endsAt` 10 min ahead, `armed.ms === 600000`.
  - `bad target 400`: `timer('start', 'wake')`, since `wake` has no goal.
- [ ] **Step 2: Run.** These should FAIL.
- [ ] **Step 3: Implement.** Register the route: the body is `{ action, target }`, the action is checked against the five names, and the response is the payload.
- [ ] **Step 4: Run.** `npm test` passes. On the preview (spm 1, so one session takes 25 s), after `reset.sh`:
  - Minted-cookie curl: `POST /api/today/timer {"action":"start","target":"read"}`.
  - Wait 30 s: `sleep 30` in a background shell, or the Monitor tool.
  - Then `GET /api/today`: `day.focus` should have one `read` line and `timer.phase` should be `short`.
- [ ] **Step 5: Commit** with the message `Today: server-held Pomodoro with auto-tick and boot recovery`.

### Task 14: Focus card, header chip, toast and sound

**Files:**
- Modify: `public/today.js`, `public/styles.css`, `public/index.html` (the Settings "look" pane, after the `Agent sound` row at line 134; `#today-chip` in the header after `#count`), `public/termtoast.js` (a `focus` tone kind), `scripts/today-e2e.js` (scenario T3)

**Interfaces:**
- Consumes: `POST /api/today/timer`, `payload.timer` and `payload.summary.focusMin`.
- Produces:
  - DOM: `#td-focus`, `#td-clock`, `#td-phase`, `#td-target` (a `<select>`), `#td-go`, `#td-skip`, `#td-reset`, `#td-dots`, `#td-log`, `#today-chip`, and `#segTodaySound` (`data-v="on"|"off"`, the same pattern as `#segTermSound`)
  - `#count` text: `${done}/${total} habits · ${fmt(focusMin)} focus`, where `fmt` gives `50m` or `1h 15m`
  - `TermToast.tone('focus')`: two notes, 660 Hz then 880 Hz, each 0.12 s, with the same gain as the existing beeps

- [ ] **Step 1: Write scenario T3** (preview spm 1):
  - Select `Read 30m` and Start.
  - `#today-chip` shows `mm:ss · Read 30m` and counts down. Switch to Board: the chip is still visible and `document.title` starts with `mm:ss`.
  - Reload in the middle of the session: the countdown continues within ±2 s.
  - After about 25 s, the toast `Read 30m ticked. 50 of 30 minutes today.` appears. Read's tick is pressed. `#td-log` has the session. The file has the line.
  - `#td-go` reads `Start break`, and `#td-target` is disabled.
  - Opening a second page in the same context after 3 minutes shows no toast. Simulate the age by setting `sessionStorage` empty and overriding `Date.now` by +3 min.
  - The Focus link on the Read row and ▶ on a task both set `#td-target`.
  - Screenshots, including the phone with the chip.
- [ ] **Step 2: Run.** `node scripts/today-e2e.js T3` should FAIL.
- [ ] **Step 3: Implement the focus card**, ported from the mockup's ring, picker, buttons and log:
  - Picker options:
    - group "Habits with a time goal": `<name> (<min>/<goal>)` → value `<id>`
    - group "Today's tasks": the open tasks → value `task:<text>`
    - `Just focus` → value `focus`
    - The picker is disabled during a break.
  - The countdown is local: `left = endsAt − (Date.now() + offset)`, where `offset = serverNow − Date.now()` is taken at each response. A `requestAnimationFrame`-free 250 ms interval runs only while `state === 'running'`.
  - At zero, wait 1500 ms, then reload. Show the toast with `TermToast.create({ onClick: () => setMode('today') })` and `kind: 'done'`, and play `TermToast.tone('focus')` when the sound pref isn't `'off'`. Do this only for a new `lastEvent.id` under 2 min old, and record the id in `sessionStorage`.
  - The chip and the title prefix update in every mode. The chip is hidden when the timer isn't running or paused.
  - Fill in the two `// Task 14` markers.
- [ ] **Step 4: Run.** T3, T2, T1 and T0 PASS on desktop and phone, in Dark and Sepia. `npm test` passes. Look at the screenshots.
- [ ] **Step 5: Commit** with the message `Today: focus card, header chip, toast and sound`.

### Task 15: Docs and the whole-branch check

**Files:**
- Modify: `CLAUDE.md`, adding a `## Today mode` section of about 25 lines:
  - where the data lives
  - London time and why (the UTC container)
  - the preview on `:7691` and `reset.sh`
  - `TODAY_SECONDS_PER_MINUTE` is preview-only
  - the read path never writes
  - `.timer.json`
  - restarts kill terminals
  - the e2e scenarios
- Modify: the spec, adding a closing `## Decisions made during implementation` section, plus the Status line
- Modify, in the vault: `Personal/1. apps/57-vaultos-today-mode/task.md`. Tick the Plan items, add to the Progress log, rewrite the `[!agent]` handoff, and set `updated:`. Check the ownership with `find /opt/vault/vault ! -uid 1000`, which should print nothing.

- [ ] **Step 1: Run the full suite.** `npm test` passes. Then `for s in T0 T1 T2 T3; do for f in "" --phone; do for th in "" --theme=sepia; do node scripts/today-e2e.js $f $th $s; done; done; done` should end with every run exiting 0.
- [ ] **Step 2: Write the docs above**, applying the stop-slop rules to the prose.
- [ ] **Step 3: Commit** with the message `Today: docs`.
- [ ] **Step 4: Whole-branch review.** Use superpowers:requesting-code-review against `master..today-mode`, and fix what it finds.

**▶ Release point 3:** **Releasing**.

## Releasing (only with Ben's OK, every time)

1. **Ask Ben.** Tell him which phase is ready, that the restart kills his live Claude terminals, and ask when. Wait for his yes.
2. **Check that master hasn't moved.** Run `git -C /opt/vault/board log -1 --format=%H master` and note the sha as `PRE`. If master is ahead of the branch point, rebase `today-mode` onto it in the worktree and rerun `npm test` and all e2e scenarios.
3. **Merge and restart together.** Run `git -C /opt/vault/board merge --ff-only today-mode && docker restart vault-board`. The merge alone makes the new `public/` live before the server has the routes.
4. **Verify.**
   - `curl -s 127.0.0.1:7684/health` returns `{"ok":true}`.
   - `diff <(curl -s 127.0.0.1:7684/today.js) /opt/vault/board/public/today.js` prints nothing.
   - `docker logs --since 2m vault-board` shows no `Today boot failed`.
   - Take a headless screenshot of `http://127.0.0.1:7684/` (read path), which shows Today. The read path never seeds `habits.md`. That happens on Ben's first load.
5. **Ben checks** a tick, and later a task and a real 25-minute session, on his phone and desktop.
6. **Rollback if needed:** `git -C /opt/vault/board revert --no-edit PRE..HEAD && docker restart vault-board`, again with Ben's OK. The day notes stay in the vault, where they're harmless.
7. **Record it.** Add a Progress log line in task 57 with the release, `PRE` and the new sha.
