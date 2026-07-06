// Data model + persistence (localStorage). Everything else reads/writes through Store.
const STORAGE_KEY = 'moonlighting.v1';

function defaultData() {
  return {
    rateGroups: {
      louisville: {
        name: 'Louisville',
        rates: { 'LDCT': 90, 'CT': 105, 'CT (multi)': 125, 'CT Runoff': 200, 'MR': 125, 'US': 50, 'XR': 20, 'DEXA': 30 }
      },
      other: {
        name: 'Memphis / Mountain Home / Lexington / Tennessee Valley',
        rates: { 'LCS': 100, 'CT': 65, 'MR': 85, 'US': 50, 'XR': 20 }
      }
    },
    sites: [
      { id: 'louisville', name: 'Louisville', rateGroupId: 'louisville' },
      { id: 'memphis', name: 'Memphis', rateGroupId: 'other' },
      { id: 'knoxville', name: 'Mountain Home (Knoxville)', rateGroupId: 'other' },
      { id: 'lexington', name: 'Lexington', rateGroupId: 'other' },
      { id: 'tennessee-valley', name: 'Tennessee Valley (Nashville)', rateGroupId: 'other' }
    ],
    entries: [],
    schemaVersion: 3,
    examLabels: {
      'LDCT': 'Low-dose CT',
      'CT (multi)': 'Multiphase CT',
      'CT Runoff': 'CT runoff (vascular)',
      'XR': 'X-ray',
      'MR': 'MRI',
      'LCS': 'Lung cancer screening / lung cancer screener',
      'US': 'Ultrasound',
      'DEXA': 'Bone density (DEXA) scan'
    },
    settings: {
      apiKey: '',
      periodType: 'biweekly',
      periodAnchor: '2026-06-28',
      // Manual true-up figures (Settings > Yearly totals), for months/weeks
      // that weren't logged in the app. See Calendar's year-to-date math.
      ytdBaseline: 0,
      previousYearTotal: 0,
      displayName: ''
    }
  };
}

function todayISO() {
  const d = new Date();
  return isoDate(d);
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// A few exam types are CT-based but don't have "CT" in their abbreviation
// (e.g. LCS — lung cancer screening — is performed via low-dose CT).
const CT_LIKE_EXAM_TYPES = new Set(['LCS']);

function isCTExamType(examType) {
  return /ct/i.test(examType) || CT_LIKE_EXAM_TYPES.has(examType);
}

// Stable sort: CT-related exam types (CT, LDCT, CT Runoff, etc.) always
// come before everything else, preserving relative order within each group.
function sortExamTypesGrouped(types) {
  return [...types].sort((a, b) => (isCTExamType(a) ? 0 : 1) - (isCTExamType(b) ? 0 : 1));
}

const Store = {
  data: null,
  _userId: null,
  _remoteEnabled: false,
  _syncTimer: null,

  // Local-only bootstrap: used when no Supabase session exists yet (or
  // Supabase isn't configured at all), so the app still works standalone.
  load() {
    const raw = localStorage.getItem(this._localStorageKey());
    if (raw) {
      try {
        this.data = JSON.parse(raw);
      } catch (e) {
        this.data = defaultData();
      }
    } else {
      this.data = defaultData();
    }
    this.applyMigrations();
    this._writeLocal();
    return this.data;
  },

  // Auth-backed bootstrap: hydrates this.data from the user's Supabase row
  // (creating one with defaultData() if this is their first login), then
  // enables background sync for future save() calls.
  async loadRemote(userId) {
    this._userId = userId;
    const { data: row, error } = await window.supabaseClient
      .from('user_data')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Failed to load remote data, starting from a fresh copy:', error.message);
    }
    if (row && row.data) {
      this.data = row.data;
      this.applyMigrations();
    } else {
      this.data = defaultData();
      const { error: insertError } = await window.supabaseClient
        .from('user_data')
        .insert({ user_id: userId, data: this.data });
      if (insertError) console.warn('Failed to create remote row:', insertError.message);
    }
    this._remoteEnabled = true;
    this._writeLocal();
    return this.data;
  },

  // Forward-compatibility: fills in any top-level keys added since a user's
  // data was last saved, then runs one-time schema migrations.
  applyMigrations() {
    const priorSchemaVersion = this.data.schemaVersion || 0;
    const d = defaultData();
    for (const k of Object.keys(d)) {
      if (!(k in this.data)) this.data[k] = d[k];
    }
    // Fill in any settings keys added since a user's data was last saved.
    for (const k of Object.keys(d.settings)) {
      if (!(k in this.data.settings)) this.data.settings[k] = d.settings[k];
    }
    // One-time migration: the old placeholder "Other Sites" bucket becomes the
    // three actual sites (Memphis, Knoxville, Lexington), all on the same rate group.
    const placeholderIdx = this.data.sites.findIndex(s => s.id === 'other' && s.name === 'Other Sites');
    if (placeholderIdx !== -1) {
      this.data.sites.splice(placeholderIdx, 1,
        { id: 'memphis', name: 'Memphis', rateGroupId: 'other' },
        { id: 'knoxville', name: 'Knoxville (Mountain Home)', rateGroupId: 'other' },
        { id: 'lexington', name: 'Lexington', rateGroupId: 'other' }
      );
      if (this.data.rateGroups.other && this.data.rateGroups.other.name === 'Other Sites') {
        this.data.rateGroups.other.name = 'Memphis / Knoxville / Lexington';
      }
    }
    // One-time migration (schema v2): add Tennessee Valley to that same group.
    if (priorSchemaVersion < 2) {
      if (!this.data.sites.some(s => s.name === 'Tennessee Valley' || s.name === 'Tennessee Valley (Nashville)')) {
        this.data.sites.push({ id: 'tennessee-valley', name: 'Tennessee Valley (Nashville)', rateGroupId: 'other' });
      }
      this.data.schemaVersion = 2;
    }
    // One-time migration (schema v3): rename sites to their clearer forms.
    // Only touches names that still match the old defaults exactly, so a
    // deliberate rename by the user is left alone.
    if (priorSchemaVersion < 3) {
      const knoxville = this.data.sites.find(s => s.id === 'knoxville' && s.name === 'Knoxville (Mountain Home)');
      if (knoxville) knoxville.name = 'Mountain Home (Knoxville)';
      const tennesseeValley = this.data.sites.find(s => s.id === 'tennessee-valley' && s.name === 'Tennessee Valley');
      if (tennesseeValley) tennesseeValley.name = 'Tennessee Valley (Nashville)';
      this.data.schemaVersion = 3;
    }
  },

  save() {
    this._writeLocal();
    this._scheduleRemoteSync();
  },

  _localStorageKey() {
    return this._userId ? `${STORAGE_KEY}.${this._userId}` : STORAGE_KEY;
  },

  _writeLocal() {
    localStorage.setItem(this._localStorageKey(), JSON.stringify(this.data));
  },

  _scheduleRemoteSync() {
    if (!this._remoteEnabled) return;
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this._pushToRemote(), 1000);
  },

  async _pushToRemote() {
    if (!this._remoteEnabled || !window.supabaseClient || !this._userId) return;
    try {
      const { error } = await window.supabaseClient
        .from('user_data')
        .upsert({ user_id: this._userId, data: this.data });
      if (error) console.warn('Supabase sync failed:', error.message);
    } catch (e) {
      console.warn('Supabase sync failed:', e);
    }
  },

  // Called on logout: drop in-memory/session state so the next login starts clean.
  reset() {
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = null;
    this._userId = null;
    this._remoteEnabled = false;
    this.data = null;
  },

  // ---- Sites & rate groups ----
  getSites() {
    return this.data.sites;
  },
  // Sites toggled off in Settings are kept (for past entries and easy
  // re-enabling) but excluded from anywhere you'd log new work.
  getActiveSites() {
    return this.data.sites.filter(s => s.active !== false);
  },
  getSite(id) {
    return this.data.sites.find(s => s.id === id);
  },
  getRateGroup(id) {
    return this.data.rateGroups[id];
  },
  // The display order for a group's exam types. Uses the group's saved
  // examOrder if it still matches the current set of rate keys exactly;
  // otherwise (never set, or an exam type was added/removed) falls back to
  // the automatic CT-grouped order. Object key order can't be trusted for
  // this — jsonb storage (Supabase) doesn't preserve JS object key order on
  // round-trip, so any persisted ordering has to live in an explicit array.
  orderedExamTypes(groupId) {
    const group = this.data.rateGroups[groupId];
    if (!group) return [];
    const currentTypes = Object.keys(group.rates);
    const order = group.examOrder;
    if (order && order.length === currentTypes.length && order.every(t => currentTypes.includes(t))) {
      return order;
    }
    return sortExamTypesGrouped(currentTypes);
  },
  examTypesForSite(siteId) {
    const site = this.getSite(siteId);
    if (!site) return [];
    const group = this.getRateGroup(site.rateGroupId);
    const groupOrder = group ? this.orderedExamTypes(site.rateGroupId) : [];
    const overrideTypes = site.rateOverrides ? Object.keys(site.rateOverrides) : [];
    const extraTypes = overrideTypes.filter(t => !groupOrder.includes(t));
    return [...groupOrder, ...sortExamTypesGrouped(extraTypes)];
  },
  // A site's own rate, if it has an override for this exam type, otherwise
  // falls back to its rate group's shared rate.
  rateFor(siteId, examType) {
    const site = this.getSite(siteId);
    if (!site) return null;
    if (site.rateOverrides && examType in site.rateOverrides) return site.rateOverrides[examType];
    const group = this.getRateGroup(site.rateGroupId);
    if (!group) return null;
    return group.rates[examType] ?? null;
  },
  groupRateFor(rateGroupId, examType) {
    const group = this.getRateGroup(rateGroupId);
    return group ? (group.rates[examType] ?? null) : null;
  },
  siteHasOverrides(siteId) {
    const site = this.getSite(siteId);
    return !!(site && site.rateOverrides && Object.keys(site.rateOverrides).length > 0);
  },
  setSiteRateOverride(siteId, examType, rate) {
    const site = this.getSite(siteId);
    if (!site) return;
    if (!site.rateOverrides) site.rateOverrides = {};
    site.rateOverrides[examType] = rate;
    this.save();
  },
  clearSiteRateOverride(siteId, examType) {
    const site = this.getSite(siteId);
    if (!site || !site.rateOverrides) return;
    delete site.rateOverrides[examType];
    this.save();
  },
  addSite(name, rateGroupId) {
    const id = uid();
    this.data.sites.push({ id, name, rateGroupId });
    this.save();
    return id;
  },
  updateSite(id, patch) {
    const site = this.getSite(id);
    if (!site) return;
    Object.assign(site, patch);
    this.save();
  },
  removeSite(id) {
    this.data.sites = this.data.sites.filter(s => s.id !== id);
    this.save();
  },
  addRateGroup(name) {
    const id = uid();
    this.data.rateGroups[id] = { name, rates: {} };
    this.save();
    return id;
  },
  updateRateGroupName(id, name) {
    if (!this.data.rateGroups[id]) return;
    this.data.rateGroups[id].name = name;
    this.save();
  },
  setRate(groupId, examType, rate) {
    const group = this.data.rateGroups[groupId];
    if (!group) return;
    group.rates[examType] = rate;
    this.save();
  },
  removeExamType(groupId, examType) {
    const group = this.data.rateGroups[groupId];
    if (!group) return;
    delete group.rates[examType];
    this.save();
  },
  // Moves an exam type up/down within its CT/non-CT group — CT-related types
  // always sort before others, so reordering is scoped within that partition.
  // Persisted as an explicit examOrder array, not object key order, since
  // jsonb storage (Supabase) doesn't preserve JS object key order.
  reorderExamType(groupId, examType, direction) {
    const group = this.data.rateGroups[groupId];
    if (!group) return;
    const order = [...this.orderedExamTypes(groupId)];
    const idx = order.indexOf(examType);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= order.length) return;
    if (isCTExamType(order[idx]) !== isCTExamType(order[swapIdx])) return;
    [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
    group.examOrder = order;
    this.save();
  },
  removeRateGroup(id) {
    delete this.data.rateGroups[id];
    this.data.sites = this.data.sites.filter(s => s.rateGroupId !== id);
    this.save();
  },

  // ---- Exam type glossary (full names / synonyms, used in the UI and to help the chatbot) ----
  allKnownExamTypes() {
    const types = new Set(Object.keys(this.data.examLabels));
    for (const group of Object.values(this.data.rateGroups)) {
      for (const t of Object.keys(group.rates)) types.add(t);
    }
    return [...types];
  },
  getExamLabel(examType) {
    return this.data.examLabels[examType] || '';
  },
  setExamLabel(examType, label) {
    if (label) {
      this.data.examLabels[examType] = label;
    } else {
      delete this.data.examLabels[examType];
    }
    this.save();
  },

  // ---- Entries ----
  addEntry(entry) {
    entry.id = uid();
    this.data.entries.push(entry);
    this.save();
    return entry.id;
  },
  updateEntry(id, patch) {
    const e = this.data.entries.find(e => e.id === id);
    if (!e) return;
    Object.assign(e, patch);
    this.save();
  },
  removeEntry(id) {
    this.data.entries = this.data.entries.filter(e => e.id !== id);
    this.save();
  },
  entriesForDate(dateISO) {
    return this.data.entries.filter(e => e.date === dateISO);
  },
  entriesForDateSite(dateISO, siteName) {
    return this.data.entries.filter(e => e.date === dateISO && e.site === siteName);
  },
  setDayForSite(dateISO, siteName, lineItems) {
    this.data.entries = this.data.entries.filter(e => !(e.date === dateISO && e.site === siteName));
    for (const item of lineItems) {
      this.data.entries.push({ id: uid(), date: dateISO, site: siteName, ...item });
    }
    this.save();
  },
  entriesInRange(startISO, endISO) {
    return this.data.entries.filter(e => e.date >= startISO && e.date <= endISO);
  },
  totalForDate(dateISO) {
    return this.entriesForDate(dateISO).reduce((sum, e) => sum + e.amount, 0);
  },

  // ---- Settings ----
  getSettings() {
    return this.data.settings;
  },
  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.save();
  }
};
