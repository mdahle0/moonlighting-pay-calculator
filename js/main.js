// Entry point: load data, wire up tab switching, init each module.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}

// Light/dark toggle — a device-level UI preference, stored locally rather
// than synced per-account. Applied synchronously in <head> to avoid a flash;
// this just keeps the icon and any later toggle in sync with that. Dark is
// the default regardless of OS preference unless the user has toggled to light.
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function applyThemeIcon() {
  document.getElementById('themeToggle').textContent = currentTheme() === 'dark' ? '☀️' : '🌙';
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('moonlighting.theme', next);
  applyThemeIcon();
});

applyThemeIcon();

function startApp() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  Calendar.init();
  ManualEntry.init();
  Chat.init();
  Settings.init();
}

document.addEventListener('DOMContentLoaded', async () => {
  Auth.init();

  if (!Auth.enabled) {
    document.getElementById('authModal').classList.remove('open');
    Store.load();
    startApp();
    return;
  }

  Auth.onLoggedIn = async () => {
    await Store.loadRemote(Auth.currentUser.id);
    Auth.hideGate();
    startApp();
  };

  const session = await Auth.getSession();
  if (session) {
    Auth.currentUser = session.user;
    await Auth.onLoggedIn();
  } else {
    Auth.showGate();
  }
});
