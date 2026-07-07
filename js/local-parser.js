// Free, offline text parser for "Tell me what you did" — no Claude API key
// required. Recognizes site names (plus common nicknames) and exam-type
// synonyms via pattern matching, so most everyday phrasing ("Today at
// Louisville I did 8 CTs and 2 ultrasounds") can be logged without ever
// calling an API. Falls back to asking a clarifying question when something
// is genuinely ambiguous (see fluoro handling below) rather than guessing
// wrong on something that affects pay.
//
// Built-in synonyms are deliberately generic radiology terminology, not
// user-specific config — a user's own exam type codes and custom labels
// (Settings > Exam type meanings) are layered on top automatically at parse
// time in buildExamAliasMap().
const EXAM_TYPE_SYNONYMS = {
  'CT': ['ct', 'cat scan', 'cat-scan', 'catscan', 'ct scan'],
  'LDCT': ['ldct', 'low dose ct', 'low-dose ct', 'lowdose ct', 'low dose', 'low-dose', 'screening ct', 'lung screening ct'],
  'CT (multi)': ['multiphase ct', 'multi-phase ct', 'multi phase ct', 'triple phase ct', 'three phase ct', 'multiphasic ct'],
  // Deliberately no bare "runoff"/"run off" — too easily confused with the
  // ordinary English phrase outside a radiology context.
  'CT Runoff': ['ct runoff', 'ct run-off', 'ct run off', 'cta runoff', 'ct angio runoff', 'lower extremity runoff', 'les runoff'],
  'MR': ['mri', 'magnetic resonance', 'mri scan'],
  'US': ['ultrasound', 'sono', 'sonogram', 'sonography'],
  'XR': ['x-ray', 'xray', 'x ray', 'plain film', 'radiograph'],
  'DEXA': ['dexa', 'dxa', 'bone density', 'bone density scan', 'bone densitometry'],
  'LCS': ['lcs', 'lung cancer screening', 'lung cancer screener', 'lung screening'],
  'PET/CT': ['pet/ct', 'pet-ct', 'petct', 'pet scan'],
  // Fluoroscopy pays differently depending on whether a radiologist was
  // physically present, so an unqualified "fluoro" is treated as ambiguous
  // (see FLUORO_AMBIGUOUS_TERMS below) and never silently guessed.
  'Fluoro (Rad)': ['fluoro with rad', 'fluoro with radiologist', 'fluoroscopy with radiologist', 'diagnostic fluoro', 'rad fluoro', 'fluoro rad present', 'fluoro with a radiologist'],
  'Fluoro (No Rad)': [
    'fluoro no rad', 'fluoro without rad', 'fluoroscopy without radiologist', 'no rad fluoro',
    'procedural fluoro', 'procedural fluoroscopy', 'intraoperative fluoro', 'intraoperative fluoroscopy',
    'intra-operative fluoro', 'intra-operative fluoroscopy', 'or fluoro', 'surgeon fluoro',
    'tech only fluoro', 'tech-only fluoro', 'fluoro without a radiologist', 'fluoro no radiologist'
  ]
};

// Matched but genuinely ambiguous — triggers a clarifying question instead
// of a guess, since the two fluoro categories pay different rates.
const FLUORO_AMBIGUOUS_TERMS = ['fluoro', 'fluoroscopy'];

// Aliases short/common enough to collide with ordinary English ("us" the
// pronoun, "mr" the title) are only accepted when a count is found
// immediately before them — otherwise they're dropped rather than flagged,
// since they're more likely a false positive than a real mention. (These
// reach the alias map via the exact-exam-type-code pathway in
// buildExamAliasMap(), not the synonym list below.)
const STRICT_COUNT_ALIASES = new Set(['us', 'mr']);

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const LocalParser = {
  // Returns one of:
  //   { status: 'entries', entries: [...], warnings: [...] }
  //   { status: 'clarify', question, choices: [{label, apply(text) -> text}], remainingText }
  //   { status: 'empty' }
  parse(rawText) {
    const text = rawText.trim();
    if (!text) return { status: 'empty' };

    const fluoroClarify = this.findFluoroAmbiguity(text);
    if (fluoroClarify) return fluoroClarify;

    const date = this.resolveDate(text);
    const sites = Store.getActiveSites().map(s => ({ site: s, aliases: siteAliases(s) }));
    const siteMatches = this.findSiteMatches(text, sites);

    const segments = this.buildSegments(text, siteMatches);
    const examAliasMap = buildExamAliasMap();

    const warnings = [];
    const rawEntries = [];
    for (const seg of segments) {
      const examMatches = findAllMatches(seg.text, examAliasMap);
      let cursor = 0;
      for (const m of examMatches) {
        const count = findCountBefore(seg.text, m.start, cursor);
        cursor = m.end;
        if (count == null) {
          if (STRICT_COUNT_ALIASES.has(m.alias)) continue; // likely false positive, drop silently
          warnings.push(`Not sure how many "${m.matchedText.trim()}"${seg.site ? ` at ${seg.site.name}` : ''} — add it manually if it should be counted.`);
          continue;
        }
        // Flag exam types not yet configured for the matched site (e.g. a
        // newly-recognized PET/CT or fluoro term before its rate is set up
        // in Settings > Rate groups) so the review row highlights it instead
        // of silently defaulting to a $0/wrong rate.
        const unknownExamType = seg.site ? !Store.examTypesForSite(seg.site.id).includes(m.canonical) : undefined;
        const entry = { date, site: seg.site ? seg.site.name : undefined, examType: m.canonical, count };
        if (unknownExamType) entry.unknownExamType = true;
        rawEntries.push(entry);
      }
    }

    // Combine repeated mentions of the same date/site/examType by summing counts.
    const combined = new Map();
    for (const e of rawEntries) {
      const key = `${e.date}|${e.site || ''}|${e.examType}`;
      if (combined.has(key)) combined.get(key).count += e.count;
      else combined.set(key, { ...e });
    }
    const entries = [...combined.values()];

    if (!entries.length) return { status: 'empty', warnings };
    return { status: 'entries', entries, warnings };
  },

  // A bare "fluoro"/"fluoroscopy" with no rad-presence qualifier nearby is
  // ambiguous since it affects pay rate — ask instead of guessing. Checks a
  // window around each mention for a qualifier before flagging it.
  findFluoroAmbiguity(text) {
    const lower = text.toLowerCase();
    for (const term of FLUORO_AMBIGUOUS_TERMS) {
      const re = new RegExp(`\\b${term}\\b`, 'gi');
      let m;
      while ((m = re.exec(lower))) {
        const windowStart = Math.max(0, m.index - 40);
        const windowEnd = Math.min(lower.length, m.index + term.length + 40);
        const window = lower.slice(windowStart, windowEnd);
        const qualified = EXAM_TYPE_SYNONYMS['Fluoro (Rad)'].some(a => window.includes(a))
          || EXAM_TYPE_SYNONYMS['Fluoro (No Rad)'].some(a => window.includes(a));
        if (qualified) continue;

        const matchStart = m.index, matchEnd = m.index + m[0].length;
        return {
          status: 'clarify',
          question: `You mentioned "${text.slice(matchStart, matchEnd)}" — was a radiologist physically present for that (pays differently)?`,
          choices: [
            { label: 'Radiologist present', apply: (t) => t.slice(0, matchStart) + 'fluoro with rad' + t.slice(matchEnd) },
            { label: 'No radiologist (procedural/intraoperative)', apply: (t) => t.slice(0, matchStart) + 'fluoro no rad' + t.slice(matchEnd) }
          ]
        };
      }
    }
    return null;
  },

  // "today" (default) / "yesterday" / a weekday name (most recent past
  // occurrence) / numeric M/D / "Month Dth". Only resolves a single date per
  // message — a message spanning multiple distinct days isn't supported by
  // the free parser (add a Claude API key for that, or log each day separately).
  resolveDate(text) {
    const lower = text.toLowerCase();
    if (/\byesterday\b/.test(lower)) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return isoDate(d);
    }
    if (/\btoday\b/.test(lower)) return todayISO();

    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(lower)) {
        const d = new Date();
        const todayDow = d.getDay();
        const diff = (todayDow - i + 7) % 7;
        d.setDate(d.getDate() - diff);
        return isoDate(d);
      }
    }

    const monthMatch = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(st|nd|rd|th)?\b/);
    if (monthMatch) {
      const month = MONTH_NAMES.indexOf(monthMatch[1]);
      const day = parseInt(monthMatch[2], 10);
      const year = new Date().getFullYear();
      return isoDate(new Date(year, month, day));
    }

    const numericMatch = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (numericMatch) {
      const month = parseInt(numericMatch[1], 10) - 1;
      const day = parseInt(numericMatch[2], 10);
      const year = new Date().getFullYear();
      return isoDate(new Date(year, month, day));
    }

    return todayISO();
  },

  findSiteMatches(text, sitesWithAliases) {
    const aliasMap = new Map();
    for (const { site, aliases } of sitesWithAliases) {
      for (const alias of aliases) {
        // Longer/more specific alias wins if two sites share a word.
        if (!aliasMap.has(alias) || aliasMap.get(alias).name.length < site.name.length) {
          aliasMap.set(alias, site);
        }
      }
    }
    return findAllMatches(text, aliasMap, true);
  },

  // Splits text into per-site chunks: if exactly one site is mentioned, the
  // whole message belongs to it (handles the common "Today at Louisville I
  // did X, Y, Z" pattern even when exam mentions appear before the site
  // name). With multiple site mentions, text between one site mention and
  // the next belongs to the first. With zero, the whole message is one
  // segment with no site (matches the Claude path's "omit site" behavior).
  buildSegments(text, siteMatches) {
    if (siteMatches.length === 0) return [{ site: null, text }];
    if (siteMatches.length === 1) return [{ site: siteMatches[0].canonical, text }];

    const segments = [];
    for (let i = 0; i < siteMatches.length; i++) {
      const start = siteMatches[i].end;
      const end = i + 1 < siteMatches.length ? siteMatches[i + 1].start : text.length;
      segments.push({ site: siteMatches[i].canonical, text: text.slice(start, end) });
    }
    return segments;
  }
};

// "Mountain Home (Knoxville)" -> also matches "mountain home" and
// "knoxville" individually, generically for any parenthetical site name
// rather than a hardcoded nickname table.
function siteAliases(site) {
  const aliases = new Set();
  const name = site.name.trim();
  aliases.add(name.toLowerCase());
  const parenMatch = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    if (parenMatch[1].trim()) aliases.add(parenMatch[1].trim().toLowerCase());
    if (parenMatch[2].trim()) aliases.add(parenMatch[2].trim().toLowerCase());
  }
  return [...aliases];
}

// Every exam type actually configured in any rate group (exact code + any
// custom label from Settings > Exam type meanings) layered on top of the
// built-in synonym dictionary, so custom/renamed exam types stay matchable.
function buildExamAliasMap() {
  const map = new Map();
  const addAlias = (alias, canonical) => {
    const a = alias.trim().toLowerCase();
    if (a) map.set(a, canonical);
  };
  for (const [canonical, aliases] of Object.entries(EXAM_TYPE_SYNONYMS)) {
    for (const alias of aliases) addAlias(alias, canonical);
  }
  for (const group of Object.values(Store.data.rateGroups)) {
    for (const examType of Object.keys(group.rates)) {
      addAlias(examType, examType);
      const label = Store.getExamLabel(examType);
      if (label) addAlias(label, examType);
    }
  }
  return map;
}

// Longest-match-wins substring matching for a lowercase-alias -> value map
// (used for both site names and exam types). Optionally allows a trailing
// "s" for plurals (exam types only — site names never pluralize).
function findAllMatches(text, aliasMap, isSiteMap) {
  const candidates = [];
  for (const [alias, value] of aliasMap.entries()) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = isSiteMap ? `\\b${escaped}\\b` : `\\b${escaped}s?\\b`;
    const re = new RegExp(pattern, 'gi');
    let m;
    while ((m = re.exec(text))) {
      candidates.push({
        start: m.index,
        end: m.index + m[0].length,
        canonical: value, // a Site object when isSiteMap, else the canonical exam type string
        alias,
        matchedText: m[0]
      });
    }
  }
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const accepted = [];
  const claimed = [];
  for (const c of candidates) {
    const overlaps = claimed.some(([s, e]) => c.start < e && c.end > s);
    if (!overlaps) {
      accepted.push(c);
      claimed.push([c.start, c.end]);
    }
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

// Looks backward from matchStart (never before `boundary`, the end of the
// previous match) for the nearest number — digit or spelled-out word,
// skipping a small number of filler words in between.
function findCountBefore(text, matchStart, boundary) {
  const before = text.slice(Math.max(boundary, 0), matchStart);
  const tokens = before.trim().split(/\s+/).filter(Boolean);
  const fillers = new Set(['of', 'the', 'and', 'did', 'i', 'we', 'also', 'plus', 'then']);
  const scanFrom = Math.max(0, tokens.length - 6);
  for (let i = tokens.length - 1; i >= scanFrom; i--) {
    const tok = tokens[i].replace(/[.,]/g, '').toLowerCase();
    if (/^\d+$/.test(tok)) return parseInt(tok, 10);
    if (tok in NUMBER_WORDS) return NUMBER_WORDS[tok];
    if (fillers.has(tok)) continue;
    break;
  }
  return null;
}
