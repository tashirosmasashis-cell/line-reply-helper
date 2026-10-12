// AI の答えを読む。形が崩れていても画面が壊れないよう、読めた所だけを返す。
export function parseAnswer(raw) {
  const empty = { points: [], noReplyNeeded: { yes: false, reason: '' }, best: '', alternatives: [], ok: false };
  if (!raw || typeof raw !== 'string') return empty;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const j = JSON.parse(s);
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const out = {
      points: Array.isArray(j.points) ? j.points.map(str).filter(Boolean) : [],
      noReplyNeeded: { yes: !!(j.noReplyNeeded && j.noReplyNeeded.yes), reason: str(j.noReplyNeeded && j.noReplyNeeded.reason) },
      best: str(j.best),
      alternatives: Array.isArray(j.alternatives) ? j.alternatives.map((x) => ({ label: str(x && x.label) || '別の言い方', text: str(x && x.text) })).filter((x) => x.text) : [],
    };
    out.ok = !!(out.best || out.noReplyNeeded.yes);
    return out;
  } catch {
    // JSON で返ってこなかった＝本文をそのまま「いちばん合う返信」として見せる
    return { ...empty, best: raw.trim(), ok: true };
  }
}

/** 本文の中の ［要確認：…］ を見つける（画面で色を変える用） */
export const NEEDS_CHECK = /［要確認[:：][^］]*］/g;
