// Unlike the Claude API key (settings.js), this anon key is meant to be public —
// Supabase's Row Level Security policies are the real access boundary, not secrecy of this key.
const SUPABASE_CONFIG = {
  url: '',
  anonKey: ''
};
