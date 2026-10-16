import { useEffect } from 'react';
import { site } from '../config/site';

export function usePageTitle(title: string) {
  useEffect(() => { document.title = `${title} · ${site.name}`; }, [title]);
}
