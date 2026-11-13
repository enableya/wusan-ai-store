export type PaymentConfig = {
  globallyPaused?: boolean;
  gatewayEnabled?: boolean;
  blockedProductIds?: string[];
  enabled: boolean;
  environment: 'sandbox' | 'production';
  message: string;
};

export type Order = {
  id: string;
  productId: string;
  productName: string;
  priceCents: number;
  originalPriceCents?: number;
  staffCheckout?: true;
  periodMonths: number;
  deliveryType?: 'voucher';
  unitLabel?: '次';
  cardDelivery?: { delivered: boolean };
  status: 'pending' | 'paid' | 'closed' | 'cancelled';
  fulfillment?: { status: 'succeeded'; rechargeEmail: string | null };
  recharge?: { submitted: boolean; state: string; settlement: string; renewal: string; reason?: string };
  cancelAction?: 'cancel' | 'request_refund' | null;
  cancelUnavailableReason?: string;
  cancellation?: { state: 'checking' | 'review' | 'refund_review' | 'refund_rejected' | 'refund_pending' | 'cancelled'; message: string; cancelledAt: string | null; voucherReclaimed?: true };
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
export const orderStatusLabel = (order: Pick<Order, 'status' | 'staffCheckout' | 'cancellation'>) =>
  order.cancellation?.voucherReclaimed ? '卡密已回收' : order.staffCheckout && order.status === 'paid' ? '免付开通' : orderStatus[order.status];
