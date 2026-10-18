export type AdminSession = { configured: boolean; authenticated: boolean; username?: string };
export type ClickReport = {
  start: string; end: string; environment: 'sandbox' | 'production' | 'all';
  total: number; today: number; clickedProducts: number;
  trend: { date: string; clicks: number }[];
  products: { id: string; name: string; active: boolean; clicks: number }[];
};
