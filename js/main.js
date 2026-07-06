// Entry point: load data, wire up tab switching, init each module.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}

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
