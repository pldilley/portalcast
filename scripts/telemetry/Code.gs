/** @OnlyCurrentDoc */
/*
 * The line above limits this script's permission to the one Sheet it is
 * attached to — it cannot open or change any other file in the account.
 */

/**
 * PortalCast report collector — a Google Apps Script web app that appends each
 * report it receives as one row of the Google Sheet it is attached to.
 * No server of our own, free at our volume. Plan §12.
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
 *   Deploy → Manage deployments → pencil → Version: "New version" → Deploy.
 *   This keeps the same /exec URL. "New deployment" would mint a new URL and
 *   break every page that points at the old one.
 *
 * WHAT IT RECORDS — and deliberately does not
 *   Only what the page sends: device capabilities and the /check report text.
 *   Apps Script does not expose the sender's IP address to the script, so it
 *   cannot be stored here even by accident. No identifiers are created.
 *
 * The URL is public, so anyone could post to it. Requests that do not look
 * like a report are rejected, and every cell is size-capped and neutralised
 * against spreadsheet formula injection.
 */

const SHEET_NAME = 'reports';
const MAX_REQUEST_CHARS = 100000;
const MAX_CELL_CHARS = 45000;      // Sheets' hard limit is 50,000 per cell
const ALLOWED_KINDS = ['check'];   // add 'device-report' when the live app sends them (plan §12)
const SUMMARY_KEYS = [
  'userAgent', 'localStorage', 'survivedRestart', 'visits', 'fragmentSurvived',
  'getRandomValues', 'aesGcm', 'videoCodecs', 'audioCodecs', 'keyPresses',
];
const HEADERS = ['received', 'kind', 'version', 'label'].concat(SUMMARY_KEYS, ['report']);

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

    const summary = data.summary || {};
    const row = [new Date(), data.kind, data.v, cell(data.label)]
      .concat(SUMMARY_KEYS.map(function (k) { return cell(summary[k]); }))
      .concat([cell(data.report)]);

    // Serialise writers so the reported row number is the one we wrote.
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet();
      sheet.appendRow(row);
      const n = sheet.getLastRow();
      // The report is ~80 lines, which would make the row huge and push every
      // other value to the bottom of its cell, out of sight. Keep each row one
      // line high and top-aligned; click the report cell to read it in full.
      sheet.getRange(n, 1, 1, HEADERS.length).setVerticalAlignment('top');
      sheet.setRowHeightsForced(n, 1, 21);
      return reply({ ok: true, row: n });
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
  if (d.summary !== undefined && (typeof d.summary !== 'object' || d.summary === null)) return 'bad summary';
  if (d.label !== undefined && typeof d.label !== 'string') return 'bad label';
  return '';
}

/**
 * Stringify, cap the length, and stop user-supplied text being run as a
 * formula: a cell starting with = + - @ is executed by Sheets unless prefixed
 * with an apostrophe.
 */
function cell(value) {
  if (value === undefined || value === null) return '';
  let s = typeof value === 'string' ? value : JSON.stringify(value);
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
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
