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
    this.saveTimer = null;

    window.addEventListener('beforeunload', () => this.flushAutoSave());

    document.getElementById('logQuickTotalBtn').addEventListener('click', (e) => {
      const input = document.getElementById('logQuickTotalAmount');
      const amount = parseFloat(input.value);
      if (!amount || amount <= 0) return;
      // A quick total replaces the itemized breakdown for the day (and vice
      // versa in persistDay()) so the two can't both count toward the total.
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      Store.clearDay(this.selectedDate);
      Store.setDayForSite(this.selectedDate, 'Quick total', [
        { examType: 'Day total', count: 1, rate: amount, amount }
      ]);
      input.value = '';
      this.renderGrid();
      this.renderDateStrip();
      Calendar.render();
      const btn = e.target;
      const original = btn.textContent;
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = original; }, 900);
    });

    document.getElementById('clearDayBtn').addEventListener('click', () => {
      const dateISO = this.selectedDate;
      if (!Store.entriesForDate(dateISO).length) return;
      const ok = window.confirm(`Clear all logged entries for ${fmtDateHuman(dateISO, true)}? This can't be undone.`);
      if (!ok) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      Store.clearDay(dateISO);
      this.renderGrid();
      this.renderDateStrip();
      Calendar.render();
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
      const markerClass = dayMarkerClass(d, paydays, holidaysByYear[year]).trim();
      if (markerClass) classes.push(...markerClass.split(' '));
      const total = Store.totalForDate(d);
      return `
        <button type="button" class="${classes.join(' ')}" data-date="${d}">
          ${dayBadgesHtml(d, paydays, holidaysByYear[year])}
          <span class="date-chip-dow">${dow}</span>
          <span class="date-chip-num">${dt.getDate()}</span>
          ${total > 0 ? `<span class="date-chip-amt money">${fmtMoney(total, true)}</span>` : ''}
        </button>
      `;
    }).join('');

    strip.querySelectorAll('.date-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.flushAutoSave();
        this.selectedDate = btn.dataset.date;
        this.renderDateStrip();
        this.renderGrid();
      });
    });
  },

  renderGrid() {
    this.flushAutoSave();
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
        this.scheduleAutoSave();
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
    // Every name this group's entries could be saved under (the combined
    // "Other" bucket, or each site individually) — used on save to clear
    // whichever name isn't currently displayed, so switching between
    // collapsed/expanded views can't leave stale entries behind.
    const altNames = encodeURIComponent(JSON.stringify(['Other', ...group.sites.map(s => s.name)]));

    return `
      <div class="group-section" data-group-id="${group.groupId}" data-alt-names="${altNames}">
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

  // The itemized grid above only covers sites/groups currently rendered as
  // rows. Anything saved for this date under a name that isn't one of those
  // (a "Quick total" entry, or a leftover entry for a site that's since been
  // deactivated) wouldn't be reflected in that sum — which used to make this
  // total silently disagree with the day's total shown on the calendar/date
  // strip. Folding it in here (and calling it out in a note) keeps this
  // number always equal to what's shown everywhere else.
  refreshTotal() {
    const container = document.getElementById('manualSitesContainer');
    let itemizedTotal = 0;
    container.querySelectorAll('.exam-grid-row').forEach(row => {
      const rate = parseFloat(row.dataset.rate);
      const count = parseInt(row.querySelector('.exam-grid-count').value, 10) || 0;
      itemizedTotal += rate * count;
    });

    const renderedSiteNames = new Set(
      [...container.querySelectorAll('.site-section')].map(s => s.dataset.siteName)
    );
    const outsideTotal = Store.entriesForDate(this.selectedDate)
      .filter(e => !renderedSiteNames.has(e.site))
      .reduce((sum, e) => sum + e.amount, 0);

    document.getElementById('manualDayTotal').textContent = fmtMoney(itemizedTotal + outsideTotal);
    document.getElementById('manualQuickTotalNote').textContent = outsideTotal > 0
      ? `Includes ${fmtMoney(outsideTotal)} logged outside this grid (e.g. a quick total below).`
      : '';
  },

  // Debounced auto-save: waits for a pause in typing so counts aren't
  // written mid-keystroke, then persists and refreshes the day-strip totals.
  scheduleAutoSave() {
    this.showSaveStatus('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persistDay(), 700);
  },

  // Persists immediately, bypassing the debounce — used whenever the
  // selected date/site set is about to change so nothing typed is lost.
  flushAutoSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.persistDay();
  },

  persistDay() {
    const dateISO = this.selectedDate;
    const container = document.getElementById('manualSitesContainer');
    const readSection = (section) => {
      const lineItems = [];
      section.querySelectorAll('.exam-grid-row').forEach(row => {
        const count = parseInt(row.querySelector('.exam-grid-count').value, 10);
        if (count > 0) {
          const rate = parseFloat(row.dataset.rate);
          lineItems.push({ examType: row.dataset.exam, count, rate, amount: rate * count });
        }
      });
      return lineItems;
    };

    // Grouped sites: clear every alternate name the group could have been
    // saved under (see renderGroupSection) before writing the currently
    // displayed mode's entries, so toggling collapsed/expanded can't double-count.
    container.querySelectorAll('.group-section').forEach(groupEl => {
      const altNames = JSON.parse(decodeURIComponent(groupEl.dataset.altNames));
      const sections = [...groupEl.querySelectorAll('.site-section')].map(section => ({
        siteName: section.dataset.siteName,
        lineItems: readSection(section)
      }));
      Store.replaceDayEntries(dateISO, altNames, sections);
    });

    // Single-site groups and rate-override sites — no alternate name to worry about.
    container.querySelectorAll(':scope > .site-section').forEach(section => {
      Store.setDayForSite(dateISO, section.dataset.siteName, readSection(section));
    });

    // Editing the itemized grid supersedes any quick total logged for this
    // day (see logQuickTotalBtn's handler for the reverse direction) so the
    // two can't both count toward the day's total.
    Store.setDayForSite(dateISO, 'Quick total', []);

    Calendar.render();
    this.renderDateStrip();
    this.showSaveStatus('saved');
  },

  showSaveStatus(state) {
    const el = document.getElementById('manualSaveStatus');
    if (!el) return;
    clearTimeout(this.statusTimer);
    if (state === 'saving') {
      el.textContent = 'Saving…';
    } else {
      el.textContent = 'Saved ✓';
      this.statusTimer = setTimeout(() => { el.textContent = ''; }, 1500);
    }
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
