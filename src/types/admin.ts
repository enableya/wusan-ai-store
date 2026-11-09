import type { Order } from './orders.ts';

export const adminPermissions = {
  'coupons.manage': '管理优惠券',
  'orders.view': '查看订单管理',
  'orders.refund': '审核订单退款',
  'revenue.view': '查看营业额统计',
  'withdrawals.manage': '审核提现与打款',
  'referrals.view': '查看邀请返利',
  'analytics.view': '查看商品点击分析',
  'vouchers.view': '查看卡密库存',
  'vouchers.codes': '查看和复制卡密',
  'vouchers.delete': '删除卡密',
  'vouchers.import': '导入卡密',
  'checkout.test': '使用管理员支付联调',
} as const;

export type AdminPermission = keyof typeof adminPermissions;
export function impliedAdminPermissions(permissions: readonly AdminPermission[]): AdminPermission[] {
  const implied: AdminPermission[] = [];
  if (permissions.includes('orders.refund')) implied.push('orders.view');
  if (permissions.includes('withdrawals.manage')) implied.push('referrals.view');
  if (permissions.includes('vouchers.delete')) implied.push('vouchers.codes');
  if (permissions.some(permission => permission === 'vouchers.codes' || permission === 'vouchers.delete' || permission === 'vouchers.import')) implied.push('vouchers.view');
  return implied;
}

export type VoucherCard = { id: number; code: string; priority: number; createdAt: string };
export type VoucherPage = { cards: VoucherCard[]; next: number | null };
export type AdminRole = 'super_admin' | 'admin';
export type AdminAccess = { username: string; role: AdminRole; permissions: AdminPermission[] };
export type AdminAccount = AdminAccess & { createdAt: string };
export type AdminSession = { configured: boolean; authenticated: false } | ({ configured: true; authenticated: true } & AdminAccess);

export function hasAdminPermission(account: AdminAccess | null, permission: AdminPermission | 'users.manage') {
  return !!account && (account.role === 'super_admin' || (permission !== 'users.manage' && account.permissions.includes(permission)));
}
export type ClickReport = {
  start: string; end: string; environment: 'sandbox' | 'production';
  total: number; today: number; clickedProducts: number;
  trend: { date: string; clicks: number }[];
  products: { id: string; name: string; active: boolean; clicks: number }[];
};
export const staffCheckoutUsername = 'linzhenglian';

export const orderPaymentTypes = { free: '免付开通', paid: '付费开通' } as const;
export type OrderPaymentType = keyof typeof orderPaymentTypes;
export const orderRefundReviewStatuses = { pending: '退款待审核', approved: '审核通过', rejected: '已驳回' } as const;
export type OrderRefundReview = {
  status: keyof typeof orderRefundReviewStatuses; requestedAt: string; reviewedAt: string | null; reviewedBy: string | null; reason: string;
};

export type AdminOrderList = {
  environment: 'sandbox' | 'production'; canViewVoucherCodes: boolean; canReviewRefunds: boolean; updatedAt: string;
  page: number; pageSize: number; total: number;
  counts: { pending: number; paid: number; closed: number; cancelled: number };
  products: { id: string; name: string }[];
  orders: {
    id: string; productId: string; productName: string; category: string; voucherCode: string | null; rechargeEmail: string | null;
    status: 'pending' | 'paid' | 'closed' | 'cancelled'; cancellationMessage: string; priceCents: number;
    recharge?: Order['recharge']; cancellation?: Order['cancellation'];
    createdAt: string; paidAt: string | null; expiresAt: string;
    tradeNo: string | null; staffCheckout: boolean; paymentType: OrderPaymentType; refundedCents: number;
    refundReview: OrderRefundReview | null;
  }[];
};
