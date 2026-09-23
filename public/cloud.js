/* global supabase, IGNIS_CONFIG */
// Shared class map on Supabase. Without a configured project (config.js) the app runs in local mode as before.
const cloud = (() => {
  const cfg = window.IGNIS_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const client = enabled ? supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const PAGE = 1000;
  const state = {enabled, client, user: null, editor: false, admin: false};

  async function refreshRole() {
    const {data: {session}} = await client.auth.getSession();
    state.user = session?.user ?? null;
    state.editor = state.admin = false;
    if (state.user) {
      const [ed, ad] = await Promise.all([client.rpc('is_editor'), client.rpc('is_admin')]);
      if (ed.error) throw ed.error;
      state.editor = ed.data === true;
      state.admin = !ad.error && ad.data === true; // is_admin exists once supabase/admin.sql has been run
    }
  }

  async function all(table, columns, order) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const {data, error} = await client.from(table).select(columns).order(order).range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }
  async function inChunks(items, size, fn) {
    for (let i = 0; i < items.length; i += size) {
      const {error} = await fn(items.slice(i, i + size));
      if (error) throw error;
    }
  }

  return Object.assign(state, {
    async init(onAuthChange) {
      await refreshRole();
      client.auth.onAuthStateChange(async event => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') { await refreshRole(); onAuthChange(); }
      });
    },
    async signIn(email, password) { const {error} = await client.auth.signInWithPassword({email, password}); if (error) throw error; },
    async signUp(email, password) {
      const {data, error} = await client.auth.signUp({email, password});
      if (error) throw error;
      if (!data.session) throw new Error('Account created, but email confirmation is switched on in Supabase. Turn it off (Authentication → Sign In / Providers → Email → Confirm email) or confirm the email first.');
    },
    async signOut() { const {error} = await client.auth.signOut(); if (error) throw error; },

    async loadBuildings() {
      return (await all('buildings', 'id, geometry, properties', 'id')).map(r => ({type: 'Feature', geometry: r.geometry, properties: {...r.properties, id: r.id}}));
    },
    async saveBuildings(features, deletedIds) {
      await inChunks(features.map(f => ({id: f.properties.id, geometry: f.geometry, properties: f.properties})), 400,
        rows => client.from('buildings').upsert(rows));
      await inChunks(deletedIds, 200, ids => client.from('buildings').delete().in('id', ids));
    },
    async loadRuns() {
      return (await all('runs', 'id, record, created_by, created_at', 'created_at')).map(r => ({...r.record, id: r.id, by: r.created_by, shared: true}));
    },
    async addRuns(records) {
      await inChunks(records.map(r => ({id: r.id, batch: r.batch, record: r})), 200, rows => client.from('runs').insert(rows));
    },
    async loadSetting(key) {
      const {data, error} = await client.from('settings').select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    },
    async saveSetting(key, value) { const {error} = await client.from('settings').upsert({key, value}); if (error) throw error; },

    // ---------- admin page (GitHub-only admin; editors are approved accounts) ----------
    async signInWithGitHub() {
      const {error} = await client.auth.signInWithOAuth({provider: 'github', options: {redirectTo: location.origin + location.pathname}});
      if (error) throw error;
    },
    async listAccounts() { const {data, error} = await client.rpc('list_accounts'); if (error) throw error; return data; },
    async approveEditor(userId, email) { const {error} = await client.from('editor_accounts').insert({user_id: userId, email}); if (error && error.code !== '23505') throw error; },
    async removeEditor(userId) { const {error} = await client.from('editor_accounts').delete().eq('user_id', userId); if (error) throw error; },

    /** Live changes from other people. handlers: {building(row|null, oldId), run(row), setting(row)} */
    subscribe(handlers) {
      client.channel('shared-map')
        .on('postgres_changes', {event: '*', schema: 'public', table: 'buildings'}, p => handlers.building(p.eventType === 'DELETE' ? null : p.new, p.old?.id))
        .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'runs'}, p => handlers.run(p.new))
        .on('postgres_changes', {event: '*', schema: 'public', table: 'settings'}, p => handlers.setting(p.new))
        .subscribe();
    }
  });
})();
