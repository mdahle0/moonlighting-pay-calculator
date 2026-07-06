// Calendar grid rendering + pay-period summary + day detail modal.
const Calendar = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(), // 0-indexed

  init() {
    document.getElementById('prevMonth').addEventListener('click', () => this.shiftMonth(-1));
    document.getElementById('nextMonth').addEventListener('click', () => this.shiftMonth(1));
    document.getElementById('closeDayModal').addEventListener('click', () => this.closeDayModal());
    document.getElementById('dayModal').addEventListener('click', (e) => {
      if (e.target.id === 'dayModal') this.closeDayModal();
    });
    this.render();
  },

  shiftMonth(delta) {
    this.viewMonth += delta;
    if (this.viewMonth < 0) { this.viewMonth = 11; this.viewYear--; }
    if (this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++; }
    this.render();
  },

  render() {
    this.renderPeriodCard();
    this.renderMonth();
  },

  renderPeriodCard() {
    const { start, end } = currentPeriodBounds();
    const entries = Store.entriesInRange(start, end);
    const total = entries.reduce((s, e) => s + e.amount, 0);
    const bySite = {};
    for (const e of entries) {
      bySite[e.site] = (bySite[e.site] || 0) + e.amount;
    }
    const breakdown = Object.entries(bySite)
      .sort((a, b) => b[1] - a[1])
      .map(([site, amt]) => `<div class="breakdown-row"><span>${escapeHtml(site)}</span><span>${fmtMoney(amt)}</span></div>`)
      .join('');

    document.getElementById('periodCard').innerHTML = `
      <div class="period-top">
        <div>
          <div class="period-label">Current pay period</div>
          <div class="period-range">${fmtDateHuman(start)} &ndash; ${fmtDateHuman(end)}</div>
        </div>
        <div class="period-total">${fmtMoney(total)}</div>
      </div>
      ${breakdown ? `<div class="breakdown">${breakdown}</div>` : ''}
    `;
  },

  renderMonth() {
    const y = this.viewYear, m = this.viewMonth;
    document.getElementById('monthLabel').textContent =
      new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = todayISO();

    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'day-cell empty';
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const total = Store.totalForDate(dateISO);
      const cell = document.createElement('div');
      cell.className = 'day-cell' + (dateISO === todayStr ? ' today' : '') + (total > 0 ? ' has-entries' : '');
      cell.innerHTML = `
        <span class="day-num">${day}</span>
        ${total > 0 ? `<span class="day-amt">${fmtMoney(total, true)}</span>` : ''}
      `;
      cell.addEventListener('click', () => this.openDayModal(dateISO));
      grid.appendChild(cell);
    }
  },

  openDayModal(dateISO) {
    const modal = document.getElementById('dayModal');
    document.getElementById('dayModalTitle').textContent = fmtDateHuman(dateISO, true);
    this.renderDayModalBody(dateISO);
    modal.classList.add('open');
  },

  closeDayModal() {
    document.getElementById('dayModal').classList.remove('open');
    this.render();
  },

  renderDayModalBody(dateISO) {
    const entries = Store.entriesForDate(dateISO);
    const body = document.getElementById('dayModalBody');
    const total = entries.reduce((s, e) => s + e.amount, 0);

    const rows = entries.map(e => `
      <div class="entry-row" data-id="${e.id}">
        <div class="entry-main">
          <span class="entry-site">${escapeHtml(e.site)}</span>
          <span class="entry-exam">${escapeHtml(e.examType)} &times; ${e.count}</span>
        </div>
        <div class="entry-amt">${fmtMoney(e.amount)}</div>
        <button class="icon-btn delete-entry" aria-label="Delete">&times;</button>
      </div>
    `).join('');

    body.innerHTML = `
      ${entries.length ? `<div class="entry-list">${rows}</div>` : '<p class="muted">No entries yet for this day.</p>'}
      ${entries.length ? `<div class="entry-total">Day total: <strong>${fmtMoney(total)}</strong></div>` : ''}
      <hr/>
      <form id="dayAddForm" class="day-add-form">
        <div class="form-row">
          <label>Site
            <select id="dayAddSite"></select>
          </label>
          <label>Exam type
            <select id="dayAddExamType"></select>
          </label>
        </div>
        <div class="form-row">
          <label># of exams
            <input type="number" id="dayAddCount" min="1" step="1" value="1" required />
          </label>
          <label>Amount
            <input type="text" id="dayAddAmount" disabled />
          </label>
        </div>
        <button type="submit" class="primary-btn">Add entry</button>
      </form>
    `;

    body.querySelectorAll('.delete-entry').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.entry-row').dataset.id;
        Store.removeEntry(id);
        this.renderDayModalBody(dateISO);
      });
    });

    const siteSel = document.getElementById('dayAddSite');
    const examSel = document.getElementById('dayAddExamType');
    const countInput = document.getElementById('dayAddCount');
    const amountInput = document.getElementById('dayAddAmount');

    populateSiteSelect(siteSel);
    const refreshExamOptions = () => {
      populateExamTypeSelect(examSel, siteSel.value);
      refreshAmount();
    };
    const refreshAmount = () => {
      const rate = Store.rateFor(siteSel.value, examSel.value);
      const count = parseInt(countInput.value, 10) || 0;
      amountInput.value = rate != null ? fmtMoney(rate * count) : '';
    };

    siteSel.addEventListener('change', refreshExamOptions);
    examSel.addEventListener('change', refreshAmount);
    countInput.addEventListener('input', refreshAmount);
    refreshExamOptions();

    document.getElementById('dayAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const siteId = siteSel.value;
      const site = Store.getSite(siteId);
      const examType = examSel.value;
      const count = parseInt(countInput.value, 10);
      const rate = Store.rateFor(siteId, examType);
      if (!site || !examType || !count || rate == null) return;
      Store.addEntry({
        date: dateISO,
        site: site.name,
        examType,
        count,
        rate,
        amount: rate * count
      });
      this.renderDayModalBody(dateISO);
    });
  }
};

function currentPeriodBounds(refDateISO) {
  const settings = Store.getSettings();
  const lengthDays = settings.periodType === 'weekly' ? 7 : 14;
  const anchor = parseISO(settings.periodAnchor || todayISO());
  const ref = refDateISO ? parseISO(refDateISO) : parseISO(todayISO());

  const msPerDay = 86400000;
  const diffDays = Math.floor((startOfDay(ref) - startOfDay(anchor)) / msPerDay);
  const cyclesElapsed = Math.floor(diffDays / lengthDays);
  const start = new Date(anchor.getTime() + cyclesElapsed * lengthDays * msPerDay);
  const end = new Date(start.getTime() + (lengthDays - 1) * msPerDay);
  return { start: isoDate(start), end: isoDate(end) };
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtMoney(n, compact) {
  const val = Math.round(n * 100) / 100;
  if (compact) {
    return '$' + (val % 1 === 0 ? val : val.toFixed(2));
  }
  return val.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function fmtDateHuman(dateISO, long) {
  const d = parseISO(dateISO);
  return d.toLocaleDateString(undefined, long
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function populateSiteSelect(sel, selectedId) {
  sel.innerHTML = Store.getActiveSites().map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)}</option>`
  ).join('');
  if (selectedId) sel.value = selectedId;
}

function populateExamTypeSelect(sel, siteId, selectedType) {
  const types = Store.examTypesForSite(siteId);
  sel.innerHTML = types.map(t => {
    const label = Store.getExamLabel(t);
    const text = label ? `${t} — ${label}` : t;
    return `<option value="${escapeHtml(t)}">${escapeHtml(text)}</option>`;
  }).join('');
  if (selectedType && types.includes(selectedType)) sel.value = selectedType;
}
