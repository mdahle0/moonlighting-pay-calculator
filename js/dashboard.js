// Persistent Dashboard shown at the top of both the Calendar and Log a day
// tabs (two mount points, one render — always identical on both pages).
const Dashboard = {
  render() {
    const data = this.computeData();
    const html = this.buildHTML(data);
    document.querySelectorAll('.dashboard-mount').forEach(el => { el.innerHTML = html; });
    applyHideAmounts();
  },

  // Year-to-date = the manually-maintained baseline (Settings > Yearly
  // totals) plus everything logged since the date that baseline was last
  // set (ytdBaselineDate) — not since the current pay period started, so it
  // keeps accumulating correctly across any number of future pay periods.
  //
  // ytdBaselineDate is the *last day already included* in the baseline
  // figure, so the "since" sum has to start the day after it — summing from
  // ytdBaselineDate itself (inclusive) double-counted any entry logged on
  // that exact date (already inside the baseline, then added again).
  computeYTD() {
    const settings = Store.getSettings();
    const todayStr = todayISO();
    const yearStart = startOfYearISO();
    const baselineDate = settings.ytdBaselineDate || yearStart;
    const ytdEntriesStart = baselineDate >= yearStart ? dayAfter(baselineDate) : yearStart;
    const sinceBaseline = Store.entriesInRange(ytdEntriesStart, todayStr)
      .reduce((s, e) => s + e.amount, 0);
    return (settings.ytdBaseline || 0) + sinceBaseline;
  },

  computeData() {
    const settings = Store.getSettings();
    const todayStr = todayISO();
    const { start: periodStart, end: periodEnd } = currentPeriodBounds();

    const periodEntries = Store.entriesInRange(periodStart, periodEnd);
    const periodTotal = periodEntries.reduce((s, e) => s + e.amount, 0);
    const bySite = {};
    for (const e of periodEntries) bySite[e.site] = (bySite[e.site] || 0) + e.amount;
    const siteBreakdown = Object.entries(bySite).sort((a, b) => b[1] - a[1]);

    const mtdTotal = Store.entriesInRange(startOfMonthISO(), todayStr)
      .reduce((s, e) => s + e.amount, 0);
    const ytdTotal = this.computeYTD();
    const payday = nextFridayAfter(periodEnd);
    const isPeriodOver = periodEnd < todayStr;

    const goalResults = (settings.goals || [])
      .filter(g => g.type)
      .map(g => this.computeGoalResult(g, { periodTotal, mtdTotal, ytdTotal }));

    return { periodTotal, siteBreakdown, payday, isPeriodOver, ytdTotal, goalResults };
  },

  computeGoalResult(goal, totals) {
    const current = goal.type === 'payPeriod' ? totals.periodTotal
      : goal.type === 'month' ? totals.mtdTotal
      : totals.ytdTotal;
    const pct = goal.amount > 0 ? Math.min(100, (current / goal.amount) * 100) : 0;
    const met = goal.amount > 0 && current >= goal.amount;

    let paceText = null;
    if (goal.type === 'year' && goal.amount > 0) {
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((startOfDay(now) - startOfYear) / 86400000) + 1;
      const y = now.getFullYear();
      const daysInYear = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
      const expectedYTD = goal.amount * (dayOfYear / daysInYear);
      const tolerance = expectedYTD * 0.02;
      if (Math.abs(current - expectedYTD) <= tolerance) paceText = 'On pace';
      else if (current > expectedYTD) paceText = 'Ahead of pace';
      else paceText = 'Behind pace';
    }

    return { type: goal.type, amount: goal.amount, current, pct, met, paceText };
  },

  buildHTML(data) {
    const paydayAmt = data.isPeriodOver
      ? `${fmtMoney(data.periodTotal)} estimated`
      : `${fmtMoney(data.periodTotal)} and counting`;

    const goalRows = data.goalResults.map(g => `
      <div class="goal-bar-row">
        <div class="goal-bar-label">${goalTypeLabel(g.type)} goal: <span class="money">${fmtMoney(g.current)} / ${fmtMoney(g.amount)}</span></div>
        <div class="goal-bar-track"><div class="goal-bar-fill${g.met ? ' met' : ''}" style="width:${g.pct}%"></div></div>
        ${g.paceText ? `<div class="goal-pace-text ${paceClass(g.paceText)}">${g.paceText}</div>` : ''}
      </div>
    `).join('');
    const goalsHtml = data.goalResults.length ? `<div class="goals-row">${goalRows}</div>` : '';

    const breakdownHtml = data.siteBreakdown.map(([site, amt]) =>
      `<div class="breakdown-row"><span>${escapeHtml(site === 'Other' ? otherGroupLabel() : site)}</span><span class="money">${fmtMoney(amt)}</span></div>`
    ).join('');

    return `
      <div class="dashboard-card">
        <div class="dash-payday-row">
          <div class="period-label">Next payday — ${fmtDateHuman(data.payday)}</div>
          <div class="dash-payday-amt money">${paydayAmt}</div>
        </div>
        <div class="stat-row">
          <div class="stat-card">
            <div class="period-label">Current pay period</div>
            <div class="stat-total money">${fmtMoney(data.periodTotal)}</div>
          </div>
          <div class="stat-card">
            <div class="period-label">Year to date</div>
            <div class="stat-total money">${fmtMoney(data.ytdTotal)}</div>
          </div>
        </div>
        ${breakdownHtml ? `<div class="breakdown">${breakdownHtml}</div>` : ''}
        ${goalsHtml}
      </div>
    `;
  }
};

function goalTypeLabel(type) {
  return { payPeriod: 'Pay period', month: 'Month', year: 'Year' }[type] || '';
}

function paceClass(paceText) {
  if (paceText === 'Ahead of pace') return 'ahead';
  if (paceText === 'Behind pace') return 'behind';
  return 'on-pace';
}

function applyHideAmounts() {
  document.body.classList.toggle('hide-amounts', !!Store.getSettings().hideDollarAmounts);
}

function dayAfter(dateISO) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}
