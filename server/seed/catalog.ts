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
];

export const findProduct = (id?: string) => products.find((product) => product.id === id);
