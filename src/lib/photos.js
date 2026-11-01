// 写真の保存：同じ写真を絶対に二重に保存しないための決まり（2026-11-01 作り直し）。
//   ・正本は保存先のフォルダの中身。押すたびにフォルダの写真を読み、そこに無い写真だけを書く
//     （拡張の記録とダウンロードの履歴だけを見ていたときは、Chrome を変えた・履歴を消した・別の版で保存した写真を知らず、全部保存し直していた）
//     フォルダのほかに記録は持たない＝消した写真は押せば戻る（2026-11-01 本人が2枚消して試した）
//   ・見分けるのは写真の見た目（縮めた絵の明暗の並び）。LINE は同じ写真を 384px でも 256px でも返すので、中身の指紋では別物に見える
//     （実測 2026-11-01：同じ写真どうしの差は 0〜7、別の写真は 14 以上。64 のうち SAME_LOOK 以下を同じと見る）
//   ・見た目を比べられない写真は保存しない（見分けられない物を書くと二重になりうる）
//   ・保存するのは大きい写真（元の写真）だけ。LINE の縮小版（住所の末尾 /preview）は保存しない。取れなければ保存しない
//     フォルダに同じ写真の小さい物があれば、大きい写真に置き換える（2026-11-01 本人「大きいサイズしかいりません」）

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

/** 保存先のフォルダの中での場所（相手の名前/日時_指紋.拡張子）。sha＝写真の中身の指紋 */
export function photoFileName(them, m, sha, mime) {
  const d = new Date(m.at);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${safeName(them)}/${day}_${String(sha).slice(0, 12)}.${extFor(mime)}`;
}

/** 写真の中身の指紋（SHA-256 の16進） */
export async function fingerprint(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 64 のうちこの数以下の違いなら同じ写真（実測の境目＝同じ写真は7以下・別の写真は14以上） */
export const SAME_LOOK = 8;

/** 明暗の並び（横9×縦8に縮めて、となりより明るいかを64個並べる）から、見た目の印を16進で作る */
export function lookFromGray(gray) {
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const p = i + k, x = p % 8, y = (p - x) / 8;
      n = n * 2 + (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
    }
    hex += n.toString(16);
  }
  return hex;
}

/** 写真の見た目の印と画素数 */
export async function lookPrint(blob) {
  const bmp = await createImageBitmap(blob);
  const pixels = bmp.width * bmp.height;
  // 一度 90×80 にして、10×10 ごとの平均で 9×8 にする（9×8 へ直接縮めると元の大きさで結果が変わり、同じ写真を別物と見た・2026-11-01 実物で確かめた）
  const canvas = new OffscreenCanvas(90, 80);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, 90, 80);
  bmp.close();
  const px = ctx.getImageData(0, 0, 90, 80).data;
  const gray = new Array(72).fill(0);
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 90; x++) {
      const i = (y * 90 + x) * 4;
      gray[Math.floor(y / 10) * 9 + Math.floor(x / 10)] += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
  }
  return { look: lookFromGray(gray), pixels };
}

/** 見た目の印の違いの数（0〜64） */
export function lookDistance(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** 2つの見た目の印が同じ写真か */
export const sameLook = (a, b) => lookDistance(a, b) <= SAME_LOOK;

/** 大きい写真（元の写真）の住所。管理画面の住所の末尾 /preview は縮小版 */
export const largeUrl = (url) => String(url).replace(/\/preview$/, '');

/**
 * 写真を保存する（同じ写真は絶対に二重に保存しない・大きい写真だけを保存する）。部品は渡してもらう（試験で差し替えられるように）
 *   folder＝保存先（list と write・lib/folder.js）／get＝写真を取り出す（fetch）／print＝見た目の印と画素数
 *   ① 保存先のフォルダの写真をすべて読み、中身の指紋と見た目の印を取る
 *   ② 大きい写真を取り出す。中身か見た目がフォルダの写真と同じなら飛ばす（別のメッセージ・別の名前でも）
 *   ③ 同じ写真の小さい物しかフォルダに無ければ、大きい写真を書いてから、小さい物を消す
 *   見分けられない写真は保存しない。別の記録は持たない＝フォルダから消した写真は、押せばまた保存する
 */
export async function savePhotos(c, { folder, get, print = lookPrint }) {
  const shas = new Set();
  const seen = [];
  for (const f of await folder.list()) {
    try {
      shas.add(await fingerprint(await f.blob.arrayBuffer()));
      seen.push({ ...(await print(f.blob)), remove: f.remove });
    } catch { /* 写真として読めないファイルは比べる相手にしない */ }
  }
  const all = (c.messages || []).filter((m) => m.kind === 'image' && m.imageUrl);
  let ok = 0, bigger = 0, same = 0, ng = 0;
  for (const m of all) {
    let sha = '', got = null, blob = null;
    try {
      const res = await get(largeUrl(m.imageUrl), { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      blob = await res.blob();
      sha = await fingerprint(await blob.arrayBuffer());
      got = await print(blob);
    } catch { ng++; continue; }
    if (shas.has(sha)) { same++; continue; }
    const twins = seen.filter((x) => sameLook(got.look, x.look));
    if (twins.some((x) => x.pixels >= got.pixels)) { same++; continue; }
    try {
      await folder.write(photoFileName(c.them, m, sha, blob.type), blob);
      for (const x of twins) {
        await x.remove();
        seen.splice(seen.indexOf(x), 1);
      }
    } catch { ng++; continue; }
    shas.add(sha);
    seen.push({ ...got, remove: () => Promise.resolve() });
    if (twins.length) bigger++;
    else ok++;
  }
  return { all: all.length, ok, bigger, skipped: same, ng };
}
