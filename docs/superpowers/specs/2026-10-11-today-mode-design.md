# Today mode: a daily home screen in VaultOS

Date: 2026-10-11 · Status: built on branch `today-mode` (all 15 tasks, reviewed per task), not yet released; the release needs Ben's OK. Design and spec approved by Ben 2026-10-11; implementation plan in `docs/superpowers/plans/2026-10-11-today-mode.md` · Task: `Personal/1. apps/57-vaultos-today-mode` · Branch `today-mode`, worktree `/opt/vault/board-today`

## Why

Ben wants a screen for life in general, apart from the Board: the date, a daily quote, a short list of today's tasks, eight habits he ticks every day with a 7-day trend, and a Pomodoro timer that ties them together. Reading or business work happens through the timer and counts toward those habits.

He built this once as **LifeOS** (Next.js + SQLite on LXC 201). It holds the same habits with three linked to focus time, but its last Pomodoro was logged on 9 Sep 2026, around the time VaultOS became the app he opens every day. LifeOS also has no login and no backups. So the features move into VaultOS as a fourth mode, **Today**, next to Board, Files and Knowledge Base.

Clickable mockup (Dark/Sepia, desktop/phone), used to agree this design: https://claude.ai/artifact/AgGZpshMNzezeSWDwjoUx9. Source copy in the task folder at `data/today-mockup.html`.

**Goal:** VaultOS opens on Today. Ben ticks habits on his phone in the morning, works through Pomodoros on the desktop, and every day is a plain markdown note in the vault that Obsidian and Claude can both read.

## Decisions

### Ben's (2026-10-11)

1. **Approach A.** Today is a mode inside VaultOS. Each day is a markdown note in the vault. LifeOS is not revived and is not used as a backend.
2. **VaultOS opens on Today** instead of the Board.
3. **Start fresh.** No import of LifeOS history.
4. **Unticked tasks move to the next day**, tagged with the day they were first set.
5. **Quotes come from a website.** ZenQuotes (below). Each day's quote is saved into that day's note.
6. **When a Pomodoro ends:** a toast and a sound in VaultOS. No Telegram or n8n.
7. **"Wake up at 5:00" is ticked by hand.** No time rule.

### Defaults in this spec

- The mode is called **Today**. Its header button sits first, before Board.
- Today's data lives in `Personal/Today/`, whatever workspace the Board is showing. The workspace switcher has no effect on Today.
- Days run on **Europe/London** time. The container's clock is UTC (`TZ` is unset), so Today computes London dates with `Intl.DateTimeFormat` and never with `new Date().getDate()`. Nothing else in VaultOS changes timezone.
- Pomodoro lengths are fixed at 25 minutes of focus, a 5-minute break, and a 15-minute break after every fourth session. Breaks do not start on their own. A Start button begins each one.
- Habits are edited in `habits.md` (Files mode or Obsidian). There is no habit editor in the UI this round.
- Past days can be edited: tick a habit you forgot, tick or add a task. Future days can't be opened.
- Focus sessions always log to the day they started on, in London time.

## What Ben sees

Layout follows the mockup.

**Desktop.** Two cards across the top: the date card (weekday, date, ISO week, day of the year, with ‹ › to step days and a "Back to today" link) and the quote card. Below them are two columns. The wide left column is **Habits**. The right column stacks **Focus** above **Today's tasks**.

**Phone (≤700px).** One column in this order: date, quote, habits, focus, tasks. The bottom tab bar gains **Today** as its first tab.

**Header in Today mode.** The search box is hidden, because there is nothing to search. The count slot shows `3/8 habits · 50m focus` for today. Refresh, terminal and Settings stay as they are.

**Running-timer chip.** While a session runs, a small chip with the time left (`18:42`) and the target (`Read 30m`) shows in the header in every mode. Clicking it switches to Today. While the timer runs, the tab title is prefixed with the time left (`18:42 · VaultOS`).

### Habits card

One row per habit, in `habits.md` order:
- **A tick button** for the selected day.
- **The icon and name.** Habits with a focus goal also get a progress bar (`25 / 30 min`) and a **Focus** link that sets the timer's target to that habit. The link only shows on today.
- **Seven day cells**, oldest to newest, each tickable, with the selected day outlined. Hovering or focusing a cell gives its day and state.
- **The current streak**, in days.

Under the rows:
- A **daily score** bar for each of the seven days: habits done out of the number of habits. The selected day's bar is labelled.
- The **week's percentage**.

**The 7-day window** ends today while the selected day is within the last 7. Step further back and it ends on the selected day.

**Streak** counts back from today if today is ticked, otherwise from yesterday. An unticked today doesn't break a streak until the day is over. It stops at the first day that isn't ticked, or that has no note. It looks back at most 400 days.

### Focus card

Running the timer:
- A ring showing time left: gold for focus, blue for a break.
- A **Working on** picker:
  - the habits with a focus goal, showing today's minutes (`Read 30m (25/30)`)
  - today's open tasks
  - "Just focus"
- Start/Pause/Resume, Skip and Reset buttons.
- Four dots for the sessions done in the current cycle.

Under it is today's log (time, target, minutes) and a total (`50m · 2 sessions`). The picker is locked during a break.

### Today's tasks card

- A checklist for the selected day.
- An add box. Enter adds the task.
- On hover, or always on a phone:
  - delete (×)
  - focus (▶), which makes that task the timer's target
- Rolled-over tasks carry a `from Fri` tag. Tasks with logged focus show `25m focus`.
- On a past day, tasks that moved on show as muted `moved to next day` and can't be ticked.

### Toast and sound

When a focus session ends, every open VaultOS tab shows a toast: `Session logged: 25 min on Read 30m.` If the session crossed a habit's goal, the toast is `Read 30m ticked. 50 of 30 minutes today.` instead. The end of a break gets `Break over.`

A short two-note chime plays if Settings → **Today → Sound when a session ends** is on, which is the default. Toasts reuse `TermToast` (`termtoast.js`). The chime is a new tone kind next to its `blocked` and `done` beeps.

## Data

Everything lives in the vault under `Personal/Today/`. The server runs as uid 1000, so every file it creates is owned correctly.

```
Personal/Today/
├─ habits.md            the habit list (a table)
├─ .timer.json          the running timer (server-owned)
└─ days/2026-10/
   └─ 2026-10-11.md     one note per day
```

The Board and Knowledge Base scans skip `Personal/Today/`, so a year of day notes adds nothing to every `/api/tasks` walk. Files mode still shows the folder.

### `habits.md`

```markdown
# Habits

Edit the table to change your habits. Keep the id when you rename a habit, or its history won't line up.

| id | Habit | Icon | Focus goal (min) |
| --- | --- | --- | --- |
| wake | Wake up at 5:00 | sun | |
| gym | Gym / run / stretch | dumbbell | |
| outside | Go outside | tree | |
| business | Business 1h | rocket | 60 |
| vitamins | Take vitamins | pill | |
| read | Read 30m | book | 30 |
| learn | Self-learning 1h | cap | 60 |
| nocoffee | No coffee | coffee-off | |
```

Parsing rules:
- Read the **first** markdown table in the file.
- Each `id` must match `^[a-z0-9-]{1,32}$`.
- The focus goal must be empty or a whole number from 5 to 600.
- An invalid row is skipped and reported under `warnings` in the API response. The habits card shows these as a muted line. The rest of the table still loads.
- An unknown icon name renders as a plain dot.
- The icon set ships in `today.js`: `sun, dumbbell, tree, rocket, pill, book, cap, coffee-off, heart, moon, droplet, pen, music, walk, check`.

If `habits.md` is missing, the first authenticated load writes this default file. Removing a row hides that habit from now on. Old day notes keep its id, and it simply isn't shown.

### Day note: `days/YYYY-MM/YYYY-MM-DD.md`

```markdown
---
date: 2026-10-11
habits: [wake, gym, vitamins]
---

## Quote
> You only live once, but if you do it right, once is enough.
> — Mae West

## Tasks
- [x] Food shop for the week
- [ ] Book dentist check-up (from 2026-10-09)
- [ ] Renew car insurance

## Focus
- 06:05 25m read
- 06:40 25m business
- 07:20 25m task: Renew car insurance
```

- **`habits:`** is an inline list of the ids ticked that day, written in `habits.md` order. The server's existing `parseFrontmatter` already reads inline lists. `setFrontmatterField` writes the line back without touching the rest of the file.
- **`## Quote`** is a markdown blockquote: the quote line, then `> — Author`. Line breaks inside the quote are folded to spaces. The text is shown as text, never as HTML.
- **`## Tasks`** uses `- [ ]` and `- [x]`.
  - A task that moved to the next day becomes `- [>]` in the note it left. That's the Obsidian "forwarded" marker. marked renders it as plain text, and it can't be ticked.
  - `(from YYYY-MM-DD)` at the end of a line holds the day the task was first set. The UI shows it as `from Fri`, or as `from 9 Oct` when it's more than six days old.
- **`## Focus`** holds one line per completed session: `- HH:MM <N>m <target>`.
  - `HH:MM` is the London start time.
  - `<target>` is a habit id, `task: <task text>`, or `focus` for "Just focus".
  - **Totals are never stored.** A habit's minutes for a day are the sum of its lines, and a task's minutes are the sum of the lines whose target is `task: <its text>`.
- Lines and sections the server doesn't recognise are left exactly as they are. Ben can add notes anywhere in the file.

**When a day note is created.** The first **authenticated** `GET /api/today` on a London date creates that day's note, if it doesn't exist yet:
1. **Rollover.** Find the most recent earlier day note, which may be older than yesterday if a day was skipped. Copy its `- [ ]` lines into the new note's `## Tasks`, adding `(from …)` where it's missing. Then rewrite those lines in the old note as `- [>]`. The new note is written first, so a crash in between can only duplicate a task, never lose one.
2. **Quote.** Fetch today's quote and write `## Quote`. If the fetch fails, the note is created without it, and later loads retry.

Only today's note is created this way. Opening a past day that has no note creates nothing. The first write to it (a habit or task) creates a plain note with just `date:` and that change, with no rollover and no quote.

A GET over the same-box read path (`isLocalRead`, used for screenshots) never writes anything. It returns a virtual empty day instead. Days that were never opened have no note, and show as empty.

### `.timer.json`

```json
{ "phase": "focus", "state": "running", "target": "read", "startedAt": "2026-10-11T05:05:00.000Z",
  "endsAt": "2026-10-11T05:30:00.000Z", "leftMs": null, "cycle": 1, "cycleDate": "2026-10-11",
  "lastEvent": { "id": 41, "kind": "focus-done", "at": "2026-10-11T05:05:00.000Z", "text": "Session logged: 25 min on Read 30m." } }
```

As built, `startedAt` and `endsAt` are epoch-millisecond numbers, not ISO strings (see "Decisions made during implementation").

- `phase` is `focus`, `short` or `long`.
- `state` is `idle`, `running` or `paused`. `leftMs` holds the time left while paused.
- `cycle` counts the focus sessions completed in the current cycle (0–3). It resets when `cycleDate` isn't today.
- The file lives in the vault rather than in the container, so recreating the container doesn't lose a session in progress. Syncthing copying it to other devices is harmless.

## Focus timer

**The server owns the timer.** Phone and desktop show one countdown, and a session completes even when no tab is open.

- **Transitions** are pure functions in `lib/today-timer.js` (`start`, `pause`, `resume`, `skip`, `reset`, `complete`). The clock is passed in, so tests control time.
- **Completion.**
  1. The server keeps one `setTimeout` for the running `endsAt`, and re-arms it after every change and on boot.
  2. When a focus session completes, it appends the `## Focus` line to the start day's note.
  3. It then runs the auto-tick check and moves to the break phase in the `idle` state.
  4. When a break completes, the timer returns to `focus` `idle`.
  5. Each completion sets `lastEvent` with a new id.
- **On boot**, if `.timer.json` says a session was running and `endsAt` has passed, the server completes it at once and logs it with its original start time. A restart in the middle of a session doesn't lose it.
- **Auto-tick rule.** After logging a focus session against a habit with a goal, the habit is ticked when the day's total **moved from below the goal to at or above it** with this session. Unticking it afterwards sticks, because later sessions don't cross the goal again. Ticking a goal habit by hand without the timer is always allowed.
- **Client countdown.**
  - Every `/api/today` and `/api/today/timer` response includes `serverNow`. The client stores the clock offset and counts down from `endsAt` locally, without polling.
  - When its countdown reaches zero, it waits 1.5 s and fetches `/api/today` to pick up the logged session and `lastEvent`.
  - It shows the toast for a `lastEvent` id it hasn't shown yet (kept in `sessionStorage`), but only if the event is under 2 minutes old. A tab opened an hour later shows the log, not a stale toast.
- **Limits.** A phone browser in the background can't play sound. The toast appears when VaultOS comes back to the front. Ben chose not to add Telegram for this.

## Quotes

- **Source:** ZenQuotes. `GET https://zenquotes.io/api/today` returns `[{ "q", "a", "date" }]`, one quote per day. `GET https://zenquotes.io/api/random` is used for reshuffles. Both were reachable from inside `vault-board` on 2026-10-11.
- **Fetching** is server-side only, with a 4 s timeout. The browser never calls ZenQuotes. Only `q` and `a` are used, trimmed and capped at 400 and 100 characters. The `h` HTML field is ignored.
- **Failures:**
  - A failed fetch is retried at most once every 10 minutes, tracked in memory.
  - Until it works, the quote card shows the most recent earlier quote, labelled `from Fri`.
  - If there is no earlier quote at all, the card shows "No quote yet today."
- **Shuffle** (today only): `POST /api/today/quote` replaces today's `## Quote` with a random one. ZenQuotes' free tier allows 5 requests per 30 seconds, so the server refuses a shuffle within 6 s of the last one (`429`). The button disables itself for 6 s anyway.
- **Attribution:** a small "Quotes from ZenQuotes" link under the quote, as their free tier asks.
- **Provider swap:** `fetchQuote(kind)` in `lib/today.js` is the only code that knows the provider, so changing provider is a one-function change.

## Server

### `lib/today.js` (new, mounted like the other `lib/` files)

Pure functions over strings, plus a small store:

- **Dates:** `londonDate(d)` gives `YYYY-MM-DD`, `londonTime(d)` gives `HH:MM`, and `addDays(iso, n)`.
- **`parseHabits(md)`** returns `{ habits: [{ id, name, icon, goal }], warnings: [] }`.
- **`parseDay(md)`** returns `{ date, done: [], quote: { text, by } | null, tasks: [{ line, text, done, moved, from }], focus: [{ time, min, target }] }`.
- **Edits, each returning new text and leaving the rest of the file byte-identical:**
  - `setHabit(md, id, on, order)`
  - `addTask(md, text)`
  - `toggleTask(md, index, expectText)`
  - `deleteTask(md, index, expectText)`
  - `appendFocus(md, line)`
  - `setQuote(md, quote)`
  - Section edits reuse the server's `insertInSection` behaviour: fence-aware, and a missing section is created at the end of the file.
- **`newDay(date, carried, quote)`** and **`rollover(prevMd)`** return `{ carried, prevMd }`.
- **Derived values:** `focusByHabit(day)`, `focusByTask(day)`, `streaks(getDay, habits, today)`, `week(getDay, habits, end)`.
- **`createStore(root)`** handles reads and writes:
  - Reads are cached by path and mtime, so streaks over 400 days cost a stat per day, not a parse.
  - Writes go through a **per-file promise queue**: read fresh, apply the edit, `atomicWrite`. Two writes to one note can't interleave.
  - `atomicWrite` moves from `server.js` into a shared helper so both use one copy.

Habit and task writes are **meaning-based**, such as "tick `read` on 2026-10-11". They're applied to the file's current content under the queue, so an edit made in Obsidian between load and click is kept. They don't use the task drawer's mtime 409.

The one exception is task toggle and delete. These are addressed by index, so the request carries the task's text as well. If the line at that index no longer has that text, the server answers **409** `This day changed since you loaded it. Refreshed.` and the client reloads the day.

### Routes in `server.js`

All of these sit behind the existing login gate. Only the GET is open to the same-box read path, and that path never writes.

| Route | Body | Does |
| --- | --- | --- |
| `GET /api/today?date=YYYY-MM-DD` | | One payload: `today`, `date`, `habits`, `warnings`, `day` (done, tasks with focus minutes, focus log, quote or fallback quote), `week` (7 × done ids), `streaks`, `focusByHabit`, `timer`, `serverNow`. The first authenticated call of a day creates its note. |
| `POST /api/today/habit` | `{ date, id, done }` | Ticks or unticks. 404 for an unknown id. |
| `POST /api/today/task` | `{ date, op: "add"\|"toggle"\|"delete", text, index }` | Adds, toggles or deletes a task. A `[>]` line can't be toggled (400). |
| `POST /api/today/quote` | `{}` | Shuffles today's quote. 429 if within 6 s of the last shuffle, 502 if ZenQuotes fails. |
| `POST /api/today/timer` | `{ action, target }` | `start`, `pause`, `resume`, `skip` or `reset`. `target` is a habit id, `task:<text>` or `focus`. Only valid on `start` during a focus phase. |

**Validation:**
- `date` must be a real `YYYY-MM-DD` no later than today in London (400 otherwise).
- Task text is trimmed, newlines removed, and capped at 200 characters.
- Errors are `{ error }` JSON in the server's existing style.
- Every POST returns the same payload as the GET, so the client re-renders from one shape.

## Frontend

- **`public/today.js` (new).** Exposes one global, `Today`, in the same style as `workbench.js`: `Today.show()`, `Today.hide()`, `Today.chip()`. It renders into `#today-view` and owns the timer loop, the header chip and the toasts. Rendering builds DOM with `textContent` for anything from the vault: names, tasks and quotes.
- **`index.html`:**
  - a `#mode-today` button first in `.modes`
  - `#today-view` next to the other views
  - a `#today-chip` in the header
  - a Today button first in `#mobile-nav`
  - a Today section in the Settings sheet with the sound toggle
  - a `<script src="/today.js">` tag
- **`app.js`:**
  - `STATE.mode` starts as `'today'`.
  - `setMode` handles `'today'`: it toggles `#today-view`, hides the search box, puts the Today summary in `#count`, and calls `Today.show()`. Other modes call `Today.hide()`, which keeps the timer and chip running.
  - `restoreAfterReload` restores `'board'` too, now that it isn't the default.
  - `#mode-today` joins the mobile-nav observers.
  - `secAvailable` leaves Today without the folder and column sections.
  - Workspace changes don't reload Today.
- **`styles.css`:** a `/* ---------- Today ---------- */` block that uses only existing tokens. Any colour without a token gets one, with both a Dark and a Sepia value, per the rule in `vault-board-app` notes. The phone layout comes in at the same 700px breakpoint the rest of VaultOS uses.
- **Sound:** `termtoast.js` gains a `focus` tone, two short notes. The `vaultboard.today.sound` key in `localStorage` defaults to on.

## Verification

**Unit tests** (`node:test`, in `test/today.test.js` and `test/today-timer.test.js`):
- `parseHabits`: a good table, bad ids, bad goals, an unknown icon, a missing table, and warnings.
- `parseDay` round-trip: parsing then editing changes only the touched line, and unknown sections survive.
- Ticking and unticking keeps `habits.md` order. Unticking the last habit writes `habits: []`.
- Tasks:
  - add, toggle and delete
  - a 409 when the expected text doesn't match
  - a `[>]` line can't be toggled
  - a task inside a code fence isn't counted
- Rollover:
  - copies only `[ ]` lines
  - keeps an existing `(from …)`
  - marks the source `[>]`
  - skips over days with no note
  - with no earlier note, carries nothing
- Focus:
  - per-habit and per-task sums
  - the auto-tick fires exactly when a session crosses the goal
  - unticking sticks after the next session
- Streaks: today unticked doesn't break a streak, a gap ends it, a missing note counts as a gap, and the 400-day cap holds.
- London dates around the BST change (25 Oct 2026, 00:30 London = 23:30 UTC), and a session started at 23:50 logs to its start day.
- Timer transitions with an injected clock: start/pause/resume/skip/reset, cycle → long break after four, cycle reset at a new date, and completion on boot when `endsAt` has passed.
- Quotes, with fetch stubbed: a success writes `## Quote`, a failure falls back to the latest earlier quote, the 10-minute retry backoff, the 6 s shuffle guard, and text trimming and length caps.

The whole suite (`npm test`) passes before and after each change.

**Preview** (the same pattern as `herdr-term-preview`):
- A `today-preview` container on `127.0.0.1:7691` only, from `/opt/vault/today-preview/`, with its own `config.json` (fresh secret and password), its own `lockout.json`, a `mint-cookie.js` for write tests, and the worktree's `server.js`, `lib/` and `public/` bind-mounted.
- Its vault comes from `scripts/today-sandbox.js`: a synthetic `Personal/Today` with `habits.md`, 12 days of notes with gaps and rolled tasks, one invalid habit row, and a pre-set `.timer.json`.
- A `TODAY_SECONDS_PER_MINUTE` env var, read only when set and honoured only when it's 1 to 60, shrinks a minute to that many seconds, so e2e can run a whole session in seconds. It is never set on `vault-board`.
- **Never run e2e against `:7684`.** The e2e script exits 2 if its base URL contains `:7684`.

**E2E** (`scripts/today-e2e.js`, puppeteer from the npx cache, against the preview with a minted cookie):
1. VaultOS opens on Today.
2. A habit tick and a past-day cell tick both change the note on disk.
3. Adding, ticking and deleting a task each change the note.
4. A session on Read logs a line, auto-ticks Read, and shows the toast.
5. The header chip counts down in Board mode.
6. Reloading in the middle of a session keeps the countdown.
7. A 409 path reloads the day.
8. The phone viewport shows the tab bar with Today first.

**Screenshots:** headless Chrome of the preview, Dark and Sepia, at 1600×1000 and 390×844, per the board's `CLAUDE.md`. Each shot is checked for clipping, overflow, and colours that ignore the theme.

**Live:** after deploy, Ben checks in his own browser that a tick, a task and one real Pomodoro work on his phone and desktop. The same-box read path can't test writes on `:7684`.

## Deploy

- Merging into `/opt/vault/board` puts `public/` live at once through the bind mount, while `server.js` and `lib/` need a restart. A merge without a restart would show a Today mode whose API returns 404. **Merge and restart go together.**
- `docker restart vault-board` **kills every live Claude terminal session.** Each release needs Ben's OK and a moment he picks.
- No image rebuild is needed. There are no new dependencies, and `lib/`, `server.js` and `public/` are already bind-mounted.
- The first authenticated load after deploy writes the default `habits.md`.
- **Rollback:** `git revert` the merge and restart. Day notes stay in the vault and are harmless markdown.

Phases are built in order: 1 habits, week, quote and landing; 2 tasks and rollover; 3 timer. Whether to release after each phase (three restarts) or once at the end (one restart) is decided in the plan with Ben.

## Risks

- **Syncthing conflicts.** If Obsidian on the phone edits a day note while VaultOS writes it, Syncthing keeps both copies and adds a `.sync-conflict` file. It's rare, both files stay readable, and Today reads the main one.
- **ZenQuotes** can go down or change its terms. The fallback quote covers outages, and the provider is one function.
- **Background tabs** don't play sound on phones, as noted above.
- **The restart** to ship is disruptive. It's covered under Deploy.
- **Clock drift between devices** is handled by the `serverNow` offset. A countdown can be off by up to the request latency, which is fine for a 25-minute timer.

## Not in this round

- A calendar (LifeOS's was a Google Calendar embed).
- Planning tomorrow's tasks.
- Views longer than seven days, and monthly stats.
- Editing habits in the UI.
- Notes on focus sessions.
- Telegram or n8n alerts.
- Importing LifeOS history.
- A Board summary on Today.
- A time rule for the wake habit.
- Retiring LifeOS. Ben runs that box, so it isn't Claude's to touch.

## Decisions made during implementation

Choices the spec left open, and fixes that changed behaviour.

- **Block-list `habits:`.** Obsidian's Properties editor writes block lists. The note code reads block and inline forms and rewrites the whole `habits:` value inline. Obsidian may turn it back into a block on its next edit, which does no damage.
- **Quote newlines.** A quote with line breaks is folded onto one line before it is saved.
- **Rollover marks only what it carried.** The source day is edited from the lines the rollover actually copied. A task added in the gap is left alone, so no task can be lost.
- **Task writes go one at a time.** The client sends one task write and waits for it, and the input clears on submit. A double Enter or a poll mid-add can't add the task twice.
- **Timer state is saved first.** The service writes `.timer.json` before it updates memory. A lazy load never overwrites newer state, so a payload request during boot can't reset the timer or repeat a completion.
- **The timer machine leaves `lastEvent` to the service.** Only the service sets it, as `{id, kind, at, text}`. The client reacts to any change of `id`, because the id restarts at 1 if `.timer.json` is lost.
- **Epoch milliseconds in `.timer.json`.** `startedAt` and `endsAt` are numbers, not the ISO strings shown above. The client countdown needs less code, and the file is a little harder to read.
- **Phone grid shows weekday letters (Task 9 review).** There is no hover on a phone, so each cell of the 7-day grid carries its day letter.
- **Warning text is legible in Sepia.** The habits warning line was about 2.5:1 on its panel. It now uses a readable colour in both themes.
- **Chip label during a break.** The header chip says "Short break" or "Long break" instead of the carried focus target.
- **Toast age uses the server clock.** The client compares `serverNow - at`, as the countdown does with its server offset.
- **The 60 s poll runs in every mode.** A session started on another device reaches the chip and the toasts. It costs one `GET /api/today` a minute while VaultOS is open.
- **The target picker stays enabled during a focus.** A change applies to the next session, with a hint. It locks only during breaks.
- **Phone chip.** On the Board, Files and Knowledge Base the chip shows time only. The target label shows on Today. Header space is tight at 390 px.
- **The focus log follows the date stepper.** It shows the log for the day on screen, with a note on past days.
- **Idempotent finish keys on the log line.** A completed session is written once per formatted line. Tests that need two sessions on one target seed the first by appending a line to the day note. At normal speed two sessions can't land in the same minute.
- **Duplicate habit ids.** In `habits.md`, an id counts as a duplicate if any earlier row used it, valid or not.
- **Task error line.** The tasks card has an inline message line (`#td-task-msg`) that shows write errors, including the 409 text.
- **Preview has terminals off.** The preview runs with `TERMINAL: "0"`.
- **One release, not three.** All three phases were built before asking Ben about release, so there is one restart instead of three.
- **Final review.** The whole-branch review is the controller's final review, not part of the docs task.
- **Sections end at an H1 too (final review).** A section runs to the next `#` or `##` heading, fence-aware, so checkboxes under Ben's own `# Notes` are not tasks and are never carried. This differs from the board's `insertInSection`, which stops only at `##`.
- **New lines go after the last owned line (final review).** A new task goes after the last task line, and a focus line after the last focus line, with any indented lines under it. With none yet, the line goes under the heading, after one blank line when text follows, and a blank line is kept before that text. Prose in the section stays where it is. A missing section is still created at the end of the file.
- **A new quote replaces only the quote (final review).** A shuffle or a retry replaces the first run of `>` lines in `## Quote`, or puts the two lines under the heading when there are none. Anything else in the section stays.
- **The quote is fetched outside the write queue (final review).** A missing quote is fetched before the note's queue is entered, and goes in only if the note still has none, so a slow ZenQuotes never holds up a tick.
- **A stale "today" never writes (final review).** The client works out London's date on the server-corrected clock. When the page is on "today" and that date has moved past it, a tick or task write isn't sent: the page reloads and says "New day. Refreshed." A past day stepped back to on purpose is written as asked. A failed poll on becoming visible is retried after 2 s, then 5 s.
- **An overtaken habit tick fetches again (final review).** As task writes already did.
