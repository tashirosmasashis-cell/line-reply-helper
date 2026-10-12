// LINE 公式アカウントの管理画面（chat.line.biz）が自分で使っている内部の口の答えを、この道具のメッセージの形にそろえる。
// 調べた形（2026-10 時点）：
//   GET /api/v3/bots/{botId}/chats/{chatId}/messages        → { list: [イベント…], backward: 次の古い分の印 }
//     イベント.type：'message'（相手から）| 'messageSent'（こちらから）| 'chatRead' など（既読の印＝使わない）
//     .timestamp（ミリ秒）・.message.{ id, type: text|image|sticker|file|audio|video|location…, text }
//     写真：.message.contentHash → https://chat-content.line.biz/bot/{botId}/{contentHash}/preview
//   GET /api/v2/bots/{botId}/chats                            → { list: [{ chatId, chatType: USER|GROUP|ROOM, profile: { name, nickname } }] }
//   GET /api/v1/bots/{botId}                                  → { name }（公式アカウントの名前）
// ⚠ 公式に公開された口ではないので、形が変わったら読めなくなる。そのときは「読めませんでした」と出す。

const KINDS = { text: 'text', image: 'image', sticker: 'sticker', file: 'file', audio: 'audio', video: 'video' };

export function parsePath(pathname) {
  const m = String(pathname).match(/^\/(U[0-9a-f]{32})\/chat\/([A-Za-z0-9]+)/);
  return m ? { botId: m[1], chatId: m[2] } : null;
}

export function imageUrl(botId, hash) {
  return `https://chat-content.line.biz/bot/${botId}/${encodeURIComponent(hash).replace(/%3D/g, '=')}/preview`;
}

/** 内部の口のイベントを、この道具のメッセージの形にする */
export function toMessages(events, { botId, them, us }) {
  const out = [];
  for (const e of events || []) {
    if (!e || (e.type !== 'message' && e.type !== 'messageSent') || !e.message) continue;
    const side = e.type === 'messageSent' ? 'us' : 'them';
    const t = e.message.type;
    const kind = KINDS[t] || 'other';
    const m = {
      id: String(e.message.id || e.timestamp),
      at: new Date(Number(e.timestamp)).toISOString(),
      side,
      author: side === 'us' ? us : them,
      kind,
      text: kind === 'text' ? String(e.message.text || '') : (t === 'location' ? `（位置情報）${e.message.title || ''} ${e.message.address || ''}`.trim() : ''),
    };
    if (kind === 'other' && t === 'location') { m.kind = 'text'; }
    const hash = e.message.contentHash || e.message.contentProvider?.contentHash;
    if (kind === 'image' && hash && !e.message.expired) m.imageUrl = imageUrl(botId, hash);
    if (kind === 'file' && e.message.fileName) m.text = e.message.fileName;
    out.push(m);
  }
  return out;
}

/** 相手の名前（あなたが付けた呼び名があればそれ）と、グループかどうか */
export function chatInfo(chatsList, chatId) {
  const c = (chatsList || []).find((x) => x && x.chatId === chatId);
  if (!c) return { them: null, isGroup: false };
  return { them: c.profile?.nickname || c.profile?.name || null, isGroup: !!c.chatType && c.chatType !== 'USER' };
}
