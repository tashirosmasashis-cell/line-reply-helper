// 写真の保存先のフォルダ（全員の写真をまとめる1つのフォルダ。選ぶのは設定の画面）。本人が1回選ぶと覚えておき、中の写真を読んで、そこへ書く（保存済みかどうかの正本がフォルダになる）。
//   フォルダの選択は Chrome の窓で本人が行う。覚えた先への読み書きの許可は Chrome が管理する（ブラウザを開き直すと聞き直されることがある）。

const DB = 'reply-helper-folder', STORE = 'folders', KEY = 'photos';
const ALLOWED_FILES = /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i;

function open() {
  return new Promise((ok, ng) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
}

/** 覚えている保存先（無ければ null） */
export async function savedFolder() {
  const db = await open();
  return new Promise((ok, ng) => {
    const r = db.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => ok(r.result || null);
    r.onerror = () => ng(r.error);
  });
}

/** 保存先を選んでもらう（押した操作の続きで呼ぶ） */
export function pickFolder() {
  return showDirectoryPicker({ id: 'reply-helper-photos', mode: 'readwrite', startIn: 'desktop' });
}

/** 保存先を覚える */
export async function keepFolder(dir) {
  const db = await open();
  await new Promise((ok, ng) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dir, KEY);
    tx.oncomplete = () => ok();
    tx.onerror = () => ng(tx.error);
  });
}

/** 読み書きの許可があるか。無ければ聞く（押した操作の続きで呼ぶ） */
export async function canWrite(dir) {
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** 保存先の読み書き。読むのは選んだフォルダの直下と、その1段下（相手ごとのフォルダ）の写真だけ */
export function folderOf(root) {
  return {
    async list() {
      const out = [];
      for await (const [name, h] of root.entries()) {
        if (h.kind === 'file') {
          if (ALLOWED_FILES.test(name)) out.push({ name, blob: await h.getFile() });
        } else {
          for await (const [inner, f] of h.entries()) if (f.kind === 'file' && ALLOWED_FILES.test(inner)) out.push({ name: `${name}/${inner}`, blob: await f.getFile() });
        }
      }
      return out;
    },
    async write(place, blob) {
      const parts = place.split('/');
      const file = parts.pop();
      let dir = root;
      // 保存先に相手のフォルダそのものを選んだときは、その中へ直接書く（同じ名前のフォルダを中に作らない）
      for (const p of parts) if (p !== root.name) dir = await dir.getDirectoryHandle(p, { create: true });
      const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
      await w.write(blob);
      await w.close();
    },
  };
}
