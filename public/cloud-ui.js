/* global cloud, $, SIDE, openSide, showHint, store, localStore, storeVersion, pushShared, map, renderEdit, updatePanel, renderScenario, selectedId, esc */
// Account panel for the shared class map: sign in, role, and the one-time upload of the first buildings.
const aui = {btn: $('#account-btn'), panel: $('#account'), body: $('#account-body')};

if (!cloud.enabled) aui.btn.hidden = true;
else {
  SIDE.account = [aui.btn, aui.panel];
  aui.btn.addEventListener('click', () => { renderAccount(); openSide('account'); });
  cloud.init(onRoleChange).then(onRoleChange).catch(err => showHint(`Sign-in service unavailable: ${err.message}`, 8000));
}

function onRoleChange() {
  aui.btn.textContent = cloud.user ? `${cloud.editor ? '✎ ' : ''}${cloud.user.email}` : 'Sign in';
  renderAccount();
  renderScenario();
  if (selectedId) { renderEdit(); updatePanel(); }
}

function renderAccount() {
  if (!cloud.enabled) {
    aui.body.innerHTML = '<p class="muted small">Could not reach the shared map, so this browser is working on its own copy.</p>';
    return;
  }
  const map = `<p class="small">Shared class map: <b>${store.features.length.toLocaleString()}</b> buildings. Changes by editors appear for everyone within a second or two.</p>`;
  if (!cloud.user) {
    aui.body.innerHTML = `${map}
      <label class="field"><span>Email</span><input id="acc-email" type="email" autocomplete="username"></label>
      <label class="field"><span>Password <i>(at least 6 characters)</i></span><input id="acc-pass" type="password" autocomplete="current-password"></label>
      <div class="row"><button id="acc-in" class="primary-soft">Sign in</button><button id="acc-up">Create account</button></div>
      <p class="muted small">Anyone can view the map and run fires without an account. To change buildings, inputs or the class trial values, create an account and ask the project owner to add your email to the editors list.</p>`;
    const creds = () => [$('#acc-email').value.trim(), $('#acc-pass').value];
    $('#acc-in').addEventListener('click', () => act(() => cloud.signIn(...creds())));
    $('#acc-up').addEventListener('click', () => act(() => cloud.signUp(...creds())));
    return;
  }
  const seedable = cloud.editor && !store.features.length;
  aui.body.innerHTML = `${map}
    <p class="small">Signed in as <b>${esc(cloud.user.email)}</b><br>${cloud.editor
      ? 'Role: <b>editor</b>. You can change the shared map, and your runs go into the class run log.'
      : 'Role: <b>viewer</b>. Your email is not on the editors list yet; ask the project owner to add it. You can still run fires; those runs stay on this device.'}</p>
    ${seedable ? `<p class="small"><b>The shared map is empty.</b> Upload the first buildings: this browser's saved map (${localStore.features.length.toLocaleString()} buildings) or, if that is empty, the 1,559 AI outlines.</p>
      <button id="acc-seed" class="primary-soft">Upload the first buildings</button>` : ''}
    <button id="acc-out">Sign out</button>`;
  $('#acc-out').addEventListener('click', () => act(() => cloud.signOut()));
  if (seedable) $('#acc-seed').addEventListener('click', seedShared);
}

async function act(fn) {
  try { await fn(); } catch (err) { showHint(err.message, 8000); }
}

/** One-time upload of the first buildings into an empty shared map. */
async function seedShared() {
  const btn = $('#acc-seed');
  let features = localStore.features;
  if (!features.length) features = (await (await fetch('data/ai-buildings.geojson')).json()).features;
  if (!window.confirm(`Upload ${features.length.toLocaleString()} buildings to the shared class map?`)) return;
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  store.features = structuredClone(features);
  await pushShared();
  storeVersion++;
  map.getSource('buildings')?.setData(store);
  $('#count').textContent = store.features.length;
  renderAccount();
  showHint(`Uploaded ${store.features.length.toLocaleString()} buildings to the shared map.`, 6000);
}
