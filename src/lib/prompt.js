// AI への頼み方。「その場で返信（鍵あり）」も「コピーして貼る（鍵なし）」も、ここで作った同じ頼み方を使う。
import { format, unanswered, hoursSinceLast, stamp } from './thread.js';

const RULES = `守ること：
- まだ返していない相手の発言（★の付いた行）に、漏れなく応える。1通でも10通でも、全部をまとめて1通で返す。
- それより前の会話も読み、約束したこと・前に聞いたことと食い違わないようにする。
- 書き方は、会話の中の「こちら」の過去の返信の口調・長さ・絵文字の使い方に合わせる。
- 相手が書いた言葉の言語で返す。
- まだ返していない相手の最初の発言から半日以上たっていれば、返信の頭に遅くなったことへのひとことのおわびを入れる。
- 分からない事実（日にち・時間・金額・できるかどうか・もうやったかどうか）は作らない。その所は ［要確認：何を確かめるか］ と空けておく。ただし「伝えたいこと」に書かれた事実は使ってよい。
- できない約束・勝手な値引き・相手の個人情報の繰り返しはしない。
- 返さなくてもよい場面（相手の最後がお礼やあいさつだけ、など）は、そう判断してよい。`;

const SHAPE_JSON = `答えは次の JSON だけで返す（前後に文を付けない）：
{
  "points": ["返すこと（質問・お願い・お礼・知らせ）を短く1つずつ"],
  "noReplyNeeded": { "yes": false, "reason": "返さなくてもよい・スタンプで十分なら yes を true にして理由" },
  "best": "いちばん合う返信の本文",
  "alternatives": [ { "label": "短め", "text": "本文" }, { "label": "気持ちを込めて", "text": "本文" } ]
}`;

const SHAPE_TEXT = `答えは次の形で書く：
## 返すこと
- （まだ返していない相手の発言から、答えるべき点を1つずつ）
## 返さなくてもよい？
（返さなくてもよい・スタンプで十分なら、その理由。返したほうがよければ「返したほうがよい」）
## いちばん合う返信
（そのまま送れる本文）
## 別の言い方
### 短め
（本文）
### 気持ちを込めて
（本文）`;

/**
 * @param o.messages   tidy 済みのメッセージ
 * @param o.them       相手の名前
 * @param o.us         こちら側の名前（公式アカウントの名前）
 * @param o.intent     伝えたいこと（任意）
 * @param o.myRole     自分の立場・口調（設定・任意）
 * @param o.memo       この相手のメモ（設定・任意）
 * @param o.now        いまの日時
 * @param o.mode       'json'（鍵あり）| 'text'（コピーして貼る）
 * @param o.photoNote  写真を AI に見せるときの説明（鍵ありで写真を付けるとき）
 */
export function buildPrompt(o) {
  const now = o.now || new Date();
  const waiting = unanswered(o.messages);
  const gap = hoursSinceLast(o.messages, now);
  const waitedFor = waiting.length ? Math.floor((now - new Date(waiting[0].at)) / 36e5) : 0;
  const n = stamp(now.toISOString());
  const parts = [
    `あなたは LINE 公式アカウント「${o.us}」の返信を考える手伝いをします。相手は「${o.them}」さんです。`,
    `いまは ${n.date} ${n.time}。最後のやりとりから約 ${gap} 時間たっています。` + (waiting.length ? `まだ返していない相手の最初の発言からは約 ${waitedFor} 時間です。` : ''),
  ];
  if (o.myRole && o.myRole.trim()) parts.push(`こちらの立場・口調：${o.myRole.trim()}`);
  if (o.memo && o.memo.trim()) parts.push(`${o.them}さんについてのメモ：${o.memo.trim()}`);
  if (o.intent && o.intent.trim()) parts.push(`今回こちらが伝えたいこと：${o.intent.trim()}`);
  parts.push(waiting.length ? `まだ返していない相手の発言は ${waiting.length} 件です（★の行）。` : 'まだ返していない相手の発言はありません（最後に送ったのはこちらです）。追いの一言が要るかも考えてください。');
  if (o.photoNote) parts.push(o.photoNote);
  parts.push('');
  parts.push('会話：');
  parts.push(format(o.messages, { them: o.them, us: o.us }));
  parts.push('');
  parts.push(RULES);
  parts.push('');
  parts.push(o.mode === 'json' ? SHAPE_JSON : SHAPE_TEXT);
  return parts.join('\n');
}
