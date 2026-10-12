// LINE 公式アカウントの管理画面の中で動く係。
//   ・右下に「返信を考える」ボタンを出す
//   ・横の窓に頼まれたら、いま開いている会話を読んで渡す（read）
//   ・横の窓に頼まれたら、案を入力欄に入れる（insert）。送信はしない
//   ・写真の中身を渡す（images）
// 会話の中身は外へ送らない。横の窓（この拡張の中）に渡すだけ。
(() => {
  if (window.__lrhLoaded) return;
  window.__lrhLoaded = true;

  // ---------- ボタン
  const btn = document.createElement('button');
  btn.className = 'lrh-fab';
  btn.type = 'button';
  btn.innerHTML = '<span class="lrh-fab__dot"></span>返信を考える';
  btn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-panel' }));
  const place = () => { if (!document.body.contains(btn)) document.body.appendChild(btn); btn.hidden = !reader.isChatOpen(); };
  new MutationObserver(() => place()).observe(document.documentElement, { childList: true, subtree: true });
  place();

  // ---------- 読み取り方（管理画面の作りに合わせる所はここだけ）
  // 返す形：{ chatKey, them, us, isGroup, messages: [{ id, at, side, author, kind, text, imageUrl }] }
  const reader = {
    /** いま会話を開いているか（URL に会話の印があるか） */
    isChatOpen() { return /\/chat\//.test(location.pathname); },
    /** いま開いている会話の印（別の会話に入れてしまう事故を防ぐため、読んだときと入れるときで比べる） */
    chatKey() { return location.pathname; },
    async read() {
      // ⚠ 調査（tools/recorder の記録）で、管理画面の読み取り方を決めてから書く。
      throw Object.assign(new Error('会話を読めませんでした（読み取り方を準備中です）'), { kind: 'unreadable' });
    },
    /** 入力欄を探す */
    input() { return document.querySelector('textarea, [contenteditable="true"]'); },
  };

  // ---------- 入力欄に入れる（入れたことを画面に知らせる合図も送る）
  function insert(text) {
    const el = reader.input();
    if (!el) return { ok: false, error: '入力欄が見つかりませんでした。' };
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }
    return { ok: true };
  }

  // ---------- 写真の中身（ページと同じログインで取る）
  async function images(urls) {
    const out = [];
    for (const url of urls.slice(-4)) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size > 4_000_000) continue;
        const base64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        out.push({ url, mime: blob.type || 'image/jpeg', base64 });
      } catch { /* 取れない写真は飛ばす（「写真が届いた」とだけ伝わる） */ }
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'read') {
      reader.read().then((c) => reply({ ok: true, convo: { ...c, chatKey: reader.chatKey() } }))
        .catch((e) => reply({ ok: false, kind: e.kind || 'unreadable', error: e.message || String(e) }));
      return true;
    }
    if (msg?.type === 'insert') {
      if (msg.chatKey !== reader.chatKey()) { reply({ ok: false, error: '読んだときと別の会話が開いています。入れるのをやめました。もう一度「返信を考える」を押してください。' }); return; }
      reply(insert(msg.text));
      return;
    }
    if (msg?.type === 'images') { images(msg.urls || []).then((list) => reply({ ok: true, images: list })); return true; }
    if (msg?.type === 'ping') { reply({ ok: true, chatOpen: reader.isChatOpen() }); return; }
  });
})();
