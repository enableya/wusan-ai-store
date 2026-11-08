import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import './message.css';

const icons = { success: CircleCheck, error: CircleAlert, info: Info, warning: TriangleAlert };
type MessageType = keyof typeof icons;
type Message = { id: number; type: MessageType; text: string };
type MessageApi = Record<MessageType, (text: string) => void>;
const MessageContext = createContext<MessageApi | null>(null);

function MessageView({ message }: { message: Message }) {
  const [host, setHost] = useState<HTMLElement>(document.body);

  useLayoutEffect(() => {
    // Native modal dialogs sit above the rest of the document regardless of z-index.
    const updateHost = () => {
      const focusedModal = document.activeElement?.closest<HTMLDialogElement>('dialog:modal');
      setHost(focusedModal ?? Array.from(document.querySelectorAll<HTMLDialogElement>('dialog:modal')).at(-1) ?? document.body);
    };
    updateHost();
    const observer = new MutationObserver(updateHost);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('focusin', updateHost);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', updateHost);
    };
  }, []);

  const Icon = icons[message.type];
  return createPortal(<div className="message-position">
    <div key={message.id} className={`app-message app-message--${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <span>{message.text}</span>
    </div>
  </div>, host);
}

export function MessageProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message | null>(null);
  const nextId = useRef(0);
  const $message = useMemo<MessageApi>(() => {
    const show = (type: MessageType, text: string) => {
      const id = ++nextId.current;
      setMessage(current => current?.type === type && current.text === text ? current : { id, type, text });
    };
    return {
      success: text => show('success', text),
      error: text => show('error', text),
      info: text => show('info', text),
      warning: text => show('warning', text),
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    let handling = false;
    function invalid(event: Event) {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
      event.preventDefault();
      if (handling) return;
      handling = true;
      queueMicrotask(() => { handling = false; });
      const label = field.labels?.[0]?.textContent?.trim().replace(/\s*\*$/, '');
      const { valueMissing, tooShort, patternMismatch } = field.validity;
      const text = valueMissing && label ? `请填写${label}。`
        : tooShort && label && 'minLength' in field ? `${label}至少需要 ${field.minLength} 位。`
          : patternMismatch && 'placeholder' in field && field.placeholder ? `请按要求填写${label ?? '此项'}（${field.placeholder}）。`
            : label ? `请检查${label}的格式。` : '请检查表单中的必填项和输入格式。';
      field.focus();
      $message.warning(text);
    }
    document.addEventListener('invalid', invalid, true);
    return () => document.removeEventListener('invalid', invalid, true);
  }, [$message]);

  return <MessageContext.Provider value={$message}>
    {children}
    {message && <MessageView message={message} />}
  </MessageContext.Provider>;
}

export function useMessage() {
  const context = useContext(MessageContext);
  if (!context) throw new Error('MessageProvider is required.');
  return context;
}
