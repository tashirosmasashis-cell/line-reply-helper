// 自己試験の見本。名前も中身も架空（本物の会話は入れない）。
const t = (d, hm) => new Date(`2026-10-${d}T${hm}:00+09:00`).toISOString();
export const shop = { them: '山田 花子', us: 'はなまる教室' };

/** 相手が続けて送ってきた（写真・スタンプ入り・日付をまたぐ） */
export const piled = [
  { id: '1', at: t('10', '10:00'), side: 'them', author: '山田 花子', kind: 'text', text: '体験レッスンに申し込みたいです' },
  { id: '2', at: t('10', '10:05'), side: 'us', author: '佐藤', kind: 'text', text: 'ありがとうございます！土曜の10時はいかがでしょうか😊' },
  { id: '3', at: t('10', '10:30'), side: 'them', author: '山田 花子', kind: 'text', text: '土曜10時でお願いします' },
  { id: '4', at: t('10', '10:31'), side: 'them', author: '山田 花子', kind: 'text', text: '持ち物はありますか？' },
  { id: '5', at: t('10', '23:50'), side: 'them', author: '山田 花子', kind: 'sticker', text: '' },
  { id: '6', at: t('11', '08:10'), side: 'them', author: '山田 花子', kind: 'text', text: '駐車場はありますか' },
  { id: '7', at: t('11', '08:11'), side: 'them', author: '山田 花子', kind: 'image', text: '', imageUrl: 'https://example.test/a.jpg' },
  { id: '8', at: t('11', '08:12'), side: 'them', author: '山田 花子', kind: 'text', text: 'この服装で大丈夫でしょうか' },
  { id: '9', at: t('11', '09:00'), side: 'them', author: '山田 花子', kind: 'text', text: '子どもも一緒に行っていいですか' },
  { id: '10', at: t('11', '09:01'), side: 'them', author: '山田 花子', kind: 'text', text: '料金は当日払いですか' },
  { id: '11', at: t('11', '09:02'), side: 'them', author: '山田 花子', kind: 'text', text: 'よろしくお願いします' },
  { id: '12', at: t('11', '09:03'), side: 'them', author: '山田 花子', kind: 'text', text: '   ' },
];

/** こちらが最後に送った状態（別の担当者の返信もこちら側） */
export const weLast = [
  { id: 'a', at: t('12', '09:00'), side: 'them', author: '山田 花子', kind: 'text', text: '明日はよろしくお願いします' },
  { id: 'b', at: t('12', '09:10'), side: 'us', author: '鈴木', kind: 'text', text: 'こちらこそ！お待ちしています' },
];
