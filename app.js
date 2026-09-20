/* Job Application Tracker
 * Plain JavaScript, no build step. Data lives in localStorage and can be
 * imported from / exported to JSON at any time.
 */
(function () {
  'use strict';

  // ---------- Configuration ----------

  const STORAGE_KEY = 'jobTracker.applications.v1';
  const THEME_KEY = 'jobTracker.theme';
  const EXPORT_VERSION = 1;

  // Pipeline order matters: it drives sorting, the pipeline chart, and stats.
  const STATUSES = [
    { key: 'Saved',        label: 'Saved',        color: 'var(--s-saved)',     active: true,  responded: false },
    { key: 'Applied',      label: 'Applied',      color: 'var(--s-applied)',   active: true,  responded: false },
    { key: 'Phone Screen', label: 'Phone Screen', color: 'var(--s-screen)',    active: true,  responded: true },
    { key: 'Interviewing', label: 'Interviewing', color: 'var(--s-interview)', active: true,  responded: true },
    { key: 'Offer',        label: 'Offer',        color: 'var(--s-offer)',     active: true,  responded: true },
    { key: 'Accepted',     label: 'Accepted',     color: 'var(--s-accepted)',  active: false, responded: true },
    { key: 'Rejected',     label: 'Rejected',     color: 'var(--s-rejected)',  active: false, responded: true },
    { key: 'Withdrawn',    label: 'Withdrawn',    color: 'var(--s-withdrawn)', active: false, responded: false },
    { key: 'Ghosted',      label: 'Ghosted',      color: 'var(--s-ghosted)',   active: false, responded: false },
  ];
  const STATUS_KEYS = STATUSES.map(s => s.key);
  const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]));
  const DEFAULT_STATUS = 'Applied';
  const PRIORITIES = ['High', 'Medium', 'Low'];
  const WORK_TYPES = ['', 'Remote', 'Hybrid', 'On-site'];

  // Fields that can be edited in the form and are carried through import/export.
  const TEXT_FIELDS = [
    'company', 'role', 'link', 'location', 'workType', 'salary', 'source',
    'contactName', 'contactEmail', 'notes',
  ];
  const DATE_FIELDS = ['dateApplied', 'followUpDate'];

  // ---------- State ----------

  let apps = loadApps();
  let pendingImport = null;
  const ui = {
    search: '',
    status: '',
    sort: 'updated-desc',
    activeOnly: false,
  };

  // ---------- Helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function isISODate(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  }

  function formatDate(iso) {
    if (!isISODate(iso)) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function daysBetween(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch { return ''; }
  }

  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

  // ---------- Data model ----------

  /** Build a clean application record from arbitrary input. Returns null if unusable. */
  function normalize(raw, opts = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const now = new Date().toISOString();

    // Accept a few common aliases so hand-written JSON still imports cleanly.
    const company = str(raw.company ?? raw.employer ?? raw.name ?? raw.appName);
    const role = str(raw.role ?? raw.title ?? raw.position ?? raw.jobTitle);
    if (!company && !role) return null;

    const rec = {
      id: (typeof raw.id === 'string' && raw.id.trim() && !opts.freshId) ? raw.id.trim() : uid(),
      company: company || 'Unknown Company',
      role: role || 'Unknown Role',
      link: str(raw.link ?? raw.url ?? raw.jobLink),
      status: STATUS_KEYS.includes(raw.status) ? raw.status : matchStatus(raw.status) || DEFAULT_STATUS,
      dateApplied: isISODate(raw.dateApplied) ? raw.dateApplied : (isISODate(raw.date) ? raw.date : ''),
      location: str(raw.location),
      workType: WORK_TYPES.includes(raw.workType) ? raw.workType : '',
      salary: str(raw.salary ?? raw.salaryRange ?? raw.compensation),
      source: str(raw.source),
      contactName: str(raw.contactName ?? raw.contact),
      contactEmail: str(raw.contactEmail),
      followUpDate: isISODate(raw.followUpDate) ? raw.followUpDate : '',
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'Medium',
      notes: str(raw.notes),
      createdAt: validTimestamp(raw.createdAt) || now,
      updatedAt: validTimestamp(raw.updatedAt) || now,
      history: [],
    };

    if (Array.isArray(raw.history)) {
      rec.history = raw.history
        .filter(h => h && STATUS_KEYS.includes(h.status) && validTimestamp(h.at))
        .map(h => ({ status: h.status, at: h.at }));
    }
    if (rec.history.length === 0) {
      rec.history.push({ status: rec.status, at: rec.createdAt });
    }
    return rec;
  }

  function str(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function validTimestamp(v) { return (typeof v === 'string' && !Number.isNaN(Date.parse(v))) ? v : ''; }
  function matchStatus(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim().toLowerCase();
    return STATUS_KEYS.find(k => k.toLowerCase() === s) || '';
  }

  function loadApps() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(r => normalize(r)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveApps() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
    } catch (e) {
      toast('Could not save to this browser. Export a JSON backup to be safe.', true);
    }
  }

  function getApp(id) { return apps.find(a => a.id === id); }

  function upsertFromForm(data) {
    const now = new Date().toISOString();
    const existing = data.id ? getApp(data.id) : null;
    if (existing) {
      const statusChanged = existing.status !== data.status;
      Object.assign(existing, data, { updatedAt: now });
      if (statusChanged) existing.history.push({ status: data.status, at: now });
      return existing;
    }
    const rec = normalize({ ...data, id: undefined, createdAt: now, updatedAt: now });
    apps.unshift(rec);
    return rec;
  }

  function changeStatus(id, status) {
    const app = getApp(id);
    if (!app || app.status === status || !STATUS_KEYS.includes(status)) return;
    const now = new Date().toISOString();
    app.status = status;
    app.updatedAt = now;
    app.history.push({ status, at: now });
    if (status === 'Applied' && !app.dateApplied) app.dateApplied = todayISO();
    saveApps();
    render();
    toast(`${app.company} moved to ${status}.`);
  }

  function deleteApp(id) {
    const idx = apps.findIndex(a => a.id === id);
    if (idx === -1) return;
    const [removed] = apps.splice(idx, 1);
    saveApps();
    render();
    toast(`Deleted ${removed.company} (${removed.role}).`);
  }

  // ---------- Derived data ----------

  function visibleApps() {
    const q = ui.search.trim().toLowerCase();
    let list = apps.filter(a => {
      if (ui.status && a.status !== ui.status) return false;
      if (ui.activeOnly && !STATUS_BY_KEY[a.status].active) return false;
      if (!q) return true;
      const hay = [a.company, a.role, a.location, a.notes, a.source, a.contactName, a.salary].join(' ').toLowerCase();
      return hay.includes(q);
    });

    const cmpStr = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });
    const byDateDesc = (f) => (x, y) => (y[f] || '').localeCompare(x[f] || '');
    const byDateAsc = (f) => (x, y) => {
      if (!x[f] && !y[f]) return 0;
      if (!x[f]) return 1;
      if (!y[f]) return -1;
      return x[f].localeCompare(y[f]);
    };

    switch (ui.sort) {
      case 'applied-desc': list.sort(byDateDesc('dateApplied')); break;
      case 'applied-asc': list.sort(byDateAsc('dateApplied')); break;
      case 'company-asc': list.sort((x, y) => cmpStr(x.company, y.company) || cmpStr(x.role, y.role)); break;
      case 'followup-asc': list.sort(byDateAsc('followUpDate')); break;
      case 'status': list.sort((x, y) => STATUS_KEYS.indexOf(x.status) - STATUS_KEYS.indexOf(y.status) || byDateDesc('updatedAt')(x, y)); break;
      default: list.sort(byDateDesc('updatedAt'));
    }
    return list;
  }

  function computeStats() {
    const today = todayISO();
    const counts = Object.fromEntries(STATUS_KEYS.map(k => [k, 0]));
    let active = 0, responded = 0, submitted = 0, interviews = 0, offers = 0, due = 0, overdue = 0;

    for (const a of apps) {
      counts[a.status]++;
      const s = STATUS_BY_KEY[a.status];
      if (s.active) active++;
      if (a.status !== 'Saved') submitted++;
      if (s.responded) responded++;
      if (['Phone Screen', 'Interviewing', 'Offer', 'Accepted'].includes(a.status)) interviews++;
      if (['Offer', 'Accepted'].includes(a.status)) offers++;
      if (a.followUpDate && s.active) {
        if (a.followUpDate < today) overdue++;
        else if (a.followUpDate === today) due++;
      }
    }
    const responseRate = submitted ? Math.round((responded / submitted) * 100) : 0;
    return { counts, total: apps.length, active, submitted, responded, responseRate, interviews, offers, due, overdue };
  }

  // ---------- Rendering ----------

  function render() {
    renderStats();
    renderPipeline();
    renderList();
  }

  function renderStats() {
    const s = computeStats();
    const followUpLabel = s.overdue ? `${s.overdue} overdue` : (s.due ? `${s.due} due today` : 'Nothing pending');
    const tiles = [
      { label: 'Total', value: s.total, hint: `${s.active} active` },
      { label: 'Response Rate', value: s.responseRate + '%', hint: `${s.responded} of ${s.submitted} submitted` },
      { label: 'Interviews', value: s.interviews, hint: 'Screens, interviews, and offers' },
      { label: 'Offers', value: s.offers, hint: s.counts.Accepted ? `${s.counts.Accepted} accepted` : 'Including accepted' },
      { label: 'Follow-Ups', value: s.overdue + s.due, hint: followUpLabel, alert: s.overdue > 0 },
    ];
    $('#stats').innerHTML = tiles.map(t => `
      <div class="stat${t.alert ? ' stat--alert' : ''}">
        <div class="stat__label">${escapeHtml(t.label)}</div>
        <div class="stat__value">${escapeHtml(String(t.value))}</div>
        <div class="stat__hint">${escapeHtml(t.hint)}</div>
      </div>`).join('');
  }

  function renderPipeline() {
    const { counts, total } = computeStats();
    const max = Math.max(1, ...Object.values(counts));
    $('#pipeline').innerHTML = STATUSES.map(s => {
      const n = counts[s.key];
      const pct = total ? Math.round((n / max) * 100) : 0;
      return `
        <button type="button" class="pbar${ui.status === s.key ? ' is-active' : ''}" data-status="${escapeHtml(s.key)}" aria-pressed="${ui.status === s.key}">
          <span class="pbar__label"><span class="pbar__dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>
          <span class="pbar__track"><span class="pbar__fill" style="width:${pct}%;background:${s.color}"></span></span>
          <span class="pbar__count">${n}</span>
        </button>`;
    }).join('');
  }

  function renderList() {
    const list = visibleApps();
    const container = $('#list');
    const count = $('#result-count');

    if (apps.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <h3>No applications yet</h3>
          <p>Add your first application, or import a JSON file you exported earlier.</p>
        </div>`;
      count.textContent = '';
      return;
    }
    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <h3>Nothing matches these filters</h3>
          <p>Try a different search or clear the filters.</p>
        </div>`;
      count.textContent = `Showing 0 of ${apps.length}`;
      return;
    }

    count.textContent = list.length === apps.length
      ? `Showing all ${apps.length} application${apps.length === 1 ? '' : 's'}`
      : `Showing ${list.length} of ${apps.length}`;

    const tpl = $('#tpl-card');
    const today = todayISO();
    const frag = document.createDocumentFragment();

    for (const a of list) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const status = STATUS_BY_KEY[a.status];
      node.dataset.id = a.id;
      node.style.setProperty('--card-accent', status.color);

      $('.card__role', node).textContent = a.role;
      $('.card__company', node).textContent = a.company + (a.location ? ` · ${a.location}` : '') + (a.workType ? ` · ${a.workType}` : '');

      const badge = $('.badge', node);
      if (a.priority === 'High') { badge.textContent = 'High Priority'; badge.classList.add('badge--priority-high'); }
      else if (a.priority === 'Low') { badge.textContent = 'Low Priority'; badge.classList.add('badge--priority-low'); }
      else badge.remove();

      const meta = [];
      if (a.dateApplied) {
        const age = daysBetween(a.dateApplied, today);
        meta.push(`<span>Applied ${escapeHtml(formatDate(a.dateApplied))}${age >= 0 ? ` (${age === 0 ? 'today' : age + 'd ago'})` : ''}</span>`);
      }
      if (a.followUpDate && status.active) {
        const cls = a.followUpDate < today ? 'is-overdue' : (a.followUpDate === today ? 'is-today' : '');
        const word = a.followUpDate < today ? 'Follow-up overdue' : 'Follow up';
        meta.push(`<span class="${cls}">${word} ${escapeHtml(formatDate(a.followUpDate))}</span>`);
      }
      if (a.salary) meta.push(`<span>${escapeHtml(a.salary)}</span>`);
      if (a.source) meta.push(`<span>via ${escapeHtml(a.source)}</span>`);
      if (a.contactName) meta.push(`<span>Contact: ${escapeHtml(a.contactName)}</span>`);
      $('.card__meta', node).innerHTML = meta.join('');
      $('.card__notes', node).textContent = a.notes;

      const sel = $('.card__status', node);
      sel.innerHTML = STATUSES.map(s => `<option value="${s.key}"${s.key === a.status ? ' selected' : ''}>${s.label}</option>`).join('');
      sel.style.borderLeft = `4px solid ${status.color}`;

      const link = $('.card__link', node);
      const href = safeUrl(a.link);
      if (href) link.href = href; else link.hidden = true;

      frag.appendChild(node);
    }
    container.innerHTML = '';
    container.appendChild(frag);
  }

  // ---------- Form dialog ----------

  const formDialog = $('#dialog-form');
  const form = $('#app-form');

  function openForm(app) {
    form.reset();
    $('#form-error').hidden = true;
    $('#form-title').textContent = app ? 'Edit Application' : 'Add Application';
    $('#btn-save-form').textContent = app ? 'Save Changes' : 'Save Application';
    form.elements.id.value = app ? app.id : '';
    form.elements.status.value = app ? app.status : DEFAULT_STATUS;
    form.elements.priority.value = app ? app.priority : 'Medium';
    form.elements.workType.value = app ? app.workType : '';
    for (const f of [...TEXT_FIELDS, ...DATE_FIELDS]) {
      if (f === 'workType') continue;
      form.elements[f].value = app ? app[f] : '';
    }
    if (!app) form.elements.dateApplied.value = todayISO();
    formDialog.showModal();
    form.elements.company.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {};
    for (const f of [...TEXT_FIELDS, ...DATE_FIELDS]) data[f] = form.elements[f].value.trim();
    data.id = form.elements.id.value;
    data.status = form.elements.status.value;
    data.priority = form.elements.priority.value;

    const errors = [];
    if (!data.company) errors.push('Company is required.');
    if (!data.role) errors.push('Role is required.');
    if (data.link && !safeUrl(data.link)) errors.push('The job link needs to start with http:// or https://.');
    if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) errors.push('That contact email does not look valid.');
    for (const f of DATE_FIELDS) if (data[f] && !isISODate(data[f])) errors.push('Dates must be valid.');
    if (errors.length) {
      const err = $('#form-error');
      err.textContent = errors.join(' ');
      err.hidden = false;
      return;
    }

    const wasNew = !data.id;
    const rec = upsertFromForm(data);
    saveApps();
    formDialog.close();
    render();
    toast(wasNew ? `Added ${rec.company}.` : `Updated ${rec.company}.`);
  });

  $('#btn-add').addEventListener('click', () => openForm(null));
  $('#btn-close-form').addEventListener('click', () => formDialog.close());
  $('#btn-cancel-form').addEventListener('click', () => formDialog.close());

  // ---------- Detail dialog ----------

  const detailDialog = $('#dialog-detail');
  let detailId = null;

  function openDetail(id) {
    const a = getApp(id);
    if (!a) return;
    detailId = id;
    $('#detail-title').textContent = `${a.role} at ${a.company}`;
    const status = STATUS_BY_KEY[a.status];
    const href = safeUrl(a.link);
    const item = (label, value) => value ? `<div class="detail__item"><span class="detail__label">${label}</span><span class="detail__value">${value}</span></div>` : '';
    const today = todayISO();

    $('#detail-body').innerHTML = `
      <div class="detail">
        <div><span class="badge" style="--badge-bg:${status.color}">${escapeHtml(status.label)}</span>
          ${a.priority !== 'Medium' ? ` <span class="badge badge--priority-${a.priority.toLowerCase()}">${escapeHtml(a.priority)} Priority</span>` : ''}
        </div>
        <div class="detail__grid">
          ${item('Job Posting', href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostname(href) || href)}</a>` : '')}
          ${item('Date Applied', escapeHtml(formatDate(a.dateApplied)) + (a.dateApplied ? ` (${daysBetween(a.dateApplied, today)} days ago)` : ''))}
          ${item('Location', escapeHtml([a.location, a.workType].filter(Boolean).join(' · ')))}
          ${item('Salary Range', escapeHtml(a.salary))}
          ${item('Source', escapeHtml(a.source))}
          ${item('Contact', escapeHtml(a.contactName) + (a.contactEmail ? ` <a href="mailto:${escapeHtml(a.contactEmail)}">${escapeHtml(a.contactEmail)}</a>` : ''))}
          ${item('Next Follow-Up', escapeHtml(formatDate(a.followUpDate)))}
          ${item('Last Updated', escapeHtml(formatDateTime(a.updatedAt)))}
        </div>
        ${a.notes ? `<div><div class="detail__label">Notes</div><div class="detail__notes">${escapeHtml(a.notes)}</div></div>` : ''}
        <div>
          <div class="detail__label" style="margin-bottom:6px">Status History</div>
          <ul class="history">
            ${a.history.slice().reverse().map(h => `
              <li><span class="history__dot" style="background:${STATUS_BY_KEY[h.status].color}"></span>
                  <span class="history__date">${escapeHtml(formatDateTime(h.at))}</span>
                  <span>${escapeHtml(h.status)}</span></li>`).join('')}
          </ul>
        </div>
      </div>`;
    detailDialog.showModal();
  }

  $('#btn-close-detail').addEventListener('click', () => detailDialog.close());
  $('#btn-detail-close').addEventListener('click', () => detailDialog.close());
  $('#btn-detail-edit').addEventListener('click', () => {
    const id = detailId;
    detailDialog.close();
    openForm(getApp(id));
  });
  $('#btn-detail-delete').addEventListener('click', () => {
    const a = getApp(detailId);
    if (!a) return;
    if (confirm(`Delete the ${a.role} application at ${a.company}? This cannot be undone.`)) {
      detailDialog.close();
      deleteApp(detailId);
    }
  });

  // ---------- List interactions ----------

  $('#list').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('.card__view')) openDetail(id);
    else if (e.target.closest('.card__edit')) openForm(getApp(id));
  });
  $('#list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('card__status')) return;
    const card = e.target.closest('.card');
    changeStatus(card.dataset.id, e.target.value);
  });

  $('#pipeline').addEventListener('click', (e) => {
    const bar = e.target.closest('.pbar');
    if (!bar) return;
    ui.status = ui.status === bar.dataset.status ? '' : bar.dataset.status;
    $('#filter-status').value = ui.status;
    render();
  });

  // ---------- Filters ----------

  const statusFilter = $('#filter-status');
  statusFilter.innerHTML += STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
  $('#form-status').innerHTML = STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join('');

  $('#search').addEventListener('input', (e) => { ui.search = e.target.value; renderList(); });
  statusFilter.addEventListener('change', (e) => { ui.status = e.target.value; render(); });
  $('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; renderList(); });
  $('#filter-active').addEventListener('change', (e) => { ui.activeOnly = e.target.checked; renderList(); });
  $('#btn-clear-filters').addEventListener('click', () => {
    ui.search = ''; ui.status = ''; ui.activeOnly = false; ui.sort = 'updated-desc';
    $('#search').value = ''; statusFilter.value = ''; $('#filter-active').checked = false; $('#sort').value = 'updated-desc';
    render();
  });

  // ---------- Export ----------

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJSON() {
    if (apps.length === 0) { toast('There is nothing to export yet.', true); return; }
    const payload = {
      app: 'job-app-tracker',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      applications: apps,
    };
    downloadFile(`job-applications-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`Exported ${apps.length} application${apps.length === 1 ? '' : 's'} to JSON.`);
  }

  function exportCSV() {
    if (apps.length === 0) { toast('There is nothing to export yet.', true); return; }
    const cols = ['company', 'role', 'status', 'dateApplied', 'followUpDate', 'location', 'workType', 'salary', 'source', 'contactName', 'contactEmail', 'priority', 'link', 'notes', 'createdAt', 'updatedAt'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    for (const a of apps) lines.push(cols.map(c => cell(a[c])).join(','));
    downloadFile(`job-applications-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast(`Exported ${apps.length} application${apps.length === 1 ? '' : 's'} to CSV.`);
  }

  $('#btn-export').addEventListener('click', exportJSON);
  $('#btn-export-csv').addEventListener('click', exportCSV);

  // ---------- Import ----------

  const importDialog = $('#dialog-import');
  const fileInput = $('#file-import');

  $('#btn-import').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseImport(text);
      pendingImport = parsed;
      const skipped = parsed.skipped ? ` ${parsed.skipped} entr${parsed.skipped === 1 ? 'y was' : 'ies were'} skipped because they had no company or role.` : '';
      $('#import-summary').textContent = `Found ${parsed.records.length} application${parsed.records.length === 1 ? '' : 's'} in "${file.name}".${skipped}`;
      $('#import-error').hidden = true;
      $$('input[name="import-mode"]').forEach(r => { r.checked = r.value === 'merge'; });
      importDialog.showModal();
    } catch (err) {
      toast(err.message || 'Could not read that file.', true);
    }
  });

  /** Accepts the export envelope, a bare array, or an object with an applications/apps/jobs array. */
  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('That file is not valid JSON.'); }

    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object') {
      list = data.applications ?? data.apps ?? data.jobs ?? data.items ?? data.data;
      if (!Array.isArray(list) && (data.company || data.role || data.name || data.title)) list = [data];
    }
    if (!Array.isArray(list)) throw new Error('Expected a JSON array of applications, or an object with an "applications" array.');
    if (list.length === 0) throw new Error('That file does not contain any applications.');

    const records = [];
    let skipped = 0;
    for (const raw of list) {
      const rec = normalize(raw);
      if (rec) records.push(rec); else skipped++;
    }
    if (records.length === 0) throw new Error('None of the entries had a company or role, so nothing could be imported.');
    return { records, skipped };
  }

  $('#btn-confirm-import').addEventListener('click', () => {
    if (!pendingImport) return;
    const mode = ($$('input[name="import-mode"]').find(r => r.checked) || {}).value || 'merge';
    const incoming = pendingImport.records;
    let added = 0, updated = 0;

    if (mode === 'replace') {
      if (apps.length && !confirm(`Replace all ${apps.length} existing applications with the ${incoming.length} from this file?`)) return;
      apps = incoming.slice();
      added = incoming.length;
    } else if (mode === 'append') {
      const fresh = incoming.map(r => ({ ...r, id: uid() }));
      apps = fresh.concat(apps);
      added = fresh.length;
    } else {
      const byId = new Map(apps.map(a => [a.id, a]));
      for (const rec of incoming) {
        const existing = byId.get(rec.id);
        if (existing) {
          // Keep whichever copy was updated most recently; always keep the fuller history.
          const newer = (rec.updatedAt || '') >= (existing.updatedAt || '');
          const history = mergeHistory(existing.history, rec.history);
          Object.assign(existing, newer ? rec : {}, { history });
          updated++;
        } else {
          apps.push(rec);
          byId.set(rec.id, rec);
          added++;
        }
      }
    }

    saveApps();
    importDialog.close();
    pendingImport = null;
    render();
    const parts = [];
    if (added) parts.push(`${added} added`);
    if (updated) parts.push(`${updated} updated`);
    toast(`Import complete: ${parts.join(', ') || 'no changes'}.`);
  });

  function mergeHistory(a, b) {
    const seen = new Set();
    return [...a, ...b]
      .filter(h => { const k = h.status + '|' + h.at; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((x, y) => x.at.localeCompare(y.at));
  }

  $('#btn-close-import').addEventListener('click', () => importDialog.close());
  $('#btn-cancel-import').addEventListener('click', () => importDialog.close());

  // ---------- Misc actions ----------

  $('#btn-clear-all').addEventListener('click', () => {
    if (apps.length === 0) { toast('There is nothing to delete.'); return; }
    if (!confirm(`Delete all ${apps.length} applications? Export a backup first if you want to keep them.`)) return;
    apps = [];
    saveApps();
    render();
    toast('All applications deleted.');
  });

  $('#btn-load-sample').addEventListener('click', async () => {
    if (apps.length && !confirm('Add the sample applications to your current list?')) return;
    try {
      const res = await fetch('sample-data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const parsed = parseImport(await res.text());
      apps = parsed.records.map(r => ({ ...r, id: uid() })).concat(apps);
      saveApps();
      render();
      toast(`Loaded ${parsed.records.length} sample applications.`);
    } catch {
      toast('Sample data is only available when the app is served over http(s), not opened as a file.', true);
    }
  });

  // Theme: follows the system by default, click to override.
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  $('#btn-theme').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  });
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch {}

  // Keyboard shortcut: "n" adds a new application when no field is focused.
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    if (e.key === 'n' && !inField && !e.metaKey && !e.ctrlKey && !$('dialog[open]')) {
      e.preventDefault();
      openForm(null);
    }
  });

  // Close dialogs when clicking on the backdrop.
  $$('dialog').forEach(d => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // ---------- Boot ----------

  render();
})();
