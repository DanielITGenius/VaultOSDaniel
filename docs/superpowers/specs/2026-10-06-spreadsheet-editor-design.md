# Spreadsheet view + edit in Files (CSV / XLSX)

Date: 2026-10-06 · Status: approved design, amended after planning research (see "Amendments") and again while building (see "Decisions made during implementation")

## Why

Ben amends CSV and XLSX files in the vault by downloading them, editing locally and
uploading again. He wants to view and edit them inside VaultOS's Files mode with an
Excel-like look and feel. Markdown stays read-only in Files; that's fine.

Step one (this spec): view, edit cell values, add/remove rows, with the file's existing
formatting preserved. Step two (later, separate spec): formatting controls (bold, fill,
column widths). Nothing in step one should block step two.

## Evidence the approach works

Every `.xlsx` in the vault (40 files) was round-tripped through ExcelJS 4 (load → write →
reload → compare values, formulas, fills, bold, borders, number formats, merges, column
widths, data validation, conditional formatting, and the zip part list):

- 31 identical (all InfoSec sign-off packs, evidence trackers, CAB pack). Explicit
  `pattern: none` fills / empty borders dropping is treated as identical (renders the same).
- 6 minor losses: `customXml/*` SharePoint metadata (2), `xl/printerSettings/*.bin` (1),
  `xl/persons/person.xml` threaded-comment authors (1), two empty column widths (1),
  five merges lost in `LIG Safeguard Firewall Rule Request … v0.3.xlsx` (1).
- 3 unreadable by ExcelJS: two RVTools exports, `AllVMSubnets-20260709-0638.xlsx`.

## Design

### 1. Viewing

- `.csv` and `.xlsx` open in a grid in Files instead of raw text / "No preview": column
  letters, row numbers, sheet tabs (xlsx), frozen panes, fills, bold/italic, font colour,
  borders, alignment, merged cells, column widths, row heights, hidden rows/columns.
- Formula cells show their cached result.
- List data validation shows as a dropdown on the covered cells.
- Conditional formatting is displayed for a **subset**: `cellIs` rules (with literal
  operands) and simple expressions of the form `REF op LITERAL` (e.g. `$F3="Open"`), via
  the rule's dxf fill/font. Anything else is skipped and counted (`cfSkipped`), never
  guessed at.
- CSV gets a **Grid | Source** segment (same pattern as Rendered | Source for `.md`);
  Source is today's text view. Grid is the default.
- A sheet renders only if `rowCount × colCount ≤ 60,000` (`SHEET_CELL_CAP`); an over-cap
  sheet is listed but carries no cells. A file over `SHEET_FILE_MAX` (csv 5 MB, xlsx
  3 MB) is flagged `tooLarge` and falls back to the existing view.

### 2. Edit eligibility (checked on open)

- **CSV:** always editable (if it decodes as text and is under the size cap).
- **XLSX:** server loads the file with ExcelJS and does an in-memory dry-run write, then
  compares the zip part lists and per-sheet merges/column widths.
  - Nothing lost → editable.
  - Only harmless parts lost (`xl/printerSettings/*`, `customXml/*`) → editable.
  - Anything else lost (charts, drawings, pivots, threaded-comment persons, merges, links to
    places in the workbook, Excel extensions such as sparklines, Excel tables, …) →
    read-only, with a banner naming what would be lost. Download still available.
  - Defined names are not compared but carried over: the save writes the source's own
    `<definedNames>` (see "Decisions made during implementation").
  - No visible sheet small enough for the grid → read-only without a dry run.
  - ExcelJS can't load it → today's "No preview" panel with Download. (Viewing these is
    out of scope.)
- Result is cached per path + mtime so re-opening a tab doesn't repeat the dry run.

### 3. Editing

- **Edit** button in the file bar switches the grid to editable; **Save** (and Ctrl+S) and
  **Done** appear. **Done** replaces the earlier "Discard": it leaves edit mode. Tab/Enter/arrows move like
  Excel; typed text is coerced like Excel (numbers, `dd/mm/yyyy` dates).
- Right-click a row header → Insert row above / Insert row below / Delete row.
  Inserted rows copy the formatting of the row the user clicked (the op's `like`): cell
  styles, height, dropdown coverage and conditional-format coverage, never values or merges.
- **Changed cells are highlighted until saved.** A save clears the undo history (the file
  on disk is the new baseline).
- **Tab state.** The existing "changed on disk" mark keeps its meaning (it is now a small `--brand`
  ring after the name, not a ●). A new `.unsaved` tab state, a filled dot in the × slot, marks a tab
  holding unsaved grid edits.
- **Switching tabs keeps unsaved edits** (the grid controller is per path) with no prompt.
  Closing a tab, or closing/reloading the page, with unsaved edits asks first
  (`beforeunload` for the page).
- Formula cells are locked in step one (can't be overwritten by accident).
- **Row operations are blocked** (toast with the reason, nothing applied) when the workbook
  contains any formulas, or the sheet has tables or images. Formulas can reference rows on
  other sheets and ExcelJS does not rewrite them; tables/images are anchored to rows we do
  not move. Merges, list validation and conditional formatting *are* shifted by our own
  model-level row shift (ExcelJS's `spliceRows` is unsafe), so merged ranges no longer
  block row ops. CSV has no such restriction.
- Paste is capped at 20,000 cells.

### 4. Saving

- Client sends an **op list**, not the whole grid. 0-based coordinates:
  `{ path, mtime, ops: [{op:'set', sheet, r, c, v}, {op:'insertRows', sheet, at, n, like},
  {op:'deleteRows', sheet, at, n}] }`. The authoritative op/payload contract lives in the
  implementation plan (`docs/superpowers/plans/2026-10-06-spreadsheet-editor.md`).
- Server re-reads the file from disk under a per-path lock, checks `mtime`, applies ops,
  then **verifies before replacing** (see below), writes a temp file in the same folder,
  copies the current file to the **backup store**, re-checks the original has not changed,
  and renames the temp over the original. Same atomic pattern as task.md writes.
- **Backups live outside the vault**: `sheet-backups/<vault path>` in `SHEET_BACKUP_DIR` (default
  `<app dir>/sheet-backups`; in the container `/app/sheet-backups`, which compose mounts from the host's
  `/opt/vault/board/sheet-backups`), one previous version per file,
  overwritten each save, never synced by Syncthing and never visible on Windows. This
  replaces the earlier `.<name>.prev` dot-file. A **Restore previous version** button in
  the file bar (`POST /api/fs/sheet/restore { path, mtime }`) swaps the backup back in.
  `SheetPayload.backup` carries the backup's
  mtime (null when none).
- **Save-time verification (422).** The written bytes are re-read and compared with the
  expected result before the original is replaced; anything that would lose data is refused with **422** and the original is left untouched.
- **409 → reload and re-apply.** If the file changed on disk since the client's `mtime`,
  the server answers **409**. The client reloads the sheet, re-applies the user's pending
  ops on top, and tells the user (no silent overwrite, no lost edits).
- Other errors: 400 bad op · 404 missing · 413 too big · 500 unexpected. A save body must
  stay under the global `express.json({ limit: '2mb' })`; the client refuses to post over
  1.9 MB.
- XLSX: sets `workbook.calcProperties.fullCalcOnLoad = true` so Excel recalculates
  dependent formulas on next open. Values typed into cells are stored as numbers when
  they parse as a number, otherwise as strings; existing cell style is kept.
- CSV: written back preserving the detected delimiter (`,` `;` tab), quote style (quote
  only where needed, unless the original quoted every field), line endings (CRLF/LF) and
  UTF-8 BOM. Non-UTF-8 files (UTF-16 PowerShell exports) are view-only.
- Needs a real login like upload (localRead is GET-only). Paths go through
  `safeVaultPath`; temp names are dot-files, so Files never lists them.
- Written files must end up uid 1000 (container already runs as 1000:1000);
  `sheet-backups/` is `chown 1000:1000`.

### 5. Components

- **Server (`server.js`, Workbench section):**
  - `GET /api/fs/sheet?path=` → `SheetPayload` (kind, mtime, editable + reason, backup,
    tooLarge, csv dialect, and per sheet: cells, styles, merges, column widths, row
    heights, hidden rows/cols, frozen panes, dropdown lists, conditional formatting,
    `readOnly` / `rowOps` reasons).
  - `POST /api/fs/sheet/save` → applies ops, returns the fresh `SheetPayload`.
  - `POST /api/fs/sheet/restore` → restores the previous version, returns the fresh payload.
  - Heavy logic lives in **`lib/`** (only `server.js` was bind-mounted before, so the
    Dockerfile gains `COPY lib ./lib` and compose gains a `lib` mount;
    `server.js` `require`s `lib/*` lazily so a missing mount cannot stop the board
    booting). Modules: `sheet-csv.js` (decode/parse/serialise), `sheet-style.js` (colours,
    CSS), `sheet-values.js` (display/edit text, coercion), `sheet-xlsx.js` (load, model,
    eligibility, ops, verified write), `sheet-store.js` (guarded read, lock, atomic replace,
    backups, eligibility cache), each testable alone.
  - `fsKind()` gains `sheet` for `.csv`/`.xlsx` (with an icon), so `/api/fs/file` keeps
    working for Source view.
- **Client — our own grid, not Jspreadsheet CE** (decided during planning; the earlier
  draft of this spec vendored Jspreadsheet CE). Research found CE has **no frozen rows**
  (12 of Ben's files freeze headers), **wipes all merges** on a row insert/delete near one
  (19 files have merges), only supports **whole-column dropdowns** (Ben's list validation
  is a cell range), and its **undo fires no events**, so changed-cell tracking and the
  `.unsaved` state would be guesswork. So:
  - `public/sheet-core.js` (UMD, no DOM, no ExcelJS): A1 parsing, range shifting, formula
    re-anchoring, client-side op application with changed-cell tracking, conditional-format
    evaluation, list matching. Shared with the server tests.
  - `public/sheet-grid.js`: the grid component (render, selection, keyboard, editor,
    dropdowns, clipboard, undo, row menu, sheet tabs, formula bar).
  - `public/sheet-files.js`: Files glue (per-path controllers, file-bar buttons,
    Edit/Save/Done/Restore, banners, save queue, 409 flow, dirty/`beforeunload`).
  - `workbench.js` / `index.html` / `styles.css` get small hooks, script tags and grid
    styles. No CDN, bundler or new front-end dependency; classic `<script>` tags.
- **Dependencies:** `exceljs@4.4.0` and `jszip` added to `package.json` (one deduped
  `jszip`); the image is rebuilt once (`docker compose build board && docker compose up -d
  board`). Check `docker exec vault-board ps` first — a restart kills live terminals.
  Development happens in a git worktree (`/opt/vault/board-sheets`, branch `sheets`) and a
  separate preview container on `127.0.0.1:7690` whose vault is a **synthetic sandbox**
  (`scripts/sheet-sandbox.js`, invented content) and whose `config.json` is freshly generated, so the
  live board, its config and the real vault are untouched until release. No real vault file is ever copied
  into the preview.

### 6. Theming / mobile

- Grid chrome (headers, gridlines, selection, changed-cell highlight) uses VaultOS tokens
  so it works in Dark and Sepia; cell fills/fonts read from the file are inline per cell
  and shown as the file has them (the one exception to "no bare colours").
- Phone: grid scrolls and is viewable; editing works but is desktop-first (≤700px styles).

### 7. Testing

- `node:test` suites in `test/*.test.js`, run in a throwaway `node:22-bookworm-slim`
  container (`node --test 'test/*.test.js'`). Workbooks are **generated with ExcelJS** in
  `test/fixtures.js` (no vault content committed); a separate corpus sweep (`scripts/sheet-corpus.js`)
  reads the real vault **mounted read-only** and prints paths, verdicts and counts only, never contents:
  - eligibility verdicts for the real files match the evidence table above (final counts on
    2026-10-06: xlsx 27 editable / 3 view-only / 3 unreadable, 39 editable csv);
  - set/insert/delete ops round-trip and keep styles/merges/lists/CF on an untouched sheet;
  - row ops blocked when the workbook has formulas or the sheet has tables/images;
  - 409 on stale mtime; backup written; temp file cleaned up on failure; 422 on a lossy save;
  - CSV: delimiter, quoting, CRLF and BOM preserved byte-for-byte for an unchanged file,
    and only the edited field changes for an edited one.
- HTTP smoke and puppeteer end-to-end scenarios run against the **preview container**
  (`127.0.0.1:7690`; its synthetic vault under `/opt/vault/sheet-preview/` is reset to pristine
  before each run), with its own freshly generated config and `sessionSecret` (nothing copied from
  the live `config.json`) so a preview cookie is worthless on the live board.
- Visual check with the `claude-in-chrome` skill (open, edit, save, reload, Sepia theme,
  phone width), screenshots before/after, per the app's `CLAUDE.md`.

## Out of scope (step one)

Formatting controls, editing formulas, adding/removing/renaming sheets, column
insert/delete, viewing files ExcelJS can't read, `.xls`/`.ods`, multi-user live editing.

## Amendments (2026-10-06, after planning research)

Approved by Ben; the sections above already reflect them.

1. **Own grid** (`public/sheet-grid.js` + `public/sheet-core.js`) instead of Jspreadsheet CE:
   CE has no frozen rows, wipes all merges on a nearby row insert/delete, only does
   whole-column dropdowns, and its undo fires no events.
2. **Backups outside the vault** (`sheet-backups/`) plus **Restore previous version**,
   replacing `.prev` files (which Syncthing would sync and Windows would show).
3. **`lib/`** holds the server modules; the Dockerfile copies it and compose mounts it.
4. **`.unsaved`** tab state, distinct from the existing ● (changed on disk).
5. **Save / Done** replaces Save / Discard.
6. **Switching tabs keeps unsaved edits** (no prompt); closing a tab or the page asks.
7. **A save clears undo history;** changed cells stay highlighted until saved.
8. **Conditional formatting display subset:** `cellIs` + simple `REF op LITERAL` expressions.
9. **Row-insert formatting** copies from row `like` (styles, height, lists, CF; no values
   or merges).
10. **Row ops blocked** when the workbook has formulas or the sheet has tables/images
    (replacing "merges or formulas at or below the row").
11. **Caps:** 60,000 cells per grid sheet, csv 5 MB / xlsx 3 MB, paste 20,000 cells,
    save body under 1.9 MB client-side (2 MB server limit).
12. **Save-time verification** (422 on anything that would lose data) and **409 →
    reload-and-re-apply**.
13. **Op/payload contract** (`SheetPayload`, `Op`, error codes) is defined in the plan
    (`docs/superpowers/plans/2026-10-06-spreadsheet-editor.md`); this spec does not
    duplicate it.

## Decisions made during implementation

What changed behaviour after the amendments above, and why. The implementation plan's shapes gained
`saveId` (request), `lastWrite: { id }` (payload), the `{ …, saved: true, reload: true }` fallback answer
and the Sheet's `locked` rectangles on top.

- **Preview:** a synthetic sandbox vault and a freshly generated config; no real file is copied into it.
  Real files are covered only by the read-only corpus sweep.
- **Dropdowns are strict only when the file says so:** a list rejects other text only when the validation
  has Excel's error alert on (`showErrorMessage="1"`); otherwise any text is accepted, as in Excel.
- **An unchanged commit is not a write** (an `[h]:mm` duration or rich text would otherwise be rewritten),
  and a text cell stays text when a number is typed into it (ticket numbers, `007`).
- **Too big is never editable:** over 60,000 cells makes a CSV view-only and an xlsx *sheet* "Too large for
  the grid" with Download; an xlsx where no visible sheet fits is view-only without a dry run. An xlsx over
  3 MB isn't parsed at all: ExcelJS parses and dry-run writes on the event loop, and a 10 MB workbook held
  every other request (terminals included) for seconds. A workbook with no visible sheet counts as unreadable.
- **Eligibility grew stricter**: view-only for shapes inside a surviving drawing, notes, page breaks, hidden
  or grouped rows, dropdowns that depend on other cells and rules bounded by cells, any validation ExcelJS
  would rewrite (raw-XML check), links to places in the workbook (`<hyperlink location=…>`: ExcelJS drops
  them), Excel extensions it doesn't write back (sparklines, the x14 half of a data bar, …; two
  `workbook.xml` settings that carry nothing, chart tracking and calc features, are ignored), and any Excel
  table whose part (ref, header and totals row counts, column names) wouldn't come back the same. A one-cell
  merge still counts as a loss, so `LIG Safeguard … v0.3` stays view-only.
- **Carried over, not refused:** `docProps/custom.xml` and `docMetadata/*` (SharePoint metadata, sensitivity
  labels) are copied into the output, which keeps `Environment Build Action List.xlsx` editable. **Defined
  names** too: ExcelJS turns a dynamic name into a broken reference, drops constants and whole-column names,
  and strips every name's scope and flags (two sheets' hidden `_xlnm._FilterDatabase` names merge into one),
  so a save writes the source's own `<definedNames>`, each name's attributes as they were and its formula
  moved through the save's row operations (every row follows its target, whole rows included; a print area
  loses an area a delete takes). A name that points at no shifted sheet keeps its bytes, and the output is
  checked to hold exactly the names meant ("named ranges" otherwise).
- **Excel tables:** ExcelJS reads a table with no `headerRowCount` (Excel's default, 1) as headerless and
  would write it back with `headerRowCount="0"`; the table parts are read to fix that. The header and totals
  rows are locked (the payload's `locked`, the grid's explanation, a 400 from the server), because the table
  part keeps the column names and totals too and Excel repairs a file where they disagree.
- **Row operations:** row-insert formatting comes from `like` (styles, height, outline level, dropdown and
  colour-rule coverage), a validation spanning the rows above and below grows over the new row, the freeze
  line follows inserted/deleted rows, and a save is capped at 200 row ops / 5,000 rows. Row ops are also
  refused when another sheet's dropdowns or colour rules point at the sheet.
- **Validations are written as non-overlapping ranges** because ExcelJS sorts addresses as strings and
  wrote overlapping ones. The action list's 2 validation elements become 14: same cells, valid, not overlapping.
- **Save lifecycle:** Save is enabled by an open cell draft as well as by changes, undo is paused while a
  save is in flight, and replay reports skipped edits. A save whose answer is lost is judged by its `saveId`
  against the payload's `lastWrite`, never by guessing from the backup; anything unproven keeps every edit
  and shows the conflict banner, worded "Your save may have gone through …" when the file moved and nothing
  says whose change it is. Saves time out at 120 s. The sheet GET takes the per-path lock.
- **Files UI:** the button reads **Restore previous version** ("Restore" on a phone); tab marks are a filled
  dot (unsaved) and a ring (changed on disk); on touch the selected rows' numbers grow into a ≥ 32 px band
  while other row numbers keep their row height (adjacent 20 px rows can't all be 32 px).
- **Server hygiene:** every body-parser error (too large, malformed JSON, an unsupported charset or
  Content-Encoding) answers JSON with its status, never Express's HTML stack page; the "save in smaller
  steps" text is only for the sheet routes. A failure after the file was written answers 200
  `{ saved: true, reload: true }`, never "the file wasn't changed"; GET and save share one edit verdict;
  `/api/fs/file` keeps `kind: 'sheet'` for CSVs over 1 MB or UTF-16.
