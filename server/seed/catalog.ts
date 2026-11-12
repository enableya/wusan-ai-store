import type { Product } from '../../src/types/catalog.ts';

// Merchant-provided monthly prices in CNY cents, not OpenAI's official pricing.
export const products: Product[] = [
  {
    id: 'chatgpt-plus', name: 'ChatGPT Plus', category: 'Plus',
    mark: 'Plus', color: 'green', icon: 'sparkles', label: '日常精选',
    description: '为日常灵感，多留一点空间。',
    audience: '日常使用、学习与办公', priceCents: 13000, selectable: true,
    features: ['个人账号订阅', '按月选择，不自动扣费', '服务条件购买前确认'],
    currency: 'CNY', periodMonths: 1,
    details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
  },
  {
    id: 'chatgpt-pro-5x', name: 'ChatGPT Pro 5x', category: 'Pro',
    mark: '5×', color: 'blue', icon: 'orbit', label: '进阶探索',
    description: '让专注的时间，有更多可能。',
    audience: '高频使用与进阶探索', priceCents: 66000, selectable: true,
    features: ['个人账号订阅', '按月选择，不自动扣费', '服务条件购买前确认'],
    currency: 'CNY', periodMonths: 1,
    details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
  },
  {
    id: 'chatgpt-pro-20x', name: 'ChatGPT Pro 20x', category: 'Pro',
    mark: '20×', color: 'rose', icon: 'layers', label: '专业工作',
    description: '给更大的想法，更多余地。',
    audience: '深度使用与专业工作', priceCents: 115000, selectable: true,
    features: ['个人账号订阅', '按月选择，不自动扣费', '服务条件购买前确认'],
    currency: 'CNY', periodMonths: 1,
    details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
  },
  {
    id: 'chatgpt-pro-50x-ph', name: 'ChatGPT Pro 50x', category: 'Pro',
    mark: '50×', color: 'gray', icon: 'infinity', label: '更多可能',
    description: '面向更高强度的使用需求。',
    audience: '高强度使用与持续创作', priceCents: 335000, selectable: true,
    features: ['个人账号订阅', '按月选择，不自动扣费', '服务条件购买前确认'],
    currency: 'CNY', periodMonths: 1,
    details: { entitlements: null, deliveryMethod: null, deliveryTime: null, accountRequirements: null, afterSales: null },
  },
  {
    id: 'chatgpt-plus-account', name: 'ChatGPT Plus 成品号', category: 'Plus',
    mark: '成品号', color: 'blue', icon: 'sparkles', label: '成品号',
    description: '提供账号密码直接使用，提供登录教程，质保 30 天（订阅及封号）。',
    audience: '需要成品号的用户', priceCents: 8800, selectable: true,
    features: ['提供账号密码直接使用', '质保 30 天', '提供登录教程，保障订阅及封号'],
    currency: 'CNY', periodMonths: 1, deliveryType: 'voucher',
    details: { entitlements: '付款后提供 ChatGPT 账号密码，可直接登录使用，并提供登录教程。', deliveryMethod: '付款确认后在订单中获取卡密', deliveryTime: null, accountRequirements: '无需提交个人账号 Session', afterSales: '付款后提供 GPT 账号密码，可直接登录使用，并提供登录教程。提供 30 天订阅及封号质保。' },
  },
  {
    id: 'codex-sms', name: 'Codex 接码', category: 'Codex',
    mark: '接码', color: 'blue', icon: 'sparkles', label: '接码服务',
    description: '一次性接码服务，付款后获取卡密，按随附使用说明操作。',
    audience: '需要 Codex 一次性接码服务的用户', priceCents: 300, selectable: true,
    features: ['一次性接码', '按次购买', '使用说明随卡提供'],
    currency: 'CNY', periodMonths: 1, deliveryType: 'voucher', unitLabel: '次',
    details: { entitlements: '每条卡密用于一次性接码。付款后提供 Codex 接码卡密，具体使用方式以订单内的使用说明为准。', deliveryMethod: '付款确认后在订单中获取卡密', deliveryTime: null, accountRequirements: '无需提交个人账号 Session', afterSales: null },
  },
];

export const findProduct = (id?: string) => products.find((product) => product.id === id);
