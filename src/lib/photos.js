// 写真の保存：同じ写真を二重に保存しないための決まり（保存した名前・保存済みの記録）。
//   ・名前は「その写真が届いた日時＋写真の番号（LINE のメッセージ番号の末尾）」で決める＝会話が増えても同じ写真は同じ名前（「何番目の写真か」で決めると、増えるたびにずれて別名で保存し直していた）
//   ・保存したメッセージ番号を覚え、次に押したときは飛ばす。Shift を押しながらなら、同じ名前に**上書き**して保存し直す（増えない）

/** 保存するフォルダの名前に使える形にする（相手の名前は相手が決められるため、使えない文字・「..」で始まる名前は置き換える） */
export function safeName(them) {
  return String(them || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 60) || '相手';
}

const pad = (n) => String(n).padStart(2, '0');

/** ダウンロードの中での保存先（返信サポート/相手の名前/日時_番号.jpg） */
export function photoFileName(them, m) {
  const d = new Date(m.at);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const id = String(m.id || '').replace(/[^0-9A-Za-z]/g, '').slice(-8) || String(d.getTime());
  return `返信サポート/${safeName(them)}/${day}_${id}.jpg`;
}

/** 保存する写真と、保存済みで飛ばす写真に分ける（force＝保存済みも保存し直す） */
export function splitPhotos(messages, saved, force = false) {
  const all = (messages || []).filter((m) => m.kind === 'image' && m.imageUrl);
  const done = saved || {};
  return force ? { all, todo: all, skipped: [] } : { all, todo: all.filter((m) => !done[m.id]), skipped: all.filter((m) => done[m.id]) };
}

/** 保存済みの記録を新しい500件までにする（記録が増え続けないように） */
export function pruneSaved(saved, limit = 500) {
  const rows = Object.entries(saved || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return Object.fromEntries(rows);
}
