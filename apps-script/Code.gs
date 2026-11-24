/**
 * Expense Tracker JSON API (standalone Apps Script).
 *
 * Setup: see README.md, "Apps Script setup".
 * Script Properties needed:
 *   SHEET_ID  - the spreadsheet ID
 *   API_TOKEN - any long random string; the app sends it with every request
 */

var TX_SHEET = 'Transactions';
var RECURRING_SHEET = 'Recurring';
var SETTINGS_SHEET = 'Settings';
var TX_HEADERS = ['ID', 'Date', 'Amount', 'Summary', 'Mode', 'Account', 'Expense Type',
  'Frequency', 'Created At', 'Updated At', 'Sub Category'];
var DEFAULT_SUBCATEGORIES = ['Household', 'Travel', 'Education', 'Medical Support',
  'Recreational', 'Fitness', 'EMI'];

// ---------- HTTP entry points ----------

function doGet(e) {
  return handle_(e.parameter || {});
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON' });
  }
  return handle_(body);
}

function handle_(req) {
  try {
    checkToken_(req.token);
    switch (req.action) {
      case 'meta': return json_({ ok: true, data: getMeta_() });
      case 'list': return json_({ ok: true, data: listTransactions_(req.month) });
      case 'add': return json_({ ok: true, data: withLock_(function () { return addTransaction_(parseData_(req.data)); }) });
      case 'update': return json_({ ok: true, data: withLock_(function () { return updateTransaction_(parseData_(req.data)); }) });
      case 'delete': return json_({ ok: true, data: withLock_(function () { return deleteTransaction_(req.id); }) });
      case 'export': return exportCsv_(req.month);
      case 'ping': return json_({ ok: true, data: 'pong' });
      default: return json_({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- Helpers ----------

function props_() { return PropertiesService.getScriptProperties(); }

function checkToken_(token) {
  var expected = props_().getProperty('API_TOKEN');
  if (!expected) throw new Error('API_TOKEN is not set in Script Properties');
  if (token !== expected) throw new Error('Unauthorized');
}

function ss_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID is not set in Script Properties');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function tz_() { return ss_().getSpreadsheetTimeZone(); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseData_(d) {
  return typeof d === 'string' ? JSON.parse(d) : (d || {});
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function headerMap_(sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) { map[String(h).trim()] = i; });
  return map;
}

// Format a cell value as yyyy-MM-dd if it is a date, else as trimmed text.
function asIsoDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // dd/MM/yyyy
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return s;
}

function toNumber_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function uniq_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (x) {
    x = String(x || '').trim();
    if (x && !seen[x]) { seen[x] = true; out.push(x); }
  });
  return out;
}

// Write dates the same way the sheet already stores them (real date or text).
function columnUsesDates_(sh, colIndex0) {
  var last = sh.getLastRow();
  if (last < 2) return true;
  var v = sh.getRange(last, colIndex0 + 1).getValue();
  return v instanceof Date;
}

function dateValue_(iso, useDate) {
  var p = iso.split('-').map(Number);
  if (useDate) return new Date(p[0], p[1] - 1, p[2]);
  return iso;
}

function stampValue_(useDate, tz) {
  var now = new Date();
  return useDate ? now : Utilities.formatDate(now, tz, 'dd/MM/yyyy');
}

// ---------- Actions ----------

function getMeta_() {
  var settings = sheet_(SETTINGS_SHEET);
  var sv = settings.getDataRange().getValues();
  var sh = sv[0].map(function (h) { return String(h).trim(); });
  function col(name) {
    var i = sh.indexOf(name);
    if (i < 0) return [];
    return uniq_(sv.slice(1).map(function (r) { return r[i]; }));
  }

  var subs = DEFAULT_SUBCATEGORIES.slice();
  var tx = sheet_(TX_SHEET);
  var txMap = headerMap_(tx);
  if (tx.getLastRow() > 1 && txMap['Sub Category'] !== undefined) {
    subs = subs.concat(tx.getRange(2, txMap['Sub Category'] + 1, tx.getLastRow() - 1, 1)
      .getValues().map(function (r) { return r[0]; }));
  }
  var rec = ss_().getSheetByName(RECURRING_SHEET);
  if (rec && rec.getLastRow() > 1) {
    var rMap = headerMap_(rec);
    if (rMap['Sub Category'] !== undefined) {
      subs = subs.concat(rec.getRange(2, rMap['Sub Category'] + 1, rec.getLastRow() - 1, 1)
        .getValues().map(function (r) { return r[0]; }));
    }
  }

  return {
    modes: col('Mode'),
    accounts: col('Account'),
    expenseTypes: col('Expense Type'),
    subCategories: uniq_(subs).sort(),
    frequencies: ['One-time', 'Monthly']
  };
}

function rowToTx_(row, map, tz) {
  return {
    id: String(row[map['ID']] || ''),
    date: asIsoDate_(row[map['Date']], tz),
    amount: toNumber_(row[map['Amount']]),
    summary: String(row[map['Summary']] || ''),
    mode: String(row[map['Mode']] || ''),
    account: String(row[map['Account']] || ''),
    expenseType: String(row[map['Expense Type']] || ''),
    frequency: String(row[map['Frequency']] || ''),
    subCategory: map['Sub Category'] !== undefined ? String(row[map['Sub Category']] || '') : '',
    createdAt: asIsoDate_(row[map['Created At']], tz),
    updatedAt: asIsoDate_(row[map['Updated At']], tz)
  };
}

/** month: 'yyyy-MM' to filter, or empty for all rows. */
function listTransactions_(month) {
  var sh = sheet_(TX_SHEET);
  if (sh.getLastRow() < 2) return [];
  var map = headerMap_(sh);
  var tz = tz_();
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  values.forEach(function (row) {
    if (!row[map['ID']]) return;
    var tx = rowToTx_(row, map, tz);
    if (month && tx.date.slice(0, 7) !== month) return;
    out.push(tx);
  });
  out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return out;
}

function validate_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw new Error('Date must be yyyy-MM-dd');
  var amt = Number(d.amount);
  if (!(amt > 0)) throw new Error('Amount must be greater than 0');
  if (!String(d.summary || '').trim()) throw new Error('Summary is required');
}

function addTransaction_(d) {
  validate_(d);
  var sh = sheet_(TX_SHEET);
  var map = headerMap_(sh);
  var tz = tz_();

  // Idempotency: the app may retry an offline add; skip if the ID already exists.
  if (d.id && findRow_(sh, map, d.id) > 0) return { id: d.id, duplicate: true };

  var id = d.id || Utilities.getUuid();
  var dateIsDate = columnUsesDates_(sh, map['Date']);
  var stampIsDate = columnUsesDates_(sh, map['Created At']);
  var row = new Array(sh.getLastColumn()).fill('');
  row[map['ID']] = id;
  row[map['Date']] = dateValue_(d.date, dateIsDate);
  row[map['Amount']] = Number(d.amount);
  row[map['Summary']] = String(d.summary).trim();
  row[map['Mode']] = d.mode || '';
  row[map['Account']] = d.account || '';
  row[map['Expense Type']] = d.expenseType || '';
  row[map['Frequency']] = d.frequency || 'One-time';
  row[map['Created At']] = stampValue_(stampIsDate, tz);
  row[map['Updated At']] = stampValue_(stampIsDate, tz);
  if (map['Sub Category'] !== undefined) row[map['Sub Category']] = d.subCategory || '';

  sh.appendRow(row);
  return { id: id };
}

function findRow_(sh, map, id) {
  if (sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2, map['ID'] + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function updateTransaction_(d) {
  if (!d.id) throw new Error('id is required');
  validate_(d);
  var sh = sheet_(TX_SHEET);
  var map = headerMap_(sh);
  var r = findRow_(sh, map, d.id);
  if (r < 0) throw new Error('Transaction not found');
  var tz = tz_();
  var range = sh.getRange(r, 1, 1, sh.getLastColumn());
  var row = range.getValues()[0];
  var dateIsDate = row[map['Date']] instanceof Date || columnUsesDates_(sh, map['Date']);
  var stampIsDate = row[map['Updated At']] instanceof Date;

  row[map['Date']] = dateValue_(d.date, dateIsDate);
  row[map['Amount']] = Number(d.amount);
  row[map['Summary']] = String(d.summary).trim();
  row[map['Mode']] = d.mode || '';
  row[map['Account']] = d.account || '';
  row[map['Expense Type']] = d.expenseType || '';
  row[map['Frequency']] = d.frequency || 'One-time';
  row[map['Updated At']] = stampValue_(stampIsDate, tz);
  if (map['Sub Category'] !== undefined) row[map['Sub Category']] = d.subCategory || '';

  range.setValues([row]);
  return { id: d.id };
}

function deleteTransaction_(id) {
  if (!id) throw new Error('id is required');
  var sh = sheet_(TX_SHEET);
  var map = headerMap_(sh);
  var r = findRow_(sh, map, id);
  if (r < 0) throw new Error('Transaction not found');
  sh.deleteRow(r);
  return { id: id };
}

/** CSV download of transactions; month 'yyyy-MM' or empty for all. */
function exportCsv_(month) {
  var rows = listTransactions_(month);
  var cols = [['Date', 'date'], ['Amount', 'amount'], ['Summary', 'summary'], ['Mode', 'mode'],
    ['Account', 'account'], ['Expense Type', 'expenseType'], ['Sub Category', 'subCategory'],
    ['Frequency', 'frequency'], ['ID', 'id']];
  function cell(v) {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  var lines = [cols.map(function (c) { return c[0]; }).join(',')];
  rows.forEach(function (t) {
    lines.push(cols.map(function (c) { return cell(t[c[1]]); }).join(','));
  });
  var name = 'expenses-' + (month || 'all') + '.csv';
  return ContentService.createTextOutput(lines.join('\r\n'))
    .setMimeType(ContentService.MimeType.CSV)
    .downloadAsFile(name);
}

// ---------- Optional: recurring expenses ----------
// Only use this if your old script does NOT already post recurring rows automatically.
// Run setupDailyTrigger() once to post due "Recurring" rows every morning.

function postRecurring() {
  withLock_(function () {
    var ss = ss_();
    var rec = ss.getSheetByName(RECURRING_SHEET);
    if (!rec || rec.getLastRow() < 2) return;
    var tz = tz_();
    var now = new Date();
    var ym = Utilities.formatDate(now, tz, 'yyyy-MM');
    var today = Number(Utilities.formatDate(now, tz, 'd'));
    var map = headerMap_(rec);
    var range = rec.getRange(2, 1, rec.getLastRow() - 1, rec.getLastColumn());
    var values = range.getValues();
    var display = range.getDisplayValues();

    values.forEach(function (row, i) {
      if (String(row[map['Active']]).trim().toLowerCase() !== 'yes') return;
      var day = Number(row[map['Day of Month']]) || 1;
      var last = String(display[i][map['Last Posted']] || '').trim();
      if (last === ym || today < day) return;

      addTransaction_({
        date: ym + '-' + ('0' + Math.min(day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())).slice(-2),
        amount: toNumber_(row[map['Amount']]),
        summary: row[map['Summary']],
        mode: row[map['Mode']],
        account: row[map['Account']],
        expenseType: row[map['Expense Type']],
        subCategory: row[map['Sub Category']],
        frequency: 'Monthly'
      });
      var cell = rec.getRange(i + 2, map['Last Posted'] + 1);
      cell.setNumberFormat('@').setValue(ym);
    });
  });
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'postRecurring') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postRecurring').timeBased().everyDays(1).atHour(6).create();
}

/** Run once from the editor to check setup. Logs the dropdown options. */
function testSetup() {
  Logger.log(JSON.stringify(getMeta_()));
  Logger.log('Rows this month: ' + listTransactions_(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM')).length);
}
