'use strict';

// ---------- Storage ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }
};

const DEFAULT_META = {
  modes: ['UPI', 'Cash'],
  accounts: ['AXIS', 'SBI', 'NA'],
  expenseTypes: ['Monthly Expense', 'Sadqah', 'Investment'],
  subCategories: ['Household', 'Travel', 'Education', 'Medical Support', 'Recreational', 'Fitness', 'EMI'],
  frequencies: ['One-time', 'Monthly']
};

const state = {
  config: store.get('config', { apiUrl: '', token: '' }),
  meta: store.get('meta', DEFAULT_META),
  month: currentMonth(),
  tx: [],            // transactions for state.month
  queue: store.get('queue', []), // pending adds while offline
  view: 'add'
};

// ---------- Utils ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const fmt = n => inr.format(n).replace(/\.00$/, '');

function pad(n) { return String(n).padStart(2, '0'); }
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function currentMonth() { return today().slice(0, 7); }
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function dayName(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (iso === today()) return 'Today';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (date.toDateString() === yest.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- API ----------
function configured() { return !!(state.config.apiUrl && state.config.token); }

async function api(action, payload = {}) {
  if (!configured()) throw new Error('Not set up');
  const { apiUrl, token } = state.config;
  let res;
  if (action === 'meta' || action === 'list' || action === 'ping') {
    const qs = new URLSearchParams({ action, token, ...payload });
    res = await fetch(`${apiUrl}?${qs}`, { redirect: 'follow' });
  } else {
    // text/plain avoids a CORS preflight, which Apps Script does not support.
    res = await fetch(apiUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, ...payload })
    });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

// ---------- Offline queue ----------
function saveQueue() { store.set('queue', state.queue); updateSyncBadge(); }

function updateSyncBadge() {
  const el = $('#sync');
  if (state.queue.length) { el.hidden = false; el.textContent = `${state.queue.length} to sync`; }
  else el.hidden = true;
}

let flushing = false;
async function flushQueue() {
  if (flushing || !state.queue.length || !configured()) return;
  flushing = true;
  try {
    while (state.queue.length) {
      await api('add', { data: state.queue[0] });
      state.queue.shift();
      saveQueue();
    }
    toast('Synced');
    await loadMonth(false);
  } catch (e) {
    // still offline or server error; try later
  } finally {
    flushing = false;
  }
}

// ---------- Data loading ----------
async function loadMeta() {
  try {
    const meta = await api('meta');
    state.meta = { ...DEFAULT_META, ...meta };
    store.set('meta', state.meta);
    renderAddForm(true);
  } catch { /* use cached */ }
}

async function loadMonth(useCache = true) {
  const key = `tx:${state.month}`;
  if (useCache) {
    state.tx = store.get(key, []);
    renderMonthViews();
  }
  if (!configured()) return;
  try {
    const month = state.month;
    const tx = await api('list', { month });
    if (month !== state.month) return; // user moved on
    state.tx = tx;
    store.set(key, tx);
    renderMonthViews();
  } catch (e) {
    if (!useCache) toast(`Could not load: ${e.message}`);
  }
}

// ---------- Form ----------
function chipGroup(name, options, selected) {
  return `<div class="chips" data-group="${name}">${options.map(o =>
    `<button type="button" class="chip${o === selected ? ' on' : ''}" data-value="${esc(o)}">${esc(o)}</button>`
  ).join('')}</div>`;
}

function formHtml(tx, isEdit) {
  const m = state.meta;
  const last = store.get('lastChoices', {});
  const v = tx || {
    date: today(), amount: '', summary: '',
    mode: last.mode || m.modes[0], account: last.account || m.accounts[0],
    expenseType: last.expenseType || m.expenseTypes.find(t => /monthly/i.test(t)) || m.expenseTypes[0],
    subCategory: last.subCategory || '', frequency: 'One-time'
  };
  const subs = [...new Set([...(v.subCategory ? [v.subCategory] : []), ...m.subCategories])];
  const summaries = [...new Set(state.tx.map(t => t.summary))].slice(0, 50);
  return `
    ${isEdit ? '<h2 style="margin:0">Edit expense</h2>' : ''}
    <input class="amount-input" name="amount" type="number" inputmode="decimal" step="0.01" min="0.01"
      placeholder="₹0" value="${esc(v.amount)}" required>
    <label>Summary<input name="summary" list="summaryList" placeholder="e.g. Auto to office" value="${esc(v.summary)}" required></label>
    <datalist id="summaryList">${summaries.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="row">
      <label>Date<input name="date" type="date" value="${esc(v.date)}" required></label>
      <label>Sub category<select name="subCategory">
        <option value="">—</option>
        ${subs.map(s => `<option${s === v.subCategory ? ' selected' : ''}>${esc(s)}</option>`).join('')}
      </select></label>
    </div>
    <label>Expense type</label>${chipGroup('expenseType', m.expenseTypes, v.expenseType)}
    <label>Mode</label>${chipGroup('mode', m.modes, v.mode)}
    <label>Account</label>${chipGroup('account', m.accounts, v.account)}
    <label>Frequency</label>${chipGroup('frequency', m.frequencies, v.frequency || 'One-time')}
    <button class="primary" type="submit">${isEdit ? 'Save changes' : 'Add expense'}</button>
    ${isEdit ? `<div class="row"><button type="button" class="secondary" data-act="cancel">Cancel</button>
      <button type="button" class="danger" data-act="delete">Delete</button></div>` : ''}
  `;
}

function readForm(form) {
  const fd = new FormData(form);
  const data = {
    amount: Number(fd.get('amount')),
    summary: String(fd.get('summary') || '').trim(),
    date: fd.get('date'),
    subCategory: fd.get('subCategory') || ''
  };
  $$('.chips', form).forEach(g => {
    const on = $('.chip.on', g);
    data[g.dataset.group] = on ? on.dataset.value : '';
  });
  return data;
}

function bindChips(form) {
  form.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('.chip', chip.parentElement).forEach(c => c.classList.toggle('on', c === chip));
  });
}

function renderAddForm(keepValues) {
  const form = $('#addForm');
  if (keepValues && form.amount && (form.amount.value || form.summary.value)) return; // don't wipe typing
  form.innerHTML = formHtml(null, false);
}

async function submitAdd(e) {
  e.preventDefault();
  const form = e.target;
  const data = readForm(form);
  if (!(data.amount > 0) || !data.summary) return;
  if (!configured()) { toast('Set up the app first'); showView('settings'); return; }

  data.id = uuid();
  store.set('lastChoices', { mode: data.mode, account: data.account, expenseType: data.expenseType, subCategory: data.subCategory });
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    await api('add', { data });
    toast(`Added ${fmt(data.amount)}`);
  } catch (err) {
    if (err.message === 'Unauthorized' || /not set|Sheet not found/i.test(err.message)) {
      toast(err.message); btn.disabled = false; return;
    }
    state.queue.push(data);
    saveQueue();
    toast('Offline: saved, will sync later');
  }
  btn.disabled = false;
  form.innerHTML = formHtml(null, false);
  $('input[name=amount]', form).focus();
  if (data.date.slice(0, 7) === state.month) loadMonth(false);
}

// ---------- Edit dialog ----------
let editing = null;
function openEdit(id) {
  const tx = state.tx.find(t => t.id === id);
  if (!tx) return;
  editing = tx;
  const form = $('#editForm');
  form.innerHTML = formHtml(tx, true);
  $('#editDialog').showModal();
}

async function submitEdit(e) {
  e.preventDefault();
  const form = e.target;
  const data = { ...readForm(form), id: editing.id };
  if (!(data.amount > 0) || !data.summary) return;
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    await api('update', { data });
    $('#editDialog').close();
    toast('Saved');
    loadMonth(false);
  } catch (err) {
    toast(`Not saved: ${err.message}`);
  } finally { btn.disabled = false; }
}

async function deleteEditing() {
  if (!editing) return;
  const btn = $('[data-act=delete]', $('#editForm'));
  if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Tap again to delete'; return; }
  btn.disabled = true;
  try {
    await api('delete', { id: editing.id });
    $('#editDialog').close();
    toast('Deleted');
    loadMonth(false);
  } catch (err) {
    toast(`Not deleted: ${err.message}`);
    btn.disabled = false;
  }
}

// ---------- Month views ----------
function monthTx() {
  const pending = state.queue.filter(q => q.date.slice(0, 7) === state.month).map(q => ({ ...q, pending: true }));
  return [...pending, ...state.tx];
}

function renderMonthViews() {
  const list = monthTx();
  const total = list.reduce((s, t) => s + Number(t.amount || 0), 0);
  $$('.hist-month').forEach(el => el.textContent = monthName(state.month));
  $$('.hist-total').forEach(el => el.textContent = fmt(total));
  renderHistory(list);
  renderSummary(list, total);
}

function renderHistory(list) {
  const q = $('#search').value.trim().toLowerCase();
  if (q) list = list.filter(t => [t.summary, t.expenseType, t.subCategory, t.mode, t.account].join(' ').toLowerCase().includes(q));
  list = [...list].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const el = $('#historyList');
  if (!list.length) { el.innerHTML = `<div class="empty">${configured() ? 'No expenses' : 'Open Settings (gear icon) to connect your Sheet'}</div>`; return; }
  let html = '', day = '';
  const dayTotals = {};
  list.forEach(t => { dayTotals[t.date] = (dayTotals[t.date] || 0) + Number(t.amount); });
  list.forEach(t => {
    if (t.date !== day) {
      day = t.date;
      html += `<div class="day-head"><span>${esc(dayName(day))}</span><span>${fmt(dayTotals[day])}</span></div>`;
    }
    const meta = [t.subCategory, t.expenseType, t.mode].filter(Boolean).join(' · ');
    html += `<button class="tx${t.pending ? ' pending' : ''}" data-id="${esc(t.id)}" ${t.pending ? 'disabled' : ''}>
      <div class="main"><div class="sum">${esc(t.summary)}</div><div class="meta">${esc(meta)}${t.pending ? ' · waiting to sync' : ''}</div></div>
      <div class="amt">${fmt(t.amount)}</div></button>`;
  });
  el.innerHTML = html;
}

function groupBy(list, key) {
  const m = {};
  list.forEach(t => { const k = t[key] || 'Uncategorised'; m[k] = (m[k] || 0) + Number(t.amount); });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function barsCard(title, rows, total) {
  if (!rows.length) return '';
  const max = rows[0][1] || 1;
  return `<div class="card"><h2>${esc(title)}</h2>${rows.map(([k, v]) => `
    <div class="bar-row"><div class="bar-top"><span>${esc(k)} <small style="color:var(--muted)">${Math.round(v / total * 100)}%</small></span><span>${fmt(v)}</span></div>
    <div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>`;
}

function renderSummary(list, total) {
  const el = $('#summaryBody');
  if (!list.length) { el.innerHTML = '<div class="empty">No expenses this month</div>'; return; }
  el.innerHTML =
    barsCard('By expense type', groupBy(list, 'expenseType'), total) +
    barsCard('By sub category', groupBy(list, 'subCategory'), total) +
    barsCard('By mode', groupBy(list, 'mode'), total);
}

// ---------- Export ----------
const IN_APK = /; wv\)/.test(navigator.userAgent);

function toCsv(rows) {
  const cols = [['Date', 'date'], ['Amount', 'amount'], ['Summary', 'summary'], ['Mode', 'mode'],
    ['Account', 'account'], ['Expense Type', 'expenseType'], ['Sub Category', 'subCategory'],
    ['Frequency', 'frequency'], ['ID', 'id']];
  const cell = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [cols.map(c => c[0]).join(','), ...rows.map(t => cols.map(c => cell(t[c[1]])).join(','))].join('\r\n');
}

async function exportTx(scope) {
  if (!configured()) { toast('Set up the app first'); return; }
  const month = scope === 'month' ? state.month : '';
  if (IN_APK) {
    // The Android app hands this link to the browser, which downloads the CSV file.
    const qs = new URLSearchParams({ action: 'export', month, token: state.config.token });
    location.href = `${state.config.apiUrl}?${qs}`;
    toast('Downloading in your browser');
    return;
  }
  try {
    toast('Preparing export…');
    const rows = await api('list', { month });
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-${month || 'all'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Exported ${rows.length} transactions`);
  } catch (e) {
    toast(`Export failed: ${e.message}`);
  }
}

// ---------- Navigation ----------
const TITLES = { add: 'Add expense', history: 'History', summary: 'Summary', settings: 'Settings' };
function showView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#title').textContent = TITLES[name];
  if (name === 'settings') {
    const f = $('#settingsForm');
    f.apiUrl.value = state.config.apiUrl;
    f.token.value = state.config.token;
  }
  history.replaceState(null, '', `#${name}`);
}

async function saveSettings(e) {
  e.preventDefault();
  const f = e.target;
  state.config = { apiUrl: f.apiUrl.value.trim(), token: f.token.value.trim() };
  const msg = $('#settingsMsg');
  msg.textContent = 'Testing…';
  try {
    await api('ping');
    store.set('config', state.config);
    msg.textContent = 'Connected.';
    toast('Connected to your Sheet');
    await loadMeta();
    await loadMonth(false);
    flushQueue();
    showView('add');
  } catch (err) {
    msg.textContent = `Could not connect: ${err.message}`;
  }
}

// ---------- Init ----------
function init() {
  renderAddForm(false);
  bindChips($('#addForm'));
  bindChips($('#editForm'));
  $('#addForm').addEventListener('submit', submitAdd);
  $('#editForm').addEventListener('submit', submitEdit);
  $('#editForm').addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act === 'cancel') $('#editDialog').close();
    if (act === 'delete') deleteEditing();
  });
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#settingsBtn').addEventListener('click', () => showView(state.view === 'settings' ? 'add' : 'settings'));
  $$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-month]').forEach(b => b.addEventListener('click', () => {
    state.month = shiftMonth(state.month, Number(b.dataset.month));
    loadMonth(true);
  }));
  $('#historyList').addEventListener('click', e => {
    const row = e.target.closest('.tx');
    if (row && !row.disabled) openEdit(row.dataset.id);
  });
  $('#search').addEventListener('input', () => renderHistory(monthTx()));
  $('#exportBtn').addEventListener('click', () => $('#exportDialog').showModal());
  $('#exportDialog').addEventListener('click', e => {
    const which = e.target.closest('[data-export]')?.dataset.export;
    if (!which) return;
    $('#exportDialog').close();
    if (which !== 'cancel') exportTx(which);
  });
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { flushQueue(); loadMonth(false); }
  });

  updateSyncBadge();
  const start = location.hash.slice(1);
  showView(!configured() ? 'settings' : (TITLES[start] ? start : 'add'));
  loadMonth(true);
  if (configured()) { loadMeta(); flushQueue(); }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
