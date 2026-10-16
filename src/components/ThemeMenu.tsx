import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../app/ThemeProvider';
import { Icon } from './Icon';
import type { IconName } from './Icon';

const choices: { value: 'light' | 'dark' | 'system'; icon: IconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: '浅色' },
  { value: 'dark', icon: 'moon', label: '深色' },
  { value: 'system', icon: 'monitor', label: '跟随系统' },
];

export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    wrapper.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="theme-control" ref={wrapper} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus(); }
    if (open && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(wrapper.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    }
  }}>
    <button ref={trigger} className="icon-button" type="button" title="切换外观" aria-label="切换外观"
      aria-expanded={open} aria-controls="theme-menu" onClick={() => setOpen(!open)}><Icon name="sun-moon" /></button>
    <div id="theme-menu" className="theme-menu" role="menu" hidden={!open}>
      {choices.map((choice) => <button key={choice.value} type="button" role="menuitemradio" aria-checked={theme === choice.value}
        onClick={() => { setTheme(choice.value); setOpen(false); trigger.current?.focus(); }}>
        <Icon name={choice.icon} />{choice.label}<Icon name="check" className="theme-check" />
      </button>)}
    </div>
  </div>;
}
