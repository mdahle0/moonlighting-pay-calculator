// Settings tab: API key, pay period, sites, rate groups.
const Settings = {
  init() {
    const settings = Store.getSettings();

    const apiKeyInput = document.getElementById('apiKeyInput');
    apiKeyInput.value = settings.apiKey || '';
    apiKeyInput.addEventListener('change', () => {
      Store.updateSettings({ apiKey: apiKeyInput.value.trim() });
    });

    const periodType = document.getElementById('periodType');
    periodType.value = settings.periodType;
    periodType.addEventListener('change', () => {
      Store.updateSettings({ periodType: periodType.value });
      Calendar.render();
      ManualEntry.refreshDateStrip();
    });

    const periodAnchor = document.getElementById('periodAnchor');
    periodAnchor.value = settings.periodAnchor;
    periodAnchor.addEventListener('change', () => {
      Store.updateSettings({ periodAnchor: periodAnchor.value });
      Calendar.render();
      ManualEntry.refreshDateStrip();
    });

    document.getElementById('addSiteBtn').addEventListener('click', () => this.addSite());
    document.getElementById('addRateGroupBtn').addEventListener('click', () => this.addRateGroup());

    this.renderSites();
    this.renderRateGroups();
    this.renderExamLabels();
  },

  expandedOverrides: new Set(),

  renderSites() {
    const list = document.getElementById('sitesList');
    const sites = Store.getSites();
    const groupOptions = Object.entries(Store.data.rateGroups)
      .map(([id, g]) => `<option value="${id}">${escapeHtml(g.name)}</option>`).join('');

    list.innerHTML = sites.map(site => {
      const isActive = site.active !== false;
      const hasOverrides = Store.siteHasOverrides(site.id);
      const expanded = this.expandedOverrides.has(site.id);
      return `
      <div class="site-block" data-id="${site.id}">
        <div class="settings-row site-row ${isActive ? '' : 'site-inactive'}">
          <input type="text" class="site-name" value="${escapeHtml(site.name)}" />
          <select class="site-group">${groupOptions}</select>
          <label class="toggle-switch" title="${isActive ? 'On — shown in Log a day' : 'Off — hidden from Log a day'}">
            <input type="checkbox" class="site-active-toggle" ${isActive ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="icon-btn remove-site" aria-label="Remove site">&times;</button>
        </div>
        <button type="button" class="link-btn site-override-toggle">${hasOverrides ? 'Custom rates ▾' : 'Customize rates ▾'}</button>
        ${expanded ? this.renderOverridePanel(site) : ''}
      </div>
    `;
    }).join('');

    list.querySelectorAll('.site-block').forEach(block => {
      const id = block.dataset.id;
      block.querySelector('.site-group').value = Store.getSite(id).rateGroupId;

      block.querySelector('.site-name').addEventListener('change', (e) => {
        Store.updateSite(id, { name: e.target.value.trim() || 'Unnamed site' });
        Calendar.render();
        ManualEntry.refreshSiteOptions();
      });
      block.querySelector('.site-group').addEventListener('change', (e) => {
        Store.updateSite(id, { rateGroupId: e.target.value });
        ManualEntry.refreshSiteOptions();
      });
      block.querySelector('.site-active-toggle').addEventListener('change', (e) => {
        Store.updateSite(id, { active: e.target.checked });
        block.querySelector('.site-row').classList.toggle('site-inactive', !e.target.checked);
        ManualEntry.refreshSiteOptions();
      });
      block.querySelector('.remove-site').addEventListener('click', () => {
        if (confirm(`Remove "${Store.getSite(id).name}"? Past entries keep their recorded amounts.`)) {
          Store.removeSite(id);
          this.renderSites();
          ManualEntry.refreshSiteOptions();
        }
      });
      block.querySelector('.site-override-toggle').addEventListener('click', () => {
        if (this.expandedOverrides.has(id)) this.expandedOverrides.delete(id);
        else this.expandedOverrides.add(id);
        this.renderSites();
      });

      block.querySelectorAll('.override-rate').forEach(input => {
        const examType = input.closest('.override-row').dataset.exam;
        input.addEventListener('change', () => {
          const site = Store.getSite(id);
          const val = parseFloat(input.value);
          if (isNaN(val)) return;
          const groupRate = Store.groupRateFor(site.rateGroupId, examType);
          if (val === groupRate) {
            Store.clearSiteRateOverride(id, examType);
          } else {
            Store.setSiteRateOverride(id, examType, val);
          }
          this.renderSites();
          ManualEntry.refreshSiteOptions();
        });
      });

      block.querySelectorAll('.reset-override').forEach(btn => {
        const examType = btn.closest('.override-row').dataset.exam;
        btn.addEventListener('click', () => {
          Store.clearSiteRateOverride(id, examType);
          this.renderSites();
          ManualEntry.refreshSiteOptions();
        });
      });
    });
  },

  renderOverridePanel(site) {
    const group = Store.getRateGroup(site.rateGroupId);
    const examTypes = group ? Object.keys(group.rates) : [];
    if (!examTypes.length) {
      return '<div class="override-panel"><p class="muted">This site\'s rate group has no exam types yet.</p></div>';
    }
    const rows = examTypes.map(examType => {
      const groupRate = Store.groupRateFor(site.rateGroupId, examType);
      const effectiveRate = Store.rateFor(site.id, examType);
      const hasOverride = site.rateOverrides && examType in site.rateOverrides;
      return `
        <div class="override-row" data-exam="${escapeHtml(examType)}">
          <span class="exam-name">${escapeHtml(examType)}</span>
          <span class="override-default muted">default ${fmtMoney(groupRate)}</span>
          <input type="number" class="override-rate" min="0" step="0.01" value="${effectiveRate}" />
          ${hasOverride ? '<button type="button" class="link-btn reset-override">Reset</button>' : '<span></span>'}
        </div>
      `;
    }).join('');
    return `<div class="override-panel">${rows}</div>`;
  },

  addSite() {
    const firstGroupId = Object.keys(Store.data.rateGroups)[0];
    Store.addSite('New Site', firstGroupId);
    this.renderSites();
    ManualEntry.refreshSiteOptions();
  },

  renderRateGroups() {
    const list = document.getElementById('rateGroupsList');
    const groups = Store.data.rateGroups;

    list.innerHTML = Object.entries(groups).map(([groupId, group]) => {
      const rateRows = Object.entries(group.rates).map(([examType, rate]) => `
        <div class="rate-row" data-exam="${escapeHtml(examType)}">
          <span class="exam-name">${escapeHtml(examType)}</span>
          <input type="number" class="rate-value" min="0" step="0.01" value="${rate}" />
          <button class="icon-btn remove-exam" aria-label="Remove exam type">&times;</button>
        </div>
      `).join('');

      const sitesUsingGroup = Store.getSites().filter(s => s.rateGroupId === groupId);
      const sitesLine = sitesUsingGroup.length
        ? `Used by: ${sitesUsingGroup.map(s => escapeHtml(s.name)).join(', ')}`
        : 'Not used by any site yet.';

      return `
        <div class="rate-group-card" data-group="${groupId}">
          <div class="rate-group-header">
            <input type="text" class="group-name" value="${escapeHtml(group.name)}" />
            <button class="icon-btn remove-group" aria-label="Remove rate group">&times;</button>
          </div>
          <p class="rate-group-sites muted">${sitesLine}</p>
          <div class="rate-list">${rateRows}</div>
          <div class="add-exam-row">
            <input type="text" class="new-exam-name" placeholder="Exam type (e.g. CT)" />
            <input type="number" class="new-exam-rate" placeholder="Rate" min="0" step="0.01" />
            <button class="secondary-btn add-exam-btn">+ Add</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.rate-group-card').forEach(card => {
      const groupId = card.dataset.group;

      card.querySelector('.group-name').addEventListener('change', (e) => {
        Store.updateRateGroupName(groupId, e.target.value.trim() || 'Unnamed group');
        this.renderSites();
      });

      card.querySelector('.remove-group').addEventListener('click', () => {
        if (Store.getSites().some(s => s.rateGroupId === groupId)) {
          alert('Reassign or remove the sites using this rate group first.');
          return;
        }
        if (confirm(`Remove rate group "${Store.getRateGroup(groupId).name}"?`)) {
          Store.removeRateGroup(groupId);
          this.renderRateGroups();
        }
      });

      card.querySelectorAll('.rate-row').forEach(row => {
        const examType = row.dataset.exam;
        row.querySelector('.rate-value').addEventListener('change', (e) => {
          Store.setRate(groupId, examType, parseFloat(e.target.value) || 0);
          ManualEntry.refreshSiteOptions();
        });
        row.querySelector('.remove-exam').addEventListener('click', () => {
          Store.removeExamType(groupId, examType);
          this.renderRateGroups();
          this.renderExamLabels();
          ManualEntry.refreshSiteOptions();
        });
      });

      card.querySelector('.add-exam-btn').addEventListener('click', () => {
        const nameInput = card.querySelector('.new-exam-name');
        const rateInput = card.querySelector('.new-exam-rate');
        const name = nameInput.value.trim();
        const rate = parseFloat(rateInput.value);
        if (!name || isNaN(rate)) return;
        Store.setRate(groupId, name, rate);
        this.renderRateGroups();
        this.renderExamLabels();
        ManualEntry.refreshSiteOptions();
      });
    });
  },

  addRateGroup() {
    const name = prompt('Name for the new rate group:', 'New Rate Group');
    if (!name) return;
    Store.addRateGroup(name.trim());
    this.renderRateGroups();
  },

  renderExamLabels() {
    const list = document.getElementById('examLabelsList');
    const types = Store.allKnownExamTypes().sort();

    list.innerHTML = types.map(examType => `
      <div class="settings-row exam-label-row" data-exam="${escapeHtml(examType)}">
        <span class="exam-name">${escapeHtml(examType)}</span>
        <input type="text" class="exam-label-input" placeholder="e.g. Low-dose CT" value="${escapeHtml(Store.getExamLabel(examType))}" />
      </div>
    `).join('');

    list.querySelectorAll('.exam-label-row').forEach(row => {
      const examType = row.dataset.exam;
      row.querySelector('.exam-label-input').addEventListener('change', (e) => {
        Store.setExamLabel(examType, e.target.value.trim());
      });
    });
  }
};
