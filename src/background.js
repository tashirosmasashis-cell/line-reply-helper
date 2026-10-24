// 裏で動く係：横の窓を開く・新しい版の知らせ。会話の中身はここを通らない（横の窓と管理画面のあいだで直接やりとりする）。
const REPO = 'tashirosmasashis-cell/line-reply-helper';
const LINE = 'https://chat.line.biz/';

// 横の窓は LINE の管理画面のタブでだけ使える（ほかのタブには出ない・ついてこない）
// ⚠ 窓の既定は「どのタブでも有効」で、一度開くと、ほかのタブや開き直したタブにも出て残る（2026-10-25 本人「いつも勝手に開く」）。
//   そこで全体では無効にしておき、LINE の管理画面のタブだけを有効にする。窓を開くのは、アイコンか「返信を考える」ボタンを押したときだけ。
const applied = new Map();   // タブごとに、最後に決めた「有効／無効」（変わらないのに決め直して、開いている窓を読み込み直さないため）
function forTab(tabId, url) {
  const on = typeof url === 'string' && url.startsWith(LINE);   // 住所が読めないタブ（LINE 以外）は無効
  if (applied.get(tabId) === on) return;
  applied.set(tabId, on);
  chrome.sidePanel.setOptions({ tabId, path: 'src/sidepanel.html', enabled: on }).catch(() => {});
}
function setup() {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.tabs.query({}).then((tabs) => tabs.forEach((t) => forTab(t.id, t.url))).catch(() => {});
}
chrome.runtime.onInstalled.addListener(() => {
  setup();
  chrome.alarms.create('version', { periodInMinutes: 24 * 60, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(setup);
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});   // 裏の係が起き直したときも、全体は無効のまま
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.url !== undefined || info.status === 'loading') forTab(tabId, info.url ?? tab.url); });
chrome.tabs.onActivated.addListener(({ tabId }) => { chrome.tabs.get(tabId).then((t) => forTab(tabId, t.url)).catch(() => {}); });
chrome.tabs.onRemoved.addListener((tabId) => applied.delete(tabId));

// 管理画面の「返信を考える」ボタン → 横の窓を開く（押した操作の続きとして開く）
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'open-panel' && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'check-version') { checkVersion().then(reply); return true; }
});

// 新しい版の知らせ：GitHub の最新の版の番号だけを見る（会話は送らない）
async function checkVersion() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return { latest: null };
    const j = await res.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    const mine = chrome.runtime.getManifest().version;
    const newer = latest && latest.split('.').map(Number).join('.') !== mine && cmp(latest, mine) > 0;
    await chrome.storage.local.set({ versionInfo: { latest, newer, url: j.html_url, checkedAt: Date.now() } });
    return { latest, newer, url: j.html_url };
  } catch { return { latest: null }; }
}
function cmp(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'version') checkVersion(); });
