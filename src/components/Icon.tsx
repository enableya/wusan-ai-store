import {
  ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpRight, BookOpen,
  Bookmark, CalendarDays, Check, ChevronRight, CircleCheck, ClipboardList,
  Columns3, CreditCard, FileQuestion, Headphones, Infinity, Info, Layers,
  ListChecks, LockKeyhole, Mail, Menu, MessageCircle, Monitor, Moon, Orbit,
  Package, PackageX, Plus, ReceiptText, RefreshCw, Search, SearchX, Send, ShieldCheck,
  Sparkles, Sun, SunMoon, Trash2, UserRound, X,
} from 'lucide-react';

const icons = {
  'arrow-left': ArrowLeft, 'arrow-left-right': ArrowLeftRight, 'arrow-right': ArrowRight,
  'arrow-up': ArrowUp, 'arrow-up-right': ArrowUpRight, 'book-open': BookOpen,
  bookmark: Bookmark, 'calendar-days': CalendarDays, check: Check, 'chevron-right': ChevronRight,
  'circle-check': CircleCheck, 'clipboard-list': ClipboardList, 'columns-3': Columns3,
  'credit-card': CreditCard, 'file-question': FileQuestion, headphones: Headphones,
  infinity: Infinity, info: Info, layers: Layers, 'list-checks': ListChecks,
  'lock-keyhole': LockKeyhole, mail: Mail, menu: Menu, 'message-circle': MessageCircle,
  monitor: Monitor, moon: Moon, orbit: Orbit, package: Package, 'package-x': PackageX,
  plus: Plus, 'receipt-text': ReceiptText, 'refresh-cw': RefreshCw, search: Search, 'search-x': SearchX,
  send: Send, 'shield-check': ShieldCheck, sparkles: Sparkles, sun: Sun, 'sun-moon': SunMoon,
  'trash-2': Trash2, 'user-round': UserRound, x: X,
};

export type IconName = keyof typeof icons;
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const Component = icons[name];
  return <Component className={className} strokeWidth={1.7} aria-hidden="true" />;
}
