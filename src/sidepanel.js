// 横の窓：会話を読む → 頼み方を作る → ①その場で AI に考えてもらう ②コピーして貼る → 入力欄に入れる
import { tidy, unanswered } from './lib/thread.js';
import { buildPrompt } from './lib/prompt.js';
import { parseAnswer, NEEDS_CHECK } from './lib/parse.js';
import { ask, PROVIDERS, AiError } from './lib/providers.js';

const $ = (id) => document.getElementById(id);
let convo = null;      // 読んだ会話 { chatKey, them, us, isGroup, messages }
let tabId = null;
let last = null;       // 最後に作った案

// ---------- 設定
async function settings() {
  const s = await chrome.storage.local.get(['provider', 'keys', 'models', 'myRole', 'memos']);
  return { provider: s.provider || 'none', keys: s.keys || {}, models: s.models || {}, myRole: s.myRole || '', memos: s.memos || {} };
}
async function saveMemo(name, text) {
  const { memos = {} } = await chrome.storage.local.get('memos');
  if (text.trim()) memos[name] = text.trim(); else delete memos[name];
  await chrome.storage.local.set({ memos });
}

// ---------- 管理画面とのやりとり
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
async function toPage(msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); }
  catch { return { ok: false, error: '管理画面とつながりませんでした。管理画面のタブを読み込み直してから、もう一度押してください。' }; }
}

function say(text, tone = '') { $('status').textContent = text; $('status').dataset.tone = tone; }

async function load() {
  const tab = await activeTab();
  tabId = tab?.id;
  if (!tab?.url?.startsWith('https://chat.line.biz/')) { say('LINE 公式アカウントの管理画面（chat.line.biz）で使います。', 'warn'); return false; }
  const r = await toPage({ type: 'read' });
  if (!r?.ok) { say(r?.error || '会話を読めませんでした（管理画面が変わった可能性があります）。', 'error'); return false; }
  if (r.convo.isGroup) { say('いまは1対1の会話だけに対応しています。', 'warn'); return false; }
  convo = { ...r.convo, messages: tidy(r.convo.messages) };
  const waiting = unanswered(convo.messages);
  $('who').textContent = `${convo.them} さんとの会話を読みました`;
  $('sub').textContent = waiting.length ? `まだ返していないメッセージ ${waiting.length} 件（最新 ${convo.messages.length} 件を読みました）` : `最後に送ったのはこちらです（最新 ${convo.messages.length} 件を読みました）`;
  const s = await settings();
  $('memo').value = s.memos[convo.them] || '';
  const photos = convo.messages.filter((m) => m.kind === 'image' && m.imageUrl);
  $('photos').hidden = !photos.length;
  $('photoNote').textContent = `この会話に写真が ${photos.length} 枚あります。コピーには写真が入らないので、AI に見せたいときは保存して添えてください。`;
  return true;
}

async function prompt(mode, extra = '') {
  const s = await settings();
  const intent = [$('intent').value, extra].filter((x) => x && x.trim()).join('\n');
  return buildPrompt({ messages: convo.messages, them: convo.them, us: convo.us, intent, myRole: s.myRole, memo: $('memo').value, mode });
}

// ---------- ① その場で考えてもらう
async function think(extra = '') {
  $('think').disabled = true;
  try {
    if (!(await load())) return;
    await saveMemo(convo.them, $('memo').value);
    const s = await settings();
    if (s.provider === 'none' || !s.keys[s.provider]) {
      say('AI の鍵が入っていません。「AI に貼る形でコピー」を使うか、設定で AI を選んでください。', 'warn');
      return;
    }
    say(`${PROVIDERS[s.provider].name.split('（')[0]} が考えています…`);
    const urls = convo.messages.filter((m) => m.kind === 'image' && m.imageUrl).map((m) => m.imageUrl);
    const imgs = urls.length ? ((await toPage({ type: 'images', urls }))?.images || []) : [];
    const text = await prompt('json', extra);
    const photoNote = imgs.length ? `相手から届いた写真のうち最新 ${imgs.length} 枚を添えます。写真の中身も踏まえてください。` : '';
    const raw = await ask(s.provider, { key: s.keys[s.provider], model: s.models[s.provider], prompt: photoNote ? text.replace('\n\n会話：', `\n${photoNote}\n\n会話：`) : text, images: imgs.map(({ mime, base64 }) => ({ mime, base64 })) });
    const a = parseAnswer(raw);
    if (!a.ok) { say('AI の答えを読めませんでした。もう一度押してください。', 'error'); return; }
    show(a);
    say('');
  } catch (e) {
    say(e instanceof AiError ? e.message : 'うまくいきませんでした：' + (e?.message || e), 'error');
  } finally { $('think').disabled = false; }
}

function markChecks(text, el) {
  const found = text.match(NEEDS_CHECK) || [];
  el.hidden = !found.length;
  el.textContent = found.length ? `確かめてから送ってください：${found.map((x) => x.replace(/^［要確認[:：]|］$/g, '')).join('／')}` : '';
}

function show(a) {
  last = a;
  $('result').hidden = false;
  $('points').innerHTML = '';
  for (const p of a.points) { const li = document.createElement('li'); li.textContent = p; $('points').appendChild(li); }
  $('pointsCard').hidden = !a.points.length && !a.noReplyNeeded.yes;
  $('noreply').hidden = !a.noReplyNeeded.yes;
  $('noreply').textContent = a.noReplyNeeded.yes ? `返さなくてもよさそうです：${a.noReplyNeeded.reason}` : '';
  $('best').value = a.best;
  markChecks(a.best, $('bestCheck'));
  const box = $('alts');
  box.innerHTML = '';
  a.alternatives.forEach((alt, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h2 class="h"></h2><textarea rows="5" id="alt${i}"></textarea><p class="check" hidden></p><div class="row"><button class="btn btn--main" type="button" data-insert="alt${i}">入力欄に入れる</button><button class="btn" type="button" data-copy="alt${i}">コピー</button></div>`;
    card.querySelector('.h').textContent = alt.label;
    card.querySelector('textarea').value = alt.text;
    markChecks(alt.text, card.querySelector('.check'));
    box.appendChild(card);
  });
}

// ---------- ② コピーして貼る
async function copyForAi() {
  if (!(await load())) return;
  await saveMemo(convo.them, $('memo').value);
  await navigator.clipboard.writeText(await prompt('text'));
  say('コピーしました。ChatGPT・Claude・Gemini などに貼って送ってください。出た返信をコピーして、管理画面の入力欄に貼れば完了です。', 'ok');
}

// ---------- 入力欄に入れる・コピー・写真の保存
document.addEventListener('click', async (e) => {
  const ins = e.target.closest('[data-insert]');
  const cp = e.target.closest('[data-copy]');
  if (ins) {
    const r = await toPage({ type: 'insert', text: $(ins.dataset.insert).value, chatKey: convo?.chatKey });
    say(r?.ok ? '入力欄に入れました。読み直してから、送信は自分で押してください。' : r?.error || '入れられませんでした。', r?.ok ? 'ok' : 'error');
  }
  if (cp) { await navigator.clipboard.writeText($(cp.dataset.copy).value); say('コピーしました。', 'ok'); }
});
$('think').addEventListener('click', () => think());
$('redo').addEventListener('click', () => think($('refine').value));
$('copy').addEventListener('click', () => copyForAi().catch((e) => say('コピーできませんでした：' + e.message, 'error')));
$('best').addEventListener('input', () => markChecks($('best').value, $('bestCheck')));
$('savePhotos').addEventListener('click', async () => {
  const urls = convo.messages.filter((m) => m.kind === 'image' && m.imageUrl);
  const safe = convo.them.replace(/[\\/:*?"<>|]/g, '_');
  for (const [i, m] of urls.entries()) {
    const d = new Date(m.at);
    const name = `LINE返信サポート/${safe}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_写真${i + 1}.jpg`;
    await chrome.downloads.download({ url: m.imageUrl, filename: name, conflictAction: 'uniquify' }).catch(() => {});
  }
  say(`写真を ${urls.length} 枚、ダウンロードの「LINE返信サポート\\${safe}」に保存しました。`, 'ok');
});

// ---------- 開いたとき
(async () => {
  const s = await settings();
  $('aiNote').textContent = s.provider === 'none' || !s.keys[s.provider]
    ? 'AI の鍵が入っていないので、いまは「AI に貼る形でコピー」で使えます。設定で鍵を入れると、ここで返信の案が出ます。'
    : `考える AI：${PROVIDERS[s.provider].name}`;
  const { versionInfo } = await chrome.storage.local.get('versionInfo');
  if (versionInfo?.newer) { $('version').hidden = false; $('version').innerHTML = `新しい版（${versionInfo.latest}）があります。<a href="${versionInfo.url}" target="_blank">入れ直し方を見る</a>`; }
  await load();
})();
chrome.tabs.onActivated.addListener(() => load());
