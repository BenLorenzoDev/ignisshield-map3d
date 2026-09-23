/* global cloud */
// Admin page: GitHub-only sign-in for the project owner; approve or remove editor accounts without opening Supabase.
const $ = s => document.querySelector(s);
const show = (id, on) => { $(id).hidden = !on; };
const when = t => (t ? new Date(t).toLocaleString() : '—');
let accounts = [];

function message(text, kind = '') { const m = $('#msg'); m.textContent = text; m.className = kind; }

function cell(tr, content) {
  const td = document.createElement('td');
  if (content instanceof Node) td.append(content); else td.textContent = content;
  tr.append(td);
  return td;
}

async function render() {
  $('#who').textContent = cloud.user ? `Signed in as ${cloud.user.email ?? cloud.user.user_metadata?.user_name ?? 'unknown'}` : '';
  show('#signin', !cloud.user);
  show('#denied', Boolean(cloud.user) && !cloud.admin);
  show('#admin', Boolean(cloud.user) && cloud.admin);
  if (cloud.user && !cloud.admin) {
    const {error} = await cloud.client.rpc('is_admin');
    if (error) message('The admin setup is missing: run supabase/upgrade-1-github-admin.sql in the Supabase SQL Editor, then reload.', 'err');
  }
  if (cloud.user && cloud.admin) await load();
}

async function load() {
  try { accounts = await cloud.listAccounts(); draw(); } catch (err) { message(`Could not load accounts: ${err.message}`, 'err'); }
}

function draw() {
  const q = $('#search').value.trim().toLowerCase();
  const body = $('#accounts');
  body.replaceChildren();
  const rows = accounts.filter(a => !q || (a.email ?? '').toLowerCase().includes(q));
  if (!rows.length) { const tr = document.createElement('tr'); cell(tr, q ? 'No matching accounts.' : 'No accounts yet.').className = 'muted'; body.append(tr); }
  for (const a of rows) {
    const tr = document.createElement('tr');
    const td = cell(tr, a.email || '(no email)');
    if (a.is_admin) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'admin'; td.append(b); }
    cell(tr, a.providers || '—');
    cell(tr, when(a.created_at));
    cell(tr, when(a.last_sign_in_at));
    if (a.is_admin) { cell(tr, 'Always').className = 'muted'; body.append(tr); continue; }
    const label = document.createElement('label');
    label.className = 'switch';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = a.is_editor;
    box.addEventListener('change', () => setEditor(a, box));
    label.append(box, document.createTextNode(a.is_editor ? 'Editor' : 'Viewer'));
    cell(tr, label);
    body.append(tr);
  }
  $('#counts').textContent = `${accounts.length} accounts · ${accounts.filter(a => a.is_editor || a.is_admin).length} can edit`;
}

async function setEditor(account, box) {
  box.disabled = true;
  try {
    if (box.checked) await cloud.approveEditor(account.user_id, account.email);
    else await cloud.removeEditor(account.user_id);
    message(`${account.email} is now ${box.checked ? 'an editor' : 'a viewer'}.`, 'ok');
    await load();
  } catch (err) {
    box.checked = !box.checked;
    message(`Could not change ${account.email}: ${err.message}`, 'err');
  } finally {
    box.disabled = false;
  }
}

$('#github-btn').addEventListener('click', () => cloud.signInWithGitHub().catch(err => message(
  /provider is not enabled|Unsupported provider/i.test(err.message) ? 'GitHub sign-in is not switched on in Supabase yet (Authentication → Sign In / Providers → GitHub).' : err.message, 'err')));
$('#search').addEventListener('input', draw);
$('#reload').addEventListener('click', load);
for (const id of ['#signout', '#signout-2']) $(id).addEventListener('click', () => cloud.signOut().catch(err => message(err.message, 'err')));

// Errors returned by GitHub/Supabase after the redirect arrive in the URL
const back = new URLSearchParams(location.hash.slice(1) || location.search);
if (back.get('error_description')) message(`Sign-in failed: ${back.get('error_description')}`, 'err');

if (!cloud.enabled) message('The shared class map is not configured (public/config.js), so there is nothing to administer.', 'err');
else cloud.init(render).then(render).catch(err => message(err.message, 'err'));
