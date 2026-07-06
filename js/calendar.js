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
    Dashboard.render();
    this.renderMonth();
    this.renderSecondaryStats();
  },

  // Month-to-date is purely what's logged in the app this calendar month.
  // Kept alongside last year's total (manual, Settings > Yearly totals) as a
  // secondary card below the Dashboard — Calendar-tab-only.
  renderSecondaryStats() {
    const settings = Store.getSettings();
    const todayStr = todayISO();

    const mtdTotal = Store.entriesInRange(startOfMonthISO(), todayStr)
      .reduce((s, e) => s + e.amount, 0);
    const lastYearTotal = settings.previousYearTotal || 0;

    document.getElementById('mtdTotal').textContent = fmtMoney(mtdTotal);
    document.getElementById('lastYearTotal').textContent = fmtMoney(lastYearTotal);

    const compareEl = document.getElementById('yearCompare');
    if (lastYearTotal > 0) {
      const ytdTotal = Dashboard.computeYTD();
      const paceTarget = lastYearTotal * monthsElapsedFraction();
      const diff = ytdTotal - paceTarget;
      const pct = paceTarget > 0 ? (Math.abs(diff) / paceTarget) * 100 : 0;
      const aheadBehind = diff >= 0 ? 'ahead of' : 'behind';
      compareEl.innerHTML =
        `Year to date is <span class="money">${fmtMoney(Math.abs(diff))}</span> (${pct.toFixed(1)}%) ${aheadBehind} last year's pace through this point (<span class="money">${fmtMoney(paceTarget)}</span>).`;
      compareEl.className = 'compare-line ' + (diff >= 0 ? 'ahead' : 'behind');
    } else {
      compareEl.textContent = 'Enter last year\'s total in Settings to see a pace comparison.';
      compareEl.className = 'compare-line';
    }
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
    const monthStartISO = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEndISO = `${y}-${String(m + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const paydays = paydaysInRange(monthStartISO, monthEndISO);
    const holidays = federalHolidaysForYear(y);

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
        ${dayBadgesHtml(dateISO, paydays, holidays)}
        ${total > 0 ? `<span class="day-amt money">${fmtMoney(total, true)}</span>` : ''}
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
        <div class="entry-amt money">${fmtMoney(e.amount)}</div>
        <button class="icon-btn delete-entry" aria-label="Delete">&times;</button>
      </div>
    `).join('');

    body.innerHTML = `
      ${entries.length ? `<div class="entry-list">${rows}</div>` : '<p class="muted">No entries yet for this day.</p>'}
      ${entries.length ? `<div class="entry-total">Day total: <strong class="money">${fmtMoney(total)}</strong></div>` : ''}
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
      <hr/>
      <form id="quickTotalForm" class="quick-total-form">
        <label>Or just log a total for the day
          <input type="number" id="quickTotalAmount" min="0" step="0.01" placeholder="e.g. 450.00" />
        </label>
        <button type="submit" class="secondary-btn">Add total</button>
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

    document.getElementById('quickTotalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('quickTotalAmount');
      const amount = parseFloat(input.value);
      if (!amount || amount <= 0) return;
      Store.addEntry({
        date: dateISO,
        site: 'Quick total',
        examType: 'Day total',
        count: 1,
        rate: amount,
        amount
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

function startOfMonthISO() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function startOfYearISO() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), 0, 1));
}

// Fraction of the year elapsed, counting the current month proportionally
// by day (e.g. April 30 -> 4/12, since April has 30 days and today is day 30).
function monthsElapsedFraction() {
  const d = new Date();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getMonth() + d.getDate() / daysInMonth) / 12;
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ---- Payday & VA federal holiday markers (Calendar grid + Log a day date-strip) ----

// The nth occurrence of a weekday in a month (n=1..5, dow=0 Sun..6 Sat).
function nthWeekdayOfMonth(year, month, dow, n) {
  const first = new Date(year, month, 1);
  const day = 1 + ((dow - first.getDay() + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

// The last occurrence of a weekday in a month (e.g. Memorial Day).
function lastWeekdayOfMonth(year, month, dow) {
  const last = new Date(year, month + 1, 0);
  const day = last.getDate() - ((last.getDay() - dow + 7) % 7);
  return new Date(year, month, day);
}

// Federal weekend-shift rule: Saturday observed the Friday before, Sunday
// observed the Monday after. Only applies to the fixed-date holidays below —
// the floating ones (nth-weekday, last-weekday) always land on a weekday.
function observedDate(d) {
  const dow = d.getDay();
  if (dow === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (dow === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

function federalHolidaysForYear(year) {
  return {
    [isoDate(observedDate(new Date(year, 0, 1)))]: "New Year's Day",
    [isoDate(nthWeekdayOfMonth(year, 0, 1, 3))]: 'Martin Luther King Jr. Day',
    [isoDate(nthWeekdayOfMonth(year, 1, 1, 3))]: "Washington's Birthday",
    [isoDate(lastWeekdayOfMonth(year, 4, 1))]: 'Memorial Day',
    [isoDate(observedDate(new Date(year, 5, 19)))]: 'Juneteenth',
    [isoDate(observedDate(new Date(year, 6, 4)))]: 'Independence Day',
    [isoDate(nthWeekdayOfMonth(year, 8, 1, 1))]: 'Labor Day',
    [isoDate(nthWeekdayOfMonth(year, 9, 1, 2))]: 'Columbus Day',
    [isoDate(observedDate(new Date(year, 10, 11)))]: 'Veterans Day',
    [isoDate(nthWeekdayOfMonth(year, 10, 4, 4))]: 'Thanksgiving',
    [isoDate(observedDate(new Date(year, 11, 25)))]: 'Christmas Day'
  };
}

// First Friday strictly after the given date (if the date itself is a
// Friday, payday is the *following* Friday, 7 days later, not the same day).
function nextFridayAfter(dateISO) {
  const d = parseISO(dateISO);
  const dow = d.getDay();
  let daysToAdd = (5 - dow + 7) % 7;
  if (daysToAdd === 0) daysToAdd = 7;
  return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToAdd));
}

// Every pay period's payday (the Friday after its end) that falls within
// [startISO, endISO] — works for any month, not just the current period,
// by walking the same anchor/length cycle math as currentPeriodBounds().
function paydaysInRange(startISO, endISO) {
  const settings = Store.getSettings();
  const lengthDays = settings.periodType === 'weekly' ? 7 : 14;
  const anchor = startOfDay(parseISO(settings.periodAnchor || todayISO()));
  const msPerDay = 86400000;
  const rangeStart = parseISO(startISO).getTime();
  const rangeEnd = parseISO(endISO).getTime();

  const paydays = new Set();
  let k = Math.floor((rangeStart - anchor.getTime()) / msPerDay / lengthDays) - 2;
  while (true) {
    const periodStart = new Date(anchor.getTime() + k * lengthDays * msPerDay);
    const periodEnd = new Date(periodStart.getTime() + (lengthDays - 1) * msPerDay);
    const payday = parseISO(nextFridayAfter(isoDate(periodEnd)));
    if (payday.getTime() > rangeEnd + 7 * msPerDay) break;
    if (payday.getTime() >= rangeStart && payday.getTime() <= rangeEnd) {
      paydays.add(isoDate(payday));
    }
    k++;
  }
  return paydays;
}

function dayBadgesHtml(dateISO, paydays, holidays) {
  const holidayName = holidays[dateISO];
  const isPayday = paydays.has(dateISO);
  if (!isPayday && !holidayName) return '';
  return `
    <div class="day-badges">
      ${isPayday ? '<span class="day-badge" title="Payday">💵</span>' : ''}
      ${holidayName ? `<span class="day-badge" title="${escapeHtml(holidayName)}">🎌</span>` : ''}
    </div>
  `;
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
