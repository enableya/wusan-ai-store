import { site } from '../config/site';

export const money = (cents: number) =>
  new Intl.NumberFormat(site.locale, { maximumFractionDigits: 2 }).format(cents / 100);

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat(site.locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: site.timeZone,
  }).format(new Date(value));

export const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
