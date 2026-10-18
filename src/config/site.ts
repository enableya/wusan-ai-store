export const site = {
  name: import.meta.env.VITE_SITE_NAME?.trim() || '伍叁 AI',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL?.trim() || '',
  merchantName: import.meta.env.VITE_MERCHANT_NAME?.trim() || '',
  supportHours: import.meta.env.VITE_SUPPORT_HOURS?.trim() || '',
  supportResponseTime: import.meta.env.VITE_SUPPORT_RESPONSE_TIME?.trim() || '',
  locale: 'zh-CN',
  currency: 'CNY',
  timeZone: 'Asia/Shanghai',
} as const;
