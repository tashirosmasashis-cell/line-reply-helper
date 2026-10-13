// 設定の画面：考える AI・鍵・モデル・自分の立場・相手ごとのメモ
import { PROVIDERS } from './lib/providers.js';

const $ = (id) => document.getElementById(id);
const HELP = {
  gemini: 'Google AI Studio（aistudio.google.com）で「API キーを作成」を押すと、無料の鍵が出ます。',
  openai: 'platform.openai.com の「API keys」で作れます（支払いの登録が要ります）。',
  claude: 'console.anthropic.com の「API Keys」で作れます（支払いの登録が要ります）。',
};
let state = { provider: 'none', keys: {}, models: {}, myRole: '', memos: {}, showContacts: false };

const FREE = '__free__';

// モデルの選び方＝最新の2つ＋「自由入力」。保存してあるモデルが2つにないときは自由入力として出す。
function drawModels(provider) {
  const sel = $('modelSelect');
  sel.innerHTML = '';
  for (const m of PROVIDERS[provider].models) sel.appendChild(new Option(m.label, m.id));
  sel.appendChild(new Option('自由入力（ほかのモデルの名前を入れる）', FREE));
  const saved = state.models[provider] || PROVIDERS[provider].defaultModel;
  const known = PROVIDERS[provider].models.some((m) => m.id === saved);
  sel.value = known ? saved : FREE;
  $('model').value = known ? '' : saved;
  $('model').hidden = known;
}

function chosenModel(provider) {
  const v = $('modelSelect').value;
  return v === FREE ? ($('model').value.trim() || PROVIDERS[provider].defaultModel) : v;
}

function pick(provider) {
  state.provider = provider;
  const on = provider !== 'none';
  $('keyField').hidden = !on;
  if (!on) return;
  $('key').value = state.keys[provider] || '';
  drawModels(provider);
  $('keyHelp').textContent = HELP[provider];
}

function drawMemos() {
  const ul = $('memos');
  ul.innerHTML = '';
  const names = Object.keys(state.memos).sort();
  $('noMemo').hidden = names.length > 0;
  for (const name of names) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><input type="text"><button class="btn" type="button">消す</button>';
    li.querySelector('b').textContent = name;
    const input = li.querySelector('input');
    input.value = state.memos[name];
    input.addEventListener('input', () => (state.memos[name] = input.value));
    li.querySelector('button').addEventListener('click', () => { delete state.memos[name]; drawMemos(); });
    ul.appendChild(li);
  }
}

async function save() {
  const p = state.provider;
  if (p !== 'none') {
    state.keys[p] = $('key').value.trim();
    state.models[p] = chosenModel(p);
    // 選んだ AI の住所にだけ、送ってよい許可をもらう（保存ボタンを押した操作の続きで聞く）
    const granted = await chrome.permissions.request({ origins: [PROVIDERS[p].host] });
    if (!granted) { $('status').textContent = 'AI に送る許可がもらえなかったので、保存をやめました。'; $('status').dataset.tone = 'error'; return; }
  }
  for (const k of Object.keys(state.memos)) if (!String(state.memos[k]).trim()) delete state.memos[k];
  state.myRole = $('myRole').value;
  state.showContacts = $('showContacts').checked;
  await chrome.storage.local.set(state);
  $('status').textContent = '保存しました。';
  $('status').dataset.tone = 'ok';
  drawMemos();
}

(async () => {
  const s = await chrome.storage.local.get(['provider', 'keys', 'models', 'myRole', 'memos', 'showContacts']);
  state = { provider: s.provider || 'none', keys: s.keys || {}, models: s.models || {}, myRole: s.myRole || '', memos: s.memos || {}, showContacts: !!s.showContacts };
  $('showContacts').checked = state.showContacts;
  document.querySelector(`input[name=provider][value=${state.provider}]`).checked = true;
  pick(state.provider);
  $('myRole').value = state.myRole;
  drawMemos();
  document.querySelectorAll('input[name=provider]').forEach((r) => r.addEventListener('change', () => pick(r.value)));
  $('save').addEventListener('click', save);
  $('modelSelect').addEventListener('change', () => {
    const free = $('modelSelect').value === FREE;
    $('model').hidden = !free;
    if (free) $('model').focus();
  });
})();
