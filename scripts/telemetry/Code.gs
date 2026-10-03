/** @OnlyCurrentDoc */
/*
 * The line above limits this script's permission to the one Sheet it is
 * attached to — it cannot open or change any other file in the account.
 */

/**
 * PortalCast report collector — a Google Apps Script web app that stores each
 * distinct report it receives as one row of the Google Sheet it is attached to.
 * No server of our own, free at our volume. Plan §12.
 *
 * THE SHEET
 *   A tab named "checks", one row per *device type* (browser + TV model):
 *     hash      SHA-256 of the report's shape — the report minus anything that
 *               changes per run or needs someone to act (see EXCLUDED_FROM_SHAPE
 *               in check/index.html). Same browser on same model = same hash.
 *     report    the first full report received for that hash.
 *     storage survives, fragment survives, fullscreen, wake lock
 *               results that need a person to act (restart, press a button).
 *               Filled in as runs report them: blank = never tested; a value
 *               that disagrees with an earlier one becomes "mixed".
 *     keys      every distinct remote button seen across all runs.
 *   A report whose hash is already present updates that row instead of adding
 *   one, and the page is told what changed.
 *
 * SETUP (one-off, about 5 minutes, in the owner's Google account)
 *   1. Create a Google Sheet (sheets.new). Name it e.g. "PortalCast reports".
 *   2. In the Sheet: Extensions → Apps Script. Replace the contents of Code.gs
 *      with this file and save.
 *   3. Deploy → New deployment → gear icon → "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Deploy, then approve the permission prompt (it only needs this Sheet).
 *   4. Copy the Web app URL (ends in /exec). That is REPORT_ENDPOINT in
 *      check/index.html.
 *
 * UPDATING THIS SCRIPT LATER
 *   Paste the new code and save, then Deploy → Manage deployments → pencil →
 *   Version: "New version" → Deploy. This keeps the same /exec URL.
 *   "New deployment" would mint a new URL and break every page using the old one.
 *
 * WHAT IT RECORDS — and deliberately does not
 *   Only the report the page sends: device capabilities and the remote-button
 *   log. Apps Script does not expose the sender's IP address to the script, so
 *   it cannot be stored here even by accident. No identifiers are created.
 *
 * The URL is public, so anyone could post to it. Requests that do not look
 * like a report are rejected, and every cell is size-capped and neutralised
 * against spreadsheet formula injection.
 */

const SHEET_NAME = 'checks';
const OUTCOMES = [
  // [payload key, column header]
  ['storageSurvives', 'storage survives'],
  ['fragmentSurvives', 'fragment survives'],
  ['fullscreen', 'fullscreen'],
  ['wakeLock', 'wake lock'],
];
const OUTCOME_VALUES = ['', 'yes', 'no', 'granted', 'refused', 'unsupported'];
const HEADERS = ['hash', 'report'].concat(OUTCOMES.map(function (o) { return o[1]; }), ['keys']);
const KEYS_COL = HEADERS.length;   // last column
const MAX_KEYS = 200;
const MAX_REQUEST_CHARS = 100000;
const MAX_CELL_CHARS = 45000;      // Sheets' hard limit is 50,000 per cell
const ALLOWED_KINDS = ['check'];   // add 'device-report' when the live app sends them (plan §12.3)

function doPost(e) {
  try {
    // The page sends JSON as the raw body; its no-CORS fallback sends a form
    // field named "payload" instead. Accept either.
    const raw = (e && e.parameter && e.parameter.payload) ||
                (e && e.postData && e.postData.contents) || '';
    if (!raw) return reply({ ok: false, error: 'empty request' });
    if (raw.length > MAX_REQUEST_CHARS) return reply({ ok: false, error: 'too large' });

    let data;
    try { data = JSON.parse(raw); } catch (_) { return reply({ ok: false, error: 'not JSON' }); }

    const problem = validate(data);
    if (problem) return reply({ ok: false, error: problem });

    const hash = sha256Hex(data.kind + '\n' + data.shape);

    // Serialise writers so two identical reports arriving together cannot both
    // pass the duplicate check, and so the row number we report is ours.
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet();
      const outcomes = data.outcomes || {};
      const keys = data.keys || [];
      const existing = findHash(sheet, hash);

      if (!existing) {
        sheet.appendRow([hash, cell(data.report)]
          .concat(OUTCOMES.map(function (o) { return outcomes[o[0]] || ''; }))
          .concat([cell(mergeKeys('', keys))]));
        return reply({ ok: true, duplicate: false, row: sheet.getLastRow() });
      }

      // Same device type: fill in what this run learned, report what changed.
      const range = sheet.getRange(existing, 1, 1, HEADERS.length);
      const row = range.getValues()[0];
      const updated = [];
      OUTCOMES.forEach(function (o, i) {
        const col = 2 + i;   // 0-based index into row
        const merged = mergeOutcome(String(row[col] || ''), outcomes[o[0]] || '');
        if (merged !== String(row[col] || '')) { row[col] = merged; updated.push(o[1]); }
      });
      const keysBefore = String(row[KEYS_COL - 1] || '');
      const keysAfter = cell(mergeKeys(keysBefore, keys));
      if (keysAfter !== keysBefore) { row[KEYS_COL - 1] = keysAfter; updated.push('keys'); }
      if (updated.length) range.setValues([row]);
      return reply({ ok: true, duplicate: true, row: existing, updated: updated });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return reply({ ok: false, error: 'server error: ' + err });
  }
}

/** Opening the /exec URL in a browser shows this, which confirms the deployment is live. */
function doGet() {
  return ContentService.createTextOutput('PortalCast report collector is running. Reports are sent by POST.');
}

function validate(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'not an object';
  if (d.v !== 1) return 'unsupported version';
  if (ALLOWED_KINDS.indexOf(d.kind) === -1) return 'unknown kind';
  if (typeof d.report !== 'string' || !d.report) return 'missing report';
  if (typeof d.shape !== 'string' || !d.shape) return 'missing shape';
  if (d.outcomes !== undefined) {
    if (typeof d.outcomes !== 'object' || d.outcomes === null || Array.isArray(d.outcomes)) return 'bad outcomes';
    for (let i = 0; i < OUTCOMES.length; i++) {
      const v = d.outcomes[OUTCOMES[i][0]];
      if (v !== undefined && OUTCOME_VALUES.indexOf(v) === -1) return 'bad outcome value';
    }
  }
  if (d.keys !== undefined) {
    if (!Array.isArray(d.keys) || d.keys.length > MAX_KEYS) return 'bad keys';
    for (let j = 0; j < d.keys.length; j++) {
      if (typeof d.keys[j] !== 'string' || d.keys[j].length > 200) return 'bad keys';
    }
  }
  return '';
}

/** Row number (1-based) of the first data row whose hash matches, or 0. */
function findHash(sheet, hash) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const hashes = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i][0] === hash) return i + 2;
  }
  return 0;
}

/**
 * Blank never overwrites a known result; the first result fills a blank; a
 * later result that disagrees means this device type behaves inconsistently.
 */
function mergeOutcome(old, incoming) {
  if (!incoming) return old;
  if (!old) return incoming;
  if (old === incoming || old === 'mixed') return old;
  return 'mixed';
}

/** Union of newline-separated key lines, sorted. */
function mergeKeys(oldText, incoming) {
  const set = {};
  String(oldText || '').split('\n').forEach(function (k) { if (k) set[k.replace(/^'/, '')] = 1; });
  incoming.forEach(function (k) { if (k) set[k] = 1; });
  return Object.keys(set).sort().slice(0, MAX_KEYS).join('\n');
}

function sha256Hex(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * Cap the length, and stop user-supplied text being run as a formula: a cell
 * starting with = + - @ is executed by Sheets unless prefixed with an apostrophe.
 */
function cell(value) {
  let s = String(value);
  if (s.length > MAX_CELL_CHARS) s = s.slice(0, MAX_CELL_CHARS) + ' …[truncated]';
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else {
    // Keep the header current when columns are added (older rows simply have
    // blanks in the new columns).
    const header = sheet.getRange(1, 1, 1, HEADERS.length);
    if (header.getValues()[0].join('|') !== HEADERS.join('|')) header.setValues([HEADERS]);
  }
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
