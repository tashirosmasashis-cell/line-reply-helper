// 自己試験：node test/run.mjs
import { tidy, unanswered, format, stamp, redact } from '../src/lib/thread.js';
import { buildPrompt } from '../src/lib/prompt.js';
import { parseAnswer, NEEDS_CHECK } from '../src/lib/parse.js';
import { ask, AiError } from '../src/lib/providers.js';
import { piled, weLast, shop, apiMessages, apiChats, BOT, CHAT } from './fixtures.mjs';
import { parsePath, toMessages, chatInfo, imageUrl } from '../src/lib/linechat.js';

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

console.log(ng ? `\n❌ ${ng}件 失敗` : '\n合格');
process.exit(ng ? 1 : 0);
