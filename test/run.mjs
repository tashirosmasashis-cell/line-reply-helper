// 自己試験：node test/run.mjs
import { tidy, unanswered, format, stamp } from '../src/lib/thread.js';
import { buildPrompt } from '../src/lib/prompt.js';
import { parseAnswer, NEEDS_CHECK } from '../src/lib/parse.js';
import { ask, AiError } from '../src/lib/providers.js';
import { piled, weLast, shop } from './fixtures.mjs';

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

console.log(ng ? `\n❌ ${ng}件 失敗` : '\n合格');
process.exit(ng ? 1 : 0);
