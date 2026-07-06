# Moonlighting

A small static web app for tracking per-diem/moonlighting shifts and calculating pay by pay period.

## Features

- **Log a day** — describe your day in plain text (or voice), and Claude parses it into exam counts per site. Review before saving.
- **Manual entry** — fill in exam counts per site for any day in the current pay period.
- **Calendar** — view logged days and running pay-period totals.
- **Settings** — configure sites, rate groups, exam-type labels, and pay period schedule (weekly or biweekly).

## Running it

This is a static site with no build step or dependencies. Serve the folder with any static file server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Claude API key

The "Log a day" chat parser uses the Claude API to turn free text into structured entries. Add your own API key in **Settings → Chatbot (Claude API)**. The key is stored only in your browser's local storage and is sent only directly to Anthropic's API (`api.anthropic.com`) with each request — never to any other server.
