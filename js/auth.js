// Email/password auth via Supabase, gating the app until a session exists.
const Auth = {
  client: null,
  currentUser: null,
  enabled: false,
  _mode: 'signin', // or 'signup'

  // If no Supabase project is configured yet, degrade gracefully to the
  // original local-only (no login) behavior instead of breaking the app.
  init() {
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
    this.client = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    window.supabaseClient = this.client;

    this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        location.reload();
      }
    });

    document.getElementById('authToggleMode').addEventListener('click', (e) => {
      e.preventDefault();
      this._mode = this._mode === 'signin' ? 'signup' : 'signin';
      this._renderMode();
    });

    document.getElementById('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSubmit();
    });

    this._renderMode();
  },

  async getSession() {
    const { data } = await this.client.auth.getSession();
    return data.session;
  },

  async _handleSubmit() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    const submitBtn = document.getElementById('authSubmitBtn');
    errorEl.textContent = '';
    submitBtn.disabled = true;
    try {
      const { data, error } = this._mode === 'signup'
        ? await this.client.auth.signUp({ email, password })
        : await this.client.auth.signInWithPassword({ email, password });
      if (error) {
        errorEl.textContent = error.message;
        return;
      }
      if (this._mode === 'signup' && !data.session) {
        errorEl.textContent = 'Check your email to confirm your account, then log in.';
        this._mode = 'signin';
        this._renderMode();
        return;
      }
      this.currentUser = data.user;
      await this.onLoggedIn();
    } finally {
      submitBtn.disabled = false;
    }
  },

  // Set by main.js — runs the rest of the app bootstrap once a session exists.
  onLoggedIn: async () => {},

  async signOut() {
    Store.reset();
    await this.client.auth.signOut();
  },

  showGate() {
    document.getElementById('authModal').classList.add('open');
  },

  hideGate() {
    document.getElementById('authModal').classList.remove('open');
  },

  _renderMode() {
    const isSignup = this._mode === 'signup';
    document.getElementById('authSubmitBtn').textContent = isSignup ? 'Sign up' : 'Log in';
    document.getElementById('authToggleMode').textContent = isSignup
      ? 'Already have an account? Log in'
      : "Need an account? Sign up";
    document.getElementById('authError').textContent = '';
  }
};
