import { useEffect, useState } from 'react';
import { readSelections, SELECTION_EVENT, SELECTION_KEY } from '../services/selections';

export function useSelections() {
  const [selections, setSelections] = useState(readSelections);
  useEffect(() => {
    const refresh = () => setSelections(readSelections());
    const onStorage = (event: StorageEvent) => {
      if (event.key === SELECTION_KEY || event.key === null) refresh();
    };
    window.addEventListener(SELECTION_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SELECTION_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return selections;
}
