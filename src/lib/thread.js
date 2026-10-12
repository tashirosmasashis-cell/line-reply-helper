// 会話の整理：管理画面から読んだメッセージを、AI に渡しやすい形にそろえる。
// メッセージの形（読み取り方に関係なく、これにそろえる）：
//   { id, at: ISO 文字列, side: 'them'（相手）| 'us'（こちら側＝担当者の誰でも）, author: 表示名,
//     kind: 'text' | 'image' | 'sticker' | 'file' | 'audio' | 'video' | 'other', text, imageUrl }

export const MAX_MESSAGES = 100; // AI に渡すのは最新のこれだけ（無料枠の上限と速さのため）

const KIND_LABEL = { image: '（写真）', sticker: '（スタンプ）', file: '（ファイル）', audio: '（音声）', video: '（動画）', other: '（そのほかのメッセージ）' };

/** 時刻順に並べ、空の物を外し、最新 MAX_MESSAGES 件にする */
export function tidy(messages) {
  return messages
    .filter((m) => m && (m.side === 'them' || m.side === 'us'))
    .filter((m) => m.kind !== 'text' || (m.text && m.text.trim()))
    .slice()
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-MAX_MESSAGES);
}

/** まだ返していない分＝こちら側の誰かの最後の返信より後の、相手の発言 */
export function unanswered(messages) {
  let last = -1;
  messages.forEach((m, i) => { if (m.side === 'us') last = i; });
  return messages.slice(last + 1).filter((m) => m.side === 'them');
}

/** 日本時間の「10/12 20:28」。日付が変わったら見出しを入れるのは format の側 */
const pad = (n) => String(n).padStart(2, '0');
export function stamp(iso, tz = 'Asia/Tokyo') {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}年${p.month}月${p.day}日`, time: `${pad(+p.hour % 24)}:${p.minute}`, md: `${p.month}/${p.day}` };
}

// パスワードらしき所は伏せてから AI に渡す（会話にログイン情報が貼られていることがある・2026-10 実際にあった）
// 「パス」のあとに区切り（空白・：・＝・は）があるときだけ伏せる（「パスタ」などは伏せない）
const SECRET = /((?:パスワード|パス|ﾊﾟｽ|password|passwd|pass|pw|PIN|暗証番号)(?:\s*(?:は|:|：|=|＝)\s*|\s+))([^\s、。，,]{4,})/gi;
const TOKEN = /\b(?:AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b/g;
export function redact(text) {
  return String(text).replace(SECRET, (_, head) => `${head}［伏せました］`).replace(TOKEN, '［鍵のような文字列を伏せました］');
}

export function lineOf(m, names) {
  const who = m.side === 'us' ? `${names.us}${m.author && m.author !== names.us ? `（${m.author}）` : ''}` : (m.author || names.them);
  const label = m.kind === 'other' && m.rawType ? `（そのほかのメッセージ：${m.rawType}）` : (KIND_LABEL[m.kind] || KIND_LABEL.other);
  const body = m.kind === 'text' ? m.text.trim() : label + (m.text ? ' ' + m.text.trim() : '');
  return `[${stamp(m.at).time}] ${who}：${redact(body)}`;
}

/** 会話を、日付の見出しつきの文にする。まだ返していない分には印を付ける */
export function format(messages, { them = '相手', us = 'こちら' } = {}) {
  const waiting = new Set(unanswered(messages).map((m) => m));
  const out = [];
  let day = '';
  for (const m of messages) {
    const s = stamp(m.at);
    if (s.date !== day) { day = s.date; out.push(`── ${day} ──`); }
    out.push((waiting.has(m) ? '★ ' : '') + lineOf(m, { them, us }));
  }
  return out.join('\n');
}

/** 最後のやりとりから今までの時間（時間単位・切り捨て） */
export function hoursSinceLast(messages, now = new Date()) {
  const last = messages[messages.length - 1];
  return last ? Math.floor((now - new Date(last.at)) / 36e5) : 0;
}
