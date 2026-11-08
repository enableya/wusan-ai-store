import type { ReactNode } from 'react';
import './admin-table.css';

type Props = { children: ReactNode; className?: string; labelledBy?: string; emptyState?: ReactNode };

export function AdminTable({ children, className = '', labelledBy, emptyState }: Props) {
  return <div className="shared-admin-table-frame">
    <table className={`shared-admin-table ${className}`} aria-labelledby={labelledBy}>{children}</table>
    {emptyState && <div className="admin-table-empty">{emptyState}</div>}
  </div>;
}
