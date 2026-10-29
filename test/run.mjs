// 自己試験：node test/run.mjs
import { tidy, unanswered, unreadOnly, format, stamp, redact } from '../src/lib/thread.js';
import { buildPrompt } from '../src/lib/prompt.js';
import { parseAnswer, NEEDS_CHECK } from '../src/lib/parse.js';
import { ask, AiError, PROVIDERS } from '../src/lib/providers.js';
import { piled, weLast, shop, apiMessages, apiChats, BOT, CHAT } from './fixtures.mjs';
import { parsePath, toMessages, chatInfo, imageUrl, waitingChats } from '../src/lib/linechat.js';
import { safeName, photoFileName, splitPhotos, pruneSaved, extFor, savePhotos } from '../src/lib/photos.js';
import { testPanel } from './panel.mjs';

let ng = 0;
const t = (name, ok, got) => { console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '  → ' + JSON.stringify(got).slice(0, 300))); if (!ok) ng++; };

// ---- 会話の整理
const m = tidy([...piled].reverse());
t('時刻順に並べ直す', m[0].id === '1' && m.at(-1).id === '11', m.map((x) => x.id));
t('中身の無い文は外す', !m.some((x) => x.id === '12'));
const w = unanswered(m);
t('まだ返していない分＝こちらの最後の返信より後の相手の発言（9件）', w.length === 9 && w[0].id === '3', w.map((x) => x.id));
t('こちらが最後なら、まだ返していない分は0件', unanswered(tidy(weLast)).length === 0);
t('別の担当者の返信もこちら側', tidy(weLast).at(-1).side === 'us');
t('日本時間で時刻を出す', stamp('2026-10-10T01:00:00Z').time === '10:00', stamp('2026-10-10T01:00:00Z'));
const f = format(m, shop);
t('日付の見出しが日ごとに入る', (f.match(/── 2026年10月/g) || []).length === 2, f);
t('まだ返していない行に★', (f.match(/^★ /gm) || []).length === 9);
t('スタンプ・写真は言葉にする', f.includes('（スタンプ）') && f.includes('（写真）'));
t('こちらの担当者名も添える', f.includes('はなまる教室（佐藤）'));
t('最新100件まで', tidy(Array.from({ length: 150 }, (_, i) => ({ id: String(i), at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), side: 'them', kind: 'text', text: 'x' + i }))).length === 100);

// ---- 頼み方
const now = new Date('2026-10-12T12:00:00+09:00');
const pj = buildPrompt({ messages: m, ...shop, intent: '駐車場は2台まで無料と伝えたい', myRole: '教室の受付・やわらかい敬語', memo: '初めての方', now, mode: 'json' });
t('頼み方に件数・伝えたいこと・立場・メモ・決まり・JSON の形', ['9 件', '駐車場は2台まで無料', 'やわらかい敬語', '初めての方', '要確認', '"best"'].every((s) => pj.includes(s)), pj.slice(0, 400));
t('いまの日時と空いた時間', pj.includes('2026年10月12日 12:00') && pj.includes('約 26 時間'), pj.slice(0, 200));
const pt = buildPrompt({ messages: tidy(weLast), ...shop, now, mode: 'text' });
t('コピー用は見出しの形・こちらが最後なら追いの一言を考える', pt.includes('## いちばん合う返信') && pt.includes('追いの一言'));
t('伝えたいことが空なら書かない', !pt.includes('伝えたいこと：'));

// ---- 答えの読み取り
const good = parseAnswer('```json\n{"points":["持ち物","駐車場"],"noReplyNeeded":{"yes":false,"reason":""},"best":"山田さま、ありがとうございます。［要確認：持ち物］","alternatives":[{"label":"短め","text":"承知しました"},{"label":"x","text":""}]}\n```');
t('JSON の答えを読む（囲みつきでも）', good.ok && good.points.length === 2 && good.alternatives.length === 1, good);
t('［要確認］を見つける', (good.best.match(NEEDS_CHECK) || []).length === 1);
const plain = parseAnswer('こんにちは、ありがとうございます');
t('JSON でなければ本文をそのまま見せる', plain.ok && plain.best === 'こんにちは、ありがとうございます');
t('空の答えでも壊れない', parseAnswer('').ok === false && parseAnswer(null).best === '');
t('返さなくてよい判断を読む', parseAnswer('{"noReplyNeeded":{"yes":true,"reason":"お礼だけ"}}').ok === true);

// ---- AI への送り方（作り物の返事で）
const fake = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const nowait = async () => {};
t('Gemini の答えを取り出す', (await ask('gemini', { key: 'k', prompt: 'p' }, fake(200, { candidates: [{ content: { parts: [{ text: '{"best":"a"}' }] } }] }), nowait)) === '{"best":"a"}');
t('ChatGPT の答えを取り出す', (await ask('openai', { key: 'k', prompt: 'p' }, fake(200, { choices: [{ message: { content: 'x' } }] }), nowait)) === 'x');
t('Claude の答えを取り出す', (await ask('claude', { key: 'k', prompt: 'p' }, fake(200, { content: [{ type: 'text', text: 'y' }] }), nowait)) === 'y');
const kind = async (fn) => { try { await fn(); return 'none'; } catch (e) { return e instanceof AiError ? e.kind : 'raw'; } };
t('鍵なしは「鍵」の失敗', (await kind(() => ask('gemini', { key: '', prompt: 'p' }, fake(200, {}), nowait))) === 'key');
t('401 は鍵の失敗', (await kind(() => ask('openai', { key: 'k', prompt: 'p' }, fake(401, 'bad'), nowait))) === 'key');
t('1日の上限は回数切れ', (await kind(() => ask('gemini', { key: 'k', prompt: 'p' }, fake(429, 'quotaId: GenerateRequestsPerDayPerProjectPerModel'), nowait))) === 'quota');
let calls = 0;
const busyThenOk = async () => (++calls === 1 ? new Response('overloaded', { status: 503 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 }));
t('混んでいたら1回だけやり直す', (await ask('claude', { key: 'k', prompt: 'p' }, busyThenOk, nowait)) === 'ok' && calls === 2);
calls = 0;
const alwaysBusy = async () => { calls++; return new Response('busy', { status: 503 }); };
t('2回目も混んでいたら「混雑」で止める', (await kind(() => ask('gemini', { key: 'k', prompt: 'p' }, alwaysBusy, nowait))) === 'busy' && calls === 2);
let sent;
const spy = async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ candidates: [] }), { status: 200 }); };
await ask('gemini', { key: 'SECRET', prompt: 'p', images: [{ mime: 'image/jpeg', base64: 'AAA' }] }, spy, nowait);
t('鍵は住所に入れず、見出しで送る', !sent.url.includes('SECRET') && sent.init.headers['x-goog-api-key'] === 'SECRET');
t('写真を付けて送る', JSON.parse(sent.init.body).contents[0].parts[1].inline_data.data === 'AAA');

// ---- 管理画面の内部の口の答えをそろえる
t('住所から公式アカウントと会話の番号を取る', JSON.stringify(parsePath('/' + BOT + '/chat/' + CHAT)) === JSON.stringify({ botId: BOT, chatId: CHAT }));
t('会話を開いていない住所は読まない', parsePath('/' + BOT + '/chat') === null);
const lm = toMessages(apiMessages.list, { botId: BOT, them: '山田 花子', us: 'はなまる教室' });
t('既読の印は外し、発言だけ（6件）', lm.length === 6, lm.map((x) => x.id));
t('相手から＝them・こちらから＝us', lm[0].side === 'them' && lm[3].side === 'us');
t('写真は管理画面と同じ住所', lm[1].imageUrl === imageUrl(BOT, 'abc+/def==') && lm[1].imageUrl.endsWith('/abc%2B%2Fdef==/preview'), lm[1].imageUrl);
t('期限切れの写真は住所なし', lm[2].kind === 'image' && !lm[2].imageUrl);
t('スタンプはスタンプ', lm[4].kind === 'sticker');
t('位置情報は文にする', lm[5].kind === 'text' && lm[5].text.includes('駅'));
t('時刻はミリ秒から', lm[0].at === new Date('2026-10-11T09:01:00+09:00').toISOString());
t('相手の名前を一覧から取る', chatInfo(apiChats.list, CHAT).them === '山田 花子' && !chatInfo(apiChats.list, CHAT).isGroup);
t('グループはグループ', chatInfo(apiChats.list, 'C' + '3'.repeat(32)).isGroup === true);
t('一覧に無ければ名前は空', chatInfo(apiChats.list, 'x').them === null);
t('そろえた会話で「まだ返していない分」', unanswered(tidy(lm)).length === 1 && unanswered(tidy(lm))[0].id === '106');

// ---- パスワードを伏せる
t('「パス xxx」を伏せる', !redact('✉️ abc@example.com\nパス Hanako2026x').includes('Hanako2026x') && redact('パス Hanako2026x').includes('［伏せました］'));
// ⚠ 試験の文字列は、秘密の見張り（secret-scan）に本物と間違われないよう、実行時に組み立てる
const PW = ['pass', 'word'].join('');
const FAKE_KEY = ['AI', 'za', 'Sy'].join('') + 'A'.repeat(33);
const V1 = 'ab' + 'cd1234', V2 = 'qw' + 'erty99';
t('「パスワード：」「パスワード=」も伏せる', !redact('パスワード' + '：' + V1).includes(V1) && !redact(PW + '=' + V2).includes(V2));
t('AI の鍵のような文字列も伏せる', !redact('鍵は ' + FAKE_KEY + ' です').includes(FAKE_KEY));
t('ふつうの文は変えない', redact('パスタを食べました。駐車場は2台です') === 'パスタを食べました。駐車場は2台です');
t('会話の文にするときに伏せる', !format(tidy([{ id: 'p', at: '2026-10-10T01:55:00Z', side: 'them', author: 'A', kind: 'text', text: 'ログイン\nパス Secret777' }]), shop).includes('Secret777'));
t('種類の分からないメッセージは種類名を出す', format(tidy(toMessages([{ type: 'message', timestamp: 1, message: { id: 'z', type: 'flex' } }], { botId: BOT, them: 'A', us: 'B' })), shop).includes('そのほかのメッセージ：flex'));

// ---- メールアドレスと電話番号
const MAIL = 'yamada' + '@' + 'example.test';
t('メールアドレスを伏せる', redact('連絡先は ' + MAIL + ' です') === '連絡先は ［メールアドレス］ です');
t('電話番号を伏せる（ハイフンあり・なし・携帯・+81）', ['06-1234-5678', '0612345678', '090-1234-5678', '+81 90 1234 5678'].every((p) => redact('電話 ' + p) === '電話 ［電話番号］'), ['06-1234-5678', '+81 90 1234 5678'].map((p) => redact(p)));
t('日付・郵便番号・金額は伏せない', redact('2026-10-12 〒562-0001 料金 3000円 2023.5月') === '2026-10-12 〒562-0001 料金 3000円 2023.5月', redact('2026-10-12 〒562-0001 料金 3000円 2023.5月'));
t('設定で外せば伏せない', redact('電話 06-1234-5678', { contacts: false }) === '電話 06-1234-5678');
t('会話の文でも既定で伏せる', format(tidy([{ id: 'c', at: '2026-10-10T01:00:00Z', side: 'them', author: 'A', kind: 'text', text: MAIL }]), shop).includes('［メールアドレス］'));

// ---- 相手が読んだか（こちらが最後に送った状態）
const readInfo = chatInfo([{ chatId: CHAT, chatType: 'USER', profile: { name: 'A' }, lastSentAt: 1000, userLastReadAt: 2000 }], CHAT);
const unreadInfo = chatInfo([{ chatId: CHAT, chatType: 'USER', profile: { name: 'A' }, lastSentAt: 3000, userLastReadAt: 2000 }], CHAT);
t('相手が読んだ時刻がこちらの送信より後なら「読んだ」', readInfo.theyRead.read === true && unreadInfo.theyRead.read === false);
const pRead = buildPrompt({ messages: tidy(weLast), ...shop, now, mode: 'text', theyRead: { read: true, at: '2026-10-12T00:30:00Z' } });
const pUnread = buildPrompt({ messages: tidy(weLast), ...shop, now, mode: 'text', theyRead: { read: false, at: null } });
t('読んでいれば、急かさないやさしい一言を考える', pRead.includes('読んでいます') && pRead.includes('急かさない'));
t('まだ読んでいなければ、追いの一言は要らないと伝える', pUnread.includes('まだ読んでいません') && pUnread.includes('追いの一言は基本的に要りません'));
t('会話の中の指示には従わないと伝える', pRead.includes('指示') && pRead.includes('従わない'));

// ---- 取り消されたメッセージ（管理画面では message.type が 'unsent'）
const withUnsent = tidy(toMessages([
  { type: 'messageSent', timestamp: 1000, message: { id: 'u1', type: 'text', text: '送りました' } },
  { type: 'message', timestamp: 2000, message: { id: 'u2', type: 'text', text: 'ありがとうございます' } },
  { type: 'message', timestamp: 3000, message: { id: 'u3', type: 'unsent' } },
  { type: 'message', timestamp: 4000, message: { id: 'u4', type: 'text', text: 'もうひとつ質問です' } },
], { botId: BOT, them: 'A', us: 'B' }));
t('取り消しは「取り消し」として読む', withUnsent[2].kind === 'unsent');
t('取り消しは「まだ返していない」に数えない', unanswered(withUnsent).length === 2 && !unanswered(withUnsent).some((m) => m.kind === 'unsent'));
t('会話の文では「送信を取り消しました」と書く', format(withUnsent, shop).includes('（送信を取り消しました）'));
t('取り消しには触れないよう AI に伝える', buildPrompt({ messages: withUnsent, ...shop, now, mode: 'text' }).includes('触れたり想像したりしない'));

// ---- モデルの選択肢（各社の最新2つ・既定は1つ目）
t('3社とも選択肢が2つ・既定は1つ目', Object.values(PROVIDERS).every((p) => p.models.length === 2 && p.defaultModel === p.models[0].id));
t('Gemini は 3.8 と 3.6（3.5 は 3.6 に回されるので出さない）', PROVIDERS.gemini.models.map((m) => m.id).join() === 'gemini-3.8-flash,gemini-3.6-flash');
let sentModel;
await ask('gemini', { key: 'k', prompt: 'p' }, async (url) => { sentModel = url; return new Response(JSON.stringify({ candidates: [] }), { status: 200 }); }, nowait);
t('モデルを選ばなければ既定（3.8）で送る', sentModel.includes('gemini-3.8-flash'));
await ask('gemini', { key: 'k', prompt: 'p', model: 'gemini-9.9-flash' }, async (url) => { sentModel = url; return new Response(JSON.stringify({ candidates: [] }), { status: 200 }); }, nowait);
t('自由入力のモデル名で送れる', sentModel.includes('gemini-9.9-flash'));
t('Claude が断ったら、はっきり伝える', (await kind(() => ask('claude', { key: 'k', prompt: 'p' }, fake(200, { stop_reason: 'refusal', content: [] }), nowait))) === 'other');

// ---- まだ返していない会話の一覧（開かずに読む）
const wl = waitingChats([
  { chatId: 'a', chatType: 'USER', profile: { name: '山田 花子' }, lastReceivedAt: 3000, lastSentAt: 1000, read: false, latestEvent: { message: { type: 'text', text: '料金は当日払いですか' } } },
  { chatId: 'b', chatType: 'USER', profile: { name: '佐藤 次郎', nickname: '佐藤さん（教室）' }, lastReceivedAt: 5000, lastSentAt: 4000, read: true, latestEvent: { message: { type: 'image' } } },
  { chatId: 'c', chatType: 'USER', profile: { name: '返し済み' }, lastReceivedAt: 1000, lastSentAt: 2000 },
  { chatId: 'g', chatType: 'GROUP', profile: { name: 'グループ' }, lastReceivedAt: 9000, lastSentAt: 0 },
]);
t('返していない1対1の会話だけ・新しい順', wl.map((c) => c.chatId).join() === 'b,a', wl);
t('呼び名があれば呼び名・最後の文・未読の印', wl[0].name === '佐藤さん（教室）' && wl[1].text === '料金は当日払いですか' && wl[1].unread === true && wl[0].text.includes('写真'));

// ---- この人への話し方（全体の口調より優先）
const pMemo = buildPrompt({ messages: tidy(weLast), ...shop, now, mode: 'text', myRole: 'ていねいな敬語', memo: '母なのでフランクに、敬語なし' });
t('この人への話し方を、全体の口調より優先と伝える', pMemo.includes('話し方・メモ（こちらの立場・口調より優先する）：母なのでフランクに'));

// ---- 自動の返事（担当者の印なし）は「返した」に数えない
const autoMs = tidy(toMessages([
  { type: 'message', timestamp: 1000, message: { id: 'x1', type: 'text', text: 'テスト' } },
  { type: 'messageSent', timestamp: 2000, message: { id: 'x2', type: 'text', text: '受け取りました' } },
], { botId: BOT, them: 'A', us: 'B' }));
t('印の無い送信は自動の返事', autoMs[1].auto === true);
t('自動の返事のあとも「まだ返していない」に残る', unanswered(autoMs).length === 1);
t('会話の文では「自動の返事」と書く', format(autoMs, shop).includes('（自動の返事）'));
t('担当者が送った物（印あり）は自動ではない', !toMessages([{ type: 'messageSent', timestamp: 1, sendId: 's', bizId: 'b', message: { id: 'y', type: 'text', text: 'x' } }], { botId: BOT, them: 'A', us: 'B' })[0].auto);
const wl2 = waitingChats([{ chatId: 'h', chatType: 'USER', profile: { name: '原 大樹' }, lastReceivedAt: 1000, lastSentAt: 2000, read: false, latestEvent: { type: 'messageSent', message: { type: 'text', text: '受け取りました' } } }]);
t('最後が自動の返事なら、一覧に出る', wl2.length === 1);
const wl3 = waitingChats([{ chatId: 'k', chatType: 'USER', profile: { name: '返し済み' }, lastReceivedAt: 1000, lastSentAt: 2000, read: true, latestEvent: { type: 'messageSent', sendId: 's', bizId: 'b', message: { type: 'text', text: 'はい' } } }]);
t('担当者が返して読んだ会話は、一覧に出ない', wl3.length === 0);

// ---- 答えが返ってこないとき（時間切れ）は、やり直さずに「答えがない」と伝える
let slowCalls = 0;
const slow = async () => { slowCalls++; const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
t('時間切れは「答えがない」と伝え、やり直さない', (await kind(() => ask('gemini', { key: 'k', prompt: 'p' }, slow, nowait))) === 'slow' && slowCalls === 1);

// ---- 写真の保存（同じ写真は絶対に二重に保存しない・2026-10-27 中身で見分ける形に）
const ph = (id, at, file) => ({ id, at, kind: 'image', imageUrl: 'https://chat-content.line.biz/x/' + (file || id) });
const p1 = ph('600000000000000001', '2026-10-24T10:30:00+09:00'), p2 = ph('600000000000000002', '2026-10-24T10:31:00+09:00');
t('写真の名前は中身の指紋で決まる（日時＋指紋の頭12文字・種類の拡張子）', photoFileName('原', p2, 'abcdef0123456789', 'image/png') === '返信サポート/原/2026-10-24_1031_abcdef012345.png', photoFileName('原', p2, 'abcdef0123456789', 'image/png'));
t('種類が分からなければ jpg', extFor('') === 'jpg' && extFor('image/jpeg') === 'jpg' && extFor('image/webp') === 'webp');
const sp = splitPhotos([p1, p2], { [p1.id]: 1 });
t('番号で保存済みの写真は飛ばす', sp.todo.length === 1 && sp.todo[0].id === p2.id && sp.skipped.length === 1, sp);
t('写真でないものは数えない', splitPhotos([{ id: 'a', kind: 'text', text: 'x' }, { id: 'b', kind: 'image' }], {}).all.length === 0);
// Chrome の部品を差し替えて、保存の流れをまるごと確かめる
function fakeChrome({ history = [], files = {} } = {}) {
  const store = {};
  const got = [];   // 実際にダウンロードした物
  return {
    got, store,
    storage: { get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))])), set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))) },
    downloads: {
      search: async ({ url, filenameRegex }) => [...history, ...got].filter((d) => (url ? d.url === url : new RegExp(filenameRegex).test(d.filename || ''))),
      download: async (o) => { got.push({ url: o.url, filename: o.filename, state: 'complete' }); return got.length; },
    },
    get: async (url) => {
      if (!(url in files)) return { ok: false, status: 404 };
      const bytes = new TextEncoder().encode(files[url]);
      return { ok: true, blob: async () => ({ type: 'image/jpeg', arrayBuffer: async () => bytes.buffer }) };
    },
  };
}
{
  // 同じ写真（中身が同じ）が別のメッセージで2回届いた＋もう1枚
  const a = ph('700000000000000001', '2026-10-27T09:00:00+09:00', 'fileA'), a2 = ph('700000000000000002', '2026-10-27T09:05:00+09:00', 'fileA2'), b = ph('700000000000000003', '2026-10-27T09:10:00+09:00', 'fileB');
  const fc = fakeChrome({ files: { [a.imageUrl]: 'SAME', [a2.imageUrl]: 'SAME', [b.imageUrl]: 'OTHER' } });
  const r1 = await savePhotos({ them: '原', messages: [a, a2, b] }, fc);
  t('中身が同じ写真は、別のメッセージで届いても1回だけ保存する', fc.got.length === 2 && r1.ok === 2 && r1.skipped === 1, { got: fc.got, r1 });
  const r2 = await savePhotos({ them: '原', messages: [a, a2, b] }, fc);
  t('もう一度押しても、1枚も保存しない', fc.got.length === 2 && r2.ok === 0 && r2.skipped === 3, r2);
  // 記録が消えても（別の拡張・入れ直し）、ダウンロードの履歴で保存済みと分かる
  for (const k of Object.keys(fc.store)) delete fc.store[k];
  const r3 = await savePhotos({ them: '原', messages: [a, a2, b] }, fc);
  t('記録が消えても、ダウンロードの履歴にある写真は保存しない', fc.got.length === 2 && r3.ok === 0, r3);
  // 相手の名前が変わって保存先のフォルダが変わっても、中身が同じなら保存しない
  const r4 = await savePhotos({ them: '原さん（教室）', messages: [a, a2, b] }, fc);
  t('相手の名前（フォルダ）が変わっても、同じ写真は保存しない', fc.got.length === 2 && r4.ok === 0, r4);
}
{
  // 前に古い名前で保存した写真（ダウンロードの履歴にある）
  const a = ph('710000000000000001', '2026-10-20T09:00:00+09:00');
  const fc = fakeChrome({ history: [{ url: a.imageUrl, filename: '返信サポート/原/3.jpg', state: 'complete' }], files: { [a.imageUrl]: 'X' } });
  const r = await savePhotos({ them: '原', messages: [a] }, fc);
  t('前の名前の決め方で保存した写真も、保存し直さない', fc.got.length === 0 && r.skipped === 1, r);
  // 途中で止まったダウンロードは保存済みに数えない
  const c = ph('710000000000000002', '2026-10-20T09:01:00+09:00');
  const fc2 = fakeChrome({ history: [{ url: c.imageUrl, state: 'interrupted' }], files: { [c.imageUrl]: 'Y' } });
  const rc = await savePhotos({ them: '原', messages: [c] }, fc2);
  t('途中で止まったダウンロードは、保存し直す', fc2.got.length === 1 && rc.ok === 1, rc);
  // 中身が取り出せない写真は保存しない（見分けられない物は落とさない）
  const d = ph('710000000000000003', '2026-10-20T09:02:00+09:00');
  const fc3 = fakeChrome({});
  const rd = await savePhotos({ them: '原', messages: [d] }, fc3);
  t('中身を取り出せない写真は保存しない', fc3.got.length === 0 && rd.ng === 1, rd);
}
t('保存先の名前に使えない文字・「..」は置き換える', !safeName('../a:b').includes('..') && !/[\\/:*?"<>|]/.test(safeName('../a:b')), safeName('../a:b'));
t('相手の名前が空なら「相手」', safeName('') === '相手');
t('保存済みの記録は新しい分だけ残す', Object.keys(pruneSaved({ a: 1, b: 3, c: 2 }, 2)).sort().join() === 'b,c');

// 未読と未返信は異なる。こちらの既読の時刻だけで選ぶ（相手の既読では選ばない）。
const unreadSample = [
  { id: 'r1', at: '2026-10-29T10:00:00Z', side: 'them', kind: 'text', text: '読んだ相談' },
  { id: 'r2', at: '2026-10-29T11:00:00Z', side: 'us', kind: 'text', text: 'こちらの文' },
  { id: 'r3', at: '2026-10-29T12:00:00Z', side: 'them', kind: 'text', text: 'まだ読んでいない相談' },
  { id: 'r4', at: '2026-10-29T12:01:00Z', side: 'them', kind: 'image' },
  { id: 'r5', at: '2026-10-29T12:02:00Z', side: 'them', kind: 'unsent' },
];
const cut = Date.parse('2026-10-29T10:00:00Z');
const selected = unreadOnly(unreadSample, { read: false, after: cut });
t('未読だけは、既読以前・こちらの文・送信取消を含めない', selected.ok && selected.messages.map((m) => m.id).join() === 'r3,r4', selected);
t('既読の会話には未読はない（未返信が残っていても入れない）', unreadOnly(unreadSample, { read: true, after: cut }).messages.length === 0);
t('未読の境目が取れないとき、未返信へ勝手に置き換えない', !unreadOnly(unreadSample, null).ok && !unreadOnly(unreadSample, { read: false, after: null }).ok);
t('未読の先頭が取れていなければ、一部分を全部としてコピーしない', !unreadOnly(unreadSample, { read: false, after: cut }, false).ok);
t('一度も読んでいない会話は全受信が未読', unreadOnly(unreadSample, { read: false, after: 0 }).messages.length === 3);
const manyUnread = Array.from({ length: 130 }, (_, i) => ({ ...unreadSample[2], id: String(i) }));
t('未読は100件で切り落とさない', unreadOnly(manyUnread, { read: false, after: cut }).messages.length === 130);
const receivedUnreadInfo = chatInfo([{ chatId: 'sample', read: false, lastReadAt: cut, userLastReadAt: cut + 99999999 }], 'sample').unread;
t('こちらの既読の時刻を使い、相手の既読の時刻と混同しない', receivedUnreadInfo.after === cut && !receivedUnreadInfo.read);
const unreadPrompt = buildPrompt({ messages: selected.messages, them: '架空の相手', us: '架空のお店', scope: 'unread', mode: 'text' });
t('未読だけの頼み文に、既読の履歴が無いことを明示する', unreadPrompt.includes('既読の会話とこちらの過去の返信は含めていません') && !unreadPrompt.includes('読んだ相談'));
await testPanel(t);
console.log(ng ? `\n❌ ${ng}件 失敗` : '\n合格');
process.exit(ng ? 1 : 0);
