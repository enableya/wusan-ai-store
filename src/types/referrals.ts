export type ReferralReason = 'earned' | 'awaiting_payment' | 'same_device' | 'self_invite' | 'product_excluded'
  | 'invitation_expired' | 'payment_expired' | 'order_closed' | 'full_refund' | 'ineligible';
export type ReferralReportData = {
  total: number; earnedCents: number; page: number; pageSize: number;
  rows: {
    orderId: string; displayOrderId: string; inviter: string; inviteCode: string; productName: string;
    orderCents: number; amountCents: number; expectedAmountCents: number;
    status: 'pending' | 'earned' | 'cancelled'; createdAt: string; earnedAt: string | null;
    reasonCode: ReferralReason; reasonMessage: string; reasonUpdatedAt: string;
    ineligibleReason: string | null;
  }[];
};
