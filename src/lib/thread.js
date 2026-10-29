// 会話の整理：管理画面から読んだメッセージを、AI に渡しやすい形にそろえる。
// メッセージの形（読み取り方に関係なく、これにそろえる）：
//   { id, at: ISO 文字列, side: 'them'（相手）| 'us'（こちら側＝担当者の誰でも）, author: 表示名,
//     kind: 'text' | 'image' | 'sticker' | 'file' | 'audio' | 'video' | 'other', text, imageUrl }

export const MAX_MESSAGES = 100; // AI に渡すのは最新のこれだけ（無料枠の上限と速さのため）

const KIND_LABEL = { unsent: '（送信を取り消しました）', image: '（写真）', sticker: '（スタンプ）', file: '（ファイル）', audio: '（音声）', video: '（動画）', other: '（そのほかのメッセージ）' };

/** 時刻順に並べ、空の物を外し、最新 MAX_MESSAGES 件にする */
export function tidy(messages) {
  return messages
    .filter((m) => m && (m.side === 'them' || m.side === 'us'))
    .filter((m) => m.kind !== 'text' || (m.text && m.text.trim()))
    .slice()
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-MAX_MESSAGES);
}

/** まだ返していない分＝こちら側の誰かの最後の返信より後の、相手の発言（取り消されたものは数えない） */
export function unanswered(messages) {
  let last = -1;
  messages.forEach((m, i) => { if (m.side === 'us' && m.kind !== 'unsent' && !m.auto) last = i; });
  return messages.slice(last + 1).filter((m) => m.side === 'them' && m.kind !== 'unsent');
}

/** LINEでこちらがまだ読んでいない相手のメッセージ。境目が不明なら推測しない。 */
export function unreadOnly(messages, state, complete = true) {
  if (!state || typeof state.read !== 'boolean') return { ok: false, reason: 'LINEの未読の状態を取得できませんでした。会話を読み直してください。' };
  if (state.read) return { ok: true, messages: [] };
  if (state.after === null || !Number.isFinite(state.after) || !complete) return { ok: false, reason: '未読の先頭まで取得できませんでした。会話を読み直してください。' };
  return { ok: true, messages: messages.filter((m) => m.side === 'them' && m.kind !== 'unsent'
    && Number.isFinite(new Date(m.at).getTime()) && new Date(m.at).getTime() > state.after)
    .slice().sort((a, b) => String(a.at).localeCompare(String(b.at))) };
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
// メールアドレスと電話番号（返信を考えるのにほぼ要らない・既定で伏せる。設定で外せる）
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+81[-\s]?|0)\d{1,4}[-\s(（]?\d{1,4}[-\s)）]?\d{3,4}/g;
export function redact(text, { contacts = true } = {}) {
  let s = String(text).replace(SECRET, (_, head) => `${head}［伏せました］`).replace(TOKEN, '［鍵のような文字列を伏せました］');
  if (contacts) {
    s = s.replace(EMAIL, '［メールアドレス］');
    // 数字が 10〜11 けたのものだけ電話番号とみなす（日付や郵便番号は伏せない）
    s = s.replace(PHONE, (m) => { const n = m.replace(/\D/g, '').replace(/^81/, '0'); return n.length >= 10 && n.length <= 11 ? '［電話番号］' : m; });
  }
  return s;
}

export function lineOf(m, names) {
  const who = m.side === 'us' ? (m.auto ? `${names.us}（自動の返事）` : `${names.us}${m.author && m.author !== names.us ? `（${m.author}）` : ''}`) : (m.author || names.them);
  const label = m.kind === 'other' && m.rawType ? `（そのほかのメッセージ：${m.rawType}）` : (KIND_LABEL[m.kind] || KIND_LABEL.other);
  const body = m.kind === 'text' ? m.text.trim() : label + (m.text ? ' ' + m.text.trim() : '');
  return `[${stamp(m.at).time}] ${who}：${redact(body, { contacts: names.hideContacts !== false })}`;
}

/** 会話を、日付の見出しつきの文にする。まだ返していない分には印を付ける */
export function format(messages, { them = '相手', us = 'こちら', hideContacts = true } = {}) {
  const waiting = new Set(unanswered(messages).map((m) => m));
  const out = [];
  let day = '';
  for (const m of messages) {
    const s = stamp(m.at);
    if (s.date !== day) { day = s.date; out.push(`── ${day} ──`); }
    out.push((waiting.has(m) ? '★ ' : '') + lineOf(m, { them, us, hideContacts }));
  }
  return out.join('\n');
}

/** 最後のやりとりから今までの時間（時間単位・切り捨て） */
export function hoursSinceLast(messages, now = new Date()) {
  const last = messages[messages.length - 1];
  return last ? Math.floor((now - new Date(last.at)) / 36e5) : 0;
}
