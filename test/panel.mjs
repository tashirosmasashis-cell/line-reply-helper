// 架空の管理画面と遅いAIで、相手の切替・連打・話し方の保存を実際の窓のコードで試す。
import fs from 'node:fs';
import vm from 'node:vm';
import { tidy, unanswered, unreadOnly } from '../src/lib/thread.js';
import { buildPrompt } from '../src/lib/prompt.js';
import { parseAnswer, NEEDS_CHECK } from '../src/lib/parse.js';

const source = fs.readFileSync(new URL('../src/sidepanel.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function element() {
  return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {},
    addEventListener() {}, appendChild() {}, querySelector() { return element(); } };
}

export async function testPanel(t) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, element()); return els.get(id); };
  const listeners = {};
  const store = { provider: 'gemini', keys: { gemini: 'fake' }, memos: { A: '丁寧に', B: '短く' } };
  const key = (name) => `/U${'a'.repeat(32)}/chat/${name}`;
  const conversation = (name) => ({ chatKey: key(name), them: name, us: '架空のお店', opened: true,
    unread: { read: false, after: 0 }, unreadComplete: true,
    messages: [{ id: name, side: 'them', kind: 'text', text: `${name}の相談`, at: '2026-10-29T10:00:00Z' }] });
  let current = 'A', nextRead = null, nextAsk = null, asked = 0, clipboard = '', lastPrompt = '';
  const context = vm.createContext({
    document: { getElementById: el, createElement: element,
      querySelectorAll: () => [...els.values()], addEventListener: (event, fn) => { listeners[event] = fn; } },
    chrome: {
      storage: { local: { get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]])),
        set: async (values) => Object.assign(store, values) } },
      tabs: { query: async () => [{ id: 1, url: 'https://chat.line.biz/' }], get: async () => ({ id: 1 }),
        onActivated: { addListener() {} }, sendMessage: async (_id, msg) => {
          if (msg.type === 'waiting') return { ok: true, list: [] };
          if (msg.type === 'read') {
            if (nextRead) { const pending = nextRead; nextRead = null; return pending.promise; }
            return { ok: true, convo: conversation(msg.chatId || current) };
          }
          throw new Error(`想定外の操作：${msg.type}`);
        } },
      runtime: { onMessage: { addListener() {} } },
    },
    location: { search: '' }, URLSearchParams, Date, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {},
    navigator: { clipboard: { writeText: async (text) => { clipboard = text; } } },
    tidy, unanswered, unreadOnly, buildPrompt, parseAnswer, NEEDS_CHECK,
    PROVIDERS: { gemini: { name: '架空のAI' } }, AiError: Error,
    ask: async (_provider, opts) => {
      asked++; lastPrompt = opts.prompt;
      if (nextAsk) { const pending = nextAsk; nextAsk = null; return pending.promise; }
      return JSON.stringify({ points: [], best: 'Aへの返信', alternatives: [] });
    }, safeName: (s) => s, savePhotos() {},
  });
  vm.runInContext(source, context);
  const run = (code) => vm.runInContext(code, context);
  await settle();

  el('memo').value = '敬語なし、絵文字を1つ';
  await run('copyForAi()');
  t('コピー前の読み直しで、編集中の話し方が消えない', clipboard.includes('敬語なし、絵文字を1つ') && store.memos.A === '敬語なし、絵文字を1つ');
  await run('copyForAi(true)');
  t('未読だけコピーは、AI向けの指示と未読の本文をコピーする', clipboard.includes('未読の相手のメッセージだけ') && clipboard.includes('Aの相談') && el('status').textContent.includes('1 件だけ'));
  const previousCopy = clipboard;
  nextRead = deferred(); const emptyRead = nextRead;
  const emptyCopy = run('copyForAi(true)'); await settle();
  emptyRead.resolve({ ok: true, convo: { ...conversation('A'), unread: { read: true, after: 0 } } });
  await emptyCopy;
  t('未読がなければ、コピー済みの内容を上書きせず知らせる', clipboard === previousCopy && el('status').textContent.includes('未読のメッセージはありません'));
  el('memo').value = 'お礼を先に';
  await run('think()');
  t('AIにも、今編集した話し方を渡して保存する', lastPrompt.includes('お礼を先に') && store.memos.A === 'お礼を先に');

  nextRead = deferred();
  const slow = nextRead;
  const firstLoad = run('load("A")');
  await settle();
  await run('load("B")');
  slow.resolve({ ok: true, convo: conversation('A') });
  await firstLoad;
  t('先に押した相手の読み取りが遅れても、今選んだ相手を上書きしない', run('convo.them') === 'B' && el('memo').value === '短く');

  current = 'A';
  await run('fresh()');
  nextAsk = deferred();
  const ai = nextAsk;
  const firstThink = run('think()');
  await settle();
  const before = asked;
  await run('think()');
  await run('copyForAi()');
  t('考えている間の再生成やコピーを重ねない', asked === before && run('busy') && el('copy').disabled && el('redo').disabled);
  current = 'B';
  await run(`switchTo(${JSON.stringify(key('B'))})`);
  ai.resolve(JSON.stringify({ points: [], best: '前の相手Aへの返信', alternatives: [] }));
  await firstThink;
  t('考えている途中で相手が変わったら、前の相手の案を表示しない', el('result').hidden && run('convo.them') === 'B' && !run('busy'));
  t('相手が変わったことと、押し直す案内を表示する', el('status').textContent.includes('前の相手の案は表示しませんでした'));

  // 表示済みの案を残したままコピー先の読み取りが別人へ変わっても、挿入を拒否する。
  current = 'A'; await run('fresh()'); await run('think()');
  current = 'B'; await run('load()');
  await listeners.click({ target: { closest: (sel) => sel === '[data-insert]' ? { dataset: { insert: 'best' } } : null } });
  t('古い案を別の相手の入力欄へ入れようとしても拒否する', el('result').hidden && el('status').textContent.includes('もう一度考えてください'));

  nextRead = deferred(); const read = nextRead;
  const pending = run('load("A")'); await settle();
  read.resolve({ ok: false, error: '会話を読めませんでした' }); await pending;
  t('会話の読み取りに失敗したら、前の相手の状態を使わない', run('convo') === null);
}
