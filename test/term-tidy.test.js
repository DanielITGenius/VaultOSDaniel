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

// Cursor wrapping near (not at) the edge of a wide terminal, with a command
// block in the same selection: the prose is rejoined, the commands are not.
const MIXED = [
  '  3. Testing restores matters as much as taking backups, because unverified copies can be incomplete, encrypted, or outdated, and discovering that',
  '     only during an incident wastes time when every hour of downtime already costs money and trust.',
  '',
  '  If you had to choose one control to improve first after reading this, would you tighten firewall rules, schedule verified backups, or both, and',
  '  why for your environment?',
  '',
  '  Get-ChildItem C:\\Windows\\Temp | Where-Object { $_.Length -gt 1MB } | Sort-Object Length -Descending',
  '  Get-Service | Where-Object { $_.Status -eq \'Running\' } | Select-Object Name, DisplayName',
].join('\n');

test('Cursor prose near the edge rejoins even with commands in the selection', () => {
  const got = tidySelection(MIXED, 160).split('\n');
  assert.equal(got.length, 6);
  assert.match(got[0], /discovering that only during an incident/);
  assert.match(got[2], /or both, and why for your environment\?$/);
  assert.match(got[4], /^Get-ChildItem .* -Descending$/);
  assert.match(got[5], /^Get-Service /);
});

test('a list item that ends near the margin is not glued to the next item', () => {
  const sel = [
    '  1. Backups matter because hardware fails, people delete files by mistake, and ransomware can lock systems overnight, so a',
    '     recent restore point is often the only practical way to recover without paying or rebuilding from scratch under pressure.',
    '  2. Regular backups also protect business continuity when a laptop is lost, a cloud account is compromised, or a bad update',
  ].join('\n');
  const got = tidySelection(sel, 200).split('\n');
  assert.equal(got.length, 2);
  assert.match(got[1], /^2\. Regular/);
});

test('a drag that starts at the first word still dedents and rejoins hanging indents', () => {
  const sel = [
    'Verified backups first — then tighten firewall rules once restore is proven.',
    '',
    '  1. Scheduled backups with a clear retention window',
    '  2. Restore tests on a real file/system (not just “job succeeded”) so the team knows that the copies are really there',
    '  3. Then firewall/egress hardening so approved apps still work for every team and every office and unnecessary',
    '     exposure shrinks',
  ].join('\n');
  assert.equal(tidySelection(sel, 160), [
    'Verified backups first — then tighten firewall rules once restore is proven.',
    '',
    '1. Scheduled backups with a clear retention window',
    '2. Restore tests on a real file/system (not just “job succeeded”) so the team knows that the copies are really there',
    '3. Then firewall/egress hardening so approved apps still work for every team and every office and unnecessary exposure shrinks',
  ].join('\n'));
  // A deeper shared indent is real code indentation, not a gutter.
  assert.equal(tidySelection('def main():\n      print(1)\n      return 2', 120), 'def main():\n      print(1)\n      return 2');
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
