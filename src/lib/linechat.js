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
    if (t === 'unsent') { m.kind = 'unsent'; } // 相手（またはこちら）が送信を取り消した印。中身は LINE 側で消えている（2026-10 の調査で確かめた名前）
    else if (kind === 'other' && t === 'location') { m.kind = 'text'; }
    else if (kind === 'other') m.rawType = String(t || e.message.contentType || '不明');
    // 自動の返事（応答メッセージ・bot）は、担当者の印（bizId・sendId）が無い＝人が返したことにしない（2026-10-13 本物で確かめた）
    if (side === 'us' && !e.bizId && !e.sendId) m.auto = true;
    const hash = e.message.contentHash || e.message.contentProvider?.contentHash;
    if (kind === 'image' && hash && !e.message.expired) m.imageUrl = imageUrl(botId, hash);
    if (kind === 'file' && e.message.fileName) m.text = e.message.fileName;
    out.push(m);
  }
  return out;
}

/** まだ返していない会話の一覧（相手から最後に届いた時刻が、こちらが最後に送った時刻より新しい1対1の会話）。新しい順。
 *  ⚠ この一覧と会話の中身を読むだけでは、管理画面で「既読」にならない（2026-10-13 本人の LINE で確かめた）。 */
export function waitingChats(chatsList) {
  return (chatsList || [])
    .filter((c) => {
      if (!c || (c.chatType && c.chatType !== 'USER')) return false;
      const got = Number(c.lastReceivedAt || 0), sent = Number(c.lastSentAt || 0);
      const ev = c.latestEvent || {};
      // 最後がこちらの「自動の返事」（担当者の印なし）なら、まだ人は返していない
      const autoLast = ev.type === 'messageSent' && !ev.bizId && !ev.sendId;
      return got > sent || autoLast || c.read === false;
    })
    .map((c) => ({
      chatId: c.chatId,
      name: c.profile?.nickname || c.profile?.name || '（名前なし）',
      at: new Date(Number(c.lastReceivedAt)).toISOString(),
      text: c.latestEvent?.message?.type === 'text' ? String(c.latestEvent.message.text || '').slice(0, 60) : '（写真やスタンプなど）',
      unread: c.read === false,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** 相手の名前（あなたが付けた呼び名があればそれ）・グループかどうか・相手がこちらの最後の返信を読んだか
 *  会話の一覧の userLastReadAt＝相手が最後に読んだ時刻、lastSentAt＝こちらが最後に送った時刻（2026-10 の調査で確かめた） */
export function chatInfo(chatsList, chatId) {
  const c = (chatsList || []).find((x) => x && x.chatId === chatId);
  if (!c) return { them: null, isGroup: false, theyRead: null };
  const sent = Number(c.lastSentAt) || 0, read = Number(c.userLastReadAt) || 0;
  return {
    them: c.profile?.nickname || c.profile?.name || null,
    isGroup: !!c.chatType && c.chatType !== 'USER',
    theyRead: sent ? { read: read >= sent, at: read ? new Date(read).toISOString() : null } : null,
  };
}
