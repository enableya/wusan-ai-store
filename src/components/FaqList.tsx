import { Icon } from './Icon';
import type { Faq } from '../types/catalog';

export function FaqList({ faqs }: { faqs: Faq[] }) {
  return <div className="faq-list">{faqs.map((faq) => <details key={faq.question}>
    <summary>{faq.question}<Icon name="plus" /></summary><p>{faq.answer}</p>
  </details>)}</div>;
}
