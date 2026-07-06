// Voice capture + Claude API parsing + review-before-commit UI.
//
// Note: only Chromium-based browsers (Chrome, Edge) implement the Web Speech
// API's SpeechRecognition interface. Safari does not, so the mic button below
// is a bonus for Chrome/Edge users — the reliable path on a Mac is always
// macOS's own Dictation (fn fn, or Edit > Start Dictation) typed straight into
// the text box, which needs no browser support at all.
const Chat = {
  recognition: null,
  listening: false,
  wantsListening: false,
  restartAttempts: 0,

  init() {
    document.getElementById('parseBtn').addEventListener('click', () => this.parse());
    this.initMic();
  },

  initMic() {
    const micBtn = document.getElementById('micBtn');
    const statusEl = document.getElementById('micStatus');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.disabled = true;
      micBtn.title = 'This browser doesn’t support the mic button — use macOS Dictation instead (see tip below).';
      statusEl.textContent = 'Mic button unavailable here — use macOS Dictation instead (tip below).';
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    const textArea = document.getElementById('chatText');
    let finalTranscript = '';

    this.recognition.onstart = () => {
      this.listening = true;
      this.restartAttempts = 0;
      finalTranscript = textArea.value ? textArea.value + ' ' : '';
      micBtn.classList.add('recording');
      statusEl.textContent = 'Listening…';
    };

    this.recognition.onresult = (event) => {
      this.restartAttempts = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interim += transcript;
        }
      }
      textArea.value = (finalTranscript + interim).trim();
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'audio-capture' || event.error === 'network') {
        // Transient — onend will fire next and auto-restart if the user is still recording.
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wantsListening = false;
        statusEl.textContent = 'Microphone access denied — check System Settings > Privacy > Microphone.';
        return;
      }
      statusEl.textContent = `Mic error: ${event.error}`;
    };

    this.recognition.onend = () => {
      this.listening = false;
      micBtn.classList.remove('recording');

      if (this.wantsListening && this.restartAttempts < 5) {
        // Chrome silently ends recognition after a few seconds of silence even
        // with continuous=true — restart transparently so dictation doesn't
        // just stop mid-sentence while the user is still talking.
        this.restartAttempts++;
        setTimeout(() => {
          if (this.wantsListening) {
            try { this.recognition.start(); } catch (e) { /* already running */ }
          }
        }, 250);
        statusEl.textContent = 'Listening…';
      } else {
        this.wantsListening = false;
        statusEl.textContent = '';
      }
    };

    micBtn.addEventListener('click', () => {
      if (this.listening || this.wantsListening) {
        this.wantsListening = false;
        this.recognition.stop();
      } else {
        this.wantsListening = true;
        try { this.recognition.start(); } catch (e) { /* already started */ }
      }
    });
  },

  async parse() {
    const errorEl = document.getElementById('chatError');
    const reviewArea = document.getElementById('reviewArea');
    errorEl.textContent = '';
    reviewArea.innerHTML = '';

    const textArea = document.getElementById('chatText');
    const text = normalizeDictationText(textArea.value.trim());
    textArea.value = text;
    if (!text) {
      errorEl.textContent = 'Say or type what you did first.';
      return;
    }
    const apiKey = Store.getSettings().apiKey;
    if (!apiKey) {
      errorEl.textContent = 'Add your Claude API key in Settings first.';
      return;
    }

    const parseBtn = document.getElementById('parseBtn');
    parseBtn.disabled = true;
    parseBtn.textContent = 'Parsing…';

    try {
      const parsed = await this.callClaude(text, apiKey);
      this.renderReview(parsed);
    } catch (err) {
      errorEl.textContent = err.message || 'Could not parse that. Try rephrasing.';
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = 'Parse';
    }
  },

  async callClaude(text, apiKey) {
    const sites = Store.getActiveSites().map(s => ({
      name: s.name,
      examTypes: Store.examTypesForSite(s.id).map(t => {
        const label = Store.getExamLabel(t);
        return label ? `${t} (aka: ${label})` : t;
      })
    }));
    const today = todayISO();
    const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' });

    const systemPrompt = `You convert a radiologist's spoken/typed description of moonlighting work into structured log entries.
Today's date is ${today} (${weekday}). Resolve relative dates ("today", "yesterday", "last Monday", "this past Tuesday and Wednesday") against that.
Known sites and their valid exam types (use these exact codes, and only these; the "aka" in parentheses is just so you can recognize when the person says the full name or a synonym instead of the code, e.g. "low dose CT" or "low-dose CT" means LDCT, "MRI" means MR, "x-ray" or "xray" means XR, "multiphase CT" or "multi-phase CT" means CT (multi), "lung cancer screening" or "lung cancer screener" means LCS):
${JSON.stringify(sites, null, 2)}
Speech-to-text often mishears "low dose" as similar-sounding words like "lotto", "lettuce", or "lotus" — treat any of those (or other clear phonetic near-misses of "low dose") as meaning "low dose".
If the person mentions a site not in this list, use their wording for "site" as-is.
If the person mentions an exam type not listed for that site, still include it with their wording, but add "unknownExamType": true on that entry.
If no site is mentioned, omit "site" for that entry.
If no date is mentioned, use today's date.
Respond with ONLY a JSON array (no markdown fences, no prose) of objects shaped like:
{"date": "YYYY-MM-DD", "site": "Louisville", "examType": "CT", "count": 8}
Combine repeated mentions of the same site/date/examType into a single entry by summing counts.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }]
      })
    });

    if (!resp.ok) {
      const body = await resp.text();
      let msg = `API error (${resp.status})`;
      try {
        const j = JSON.parse(body);
        if (j.error && j.error.message) msg = j.error.message;
      } catch (e) { /* ignore */ }
      throw new Error(msg);
    }

    const data = await resp.json();
    const raw = data.content.map(c => c.text || '').join('');
    const cleaned = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    let entries;
    try {
      entries = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Got an unexpected response — try rephrasing what you did.');
    }
    if (!Array.isArray(entries)) throw new Error('Got an unexpected response — try rephrasing what you did.');
    return entries;
  },

  renderReview(entries) {
    const reviewArea = document.getElementById('reviewArea');
    if (!entries.length) {
      reviewArea.innerHTML = '<p class="muted">Nothing recognizable in that — try rephrasing.</p>';
      return;
    }

    const sites = Store.getActiveSites();

    const rowsHtml = entries.map((entry, i) => {
      const matchedSite = sites.find(s => s.name.toLowerCase() === (entry.site || '').toLowerCase());
      const siteOptions = sites.map(s =>
        `<option value="${s.id}" ${matchedSite && matchedSite.id === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');
      const flagged = entry.unknownExamType || !matchedSite;

      return `
        <div class="review-row ${flagged ? 'flagged' : ''}" data-idx="${i}">
          <input type="date" class="rv-date" value="${entry.date || todayISO()}" />
          <select class="rv-site">${siteOptions}</select>
          <select class="rv-exam"></select>
          <input type="number" class="rv-count" min="1" step="1" value="${entry.count || 1}" />
          <span class="rv-amount"></span>
          <button type="button" class="icon-btn rv-remove" aria-label="Remove">&times;</button>
        </div>
      `;
    }).join('');

    reviewArea.innerHTML = `
      <div class="review-list">
        <div class="review-header">
          <span>Date</span><span>Site</span><span>Exam</span><span>Count</span><span>Amount</span><span></span>
        </div>
        ${rowsHtml}
      </div>
      <div class="review-actions">
        <button id="discardReview" class="secondary-btn">Discard</button>
        <button id="commitReview" class="primary-btn">Add to calendar</button>
      </div>
    `;

    const rows = [...reviewArea.querySelectorAll('.review-row')];
    rows.forEach((row, i) => {
      const entry = entries[i];
      const siteSel = row.querySelector('.rv-site');
      const examSel = row.querySelector('.rv-exam');
      const countInput = row.querySelector('.rv-count');
      const amountEl = row.querySelector('.rv-amount');

      const refreshExam = () => {
        populateExamTypeSelect(examSel, siteSel.value, entry.examType);
        refreshAmount();
      };
      const refreshAmount = () => {
        const rate = Store.rateFor(siteSel.value, examSel.value);
        const count = parseInt(countInput.value, 10) || 0;
        amountEl.textContent = rate != null ? fmtMoney(rate * count) : '—';
      };

      siteSel.addEventListener('change', refreshExam);
      examSel.addEventListener('change', refreshAmount);
      countInput.addEventListener('input', refreshAmount);
      refreshExam();

      row.querySelector('.rv-remove').addEventListener('click', () => {
        row.remove();
      });
    });

    document.getElementById('discardReview').addEventListener('click', () => {
      reviewArea.innerHTML = '';
    });

    document.getElementById('commitReview').addEventListener('click', () => {
      const remainingRows = [...reviewArea.querySelectorAll('.review-row')];
      let added = 0;
      for (const row of remainingRows) {
        const siteId = row.querySelector('.rv-site').value;
        const site = Store.getSite(siteId);
        const examType = row.querySelector('.rv-exam').value;
        const date = row.querySelector('.rv-date').value;
        const count = parseInt(row.querySelector('.rv-count').value, 10);
        const rate = Store.rateFor(siteId, examType);
        if (!site || !examType || !count || rate == null || !date) continue;
        Store.addEntry({ date, site: site.name, examType, count, rate, amount: rate * count });
        added++;
      }
      reviewArea.innerHTML = `<p class="muted">Added ${added} ${added === 1 ? 'entry' : 'entries'} to the calendar.</p>`;
      document.getElementById('chatText').value = '';
      Calendar.render();
    });
  }
};

// Speech-to-text (browser and macOS Dictation alike) commonly mishears
// "low dose" as similar-sounding words. Runs once, only when Parse is
// clicked — never live while text is still being typed or dictated, so it
// can't collide with an in-progress dictation session rewriting the box.
function normalizeDictationText(text) {
  return text.replace(/\b(lotto|loto|lodo|lettuce|lotus)\b/gi, (match) => {
    const isCapitalized = match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase();
    return isCapitalized ? 'Low dose' : 'low dose';
  });
}
