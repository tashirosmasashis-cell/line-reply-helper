// 写真の保存：同じ写真を絶対に二重に保存しないための決まり（2026-10-27 作り直し）。
//   ・見分けるのは写真の「中身」（指紋＝SHA-256）。メッセージの番号や名前では見分けない
//     （番号で見ていたときは、名前の決め方が変わる前に保存した写真・同じ写真が別のメッセージで届いたものを、別の写真として保存し直していた）
//   ・名前も中身から決める（日時＋指紋の頭12文字）＝同じ写真はいつ押しても同じ名前
//   ・保存する前に、ダウンロードの履歴に同じ住所・同じ指紋の名前の写真があれば飛ばす（記録が消えても・ほかの拡張で保存した分も拾う）
//   ・指紋が取れない写真は保存しない（見分けられない物を落とすと二重になりうる）

/** 保存するフォルダの名前に使える形にする（相手の名前は相手が決められるため、使えない文字・「..」で始まる名前は置き換える） */
export function safeName(them) {
  return String(them || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 60) || '相手';
}

const pad = (n) => String(n).padStart(2, '0');

/** 写真の種類から拡張子（分からなければ jpg） */
export function extFor(mime) {
  const t = String(mime || '').toLowerCase().split(';')[0].trim();
  return { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[t] || 'jpg';
}

/** 名前に入れる指紋の長さ（ダウンロードの履歴を、この指紋で探して保存済みかを見る） */
export const SHA_IN_NAME = 12;

/** ダウンロードの中での保存先（返信サポート/相手の名前/日時_指紋.拡張子）。sha＝写真の中身の指紋 */
export function photoFileName(them, m, sha, mime) {
  const d = new Date(m.at);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `返信サポート/${safeName(them)}/${day}_${String(sha).slice(0, SHA_IN_NAME)}.${extFor(mime)}`;
}

/** 写真の中身の指紋（SHA-256 の16進） */
export async function fingerprint(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 写真のメッセージと、もう保存済みと分かっている物（メッセージの番号で）に分ける。番号で分からない物は、中身を見て決める */
export function splitPhotos(messages, savedIds) {
  const all = (messages || []).filter((m) => m.kind === 'image' && m.imageUrl);
  const done = savedIds || {};
  return { all, todo: all.filter((m) => !done[m.id]), skipped: all.filter((m) => done[m.id]) };
}

/** 中身の指紋で決める：保存済みの指紋なら飛ばす */
export const isSavedHash = (sha, savedHashes) => !!(sha && savedHashes && savedHashes[sha]);

/** 記録を新しい2万件までにする（増え続けないように。2万件でも Chrome の中の置き場の上限には遠い） */
export function pruneSaved(saved, limit = 20000) {
  const rows = Object.entries(saved || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return Object.fromEntries(rows);
}

/** ダウンロードの履歴の中で、保存できている（または保存中の）物があるか。途中で止まった物は数えない */
const anyKept = (rows) => (rows || []).some((d) => d.state !== 'interrupted');

/**
 * 写真を保存する（同じ写真は絶対に二重に保存しない）。Chrome の部品は渡してもらう（試験で差し替えられるように）
 *   storage＝chrome.storage.local／downloads＝chrome.downloads／get＝写真を取り出す（fetch）
 *   ① メッセージの番号で保存済み → 飛ばす
 *   ② ダウンロードの履歴に同じ住所 → 飛ばす（この記録より前・名前の決め方が違ったころ・ほかの拡張で保存した分も）
 *   ③ 中身の指紋が保存済み → 飛ばす（同じ写真が別のメッセージで届いた・前に別の名前で保存した）
 *   ④ ダウンロードの履歴に、名前に同じ指紋の入った写真がある → 飛ばす（記録が消えても・相手の名前のフォルダが変わっても）
 *   指紋が取れない写真は保存しない。記録は1枚ごとに書く（途中で窓を閉じても、保存した分は覚えている）
 */
export async function savePhotos(c, { storage, downloads, get }) {
  const rec = await storage.get(['savedPhotos', 'savedPhotoHashes']);
  const ids = rec.savedPhotos || {};
  const hashes = rec.savedPhotoHashes || {};
  const keep = () => storage.set({ savedPhotos: pruneSaved(ids), savedPhotoHashes: pruneSaved(hashes) });
  const { all, todo } = splitPhotos(c.messages, ids);
  let ok = 0, same = 0, ng = 0;
  for (const m of todo) {
    const now = Date.now();
    if (anyKept(await downloads.search({ url: m.imageUrl }).catch(() => []))) { ids[m.id] = now; same++; await keep(); continue; }
    let sha = '', mime = '';
    try {
      const res = await get(m.imageUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      mime = blob.type;
      sha = await fingerprint(await blob.arrayBuffer());
    } catch { ng++; continue; }
    if (isSavedHash(sha, hashes)) { ids[m.id] = now; same++; await keep(); continue; }
    const named = await downloads.search({ filenameRegex: '_' + sha.slice(0, SHA_IN_NAME) + '\\.[A-Za-z]+$' }).catch(() => []);
    if (anyKept(named)) { ids[m.id] = now; hashes[sha] = now; same++; await keep(); continue; }
    const id = await downloads.download({ url: m.imageUrl, filename: photoFileName(c.them, m, sha, mime), conflictAction: 'overwrite' }).catch(() => undefined);
    if (id === undefined) { ng++; continue; }
    ids[m.id] = now; hashes[sha] = now; ok++;
    await keep();
  }
  return { all: all.length, ok, skipped: all.length - todo.length + same, ng };
}
