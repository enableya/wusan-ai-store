import type { Order } from './orders.ts';
export type RedemptionPolicy = { terms: string; privacy: string };
export type RedemptionAccount = { email: string; plan: string; validation: string; confirmationId: string };
export type RedemptionResult = {
  orderNo: string;
  state: string;
  settlement: string;
  progress: number | null;
  renewal: string;
};
export type RedemptionView = {
  cancellation?: Order['cancellation'];
  enabled: boolean;
  submitted: boolean;
  requiresSession?: boolean;
  rechargeEmail: string | null;
  account: RedemptionAccount | null;
  result: RedemptionResult | null;
};
