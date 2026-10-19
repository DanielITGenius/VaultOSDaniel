'use strict';

// tidySelection lives in the browser-only public/term.js; lift its source out
// and evaluate it on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/term.js'), 'utf8');
const body = /^function tidySelection[\s\S]*?^}$/m.exec(src)[0];
const tidySelection = new Function(`${body}; return tidySelection;`)();

// Cursor CLI wraps prose at ~108 cells whatever the terminal width.
const CURSOR = [
  '  Infrastructure side is done (app, consent, audit on, Bitwarden). Goal still includes Infosec wiring Falcon',
  '  and confirming events — that hasn’t happened.',
  '',
  '  Recommendation: don’t mark the vault card done yet. Instead:',
  '  1. Tell Infosec the app is ready (Bitwarden path + that they can attach the connector)',
  '  2. Set status to review or leave it with Infosec as the remaining work',
  '  3. Close only after they confirm M365 events in NG SIEM — or close now if INFOSEC-184 was only the',
  '     Entra/Bitwarden work and Infosec tracks the rest separately',
  '',
  '  Which do you want: hand off to Infosec and park the card, or mark done / close INFOSEC-184 on',
  '  Infrastructure scope only?',
].join('\n');

const CURSOR_TIDY = [
  'Infrastructure side is done (app, consent, audit on, Bitwarden). Goal still includes Infosec wiring Falcon and confirming events — that hasn’t happened.',
  '',
  'Recommendation: don’t mark the vault card done yet. Instead:',
  '1. Tell Infosec the app is ready (Bitwarden path + that they can attach the connector)',
  '2. Set status to review or leave it with Infosec as the remaining work',
  '3. Close only after they confirm M365 events in NG SIEM — or close now if INFOSEC-184 was only the Entra/Bitwarden work and Infosec tracks the rest separately',
  '',
  'Which do you want: hand off to Infosec and park the card, or mark done / close INFOSEC-184 on Infrastructure scope only?',
].join('\n');

test('Cursor CLI prose wrapped short of the edge is rejoined at any width', () => {
  for (const cols of [110, 120, 150, 200, 260]) assert.equal(tidySelection(CURSOR, cols), CURSOR_TIDY, `cols ${cols}`);
});

test('Claude Code wrap at the terminal edge still rejoins', () => {
  const cols = 40;
  const sel = '  Run this to restart the board and then\n  check the logs for errors';
  assert.equal(tidySelection(sel, cols), 'Run this to restart the board and then check the logs for errors');
  assert.equal(tidySelection('  see /opt/vault/board/public/term.js/abc\n  def.js now', 42), 'see /opt/vault/board/public/term.js/abcdef.js now');
});

test('short real lines keep their newlines', () => {
  assert.equal(tidySelection('  docker compose pull\n  docker compose up -d', 160), 'docker compose pull\ndocker compose up -d');
  assert.equal(tidySelection('  First point here.\n  Second point here.', 160), 'First point here.\nSecond point here.');
});

test('a block of long commands of similar length is not glued in a wide terminal', () => {
  const sel = [
    '  docker run -d --name vault-board -p 7684:7684 -v /opt/vault/vault:/vault vault-board:latest',
    '  docker logs --tail 200 --follow vault-board 2>&1 | grep -i error | tee /tmp/board-errors.log',
  ].join('\n');
  assert.equal(tidySelection(sel, 200), sel.replace(/^ {2}/gm, ''));
  const ps = [
    '  Get-ChildItem C:\\Users\\ben\\Downloads | Where-Object { $_.Length -gt 1MB } | Sort-Object Length',
    '  Get-ChildItem C:\\Users\\ben\\Documents | Where-Object { $_.Length -gt 1MB } | Sort-Object Name',
  ].join('\n');
  assert.equal(tidySelection(ps, 200), ps.replace(/^ {2}/gm, ''));
});

test('one long prose line among short ones is not treated as a margin', () => {
  const sel = '  This is a fairly long sentence that ends well short of the edge of the terminal.\n  Next line.';
  assert.equal(tidySelection(sel, 200), 'This is a fairly long sentence that ends well short of the edge of the terminal.\nNext line.');
});
