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
 *   A tab named "checks" with two columns: `hash` and `report`.
 *   `hash` is SHA-256 of the report's *shape* — the report minus the lines that
 *   change on every run (timestamps, visit counts, page URL, window size), with
 *   key presses reduced to the distinct set. The page builds the shape; see
 *   VOLATILE in check/index.html. A report whose shape is already in the sheet
 *   is not stored again; the page is told which row already holds it.
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
const HEADERS = ['hash', 'report'];
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
      const existing = findHash(sheet, hash);
      if (existing) return reply({ ok: true, duplicate: true, row: existing });
      sheet.appendRow([hash, cell(data.report)]);
      return reply({ ok: true, duplicate: false, row: sheet.getLastRow() });
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
  }
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
