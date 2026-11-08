import { useMessage } from '../app/MessageProvider';
import { useState } from 'react';
import { Check, Copy, Mail, MessageCircle, MessagesSquare } from 'lucide-react';
import { site } from '../config/site';

const contacts = [
  { id: 'wechat', label: '微信', value: site.supportWechat, Icon: MessagesSquare },
  { id: 'qq', label: 'QQ', value: site.supportQQ, Icon: MessageCircle },
  { id: 'email', label: '邮箱', value: site.supportEmail, Icon: Mail },
] as const;

export function SupportContacts() {
  const [copied, setCopied] = useState<typeof contacts[number]['label'] | null>(null);
  const $message = useMessage();

  async function copy({ label, value }: typeof contacts[number]) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      $message.success(`已复制${label}。`);
    } catch {
      setCopied(null);
      $message.error('复制失败，请长按或选中文字后手动复制。');
    }
  }

  return <>
    <ul className="support-contacts" aria-label="客服联系方式">
      {contacts.map((contact) => <li key={contact.id}>
        <span className={`support-contact-icon ${contact.id}`}><contact.Icon aria-hidden="true" /></span>
        <span className="support-contact-label">{contact.label}</span>
        {contact.id === 'email' ? <a className="support-contact-value" href={`mailto:${contact.value}`}>{contact.value}</a>
          : <span className="support-contact-value">{contact.value}</span>}
        <button className={`icon-button support-copy${copied === contact.label ? ' copied' : ''}`} type="button"
          aria-label={`复制${contact.label}`} title={copied === contact.label ? '已复制' : `复制${contact.label}`} onClick={() => void copy(contact)}>
          {copied === contact.label ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </li>)}
    </ul>
  </>;
}
