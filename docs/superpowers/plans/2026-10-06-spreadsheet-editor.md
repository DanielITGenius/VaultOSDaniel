# Spreadsheet view + edit in Files (CSV / XLSX) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** recommended **subagent-driven** (a fresh implementer + reviewer per task). There are 16 tasks with tight
interface hand-offs (payload/op contract, SheetCore shared by server and grid), and a shipped mistake can corrupt a file
Ben sends to InfoSec, so a per-task review is worth its cost. The alternative is **native**: I build every task in this
session, with one whole-branch review at the end.

## Context

Ben amends CSV/XLSX files in the vault by downloading → editing locally → re-uploading. He wants an **Edit**
button in VaultOS's Files mode and an Excel look-and-feel grid to view and change them in place, with the file's
formatting kept intact (formatting *controls* are a later step two). Brainstorming produced the spec
`docs/superpowers/specs/2026-10-06-spreadsheet-editor-design.md` (commit 6e723c5). Planning research changed
three things, all approved by Ben:

1. **Own grid, not Jspreadsheet CE.** CE has no frozen rows (12 of Ben's files freeze headers), wipes *all*
   merges on a row insert/delete near one (19 files have merges), only does whole-column dropdowns, and its undo
   fires no events.
2. **Backups outside the vault** (`/opt/vault/board/sheet-backups/<vault path>`, never synced) plus a
   **Restore previous version** button — not `.prev` files, which Syncthing would copy and Windows would show.
3. Server code lives in `lib/` (only `server.js` is bind-mounted today), so it needs `COPY lib` + a mount.

Evidence (all gathered read-only) the plan relies on:
- ExcelJS 4.4.0 round-trip of the vault's 40 `.xlsx`: 31 identical; minor losses in 6 (customXml ×2,
  printerSettings ×1, threaded-comment persons ×1, two empty col widths ×1, five merges in
  `LIG Safeguard Firewall Rule Request - Infra Proposed v0.3.xlsx` ×1); 3 unreadable (two RVTools exports,
  `AllVMSubnets-20260709-0638.xlsx`). `xl/theme/theme1.xml` survives byte-identical.
- Features in real files: theme colours (fills ×6, fonts ×19), argb (×22), frozen panes (×12), merges (×19),
  row heights (×22), wrap (×23), list dropdowns (×3; `"Open,In Progress,Closed"` on
  `Environment Build Action List.xlsx` F3:F67), conditional formatting (×2, expression `$F3="Open"` → red via dxf
  **bgColor**), autoFilter (×8), tables (×3), hidden rows (×2), formulas (×1 file). `{"type":"pattern"}` with no
  `pattern` = no fill.
- ExcelJS `spliceRows` is unsafe. **Model-level shifting works** with three traps found in probes/review:
  (a) the getter emits `merges`, the setter reads `mergeCells`; (b) the setter doesn't reset `_merges` →
  set `ws._merges = {}` first; (c) the setter **drops the style of merged non-master cells** (`row.js:374–377`),
  so every `type: Merge` cell model must be rewritten as `{ address, type: Null, style }` before `ws.model = m`.
  CF formulas must be re-anchored when their range moves (`$F3="Open"` → `$F4="Open"`).
- CSVs: 41 files, ASCII/UTF-8 (9 with BOM), comma-delimited, CRLF and LF both common, one mixed-ending file,
  largest 396 KB / 339×90, some with no trailing newline.

# Implementation plan

**Goal:** View CSV/XLSX in an Excel-like grid in Files, and edit cell values / insert & delete rows with the
file's formatting preserved, saved safely (mtime guard, atomic write, verified output, one-step backup + restore).

**Architecture:** The server parses the file (ExcelJS for xlsx, a byte-preserving parser for csv) into a JSON
*sheet model*. A vanilla-JS grid renders it and records edits as an **op list**. Save posts the ops; the server
re-reads the file, applies them, verifies nothing was lost, backs up the checked bytes and atomically replaces
the file. Logic shared by both sides (A1 refs, range shifting, client-side op application, CF evaluation) lives
in one UMD file, `public/sheet-core.js`.

**Tech Stack:** Node 22 / Express 5 (existing), `exceljs@4.4.0`, `jszip` (exceljs's own copy, made explicit),
`node:test`, vanilla classic scripts, host puppeteer for e2e.

**Spec:** `docs/superpowers/specs/2026-10-06-spreadsheet-editor-design.md` (amended in Task 0).

## Global Constraints

- Develop in a **git worktree** `/opt/vault/board-sheets`, branch `sheets`. `/opt/vault/board/public` and
  `server.js` are bind-mounted into the **live** container — don't touch them until Task 15.
- Never write to `/opt/vault/vault` during development. Saves are tested on the preview container (Task 0)
  whose vault is a copy under `/opt/vault/sheet-preview/`.
- Never edit `/opt/platform-standard` (VaultOS is outside the standard anyway).
- Colours via tokens in `styles.css` (`:root` + `:root[data-theme="light"]`), never bare hex in rules
  (VaultOS `CLAUDE.md`). Colours read from an xlsx are inline per cell — the only exception.
- No CDN, bundler or new front-end dependency. Classic `<script>` tags.
- JSON coordinates are **0-based** (`r`, `c`); the server converts to ExcelJS 1-based at the edge.
- Caps: grid renders a sheet only if `rowCount × colCount ≤ 60000` (`SHEET_CELL_CAP`; over-cap sheets carry no
  `cells`); file size csv ≤ 5 MB, xlsx ≤ 3 MB (`SHEET_FILE_MAX`); paste ≤ 20,000 cells; a save body must stay
  under the global `express.json({ limit: '2mb' })` — the client refuses to post over 1.9 MB.
- POSTs need a real session (the global `/api` gate already refuses localRead POSTs).
- The container runs as uid 1000; `sheet-backups/` is `chown 1000:1000`; compose files stay mode 0600.
- UK copy: dates display/accept `dd/mm/yyyy`.
- Test command (Node ≥ 21 treats args as globs; this also keeps `fixtures.js` from running as a suite):
  `docker run --rm -v /opt/vault/board-sheets:/app -w /app node:22-bookworm-slim node --test 'test/*.test.js'`
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Background refresh while editing** — the 8 s recent-poll, `visibilitychange` → `fxRefresh`, tab and mode
   switches all reach `renderView`. Edits, an open cell editor, selection and scroll must survive. *E4 (Task 13).*
2. **File changed on disk during an edit** (Syncthing, an agent) — Save 409s, edits kept, "Reload and re-apply my
   N edits" works; a change landing *during* a slow xlsx save is caught by the re-check in `store.replace`.
   *E5 (Task 13) + store test (Task 8).*
3. **Save races** — clicking Save with the editor open commits it first; typing while a save is in flight
   survives; double Ctrl+S posts once. *E3 (Task 13).*
4. **Typed values that look numeric** — `007`, `0123 456`, a 16-digit ticket number, `1,234`, `1e5`, a date in a
   date cell, `TRUE`, digits into a `@`-format cell — never silently become different numbers. *`coerceInput`
   tests (Task 4).*
5. **Merged-cell formatting through row ops** — borders/fills on non-master merged cells (42 such cells in the
   action list) survive insert/delete. *Task 7 test + `--ops-smoke` full-cell signature (Task 7).*

---

## File structure

| File | Responsibility |
|---|---|
| `public/sheet-core.js` (new, UMD → `window.SheetCore` / `require`) | A1 parsing, range shifting, formula re-anchoring, client op application on the sheet model (incl. changed-cell tracking), CF evaluation, list matching. No DOM, no ExcelJS. |
| `lib/sheet-csv.js` (new) | CSV decode/detect/parse, model building, op application, byte-preserving serialise. |
| `lib/sheet-style.js` (new) | Theme palette, theme/indexed/argb + tint → `#rrggbb`, cell style → CSS, dxf → CSS. |
| `lib/sheet-values.js` (new) | Display text (numFmt subset, UK dates), edit text, typed-input coercion. |
| `lib/sheet-xlsx.js` (new) | Load, `toModel`, `checkEditable`, `applyOps` (set + model-level row shift), `writeVerified`. |
| `lib/sheet-store.js` (new) | Guarded read, per-path lock, atomic replace with pre-rename re-check, backups (cross-mount safe), eligibility cache. |
| `server.js` (modify) | `fsKind` → `'sheet'`; `/api/fs/file` sheet branch; `GET /api/fs/sheet`, `POST /api/fs/sheet/save`, `POST /api/fs/sheet/restore` with **lazy `require`** of `lib/*`. |
| `public/sheet-grid.js` (new) | Grid component: render, selection, keyboard, editor, dropdowns, clipboard, undo, row menu, tabs, formula bar. |
| `public/sheet-files.js` (new) | Files glue: per-path controllers, file-bar buttons, Edit/Save/Done/Restore, banners, save queue, 409 flow, dirty/beforeunload. |
| `public/workbench.js`, `public/index.html`, `public/styles.css` (modify) | Small hooks; script tags; grid styles + sheet tokens (both themes, ≤700px). |
| `test/*.test.js`, `test/fixtures.js` (new) | `node:test` suites; workbooks generated with ExcelJS (no vault content committed). |
| `scripts/sheet-corpus.js`, `scripts/sheet-smoke.sh`, `scripts/sheet-e2e.js` (new) | Read-only corpus sweep; HTTP smoke; puppeteer scenarios E1–E8. |
| `Dockerfile`, `docker-compose.yml`, `/opt/vault/docker-compose.yml`, `.gitignore`, `.dockerignore`, `package*.json`, `CLAUDE.md` | Packaging, mounts, docs. |

## Shared data shapes (the contract every task uses)

```js
// GET /api/fs/sheet?path=  → SheetPayload
{ path, name, kind: 'csv'|'xlsx', mtime, size,
  editable: bool, reason: null|string,                 // why the whole file is view-only
  backup: null | { mtime },                            // mtime = when that previous version was last written
  tooLarge: bool,                                      // over SHEET_FILE_MAX → sheets: []
  csv: null | { delimiter, bom: bool, eol: '\r\n'|'\n' },
  sheets: [Sheet], active: 0 }                         // index into sheets[]

Sheet = { index,                    // worksheet position (hidden sheets are omitted from sheets[]); Op.sheet uses this
  name, rowCount, colCount,
  cells: { 'r,c': { t: 'display', e?: 'edit text if ≠ t', s?: styleIdx, f?: '=FORMULA' } },
  styles: ['css…'], colWidths: [px…], rowHeights: { r: px }, defaultRowHeight: px,
  hiddenRows: [r…], hiddenCols: [c…], merges: [{ r1, c1, r2, c2 }], frozen: { rows, cols },
  lists: [{ ranges: [{r1,c1,r2,c2}], items: ['Open', …], strict: bool }],
  cf: [{ ranges: [...], rules: [CfRule] }], cfSkipped: n,
  readOnly: null|string, rowOps: null|string, tooBig: bool,
  locked: [{ r1, c1, r2, c2, msg }] }  // cells nobody may set (an Excel table's header and totals rows), and why; [] for a csv

CfRule = { kind: 'cell'|'ref', op: 'eq'|'ne'|'gt'|'lt'|'ge'|'le'|'between'|'notBetween', values: [..],
           ref?: { r, c, absR, absC }, css, stop: bool }
  // 'cell' compares the cell's own value (Excel cellIs with literal operands);
  // 'ref' compares another cell (Excel expression `REF op LITERAL`); relative ref.r/c are offsets from the
  // CF anchor (top-left of ranges[0]) and apply to whichever cell is being evaluated; absolute ones are indices.

Op = { op: 'set', sheet, r, c, v: 'text' }
   | { op: 'insertRows', sheet, at, n, like: r|null }  // new rows occupy at..at+n-1; formatting copied from
                                                       // pre-shift row `like`, which must be at-1 or at (or null)
   | { op: 'deleteRows', sheet, at, n }

POST /api/fs/sheet/save    { path, mtime, ops } → SheetPayload (fresh)
POST /api/fs/sheet/restore { path, mtime }      → SheetPayload (fresh)
errors { error }: 400 bad op · 404 missing · 409 changed on disk · 413 too big · 422 would lose data · 500 unexpected
```

**Row-insert formatting:** new rows copy row `like`'s cell styles (deep clone), height, list coverage and CF
coverage — never values or merges. The client sets `like` to the row the user right-clicked (Insert above row R
→ `at = R, like = R`; Insert below R → `at = R+1, like = R`; multi-row selection uses its top/bottom row).

**Shift semantics** (`SheetCore.shiftRange(rg, at, delta)`, rows only, 0-based): insert (`delta > 0`):
`r ≥ at → r + delta`, a range with `r1 < at ≤ r2` grows; delete (`delta = −n`, band `at..at+n−1`): rows below move
up `n`, a range wholly inside the band → `null`, partially → shrinks; callers drop merges that end up 1×1.

**Formula re-anchoring** (`rebaseFormula`, used for CF and DV formulas): relative row refs move by `anchorShift`
(new anchor row − old anchor row); absolute (`$`) row refs follow their target cell (insert `r ≥ at → r+delta`;
delete: below band `r−n`, inside band → `at`). This equals Excel's "refs follow their target" except when the
anchor and target sit on opposite sides of the insertion point — documented, not handled (no real file hits it).

---

### Task 0: Worktree, preview environment, dependencies, spec amendment

**Files:** Modify `package.json`, `package-lock.json`, `Dockerfile`, `.gitignore`, `.dockerignore`, the spec;
Create `lib/`, `test/`, `docs/superpowers/plans/2026-10-06-spreadsheet-editor.md` (copy of this plan).

- [ ] **Step 1:** `git -C /opt/vault/board worktree add /opt/vault/board-sheets -b sheets` (superpowers:using-git-worktrees).
- [ ] **Step 2: deps** (host has no npm): `docker run --rm -v /opt/vault/board-sheets:/app -w /app node:22-bookworm-slim npm install --ignore-scripts --save-exact exceljs@4.4.0 jszip`;
  `npm ls jszip` in the same container must show one deduped copy. Add `"scripts": { "test": "node --test 'test/*.test.js'" }`.
  (`--ignore-scripts` only skips node-pty's native build in the worktree; the image's `npm ci` stage still builds it.)
- [ ] **Step 3: packaging:** Dockerfile `COPY lib ./lib` next to `COPY server.js set-password.js ./`; add `sheet-backups/` to
  `.gitignore` and `.dockerignore`. (Compose mounts are added in Task 15.)
- [ ] **Step 4: preview environment** (not committed) under `/opt/vault/sheet-preview/`:
  - `pristine/` = `cp -a` of these vault folders (keeping their relative paths): `Lancashire/1. iac/environment-build/`,
    `Lancashire/2. iam/PAM/service-account-onboarding/01-linux-appliances-svc-spp-linux/`,
    `Lancashire/2. iam/PAM/service-account-onboarding/04-svc-spp-ad-auth/`,
    `Lancashire/2. iam/PAM/service-account-onboarding/06-linux-server-inventory/data/`,
    `Lancashire/2. iam/PAM/safeguard-windows-gpo/`, `Lancashire/2. iam/PAM/_done/subnets-firewall/`,
    `Lancashire/8. mimecast/_done/suman-mimecast/`, `Code/Powershell/Tools/PersonalEmail/`.
    `reset.sh`: `rsync -a --delete pristine/ vault/ && rm -rf backups/* && chown -R 1000:1000 vault backups` — run before every e2e/smoke run.
  - `config.json` = copy of the live one with **`sessionSecret` replaced** (`openssl rand -hex 32`), so a preview cookie
    is worthless on :7684; `lockout.json` copy. Both mode 600, uid 1000.
  - `compose.yml`: project `vault-sheet-preview`, `build: /opt/vault/board-sheets`, **`image: vault-sheet-preview:dev`**
    (never retags `vault-board:latest`), container `vault-sheet-preview`, **`ports: ["127.0.0.1:7690:8080"]`**,
    `user: "1000:1000"`, env `VAULT_DIR=/vault PORT=8080 SECURE_COOKIE=0 SHEET_BACKUP_DIR=/app/sheet-backups` (no `TERMINAL`),
    volumes `./vault:/vault`, `./config.json:/app/config.json:ro`, `./lockout.json:/app/lockout.json`,
    `/opt/vault/board/workspace-visibility.json:/app/workspace-visibility.json:ro`, and from the worktree
    `public:/app/public:ro`, `server.js:/app/server.js:ro`, `lib:/app/lib:ro`, plus `./backups:/app/sheet-backups`.
  - `mint-cookie.js`: prints a `Cookie:` value for `board_sess` = base64 `{"authed":true}` with `board_sess.sig` =
    Keygrip (sha1, the preview `sessionSecret`) over `board_sess=<value>`. Stdout only, never written to disk.
  - Bring up: `docker compose -f /opt/vault/sheet-preview/compose.yml up -d --build`; `curl -s 127.0.0.1:7690/health` → 200.
- [ ] **Step 5: spec amendment:** own grid (`public/sheet-grid.js`) and why; backups in `sheet-backups/` + Restore (replaces
  `.prev`); `lib/` + its mount; new `.unsaved` tab state (existing ● = changed on disk); Edit → **Save / Done** (Done replaces
  Discard); switching tabs keeps unsaved edits (no prompt; closing a tab or the page asks); a save clears undo history;
  changed cells highlighted until saved; CF display subset (`cellIs` + simple expressions); `like` row formatting;
  row ops blocked when the workbook has formulas or the sheet has tables/images; caps; save-time verification (422);
  409 → reload-and-re-apply; the op/payload contract lives in the plan. Copy this plan into `docs/superpowers/plans/`.
- [ ] **Step 6:** commit `Sheets: worktree setup, exceljs dep, spec amendments`.

---

### Task 1: `SheetCore` — A1 refs, range shifting, formula re-anchoring

**Files:** Create `public/sheet-core.js`, `test/sheet-core.test.js`

**Produces** (`module.exports` in Node, `window.SheetCore` in the browser):
`colName(c)`, `colIndex('AB') → 27`, `parseCell('$F$3') → { r, c, absR, absC }` (throws on bad input),
`parseRange('A1:G1') → { r1, c1, r2, c2 }` (single cell allowed), `rangeStr(rg)`, `shiftRange(rg, at, delta) → rg|null`,
`shiftRefList('F3:F15 F17', at, delta) → string` (`''` when all removed),
`rebaseFormula(formula, { sheet, at, delta, anchorShift }) → string` (rules above; only refs to this sheet — unqualified
or `sheet!`/`'sheet'!`; skips `"…"` literals, other sheets, function names like `LOG10(`, whole-column refs `F:F`).

- [ ] **Step 1: failing tests:**
```js
test('colName/colIndex round trip', () => { for (const c of [0, 25, 26, 701, 702, 16383]) assert.equal(colIndex(colName(c)), c); assert.equal(colName(27), 'AB'); });
test('parseCell flags', () => assert.deepEqual(parseCell('$F3'), { r: 2, c: 5, absR: false, absC: true }));
test('insert shifts and grows', () => {
  assert.deepEqual(shiftRange(parseRange('A3:G3'), 1, 1), parseRange('A4:G4'));
  assert.deepEqual(shiftRange(parseRange('F3:F15'), 5, 2), parseRange('F3:F17'));
  assert.deepEqual(shiftRange(parseRange('F3:F15'), 15, 1), parseRange('F3:F15'));
});
test('delete removes, shrinks, moves up', () => {
  assert.equal(shiftRange(parseRange('A5:G5'), 4, -1), null);
  assert.deepEqual(shiftRange(parseRange('F3:F15'), 4, -2), parseRange('F3:F13'));
  assert.deepEqual(shiftRange(parseRange('F20:F30'), 4, -2), parseRange('F18:F28'));
});
test('ref list', () => assert.equal(shiftRefList('F3:F15 F17 F19:F47', 16, -1), 'F3:F15 F18:F46'));
test('rebase', () => {
  assert.equal(rebaseFormula('$F3="Open"', { sheet: 'S', at: 0, delta: 1, anchorShift: 1 }), '$F4="Open"');
  assert.equal(rebaseFormula('$F3="Open"', { sheet: 'S', at: 9, delta: 1, anchorShift: 0 }), '$F3="Open"');
  assert.equal(rebaseFormula('COUNTIF($K$2:$K$9,A1)', { sheet: 'S', at: 4, delta: 2, anchorShift: 0 }), 'COUNTIF($K$2:$K$11,A1)');
  assert.equal(rebaseFormula('Other!$A$5="x"', { sheet: 'S', at: 0, delta: 1, anchorShift: 1 }), 'Other!$A$5="x"');
  assert.equal(rebaseFormula('A1="B2"', { sheet: 'S', at: 0, delta: 1, anchorShift: 1 }), 'A2="B2"');
  assert.equal(rebaseFormula("'S'!$A$5", { sheet: 'S', at: 2, delta: -1, anchorShift: 0 }), "'S'!$A$4");
});
```
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; UMD wrapper `(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.SheetCore = f(); })(typeof self !== 'undefined' ? self : this, function () { … })`.
- [ ] **Step 4:** PASS. **Step 5:** commit `Sheets: SheetCore A1/range/formula helpers`.

---

### Task 2: CSV — byte-preserving parse, model, ops, serialise

**Files:** Create `lib/sheet-csv.js`, `test/sheet-csv.test.js`

**Produces:** `parseCsv(buf) → Parsed` (`{ encoding: 'utf-8'|'utf-8-bom'|'utf-16le'|'utf-16be'|'latin1', delimiter, eolDominant, endsWithEol, quoteAll, records: [{ fields: [{ v, q }], raw, eol }] }`);
`csvToSheet(parsed, name) → Sheet` (frozen `{rows:1, cols:0}`, row 0 bold via style `'font-weight:600'`, `colWidths` = clamp(maxLen·7+16, 48, 320));
`csvEditable(parsed) → null | "This CSV isn't UTF-8, so it's view-only here"`; `applyCsvOps(parsed, ops) → Parsed` (touched records lose `raw`); `serializeCsv(parsed) → Buffer`.

Rules: BOM `EF BB BF` → utf-8-bom; `FF FE`/`FE FF` → utf-16 (view-only, decoded for display); else strict UTF-8, failure
→ latin1 (view-only). Delimiter = candidate of `, ; \t |` giving the most of the first 20 records with an equal field
count > 1; none → `,`. RFC 4180 quoting; a quote inside an unquoted field is literal. Untouched records serialise as
`raw + eol` verbatim. Touched/new records: fields joined by the delimiter; quoted if quoted before, or `quoteAll`, or
containing delimiter/`"`/`\r`/`\n`; eol = own eol else `eolDominant`. New records (insert, or `set` with
`r ≥ records.length`, which appends records up to `r`) get as many empty fields as record 0. `set` past a record's end
pads with empty fields. The file ends with an eol iff it did before.

- [ ] **Step 1: failing tests:**
```js
const B = (s) => Buffer.from(s, 'utf8'), run = (s, ops) => serializeCsv(applyCsvOps(parseCsv(B(s)), ops)).toString();
const set = (r, c, v) => ({ op: 'set', sheet: 0, r, c, v }), ins = (at, n, like = null) => ({ op: 'insertRows', sheet: 0, at, n, like }), del = (at, n) => ({ op: 'deleteRows', sheet: 0, at, n });
test('untouched files are byte-identical', () => { for (const s of ['﻿a,b\r\n1,"x,y"\r\n', 'a,b\n1,2', 'a,b\r\n1,2\n3,"multi\r\nline"\r\n', 'h1;h2\n1;2\n']) assert.equal(run(s, []), s); });
test('set changes only that record', () => assert.equal(run('a,b\r\n1,2\r\n3,4\n', [set(1, 1, 'x,y')]), 'a,b\r\n1,"x,y"\r\n3,4\n'));
test('insert/delete and the trailing-eol rule', () => {
  assert.equal(run('a,b\n1,2', [ins(2, 1), set(2, 0, 'z')]), 'a,b\n1,2\nz,');
  assert.equal(run('a,b\n1,2', [ins(1, 1)]), 'a,b\n,\n1,2');
  assert.equal(run('a,b\n1,2', [del(1, 1)]), 'a,b');
});
test('set past the last record appends records', () => assert.equal(run('a,b\n1,2\n', [set(3, 0, 'z')]), 'a,b\n1,2\n,\nz,\n'));
test('quoteAll files quote new fields', () => assert.equal(run('"a","b"\n"1","2"\n', [ins(2, 1), set(2, 0, 'q')]), '"a","b"\n"1","2"\n"q",""\n'));
test('delimiter detection', () => { assert.equal(parseCsv(B('a;b;c\n1;2;3\n')).delimiter, ';'); assert.equal(parseCsv(B('a\tb\n1\t2\n')).delimiter, '\t'); assert.equal(parseCsv(B('name\nx, y\n')).delimiter, ','); });
test('ragged rows pad on set', () => assert.equal(run('a,b,c\n1\n', [set(1, 2, 'v')]), 'a,b,c\n1,,v\n'));
test('newline in an edited value is quoted', () => assert.equal(run('a\n1\n', [set(1, 0, 'x\ny')]), 'a\n"x\ny"\n'));
test('utf-16 and latin1 are view-only', () => { assert.ok(csvEditable(parseCsv(Buffer.from([0xFF, 0xFE, 0x61, 0x00])))); assert.ok(csvEditable(parseCsv(Buffer.from([0x61, 0xE9, 0x0A])))); });
test('csvToSheet shape', () => { const s = csvToSheet(parseCsv(B('a,b\n1,2\n')), 'x.csv'); assert.equal(s.rowCount, 2); assert.equal(s.cells['1,1'].t, '2'); assert.deepEqual(s.frozen, { rows: 1, cols: 0 }); });
```
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: CSV parse/serialise`.

---

### Task 3: Styles — colours, theme, tint, CSS

**Files:** Create `lib/sheet-style.js`, `test/sheet-style.test.js`

**Produces:** `themePalette(xml?) → string[12]` in index order `[lt1, dk1, lt2, dk2, accent1…6, hlink, folHlink]` (XML order is
dk1, lt1, dk2, lt2 — swap the first two pairs; `sysClr` → `lastClr`, `srgbClr` → `val`; no theme → Office 2013 defaults
`FFFFFF 000000 E7E6E6 44546A 5B9BD5 ED7D31 A5A5A5 FFC000 4472C4 70AD47 0563C1 954F72`);
`resolveColor({argb|theme|indexed, tint?}, palette) → '#rrggbb'|null` (indexed 64/65 = automatic → `null`);
`cellCss(style, palette) → string`: fill (pattern set and ≠ `none` → `background:` fgColor; gradient → first stop), font
(bold → `font-weight:700`, italic, underline/strike, colour, size → `font-size:calc(var(--sg-fs)*${size/11})`),
alignment (`text-align`; vertical `center`→`middle`; `wrapText` → `white-space:pre-wrap`; `indent` → `padding-left`),
borders (thin 1px, medium 2px, thick 3px; dashed/dotted/double/hair mapped; colour resolved, default black);
`dxfCss(style, palette)`: fill colour = `bgColor` when present (dxf convention, including fills with **no** pattern type),
else fgColor; font colour/bold/italic/strike.
Tint: RGB→HSL; `tint < 0 ? L·(1+tint) : L·(1−tint) + tint`; HSL→RGB. Indexed 0–7 = 8–15; 8–63:
`000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333`.

- [ ] **Step 1: failing tests** (`near(a, b)` = every channel within ±1):
```js
test('palette order', () => { const p = themePalette(`<a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1></a:clrScheme>`); assert.equal(p[0], '#ffffff'); assert.equal(p[1], '#000000'); assert.equal(p[3], '#1f497d'); assert.equal(p[4], '#4f81bd'); });
test('tint', () => { const p = themePalette(); assert.ok(near(resolveColor({ theme: 4, tint: 0.7999816888943144 }, p), '#ddebf7')); assert.ok(near(resolveColor({ theme: 0, tint: -0.1499984740745262 }, p), '#d9d9d9')); });
test('argb and indexed', () => { assert.equal(resolveColor({ argb: 'FFC00000' }), '#c00000'); assert.equal(resolveColor({ indexed: 10 }), '#ff0000'); assert.equal(resolveColor({ indexed: 64 }), null); });
test('cell fill without pattern is no fill', () => assert.equal(cellCss({ fill: { type: 'pattern' } }, themePalette()), ''));
test('dxf uses bgColor, with or without a pattern type', () => { const p = themePalette(); assert.match(dxfCss({ fill: { type: 'pattern', pattern: 'solid', fgColor: { indexed: 64 }, bgColor: { argb: 'FFC00000' } }, font: { color: { argb: 'FFFFFFFF' } } }, p), /background:#c00000.*color:#ffffff/); assert.match(dxfCss({ fill: { type: 'pattern', bgColor: { argb: 'FFED7D31' } } }, p), /background:#ed7d31/); });
```
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: xlsx colour/style → CSS`.

---

### Task 4: Values — display text, edit text, typed-input coercion

**Files:** Create `lib/sheet-values.js`, `test/sheet-values.test.js`

**Produces:** `displayText(value, numFmt)` — null → `''`; richText joined; hyperlink → `text`; formula → formatted
`result`; error → its code; boolean → `TRUE`/`FALSE`; Date (UTC getters) → `dd/mm/yyyy`, `+ hh:mm` when numFmt has h/s,
`yyyy-mm-dd` when numFmt is ISO-like; numbers: General → `String(Number(v.toPrecision(15)))`, plus `0`, `0.00…`,
`#,##0`, `#,##0.00…`, `0%`, `0.0…%`, literal prefix/suffix (`"£"#,##0.00`, `£#,##0`), first section of `pos;neg` with
`-`; anything else → General. `editText(value, numFmt)` — numbers unformatted, dates `dd/mm/yyyy[ hh:mm]`.
`isDateFmt(numFmt)`. `coerceInput(text, { value, numFmt })` — `''` → `null`; hyperlink → `{ text, hyperlink }`;
numFmt `@` → string; current value a string → string (keeps ticket IDs etc. as text); date cell (Date value or date
numFmt) + `dd/mm/yyyy[ hh:mm]` or `yyyy-mm-dd` → UTC `Date`; `/^-?(0|[1-9]\d{0,14})(\.\d+)?$/` → number;
`TRUE`/`FALSE` (any case) only when the cell was boolean; else string.

- [ ] **Step 1: failing tests:**
```js
test('display', () => { assert.equal(displayText(0.125, '0.0%'), '12.5%'); assert.equal(displayText(1234.5, '#,##0.00'), '1,234.50'); assert.equal(displayText(1234.5, '"£"#,##0'), '£1,235'); assert.equal(displayText(0.1 + 0.2), '0.3'); assert.equal(displayText(new Date(Date.UTC(2026, 2, 12)), 'dd/mm/yyyy'), '12/03/2026'); assert.equal(displayText({ formula: 'SUM(A1:A2)', result: 3 }), '3'); assert.equal(displayText({ richText: [{ text: 'a' }, { text: 'b' }] }), 'ab'); });
test('lookalikes stay text', () => { for (const s of ['007', '0123 456', '1234567890123456', '1,234', '1e5', '=SUM(A1)', ' 12']) assert.equal(coerceInput(s, { value: null }), s); assert.equal(coerceInput('42', { value: '41' }), '42'); assert.equal(coerceInput('42', { value: null, numFmt: '@' }), '42'); });
test('numbers, blanks, booleans, dates', () => { assert.equal(coerceInput('42', { value: 7 }), 42); assert.equal(coerceInput('-0.5', { value: null }), -0.5); assert.equal(coerceInput('', { value: 3 }), null); assert.equal(coerceInput('true', { value: false }), true); assert.equal(coerceInput('true', { value: null }), 'true'); assert.deepEqual(coerceInput('12/03/2026', { value: new Date(0) }), new Date(Date.UTC(2026, 2, 12))); assert.equal(coerceInput('12/03/2026', { value: null }), '12/03/2026'); });
test('hyperlink keeps its target', () => assert.deepEqual(coerceInput('New', { value: { text: 'Old', hyperlink: 'https://x' } }), { text: 'New', hyperlink: 'https://x' }));
```
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: cell display + input coercion`.

---

### Task 5: XLSX → sheet model

**Files:** Create `lib/sheet-xlsx.js`, `test/fixtures.js`, `test/sheet-xlsx-model.test.js`

**Consumes:** Tasks 1, 3, 4. **Produces:** `loadWorkbook(buf) → Promise<Workbook>`; `toModel(wb) → { sheets, active }`
(`active` = `wb.views[0].activeTab` if visible, else first visible). `test/fixtures.js` exports `makeTracker()` and
`makePack()` → `Promise<Buffer>` built with ExcelJS:
- *tracker* (Excel rows): 1 header (bold, theme-5 fill, autoFilter `A1:G1`, frozen `ySplit 1`); 2 section merged `A2:G2` with a
  **medium right border on G2**; 3–15 tasks (F4 = `Open`, F5 = `Closed`, custom heights), list `"Open,In Progress,Closed"`
  (showErrorMessage) and CF expression `$F3="Open"` (dxf bgColor `FFC00000`) on F3:F15; 16 section merged `A16:G16`
  with a medium right border on G16;
  `pageSetup.printArea = 'A1:G20'`.
- *pack*: sheets `Overview` (visible), `Lists` (hidden), `Detail` (visible); frozen `ySplit 4`; wrap text; argb fills;
  theme fonts with tint; Overview B2 = 2, B3 = 3, B4 = `=SUM(B2:B3)` (result 5).

Mapping: `rowCount = ws.rowCount`, `colCount = max(ws.columnCount, 1)`; widths `px = round(w·7+5)` (default
`defaultColWidth ?? 8.43`); heights `px = round(pt·4/3)` (default `defaultRowHeight ?? 15`); hidden rows/cols; frozen from
the first `views[]` entry with `state: 'frozen'`; merges from `ws._merges`; styles deduped; formula cells `f = '=' + formula`;
`lists` = list DVs grouped by identical `{formulae, showErrorMessage}`, items from a literal `"a,b"` or a same-workbook
range/defined name (display texts, blanks dropped), unresolvable → none; `strict = showErrorMessage !== false`.
CF: ranges from `ref`, rules by `priority`; supported: `cellIs` with literal operands → `kind:'cell'`; `expression` matching
`^\s*REF\s*(=|<>|>|<|>=|<=)\s*LITERAL\s*$` with REF a single same-sheet cell → `kind:'ref'`; `css = dxfCss(rule.style)`;
anything else → `cfSkipped++`. `readOnly = 'This sheet is protected in Excel'` when `ws.sheetProtection?.sheet`. `rowOps`,
first match: any formula in the workbook → `'This workbook has formulas, so inserting or deleting rows could break them — do that in Excel'`;
sheet has tables → `"This sheet has an Excel table, so add or remove rows in Excel"`; images → `"This sheet has pictures, so add or remove rows in Excel"`.
`tooBig` when `rowCount·colCount > 60000` (then `cells = {}`).

- [ ] **Step 1: failing tests:**
```js
test('tracker model', async () => {
  const s = toModel(await loadWorkbook(await makeTracker())).sheets[0];
  assert.deepEqual(s.frozen, { rows: 1, cols: 0 });
  assert.deepEqual(s.merges.find((m) => m.r1 === 1), { r1: 1, c1: 0, r2: 1, c2: 6 });
  assert.deepEqual(s.lists[0].items, ['Open', 'In Progress', 'Closed']); assert.equal(s.lists[0].strict, true);
  assert.deepEqual(s.cf[0].rules[0], { kind: 'ref', op: 'eq', values: ['Open'], ref: { r: 0, c: 5, absR: false, absC: true }, css: s.cf[0].rules[0].css, stop: false });
  assert.match(s.cf[0].rules[0].css, /background:#c00000/);
  assert.match(s.styles[s.cells['0,0'].s], /font-weight:700/);
  assert.equal(s.rowOps, null);
});
test('pack model', async () => {
  const { sheets } = toModel(await loadWorkbook(await makePack()));
  assert.equal(sheets.length, 2); assert.equal(sheets[1].index, 2); assert.equal(sheets[1].name, 'Detail');
  assert.deepEqual(sheets[0].cells['3,1'], { ...sheets[0].cells['3,1'], f: '=SUM(B2:B3)', t: '5' });
  assert.match(sheets[0].rowOps, /formulas/);
});
```
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: xlsx → sheet model`.

---

### Task 6: XLSX eligibility (dry-run diff) + corpus sweep

**Files:** Modify `lib/sheet-xlsx.js`; Create `test/sheet-xlsx-check.test.js`, `scripts/sheet-corpus.js`

**Produces:**
- `partCounts(buf) → Promise<Map<normalisedName, count>>` — JSZip part names with digits normalised (`sheet3.xml` → `sheetN.xml`),
  ignoring `_rels/`, `[Content_Types].xml`, `docProps/`, `calcChain`, `sharedStrings`.
- `checkEditable(srcBuf, wb) → Promise<{ editable, lost: string[], reason }>` — write the untouched workbook; any normalised
  part whose **count** drops is a loss, except `xl/printerSettings/*` and `customXml/*`; re-load the output and compare per
  sheet: merge sets, non-null column widths → losses `merged cells` / `column widths`. Names: `charts`; `drawings` →
  `shapes or pictures`; `pivotTables|pivotCache` → `pivot tables`; `persons|threadedComments` → `threaded comments`;
  `externalLinks` → `links to other workbooks`; `vbaProject` → `macros`; `slicers`; `timelines`; `ctrlProps` →
  `form controls`; else the folder name. `reason = "Saving here would lose ${list} — edit it in Excel"`.
- `cellSignature(wb) → object` (exported for the corpus and Task 7): per sheet `{ name, state, merges (sorted), cols: [{width, hidden}],
  views, autoFilter, printArea, dv: dataValidations.model, cf: conditionalFormattings, rows: { n: { height, hidden, outlineLevel } },
  cells: { addr: [value (richText → joined text; hyperlink → {text,hyperlink}; formula → {formula,result}), numFmt, font,
  fill (pattern none/absent → null), border (empty → null), alignment, protection] } }` — **every** cell including merged non-masters.
- `scripts/sheet-corpus.js <dir> [--ops-smoke]` (read-only): each `.xlsx`/`.csv` outside dot-folders → print
  `EDITABLE | VIEW-ONLY (reason) | UNREADABLE (error)`; for editable files apply `[]` ops and require equivalence
  (csv: byte-identical; xlsx: equal `partCounts` + equal `cellSignature`). Exit 1 on any failure.

- [ ] **Step 1: failing tests:** tracker → `{ editable: true, lost: [] }`; tracker zip + injected `xl/charts/chart1.xml` (JSZip
  add + regenerate) → `editable: false`, `lost` includes `'charts'`, reason `/would lose charts/`; injected
  `xl/printerSettings/printerSettings1.bin` only → editable; a workbook with two drawings where the output keeps one
  (inject a second `xl/drawings/drawingN.xml`) → not editable (count-based).
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: corpus run** — `docker run --rm -v /opt/vault/board-sheets:/app -v /opt/vault/vault:/vault:ro -w /app node:22-bookworm-slim node scripts/sheet-corpus.js /vault`.
  Expected: **34 EDITABLE**; **3 VIEW-ONLY** — `LIG Safeguard Firewall Rule Request - Infra Proposed v0.3.xlsx` (merged cells),
  `LIG Firewall Rule Form v01_30Apr2026.xlsx` (threaded comments), `PersonalEmailTrace_20251106_120442.xlsx` (column widths);
  **3 UNREADABLE** — both `RVTools_export_all_2026-09-28_*.xlsx`, `AllVMSubnets-20260709-0638.xlsx`; all 41 CSVs EDITABLE;
  zero equivalence failures. A deviation means investigate; never loosen the check to match the numbers.
- [ ] **Step 6:** commit `Sheets: xlsx eligibility + corpus sweep`.

---

### Task 7: XLSX ops — set + model-level row shifting + verified write

**Files:** Modify `lib/sheet-xlsx.js`, `scripts/sheet-corpus.js`; Create `test/sheet-xlsx-ops.test.js`

**Consumes:** Tasks 1, 4, 5, 6. **Produces:**
- `applyOps(wb, ops) → void`, throwing `Object.assign(new Error(msg), { status: 400 })` for: unknown op; `sheet` not a visible
  worksheet index; `readOnly` sheet; `set` on a formula cell (`'B4 has a formula — edit formulas in Excel'`) or a merged non-master;
  row op while `rowOps` is set (that message); `n` outside 1–1000; `like` not `null`/`at−1`/`at`; `r`/`c` outside Excel bounds;
  `v` not a string or > 32,767 chars; more than 50,000 ops.
- `set` → `cell.value = coerceInput(v, { value: cell.value, numFmt: cell.numFmt })`; style untouched; richText → plain.
- `shiftRows(ws, wb, at, delta)` (exported for tests): `m = ws.model`; drop rows in a delete band; renumber rows and cell
  addresses; **rewrite every `type: Merge` cell model as `{ address, type: ValueType.Null, style }` (drop `master`)**;
  `m.mergeCells` = shifted `m.merges` minus `null`/1×1; re-key `m.dataValidations` (drop removed) and rebase their formulae
  (`anchorShift: 0`); CF: `ref = shiftRefList(...)` (drop the entry if `''`), `formulae` rebased with `anchorShift` = new − old
  top-left row of the first range; `m.autoFilter` (string or `{from,to}`) shifted; `m.pageSetup.printArea` split on `&&`,
  each area shifted, re-joined; then `ws._merges = {}; ws.model = m;` then `wb.definedNames.spliceRows(ws.name, at + 1, del, ins)`.
  Insert with `like` copies that row's height, deep-cloned cell styles, list DVs and CF coverage onto the new rows (CF ranges
  appended only for new cells not already inside the shifted ranges).
- `writeVerified(wb, srcBuf) → Promise<Buffer>` — snapshot the in-memory workbook *before* writing (sheet names, merges,
  non-null widths); set `wb.calcProperties.fullCalcOnLoad = true` only if any formula exists; `writeBuffer()`; re-load;
  require `partCounts(out)` ≥ `partCounts(srcBuf)` per name (same exceptions as `checkEditable`) and the snapshot equal to the
  re-loaded workbook's; else throw `{ status: 422 }` `"Saving would have lost ${what} — nothing was changed"`.

- [ ] **Step 1: failing tests:**
```js
const set = (r, c, v) => ({ op: 'set', sheet: 0, r, c, v }), ins = (at, n, like) => ({ op: 'insertRows', sheet: 0, at, n, like }), del = (at, n) => ({ op: 'deleteRows', sheet: 0, at, n });
async function after(ops, make = makeTracker) { const src = await make(); const wb = await loadWorkbook(src); applyOps(wb, ops); return (await loadWorkbook(await writeVerified(wb, src))).worksheets[0]; }
const merges = (ws) => Object.values(ws._merges).map((m) => m.range).sort();
test('set keeps style and coerces', async () => { const orig = (await loadWorkbook(await makeTracker())).worksheets[0]; const ws = await after([set(3, 5, 'Closed'), set(4, 1, '42')]); assert.equal(ws.getCell('F4').value, 'Closed'); assert.deepEqual(ws.getCell('F4').fill, orig.getCell('F4').fill); assert.equal(ws.getCell('B5').value, 42); });
test('set on a merged non-master is refused', async () => { const wb = await loadWorkbook(await makeTracker()); assert.throws(() => applyOps(wb, [set(1, 3, 'x')]), (e) => e.status === 400); });
test('insert above the section row: everything moves, CF re-anchors, merged border survives', async () => {
  const ws = await after([ins(1, 1, 1)]);
  assert.deepEqual(merges(ws), ['A17:G17', 'A3:G3']);
  assert.equal(ws.getCell('G3').border.right.style, 'medium');
  assert.equal(ws.dataValidations.find('F4').type, 'list'); assert.equal(ws.dataValidations.find('F3'), undefined);
  assert.match(ws.conditionalFormattings[0].ref, /^F4:F16/); assert.equal(ws.conditionalFormattings[0].rules[0].formulae[0], '$F4="Open"');
  assert.equal(ws.autoFilter, 'A1:G1'); assert.equal(ws.pageSetup.printArea, 'A1:G21');
});
test('insert above the first task row copies the task row, not the section row', async () => {
  const ws = await after([ins(2, 1, 2)]);                       // new Excel row 3, like = old row 3
  assert.equal(ws.dataValidations.find('F3').type, 'list');
  assert.equal(ws.conditionalFormattings[0].ref, 'F4:F16 F3'); // shifted range first (anchor F4), new cell appended
  assert.equal(ws.conditionalFormattings[0].rules[0].formulae[0], '$F4="Open"');
  assert.deepEqual(ws.getCell('A3').fill, ws.getCell('A4').fill); assert.equal(ws.getCell('A3').value, null);
});
test('insert inside the list range: DV + CF cover the new rows once, height from like', async () => {
  const ws = await after([ins(6, 2, 5)]);                       // new Excel rows 7–8, like = Excel row 6
  for (const a of ['F7', 'F8']) assert.equal(ws.dataValidations.find(a).type, 'list');
  assert.equal(ws.conditionalFormattings[0].ref.split(' ')[0], 'F3:F17');
  assert.equal(ws.getRow(7).height, ws.getRow(6).height);
  assert.deepEqual(merges(ws), ['A18:G18', 'A2:G2']);
});
test('delete the section row: merge dropped, rest moves up, CF re-anchors, border on G15 survives', async () => {
  const ws = await after([del(1, 1)]);
  assert.deepEqual(merges(ws), ['A15:G15']); assert.equal(ws.getCell('G15').border.right.style, 'medium');
  assert.match(ws.conditionalFormattings[0].ref, /^F2:F14/); assert.equal(ws.conditionalFormattings[0].rules[0].formulae[0], '$F2="Open"');
  assert.equal(ws.dataValidations.find('F15'), undefined);
});
test('row ops refused when the workbook has formulas', async () => { const wb = await loadWorkbook(await makePack()); assert.throws(() => applyOps(wb, [ins(2, 1, 1)]), /formulas/); });
test('fullCalcOnLoad written only when formulas exist', async () => {
  const calc = async (make, ops) => { const src = await make(); const wb = await loadWorkbook(src); applyOps(wb, ops); return (await JSZip.loadAsync(await writeVerified(wb, src))).file('xl/workbook.xml').async('string'); };
  assert.doesNotMatch(await calc(makeTracker, [set(3, 5, 'Closed')]), /fullCalcOnLoad="1"/);
  assert.match(await calc(makePack, [set(1, 0, 'x')]), /<calcPr[^>]*fullCalcOnLoad="1"/);
});
```
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: real-file regression:** `scripts/sheet-corpus.js --ops-smoke`: for every editable xlsx whose first visible sheet
  allows row ops, apply `[insertRows at 2 n 1 like 2, set <first cell in the new row not covered by a merge> 'x', deleteRows at 2 n 1]`
  and require `cellSignature` equal to the original's (full per-cell + rows + merges + DV + CF + autoFilter + printArea).
  Run it read-only against `/vault`; expect zero failures. Commit `Sheets: xlsx ops + verified write`.

---

### Task 8: Disk store — guarded read, lock, atomic replace, backups

**Files:** Create `lib/sheet-store.js`, `test/sheet-store.test.js`

**Produces:** `createStore({ vaultDir, backupDir, fs = require('fs/promises') })` (`fs` injectable for tests) with:
- `readGuarded(full, expectedMtime?) → { buf, stat }` — 409 `'This file changed on disk since you opened it.'` when `|stat.mtimeMs − expected| > 1`.
- `withLock(full, fn)` — per-path promise chain.
- `replace(full, rel, newBuf, guard: { buf, stat }) → stat` — **right before writing**, re-`stat` the file and 409 if
  `mtimeMs`, `size` or `ino` differ from `guard.stat`; write `guard.buf` (the bytes that were checked) to
  `backupDir/rel` via a temp file **in the backup folder** + rename, then `utimes` it to `guard.stat`'s times; write `newBuf`
  to `.<base>.tmp-sheet-<pid>-<n>` **in the file's own folder** + rename over `full`; unlink temps on any error. Never `rename`
  between `vaultDir` and `backupDir` (separate bind mounts → EXDEV).
- `backupInfo(rel) → null | { mtime }`.
- `restore(full, rel, guard) → stat` — same re-check; read backup bytes and current bytes; write backup bytes over `full`
  (temp in the file's folder + rename, then `utimes` to the backup's times) and the old current bytes into the backup (temp in
  the backup folder + rename, `utimes` to the old file's times). Missing backup → 404.
- `eligibility`: `Map` keyed `rel` → `{ mtime, size, result }`, max 100 entries.

- [ ] **Step 1: failing tests** (in `fs.mkdtemp`, `vault/` and `backups/` siblings): stale mtime → 409, file untouched;
  file modified between `readGuarded` and `replace` → 409, nothing written; `replace` → new bytes in place, backup = checked
  bytes with the old mtime, no `.tmp-` leftovers; injected `fs.rename` that throws `EXDEV` when source and target roots differ →
  `replace` and `restore` still succeed; failure injection (`backupDir` path whose parent is a regular file → ENOTDIR) → original
  intact, no temps; `restore` twice → original bytes; two `withLock` calls run in order.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: atomic store + backups`.

---

### Task 9: `SheetCore` client model — ops on the JSON sheet, CF evaluation, list matching

**Files:** Modify `public/sheet-core.js`; Create `test/sheet-core-model.test.js`

**Produces:** `applyOps(sheet, ops) → Sheet` (deep clone; mirrors Task 7: cells re-keyed, merges shifted (drop null/1×1),
`rowHeights`/`hiddenRows`, `lists[].ranges`, `cf[].ranges` (empty entries dropped), absolute `ref` rules follow cells; `rowCount`
± delta; `set` beyond bounds grows `rowCount`/`colCount`; `set` with `''` removes `t`/`e` but keeps `s`; inserts copy row `like`'s
`s`, height, list and CF coverage; maintains `sheet.changed` — a `Set` of `'r,c'` keys set since the base, shifted/dropped with
row ops — and `sheet.newRows` (inserted rows)). `cfCss(sheet, r, c) → string` (rules in order, first match wins per CSS
property, `stop` ends the walk; text comparisons case-insensitive, otherwise exact; numeric when both sides are finite
numbers; `'ref'` reads `(r + ref.r, c + ref.c)` for relative parts, `ref.r`/`ref.c` as indices for absolute ones).
`matchListItem(items, text) → string|null` (trim + case-insensitive, returns the item's spelling). `cellText(sheet, r, c)`.
`compactOps(ops) → ops` (drops a `set` superseded by a later `set` to the same cell with no row op between them).

- [ ] **Step 1: failing tests** on `T()` — a hand-built tracker-shaped `Sheet` (1 frozen row, merge `{1,0,1,6}`, list on rows 2–14 col 5,
  CF `ref` rule `{ r: 0, c: 5, absR: false, absC: true }` eq `'Open'` css `background:#c00000`, `rowCount` 16):
```js
const ins = (at, n, like) => ({ op: 'insertRows', sheet: 0, at, n, like }), set = (r, c, v) => ({ op: 'set', sheet: 0, r, c, v });
test('insert above section row', () => { const s = applyOps(T(), [ins(1, 1, 1)]); assert.deepEqual(s.merges, [{ r1: 2, c1: 0, r2: 2, c2: 6 }]); assert.deepEqual(s.lists[0].ranges[0], { r1: 3, c1: 5, r2: 15, c2: 5 }); assert.equal(s.rowCount, 17); });
test('insert inside range grows coverage once', () => assert.deepEqual(applyOps(T(), [ins(6, 2, 5)]).lists[0].ranges, [{ r1: 2, c1: 5, r2: 16, c2: 5 }]));
test('insert above first task row copies the list', () => assert.deepEqual(applyOps(T(), [ins(2, 1, 2)]).lists[0].ranges, [{ r1: 3, c1: 5, r2: 15, c2: 5 }, { r1: 2, c1: 5, r2: 2, c2: 5 }]));
test('delete band drops merge', () => assert.deepEqual(applyOps(T(), [{ op: 'deleteRows', sheet: 0, at: 1, n: 1 }]).merges, []));
test('set grows and tracks changes through row shifts', () => { const s = applyOps(T(), [set(40, 9, 'x'), set(5, 1, 'y'), ins(0, 1, null)]); assert.equal(s.rowCount, 42); assert.equal(s.colCount, 10); assert.ok(s.changed.has('6,1')); assert.ok(s.changed.has('41,9')); });
test('cfCss', () => { const s = applyOps(T(), [set(3, 5, 'open'), set(4, 5, 'Open ')]); assert.match(cfCss(s, 3, 5), /#c00000/); assert.equal(cfCss(s, 4, 5), ''); });
test('matchListItem', () => { assert.equal(matchListItem(['Open', 'Closed'], ' closed '), 'Closed'); assert.equal(matchListItem(['Open'], 'Nope'), null); });
test('compactOps', () => assert.deepEqual(compactOps([set(1, 1, 'a'), set(1, 1, 'b'), ins(0, 1, null), set(2, 1, 'c')]), [set(1, 1, 'b'), ins(0, 1, null), set(2, 1, 'c')]));
```
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: SheetCore client model`.

---

### Task 10: Server routes + `sheet` kind

**Files:** Modify `server.js`; Create `scripts/sheet-smoke.sh`

**Consumes:** Tasks 2, 5–8. **Produces:** the HTTP contract above.
- `fsKind`: `.csv`/`.xlsx` → `'sheet'` (before the text set; `.tsv` stays text). `/api/fs/file`: sheet + `.csv` → today's text
  branch (`source`, NUL check, `tooLarge`) with `kind: 'sheet'`; `.xlsx` → no `source`.
- `function sheetLib()` — **lazy** `require('./lib/sheet-csv')` etc. on first use, so a missing dependency can only break the sheet routes, never boot.
- `GET /api/fs/sheet?path=` (localRead-OK like `/api/fs/file`): `safeVaultPath`; must be `.csv`/`.xlsx`; over `SHEET_FILE_MAX` →
  `{ …meta, tooLarge: true, sheets: [], editable: false }`; csv → `parseCsv`, `csvToSheet`, `editable = !csvEditable`, `csv` meta;
  xlsx → `loadWorkbook` (failure → `sheets: [], editable: false, reason: "VaultOS can't read this workbook — download it to open in Excel"`),
  eligibility from the cache (keyed on mtime+size) or `checkEditable`, `toModel`; `backup: store.backupInfo(rel)`.
- `POST /api/fs/sheet/save` `{ path, mtime, ops }`: `ops` a non-empty array; `store.withLock(full, async () => { const guard = await store.readGuarded(full, mtime); … })`;
  csv → refuse when `csvEditable`, `serializeCsv(applyCsvOps(parseCsv(guard.buf), ops))`; xlsx → `loadWorkbook(guard.buf)`, eligibility
  (cache or `checkEditable`) must be editable, `applyOps`, `writeVerified(wb, guard.buf)`; then `store.replace(full, rel, out, guard)` and
  respond with the fresh payload (same builder as GET).
- `POST /api/fs/sheet/restore` `{ path, mtime }`: lock → `readGuarded` → `store.restore(full, rel, guard)` → fresh payload.
- Errors: `ENOENT` → `fsError`; errors carrying `status` → that status + message; anything else → `console.error` and 500
  `"Something went wrong, and the file wasn't changed"` (no `/vault/...` paths in responses).
- `const store = createStore({ vaultDir: VAULT_DIR, backupDir: process.env.SHEET_BACKUP_DIR || path.join(ROOT, 'sheet-backups') })` (created lazily with `sheetLib()`).

- [ ] **Step 1: smoke script** `scripts/sheet-smoke.sh` (base URL + `SHEET_COOKIE`; `curl`, `jq`, `cmp`; runs `reset.sh` first):
  GET the action list → `.editable == true`, `.sheets[0].lists[0].items == ["Open","In Progress","Closed"]`, `.backup == null`;
  GET an RVTools export → `.editable == false`, `.reason` contains `can't read`; `GET /api/fs/file` on a `.csv` → `.kind == "sheet"`
  with `.source`; POST save without cookie → 401; with cookie and a stale `mtime` → 409; with cookie and
  `[{op:"set",sheet:0,r:3,c:5,v:"Closed"}]` → 200, `.sheets[0].cells["3,5"].t == "Closed"`, `.backup.mtime` equals the original
  file's mtime, the vault file changed and is owned by uid 1000, the backup `cmp`-equals `pristine/`; restore → vault file
  `cmp`-equals `pristine/`; GET with `path=../config.json` → 400; a missing file → 404 with no `/vault` in the body.
- [ ] **Step 2:** `docker compose -f /opt/vault/sheet-preview/compose.yml up -d --build`; run → FAIL.
- [ ] **Step 3:** implement. **Step 4:** `docker restart vault-sheet-preview` (single-file mount); run → PASS.
- [ ] **Step 5:** commit `Sheets: /api/fs/sheet routes`.

---

### Task 11: Grid — read-only rendering, mounted in Files

**Files:** Create `public/sheet-grid.js`, `public/sheet-files.js` (mount-only cut), `scripts/sheet-e2e.js`; Modify `public/index.html`
(after `app.js`, before `workbench.js`: `sheet-core.js`, `sheet-grid.js`, `sheet-files.js`), `public/styles.css`, `public/workbench.js`
(view hooks: `FX_ICONS.sheet` `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>`; `fxKindOf`
`/\.(csv|xlsx)$/i → 'sheet'`; `renderView`: sheet `mode` = csv ? `FX.views[p] || 'grid'` : `'grid'`, CSV `Grid | Source` seg, grid branch
`view.classList.add('fx-view-sheet'); SheetFiles.mount(view, p, f); return;`, source branch also for `f.kind === 'sheet' && f.source != null`,
other branches remove `fx-view-sheet`; at the top of `renderView` call `SheetFiles.beforeViewChange()`).

**Produces** (`window.SheetGrid`):
```js
const grid = SheetGrid.create(payload, { editable: false, onChange, onRequestSave, toast });
grid.el                     // root .sg element; editor, dropdown list and row menu all live inside it
grid.attach(container)      // if already the container's child: restore scroll + focus only; else append, then restore scroll
grid.suspend()              // commit any open edit, close list/menu (called before the view changes)
grid.setEditable(bool); grid.load(payload, { keepView: true }); grid.ops(); grid.changeCount(); grid.commitEdit() → bool
grid.replay(ops); grid.opsSince(n) → ops added after the first n; grid.destroy()
```
`SheetFiles` (this task): `mount(viewEl, path, fileMeta)` — registry `Map(path → { payload, grid, mtime, loading })`, one load per path
at a time, `Loading…` until `GET /api/fs/sheet` returns, then `grid.attach(viewEl)`; `beforeViewChange()` → `suspend()` on the attached grid.

DOM: `.sg` → `.sg-fbar` (Name box + content field) / `.sg-scroll` (`overflow:auto`; tracks its own `scrollTop/Left` via a scroll
listener) → `table.sg-table` (`border-collapse: separate; border-spacing:0; table-layout:fixed`), `<colgroup>`, sticky `thead`
letters, sticky row-number `th`, sticky corner / `.sg-tabs` (visible sheets; hidden for CSV) / `textarea.sg-sink`
(off-screen, **`inputmode="none"`**, always holding one selected space so Chrome fires `copy`/`cut`, with `beforecopy`/`beforecut`
`preventDefault` as belt and braces).
Rendering: one HTML string per sheet; merges drawn from their **first visible row and column** with `rowspan/colspan`
counting only visible rows/cols; covered and hidden cells omitted; cell content in `<div class="sg-c">`; inline style =
`styles[s]` + `cfCss`; heights from `rowHeights`/`defaultRowHeight` (wrapped rows without a height grow). Frozen panes:
after render measure frozen rows/cols and set `position: sticky; top/left` with opaque background (`--sheet-paper` when no
fill); z-index corner 4 > headers 3 > frozen 2; **merges that cross the frozen line are not made sticky**. Formula cells get
`title` = formula. Selection: mouse click/shift-click/drag (drag only for `pointerType === 'mouse'`, so finger drags scroll),
row-number and column-letter clicks, Ctrl+A in the grid; drawn with classes (`.sg-sel` inset tint, `.sg-act` 2px outline).
Keyboard: arrows, Shift+arrows, Ctrl+arrows (data edge), Home/Ctrl+Home/Ctrl+End, PageUp/PageDown, Tab/Enter.
Copy → TSV of display text (quoted when containing tab/newline/quote). Formula bar shows the address and full text (`f`
for formula cells). Tokens (both themes): `--sheet-paper`, `--sheet-ink`, `--sheet-gridline`, `--sheet-head-bg`,
`--sheet-head-fg`, `--sheet-head-sel-bg`, `--sheet-sel` (Excel green family `#107c41`), `--sheet-sel-tint`,
`--sheet-changed`; xlsx paper white in both themes; CSV cells use `--bg`/`--text`; cell font
`Calibri, Carlito, "Segoe UI", Arial, sans-serif`, `--sg-fs: 13px`. `.fx-view.fx-view-sheet { overflow: hidden; display: flex; }`.

- [ ] **Step 1: e2e harness + E1.** `scripts/sheet-e2e.js` — puppeteer `/root/.npm/_npx/7d92d9a2d2ccc630/node_modules/puppeteer`,
  chrome `/root/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome`, base URL default `http://127.0.0.1:7690`,
  cookie from env `SHEET_COOKIE`, scenario names as args, runs `reset.sh` first. Files are opened as a user would: Files
  button → type the name in `#search` → click the result. **E1:** (a) action list → F4 (`Open`) has the CF red computed
  background, F5 doesn't; the `Environments` master cell has `colspan="7"`; the header row is bold with its theme fill.
  (b) `svc-spp-linux - InfoSec Sign-off Pack.xlsx` (4 frozen rows) → after scrolling `.sg-scroll` 600px down, row 4 keeps its
  viewport `top`; its sheet tabs are listed; clicking the 2nd tab renders that sheet. (c) `linux.xlsx` (1 frozen column) →
  column A keeps its `left` after scrolling 400px right. (d) a CSV → bold first row; `Grid | Source` round-trips.
  (e) click B3, →, ↓ → Name box `C4`; select B3:C4, Ctrl+C → a page `copy` listener sees 2×2 TSV. (f) switch to Board and
  back, and dispatch `visibilitychange` → same scroll position and active cell. Screenshots: dark + sepia, 1600×1000 and
  390×844 (`isMobile`, `hasTouch`) → `/tmp/sheet-shots/`; at 390×844 a tap on a cell must not open the keyboard (`inputmode`).
- [ ] **Step 2:** run E1 → FAIL. **Step 3:** implement. **Step 4:** E1 PASS; review every screenshot (fills, bold, wrap,
  widths, merges, frozen panes, both themes; chrome follows VaultOS, xlsx paper stays white). **Step 5:** commit `Sheets: read-only grid in Files`.

---

### Task 12: Grid — editing (+ the Edit button)

**Files:** Modify `public/sheet-grid.js`, `public/sheet-files.js` (`barHtml(p, f)` renders **Edit** — disabled with
`title=reason` when `!payload.editable`; `onBar(btn, p)` handles it: `fxPin(p)` then `grid.setEditable(true)`),
`public/workbench.js` (bar adds `SheetFiles.barHtml(p, f)`; `#fx-bar` delegation `if (SheetFiles.onBar(btn, p)) return;` before the `btn.id` switch), `public/styles.css`

Behaviour when editable (locked = formula cell, merged non-master, `readOnly` sheet → toast why, once per kind):
- Start edit: a printable key replaces the content (arrows then commit + move); F2 / double-click / double-tap keeps it
  (arrows move the caret); or typing in the formula bar. Editor = `textarea.sg-editor` inside `grid.el`, `position: fixed`
  over the cell rect (repositioned on scroll/resize), cell font/alignment, `enterkeyhint="done"`.
- Commit: Enter ↓, Shift+Enter ↑, Tab →, Shift+Tab ←, click elsewhere; Alt+Enter newline; Esc cancels. A commit whose
  text equals the cell's edit text emits nothing. Otherwise one undo group `[set]`, cell DOM updated in place, CF re-evaluated
  for the sheet, cell marked `.sg-changed` (from `sheet.changed`); inserted rows mark their row number.
- Lists: a ▾ at the active cell's edge; Alt+↓ or click opens `.sg-list` (type to filter, ↑/↓/Enter/Esc, click). Commit →
  `matchListItem` → canonical spelling; no match + `strict` → toast `“x” isn't in the list: Open, In Progress, Closed`,
  editor stays open; non-strict → as typed.
- Delete/Backspace clears non-locked, **non-empty** cells in the selection (one group); Ctrl+X = copy + clear.
- Paste (`paste` on sink/editor-less grid): Excel TSV (quoted cells with embedded newlines/tabs); a 1×1 clip fills the
  selection; otherwise from the selection's top-left, growing the sheet; locked cells skipped (`N locked cells were skipped`);
  only cells whose text changes emit ops; > 20,000 cells → toast `That's too much to paste at once (max 20,000 cells)` and abort.
- Undo/redo: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z; ≤ 500 groups; undo = rebuild from base by replaying the remaining groups through
  `SheetCore.applyOps`, re-render, restore scroll + active cell.
- Row menu (`contextmenu` on a row number or cell; touch: tap a row number in edit mode): `Insert row above` / `Insert row below` /
  `Delete row`, pluralised by the selected row span (`Insert 3 rows above`, `Delete rows 5–7`), `like` per the rule above,
  disabled with `title = sheet.rowOps` when blocked; separator; `Copy`; `Clear contents`. View mode: `Copy` only.
  Arrows/Enter/Esc in the menu. Row ops are one group each with a full re-render.
- Edit mode renders `rowCount + 20` rows and `colCount + 2` columns (dimmed headers); setting a spare cell grows the sheet.
- View mode: a printable key → toast `Press Edit to change cells` (once per grid).
- Ctrl+S in the grid or editor → `commitEdit()` then `onRequestSave()`; every change → `onChange(grid)`.

- [ ] **Step 1: e2e E2** on the action list (nothing saved): a key before Edit → the toast; click **Edit**; F4 → Alt+↓ → `Closed`
  → text `Closed`, CF red gone, F4 has `.sg-changed`; F5 type `closed ` + Enter → `Closed`; type `Nope` + Enter → toast lists the
  values, editor open, Esc; Ctrl+Z ×2 → F4 `Open` and red, no `.sg-changed`; right-click row 3 (first task row) → `Insert row above`
  → new row 3 shows a ▾ on F when active and the `Environments` row 2 is still merged; Ctrl+Z → gone; paste event with
  `a\t"multi\nline"\r\nb\tc` at B6 → B6 `a`, C6 `multi⏎line`, B7 `b`, C7 `c`; F2 on C6, ← moves the caret within the editor.
  Sub-scenario on `Mimecast_User_Access_Export.xlsx`: its formula cell refuses edits with a toast; `Insert row above` is
  disabled with the formulas reason.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Sheets: grid editing`.

---

### Task 13: Save lifecycle — Save/Done/Restore, dirty state, conflicts, refresh safety

**Files:** Modify `public/sheet-files.js`, `public/workbench.js`, `public/styles.css`

**Produces** (`SheetFiles` complete): `mount`, `beforeViewChange`, `barHtml`, `onBar`, `isDirty(p)`, `anyDirty()`,
`confirmDiscard(p) → bool` (`confirm('Discard N unsaved changes to <name>?')` when dirty), `drop(p)`.
Controller `{ payload, grid, editing, saving, mtime, loading }`.
- **Save** (accent, label `Save (N)`, disabled when `changeCount() === 0` or `saving`) and Ctrl+S (document handler in Files
  when the active tab is a sheet in edit mode; ignored while `saving`): `grid.commitEdit()` (abort if it returns false);
  `sent = grid.ops().length`; `body = { path, mtime, ops: SheetCore.compactOps(grid.ops()) }`; if
  `JSON.stringify(body).length > 1.9e6` → toast `Too many changes for one save — save in smaller steps` and stop;
  `saving = true`; `fetch` POST directly (not `api()`, which drops the status). On 200: `later = grid.opsSince(sent)`;
  `grid.load(fresh, { keepView: true })`; `grid.replay(later)` if any; `mtime = fresh.mtime`; refetch `/api/fs/file` into
  `FX.files` (so mtime, size and CSV `source` are current and the poll doesn't treat our save as external); toast `Saved`.
  401 → `showLogin()`; 409 → banner (below); 413 → the too-many toast; 400/422/500 → toast the message. `finally saving = false`.
  A save clears undo history.
- **409 banner** (`.sg-note`): `This file changed on disk since you opened it.` **[Reload and re-apply my N edits]** → fetch fresh,
  `grid.load`, `grid.replay(myOps)` (cells highlighted), still dirty; **[Reload and discard my edits]**.
- **Done** → `confirmDiscard`, then `grid.load(payload)` and leave edit mode. **Restore previous version** (new `FX_ICONS.history`)
  when `payload.backup && !editing` → `confirm('Put back the version from <dd/mm/yyyy hh:mm>? What's there now becomes the backup, so you can switch back.')`
  → POST restore → same 200 handling.
- External change: `mount` with `|fileMeta.mtime − controller.mtime| > 1` and not `saving` → clean: refetch + `grid.load(…, { keepView: true })`;
  dirty: show the 409 banner proactively, no auto-reload.
- Read-only banners: `payload.reason` + **[Download]**; `cfSkipped > 0` → muted `Some colour rules from Excel aren't shown here`;
  `tooLarge`/`tooBig` → `Too large for the grid` (+ CSV **[Show source]**).
- `beforeunload` → `preventDefault()` when `anyDirty()`.

`workbench.js` hooks added here: `renderTabs` adds `' unsaved'` when `SheetFiles.isDirty(t.path)` (CSS: `.fx-tab.unsaved .fx-tab-x`
shows a ● in `--accent` instead of × until hover, always visible; distinct from `.changed`); `fxClose`: `if (!SheetFiles.confirmDiscard(p)) return;`
then `SheetFiles.drop(p)`; `fxOpen` preview replacement: never replace a dirty tab (pin it instead) and `SheetFiles.drop(old)` for the replaced one.

- [ ] **Step 1: e2e** (each runs `reset.sh` first):
  **E3** type in F4 and click **Save** with the editor still open → file on disk has it (read back with node + ExcelJS over the preview
  vault), toast `Saved`, ● gone; then type in F6 immediately after clicking Save → F6 survives the save and stays dirty; press
  Ctrl+S twice quickly → exactly one POST (request interception); after **Done**, **Restore previous version** is shown.
  **E4** in edit mode, change F4, start typing in F5 **without committing**, dispatch `visibilitychange`, wait 9 s, switch to Board and
  back → F4 changed, F5's editor still holds the text, `Save (1)`, scroll unchanged.
  **E5** CSV: edit a cell, then change another line of the file on disk (node over the preview vault) → (if > 8 s passed, the
  proactive banner shows) Save → 409 banner → **Reload and re-apply** → both changes present, cell highlighted, dirty → Save → 200.
  **E6** close a dirty tab → confirm dialog; dismissing keeps the tab. **E7** Restore → vault file `cmp`-equal to `pristine/`.
  **E8** CSV: Grid|Source, edit, Save → `diff` against `pristine/` shows only the edited line; Source view shows the new text.
- [ ] **Steps 2–5:** FAIL → implement → E1–E8 PASS → commit `Sheets: save lifecycle`.

---

### Task 14: Polish — themes, phone, accessibility, regressions

**Files:** Modify `public/styles.css`, `public/sheet-grid.js`, `public/sheet-files.js`

- ≤700px: file-bar edit buttons keep labels and wrap; `.sg-fbar` shows only the content field; row menu via row-number tap;
  tabs scroll horizontally; ▾ hit area ≥ 32px on coarse pointers; double-tap to edit opens the keyboard (editor), single taps don't.
- `role="grid"` on the table with `aria-label` = sheet name; the sink's `aria-label` updates to e.g. `F4, Open` on move.
- Regression sweep — unchanged: `.md` Rendered|Source, text files, images, Ctrl+A in a text file, Copy file, Download, upload
  drop onto the tree, right-click tree menu, Changed recently ●, terminal dock.
- [ ] **Step 1:** run E1–E8 at 1600×1000 and 390×844 (`isMobile`, `hasTouch`), dark + sepia; screenshot each state.
- [ ] **Step 2:** fix failures, re-run until green, compare screenshots both themes. **Step 3:** commit `Sheets: phone + theme polish`.

---

### Task 15: Docs, review, then merge + deploy in one sitting (Ben's go-ahead first)

**Files:** Modify `CLAUDE.md`; at deploy also `docker-compose.yml` (repo) and `/opt/vault/docker-compose.yml` (live, mode 0600)

- [ ] **Step 1: docs** — `CLAUDE.md` section "Spreadsheets in Files (added 2026-10-06)": modules and jobs; contract → plan/spec;
  `lib/` + `sheet-backups/` mounts and the lazy require; model-shift traps (`ws._merges = {}`, `merges` vs `mergeCells`,
  merged non-master styles, CF re-anchoring, the anchor caveat); eligibility rules + harmless parts; EXDEV rule for backups;
  why not Jspreadsheet; test / corpus / smoke / e2e commands and the preview recipe. Fix the stale "compose is symlinked" line.
- [ ] **Step 2: review** — superpowers:requesting-code-review on `sheets`; fix findings; tests + corpus (`--ops-smoke`) + smoke + E1–E8 all green. Commit.
- [ ] **Step 3: ask Ben.** `docker exec vault-board ps -eo pid,etime,cmd` → tell him how many terminals / `claude` sessions the restart ends. Wait for his yes.
- [ ] **Step 4: deploy, back-to-back:** merge `sheets` → `master` in `/opt/vault/board` (superpowers:finishing-a-development-branch);
  `install -d -o 1000 -g 1000 /opt/vault/board/sheet-backups`; in both compose files add to the `board` service
  `- ./board/lib:/app/lib:ro`, `- ./board/sheet-backups:/app/sheet-backups` and env `- SHEET_BACKUP_DIR=/app/sheet-backups`;
  `cd /opt/vault && docker compose up -d --build board`.
- [ ] **Step 5: verify live:** healthy; `docker exec vault-board md5sum /app/server.js /app/lib/sheet-xlsx.js` matches the host;
  `diff <(curl -s localhost:7684/sheet-grid.js) public/sheet-grid.js` empty; read-only E1(a) against `http://127.0.0.1:7684`
  (localRead) on the real action list. Saving on the live vault is Ben's first try.
- [ ] **Step 6: cleanup** — `docker compose -f /opt/vault/sheet-preview/compose.yml down --rmi local`; `rm -rf /opt/vault/sheet-preview`;
  `git worktree remove /opt/vault/board-sheets`; memory `vault-board-app.md` gets one dated line pointing at the CLAUDE.md section.

## Verification (end to end)

1. `node --test 'test/*.test.js'` (node:22 container) — all suites green.
2. `scripts/sheet-corpus.js /vault` (read-only): 34 editable / 3 view-only / 3 unreadable xlsx, 41 editable CSVs, zero equivalence
   failures; `--ops-smoke`: zero failures with the full per-cell signature.
3. `scripts/sheet-smoke.sh` and `scripts/sheet-e2e.js` E1–E8 on the preview (127.0.0.1:7690), desktop + phone, dark + sepia, screenshots reviewed.
4. After deploy: E1(a) read-only on :7684 against the real vault; Ben makes the first real edit (suggested: a Status in
   `Environment Build Action List.xlsx`, then **Restore previous version** to see the round trip).
