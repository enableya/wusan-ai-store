import type { ReactNode } from 'react';
import { useUI } from '../app/UIProvider';

export function SupportButton({ children = '联系支持', className, label, onClick }: {
  children?: ReactNode; className?: string; label?: string; onClick?: () => void;
}) {
  const { openModal } = useUI();
  return <button className={className ? `support-trigger ${className}` : 'support-trigger'} type="button"
    aria-label={label} aria-haspopup="dialog" onClick={() => { onClick?.(); openModal({ type: 'support' }); }}>{children}</button>;
}
