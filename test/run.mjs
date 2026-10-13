// 自己試験：node test/run.mjs
import { tidy, unanswered, format, stamp, redact } from '../src/lib/thread.js';
import { buildPrompt } from '../src/lib/prompt.js';
import { parseAnswer, NEEDS_CHECK } from '../src/lib/parse.js';
import { ask, AiError, PROVIDERS } from '../src/lib/providers.js';
import { piled, weLast, shop, apiMessages, apiChats, BOT, CHAT } from './fixtures.mjs';
import { parsePath, toMessages, chatInfo, imageUrl, waitingChats } from '../src/lib/linechat.js';

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

console.log(ng ? `\n❌ ${ng}件 失敗` : '\n合格');
process.exit(ng ? 1 : 0);
