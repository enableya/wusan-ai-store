import { useId, useState } from 'react';
import { DayPicker } from '@daypicker/react';
import { zhCN } from '@daypicker/react/locale';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays } from 'lucide-react';
import '@daypicker/react/style.css';
import './date-field.css';

type DateFieldProps = {
  label: string;
  value: string;
  today: string;
  onChange: (value: string) => void;
};

// Store calendar days as YYYY-MM-DD and give the picker a neutral time zone.
const calendarDate = (day: string) => new Date(`${day}T12:00:00Z`);

export function DateField({ label, value, today, onChange }: DateFieldProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = value ? calendarDate(value) : undefined;
  const latest = calendarDate(today);
  const displayValue = value ? value.replaceAll('-', '/') : '不限';

  return <div className="date-field">
    <label htmlFor={id}>{label}</label>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger id={id} className="date-field-trigger" aria-label={`${label}，${displayValue}`}>
        <span>{displayValue}</span><CalendarDays size={17} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="date-field-calendar" aria-label={`选择${label}`} align="start" sideOffset={8}
          onOpenAutoFocus={event => event.preventDefault()}>
          <DayPicker mode="single" required autoFocus timeZone="UTC" locale={zhCN}
            selected={selected} defaultMonth={selected} today={latest} endMonth={latest}
            disabled={{ after: latest }}
            onSelect={date => {
              onChange(date.toISOString().slice(0, 10));
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
