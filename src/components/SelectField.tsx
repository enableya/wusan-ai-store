import { useCallback, useId, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import './select-field.css';

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
};

export function SelectField({ label, value, options, onValueChange }: SelectFieldProps) {
  const id = useId();
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const triggerRef = useCallback((node: HTMLButtonElement | null) => { if (node) setContainer(node.closest('dialog') ?? undefined); }, []);

  return <div className="select-field">
    <label htmlFor={id}>{label}</label>
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger ref={triggerRef} id={id} className="select-field-trigger">
        <Select.Value />
        <Select.Icon asChild><ChevronDown aria-hidden="true" size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Content className="select-field-menu" position="popper" sideOffset={6} align="start">
          <Select.Viewport className="select-field-options">
            {options.map(option => <Select.Item key={option.value} value={option.value} className="select-field-option">
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="select-field-check"><Check aria-hidden="true" size={16} /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  </div>;
}
