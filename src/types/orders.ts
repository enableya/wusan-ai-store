export type PaymentConfig = {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  message: string;
};

export type Order = {
  id: string;
  productId: string;
  productName: string;
  priceCents: number;
  periodMonths: number;
  status: 'pending' | 'paid' | 'closed';
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  tradeNo: string | null;
  environment: 'sandbox' | 'production';
  details: {
    entitlements: string | null;
    deliveryMethod: string | null;
    deliveryTime: string | null;
    accountRequirements: string | null;
    afterSales: string | null;
  };
};

export const orderStatus = { pending: '待付款', paid: '已付款', closed: '已关闭' } as const;
