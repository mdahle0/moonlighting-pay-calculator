// "Add manually" form on the Log a day tab — every site's exam types are shown
// together so a full day across multiple sites can be entered in one pass.
// Sites that share a rate group (e.g. Memphis / Mountain Home / Lexington /
// Tennessee Valley) collapse into one combined "Other" section by default,
// since the pay is identical either way, but can be expanded to attribute
// counts to each site individually.
const ManualEntry = {
  selectedDate: null,

  init() {
    this.selectedDate = todayISO();

    document.getElementById('manualForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });

    document.getElementById('logQuickTotalBtn').addEventListener('click', (e) => {
      const input = document.getElementById('logQuickTotalAmount');
      const amount = parseFloat(input.value);
      if (!amount || amount <= 0) return;
      Store.addEntry({
        date: this.selectedDate,
        site: 'Quick total',
        examType: 'Day total',
        count: 1,
        rate: amount,
        amount
      });
      input.value = '';
      Calendar.render();
      const btn = e.target;
      const original = btn.textContent;
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = original; }, 900);
    });

    this.renderDateStrip();
    this.renderGrid();
  },

  renderDateStrip() {
    const { start, end } = currentPeriodBounds();
    const strip = document.getElementById('manualDateStrip');
    const todayStr = todayISO();
    const paydays = paydaysInRange(start, end);
    const holidaysByYear = {};

    const days = [];
    for (let d = parseISO(start); d <= parseISO(end); d.setDate(d.getDate() + 1)) {
      days.push(isoDate(d));
    }

    strip.innerHTML = days.map(d => {
      const dt = parseISO(d);
      const dow = dt.toLocaleDateString(undefined, { weekday: 'short' });
      const classes = ['date-chip'];
      if (d === this.selectedDate) classes.push('selected');
      if (d === todayStr) classes.push('today');
      const year = dt.getFullYear();
      if (!holidaysByYear[year]) holidaysByYear[year] = federalHolidaysForYear(year);
      return `
        <button type="button" class="${classes.join(' ')}" data-date="${d}">
          ${dayBadgesHtml(d, paydays, holidaysByYear[year])}
          <span class="date-chip-dow">${dow}</span>
          <span class="date-chip-num">${dt.getDate()}</span>
        </button>
      `;
    }).join('');

    strip.querySelectorAll('.date-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedDate = btn.dataset.date;
        this.renderDateStrip();
        this.renderGrid();
      });
    });
  },

  renderGrid() {
    const dateISO = this.selectedDate;
    const container = document.getElementById('manualSitesContainer');
    const sites = Store.getActiveSites();

    // A site with its own rate override no longer matches the rest of its
    // group, so it's pulled out and always shown as its own section instead
    // of being lumped into the collapsed/expandable group.
    const deviating = sites.filter(s => Store.siteHasOverrides(s.id));
    const groupable = sites.filter(s => !Store.siteHasOverrides(s.id));

    const groups = [];
    const seenGroupIds = new Set();
    for (const site of groupable) {
      if (seenGroupIds.has(site.rateGroupId)) continue;
      seenGroupIds.add(site.rateGroupId);
      groups.push({
        groupId: site.rateGroupId,
        sites: groupable.filter(s => s.rateGroupId === site.rateGroupId)
      });
    }

    const groupsHtml = groups.map(group => {
      return group.sites.length === 1
        ? this.renderSiteSection(group.sites[0], dateISO, true)
        : this.renderGroupSection(group, dateISO);
    }).join('');
    const deviatingHtml = deviating.map(site => this.renderSiteSection(site, dateISO, true)).join('');

    container.innerHTML = groupsHtml + deviatingHtml;

    container.querySelectorAll('.group-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const groupId = btn.dataset.groupId;
        const expandedRateGroups = { ...Store.getSettings().expandedRateGroups };
        expandedRateGroups[groupId] = !expandedRateGroups[groupId];
        Store.updateSettings({ expandedRateGroups });
        this.renderGrid();
      });
    });

    container.querySelectorAll('.exam-grid-row').forEach(row => {
      const rate = parseFloat(row.dataset.rate);
      const countInput = row.querySelector('.exam-grid-count');
      const amountEl = row.querySelector('.exam-grid-amount');
      countInput.addEventListener('input', () => {
        const count = parseInt(countInput.value, 10);
        amountEl.textContent = count > 0 ? fmtMoney(rate * count) : '';
        this.refreshTotal();
      });
    });

    this.refreshTotal();
  },

  renderGroupSection(group, dateISO) {
    const expanded = !!Store.getSettings().expandedRateGroups?.[group.groupId];
    const toggleLabel = expanded ? 'Collapse into one' : 'Edit sites individually';
    const bodyHtml = expanded
      ? group.sites.map(s => this.renderSiteSection(s, dateISO, true)).join('')
      : this.renderCombinedSection(group, dateISO);

    return `
      <div class="group-section" data-group-id="${group.groupId}">
        <div class="group-section-header">
          <span class="group-section-title">Other</span>
          <button type="button" class="link-btn group-toggle-btn" data-group-id="${group.groupId}">${toggleLabel}</button>
        </div>
        ${bodyHtml}
      </div>
    `;
  },

  // Collapsed "Other": one combined grid, not attributed to any single site.
  // Saved under the literal site name "Other" — pay is identical regardless
  // of which specific site it's logged against, since they share a rate group.
  renderCombinedSection(group, dateISO) {
    const rateGroup = Store.getRateGroup(group.groupId) || { rates: {} };
    const examTypes = Store.orderedExamTypes(group.groupId);
    const existingEntries = Store.entriesForDateSite(dateISO, 'Other');
    const rows = this.buildRowsHtml(examTypes, (t) => rateGroup.rates[t], existingEntries);
    return `<div class="site-section" data-site-name="Other">${rows}</div>`;
  },

  renderSiteSection(site, dateISO, withTitle) {
    const examTypes = Store.examTypesForSite(site.id);
    const existingEntries = Store.entriesForDateSite(dateISO, site.name);
    const rows = this.buildRowsHtml(examTypes, (t) => Store.rateFor(site.id, t), existingEntries);
    return `
      <div class="site-section" data-site-name="${escapeHtml(site.name)}">
        ${withTitle ? `<div class="site-section-title">${escapeHtml(site.name)}</div>` : ''}
        ${rows}
      </div>
    `;
  },

  // Shared row-building for both a single site and the combined "Other" total.
  // Keeps any exam type already logged for this day/target even if it's not
  // in the current rate table, so saving can't silently drop it.
  buildRowsHtml(examTypes, rateForExamType, existingEntries) {
    const existing = {};
    for (const e of existingEntries) existing[e.examType] = e.count;

    const extraTypes = existingEntries.map(e => e.examType).filter(t => !examTypes.includes(t));
    const rateOverrides = {};
    for (const e of existingEntries) {
      if (extraTypes.includes(e.examType)) rateOverrides[e.examType] = e.rate;
    }
    const allTypes = [...examTypes, ...new Set(extraTypes)];

    return allTypes.map(examType => {
      const rate = examType in rateOverrides ? rateOverrides[examType] : rateForExamType(examType);
      const count = existing[examType] || '';
      const label = Store.getExamLabel(examType);
      return `
        <div class="exam-grid-row" data-exam="${escapeHtml(examType)}" data-rate="${rate}">
          <span class="exam-grid-name">${escapeHtml(examType)}${label ? `<span class="exam-grid-aka">${escapeHtml(label)}</span>` : ''}</span>
          <span class="exam-grid-rate muted">${fmtMoney(rate)}</span>
          <input type="number" class="exam-grid-count" min="0" step="1" placeholder="0" value="${count}" />
          <span class="exam-grid-amount muted">${count ? fmtMoney(rate * count) : ''}</span>
        </div>
      `;
    }).join('');
  },

  refreshTotal() {
    const container = document.getElementById('manualSitesContainer');
    let total = 0;
    container.querySelectorAll('.exam-grid-row').forEach(row => {
      const rate = parseFloat(row.dataset.rate);
      const count = parseInt(row.querySelector('.exam-grid-count').value, 10) || 0;
      total += rate * count;
    });
    document.getElementById('manualDayTotal').textContent = fmtMoney(total);
  },

  save() {
    const dateISO = this.selectedDate;
    const container = document.getElementById('manualSitesContainer');

    container.querySelectorAll('.site-section').forEach(section => {
      const siteName = section.dataset.siteName;
      const lineItems = [];
      section.querySelectorAll('.exam-grid-row').forEach(row => {
        const count = parseInt(row.querySelector('.exam-grid-count').value, 10);
        if (count > 0) {
          const rate = parseFloat(row.dataset.rate);
          lineItems.push({ examType: row.dataset.exam, count, rate, amount: rate * count });
        }
      });
      Store.setDayForSite(dateISO, siteName, lineItems);
    });

    Calendar.render();
    flashSaved(document.getElementById('manualForm'));
  },

  refreshSiteOptions() {
    this.renderGrid();
  },

  refreshDateStrip() {
    const { start, end } = currentPeriodBounds();
    if (this.selectedDate < start || this.selectedDate > end) {
      this.selectedDate = todayISO();
    }
    this.renderDateStrip();
    this.renderGrid();
  }
};

function flashSaved(form) {
  const btn = form.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = original; }, 900);
}
