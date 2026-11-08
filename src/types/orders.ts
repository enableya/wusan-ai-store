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
  staffCheckout?: true;
  periodMonths: number;
  status: 'pending' | 'paid' | 'closed' | 'cancelled';
  cancelAction?: 'cancel' | 'request_refund' | null;
  cancellation?: { state: 'checking' | 'review' | 'refund_review' | 'refund_rejected' | 'refund_pending' | 'cancelled'; message: string; cancelledAt: string | null };
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

export const orderStatus = { pending: '待付款', paid: '已付款', closed: '已关闭', cancelled: '订单已取消' } as const;
