// 鍵ありのとき、選んだ AI に頼み文を送って答えをもらう。鍵は Chrome の中（chrome.storage.local）にだけ置き、ここでは送り先の AI にだけ渡す。
// 写真：{ mime, base64 } の配列。AI ごとの形に直して付ける。

export const PROVIDERS = {
  gemini: { name: 'Gemini（Google・無料の鍵あり）', defaultModel: 'gemini-3.5-flash', host: 'https://generativelanguage.googleapis.com/*' },
  openai: { name: 'ChatGPT（OpenAI・有料）', defaultModel: 'gpt-5-mini', host: 'https://api.openai.com/*' },
  claude: { name: 'Claude（Anthropic・有料）', defaultModel: 'claude-haiku-5-5', host: 'https://api.anthropic.com/*' },
};

export class AiError extends Error {
  /** kind: 'key'（鍵が違う）| 'quota'（回数切れ）| 'busy'（混雑）| 'other' */
  constructor(kind, message) { super(message); this.kind = kind; }
}

function classify(status, body) {
  const t = String(body || '');
  if (status === 401 || status === 403 || /API key not valid|invalid.*api.?key|authentication/i.test(t)) return new AiError('key', 'AI の鍵が正しくないようです。設定で入れ直してください。');
  if (status === 429 && /PerDay|per day|quota|insufficient_quota|credit/i.test(t)) return new AiError('quota', '今日の回数（または残高）を使い切りました。明日になるか、別の AI を選んでください。');
  if (status === 429 || status === 503 || status === 529 || status === 500) return new AiError('busy', 'AI が混んでいます。少し待ってからもう一度押してください。');
  return new AiError('other', `AI から思わぬ返事がありました（${status}）：${t.slice(0, 200)}`);
}

async function post(url, headers, body, fetchImpl) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw classify(res.status, text);
  try { return JSON.parse(text); } catch { throw new AiError('other', 'AI の返事を読めませんでした。'); }
}

const senders = {
  async gemini({ key, model, prompt, images }, f) {
    const parts = [{ text: prompt }, ...images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.base64 } }))];
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key },
      { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.6 } }, f);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  },
  async openai({ key, model, prompt, images }, f) {
    const content = [{ type: 'text', text: prompt }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.base64}` } }))];
    const j = await post('https://api.openai.com/v1/chat/completions', { authorization: 'Bearer ' + key },
      { model, messages: [{ role: 'user', content }], response_format: { type: 'json_object' } }, f);
    return j.choices?.[0]?.message?.content || '';
  },
  async claude({ key, model, prompt, images }, f) {
    const content = [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } })), { type: 'text', text: prompt }];
    const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model, max_tokens: 2000, messages: [{ role: 'user', content }] }, f);
    return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  },
};

/** 混んでいたら少し待って1回だけやり直す */
export async function ask(provider, opts, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const send = senders[provider];
  if (!send) throw new AiError('other', 'AI が選ばれていません。');
  if (!opts.key) throw new AiError('key', 'AI の鍵が入っていません。設定で入れるか、「AI に貼る形でコピー」を使ってください。');
  const o = { ...opts, model: opts.model || PROVIDERS[provider].defaultModel, images: opts.images || [] };
  try { return await send(o, fetchImpl); }
  catch (e) {
    if (e instanceof AiError && e.kind === 'busy') { await wait(4000); return await send(o, fetchImpl); }
    throw e;
  }
}
