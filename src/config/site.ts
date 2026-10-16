export const site = {
  name: import.meta.env.VITE_SITE_NAME?.trim() || '伍叁 AI',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL?.trim() || '',
  tradingEnabled: false,
  locale: 'zh-CN',
  currency: 'CNY',
  timeZone: 'Asia/Shanghai',
} as const;
