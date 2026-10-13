// LINE 公式アカウントの管理画面の中で動く係。
//   ・相手の名前の横の列（「要対応」「対応済み」の並び）に「返信を考える」ボタンを出す（見つからなければ右下）
//   ・横の窓に頼まれたら、いま開いている会話を読んで渡す（read）
//   ・横の窓に頼まれたら、案を入力欄に入れる（insert）。送信はしない
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
  // 置き場所：会話の見出しの右の列（2026-10 の調査で見た作り＝#content-secondary .sub-header の中の
  // 「左右に分かれた行」の右側）。入力欄や自分の吹き出しに重ならない。見つからなければ右下に浮かせる。
  const headerSlot = () => {
    const row = document.querySelector('#content-secondary .sub-header .d-flex.justify-content-between');
    return row && row.lastElementChild && row.lastElementChild !== row.firstElementChild ? row.lastElementChild : null;
  };
  const place = () => {
    const slot = headerSlot();
    if (slot) {
      if (btn.parentElement !== slot) { btn.classList.add('lrh-fab--inline'); slot.prepend(btn); }
    } else if (!document.body.contains(btn) || btn.classList.contains('lrh-fab--inline')) {
      btn.classList.remove('lrh-fab--inline'); document.body.appendChild(btn);
    }
    btn.hidden = !reader.isChatOpen();
  };

  // ---------- 読み取り方（管理画面の作りに合わせる所はここだけ）
  // 返す形：{ chatKey, them, us, isGroup, messages: [{ id, at, side, author, kind, text, imageUrl }] }
  // 管理画面が自分で使っている内部の口を、同じログインのまま読む（形のそろえ方は src/lib/linechat.js）
  const lib = () => import(chrome.runtime.getURL('src/lib/linechat.js'));
  const getJson = async (path) => {
    const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!res.ok) throw Object.assign(new Error(`会話を読めませんでした（管理画面の答え ${res.status}）。ログインし直すか、管理画面を読み込み直してください。`), { kind: 'unreadable' });
    return res.json();
  };
  const reader = {
    /** いま会話を開いているか（URL に会話の印があるか） */
    isChatOpen() { return /^\/U[0-9a-f]{32}\/chat\/[A-Za-z0-9]+/.test(location.pathname); },
    /** いま開いている会話の印（別の会話に入れてしまう事故を防ぐため、読んだときと入れるときで比べる） */
    chatKey() { return location.pathname; },
    async read() {
      const { parsePath, toMessages, chatInfo } = await lib();
      const ids = parsePath(location.pathname);
      if (!ids) throw Object.assign(new Error('相手との会話を開いてから押してください。'), { kind: 'nochat' });
      const base = `/api/v3/bots/${ids.botId}/chats/${ids.chatId}/messages`;
      const [page1, chats, bot] = await Promise.all([
        getJson(base),
        getJson(`/api/v2/bots/${ids.botId}/chats`).catch(() => ({ list: [] })),
        getJson(`/api/v1/bots/${ids.botId}?noFilter=true`).catch(() => ({})),
      ]);
      if (!page1 || !Array.isArray(page1.list)) throw Object.assign(new Error('会話を読めませんでした（管理画面が変わった可能性があります）。'), { kind: 'unreadable' });
      let events = page1.list;
      // もう1ページ古い分（最新 100 件ほどにする）。取れなければ最初の分だけで進める
      if (page1.backward) {
        const older = await getJson(`${base}?backward=${encodeURIComponent(page1.backward)}`).catch(() => null);
        if (older && Array.isArray(older.list)) events = older.list.concat(events);
      }
      const info = chatInfo(chats.list, ids.chatId);
      const them = info.them || headerName() || '相手';
      const us = bot.name || 'こちら';
      const seen = new Set();
      const messages = toMessages(events, { botId: ids.botId, them, us }).filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
      return { them, us, isGroup: info.isGroup, theyRead: info.theyRead, messages };
    },
    /** 入力欄を探す。管理画面の入力欄は独自の部品 <textarea-ex id="editor">（2026-10 の調査）。中に本物の入力欄があればそれを使う */
    input() {
      const host = document.querySelector('#editable-unit #editor, textarea-ex#editor, textarea-ex') || document.querySelector('#editable-unit textarea');
      if (!host) return null;
      const inner = (host.shadowRoot && host.shadowRoot.querySelector('textarea, [contenteditable=""], [contenteditable="true"]'))
        || (host.tagName === 'TEXTAREA' ? host : host.querySelector('textarea, [contenteditable=""], [contenteditable="true"]'));
      return { host, inner };
    },
  };

  // ---------- 入力欄に入れる
  // ⚠ 管理画面は「Enter で送信」。キーを押したことにはしない（値を入れて「入力された」合図だけ送る）＝勝手に送られない。
  // 入れたあとに読み返し、入っていなければ { ok:false, copy:true } を返す（横の窓がコピーに切り替える）。
  function insert(text) {
    const found = reader.input();
    if (!found) return { ok: false, copy: true, error: '入力欄が見つかりませんでした。' };
    const { host, inner } = found;
    const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); };
    try {
      if (inner && inner.tagName === 'TEXTAREA') {
        inner.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(inner, text);
        fire(inner);
      } else if (inner) {
        inner.focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      } else if ('value' in host) {
        host.focus();
        host.value = text;
        fire(host);
      }
    } catch { /* 下の読み返しで判断する */ }
    const now = inner ? (inner.value ?? inner.innerText ?? '') : (host.value ?? '');
    const head = text.replace(/\s+/g, '').slice(0, 12);
    if (!String(now).replace(/\s+/g, '').includes(head)) return { ok: false, copy: true, error: '入力欄に入れられませんでした。' };
    return { ok: true };
  }

  // 相手の名前が一覧に無いときだけ、画面の見出しから読む（予備・2026-10 の調査で見た場所）
  function headerName() {
    const h = document.querySelector('#content-secondary .sub-header h4');
    return h ? h.textContent.trim().slice(0, 60) : '';
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
    if (msg?.type === 'ping') { reply({ ok: true, chatOpen: reader.isChatOpen() }); return; }
  });

  // 別の人の会話を開いたら、横の窓に知らせる（窓が「◯◯ さんとの会話を読みました」を読み直す）
  let lastKey = reader.isChatOpen() ? reader.chatKey() : '';
  const watchChat = () => {
    const key = reader.isChatOpen() ? reader.chatKey() : '';
    if (key === lastKey) return;
    lastKey = key;
    chrome.runtime.sendMessage({ type: 'chat-changed', chatKey: key }).catch(() => { /* 窓が閉じていれば何もしない */ });
  };

  // 読み取り方を決めてから、ボタンを出す（会話を開いているときだけ見せる）
  new MutationObserver(() => { place(); watchChat(); }).observe(document.documentElement, { childList: true, subtree: true });
  place();
})();
