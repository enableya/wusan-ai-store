export const withdrawalStatuses = {
  pending: '待审核', approved: '审核通过 · 待打款', processing: '打款处理中', paid: '已到账', rejected: '已驳回', failed: '打款失败',
} as const;
export type WithdrawalStatus = keyof typeof withdrawalStatuses;
export type Withdrawal = {
  id: string; username: string; amountCents: number; account: string; realName: string;
  status: WithdrawalStatus; createdAt: string; reviewedAt: string | null; reviewedBy: string | null;
  paidAt: string | null; transferNo: string | null; note: string;
};
export type WithdrawalReport = {
  environment: 'sandbox' | 'production'; payoutEnabled: boolean; page: number; pageSize: number; total: number;
  balance: { earnedCents: number; availableCents: number; heldCents: number; paidCents: number; deficitCents: number } | null;
  rows: Withdrawal[];
};
export type PayoutRequest = { id: string; amountCents: number; account: string; realName: string };
export type PayoutResult = Record<string, string>;
export type PayoutGateway = {
  enabled: boolean;
  transfer(request: PayoutRequest): Promise<PayoutResult>;
  query(request: PayoutRequest): Promise<PayoutResult>;
};
