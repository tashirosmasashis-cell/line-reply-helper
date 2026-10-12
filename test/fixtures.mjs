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

/** 管理画面の内部の口の答えの形（2026-10 の調査で見た形を写した架空の中身） */
const ms = (d, hm) => new Date(`2026-10-${d}T${hm}:00+09:00`).getTime();
export const BOT = 'U' + '1'.repeat(32);
export const CHAT = 'U' + '2'.repeat(32);
export const apiMessages = {
  list: [
    { type: 'chatRead', timestamp: ms('11', '09:00'), source: { chatId: CHAT }, read: { watermark: 1 } },
    { type: 'message', timestamp: ms('11', '09:01'), source: { chatId: CHAT, userId: CHAT }, message: { id: '101', type: 'text', text: '写真を送ります' } },
    { type: 'message', timestamp: ms('11', '09:02'), source: { chatId: CHAT, userId: CHAT }, message: { id: '102', type: 'image', contentProvider: { type: 'line' }, contentHash: 'abc+/def==', expired: false } },
    { type: 'message', timestamp: ms('11', '09:03'), source: { chatId: CHAT, userId: CHAT }, message: { id: '103', type: 'image', contentHash: 'old', expired: true } },
    { type: 'messageSent', timestamp: ms('11', '10:00'), source: { chatId: CHAT }, message: { id: '104', type: 'text', text: 'ありがとうございます！' }, sendId: 's', bizId: 'b' },
    { type: 'messageSent', timestamp: ms('11', '10:01'), source: { chatId: CHAT }, message: { id: '105', type: 'sticker', packageId: '1', stickerId: '2' }, sendId: 's', bizId: 'b' },
    { type: 'message', timestamp: ms('11', '11:00'), source: { chatId: CHAT, userId: CHAT }, message: { id: '106', type: 'location', title: '駅', address: '大阪府' } },
  ],
  backward: 'TOKEN',
};
export const apiChats = { list: [
  { chatId: CHAT, chatType: 'USER', profile: { userId: CHAT, name: '山田 花子', nickname: '' } },
  { chatId: 'C' + '3'.repeat(32), chatType: 'GROUP', profile: { name: 'おしごと仲間' } },
] };
