export type Product = {
  id: string;
  name: string;
  category: 'Plus' | 'Pro';
  mark: string;
  color: 'green' | 'blue' | 'rose' | 'gray';
  icon: 'sparkles' | 'orbit' | 'layers' | 'infinity';
  label: string;
  description: string;
  audience: string;
  priceCents: number | null;
  selectable: boolean;
  features: string[];
  currency: 'CNY';
  periodMonths: number;
  details: {
    entitlements: string | null;
    deliveryMethod: string | null;
    deliveryTime: string | null;
    accountRequirements: string | null;
    afterSales: string | null;
  };
};

export type Faq = { question: string; answer: string };
export type HomeContent = {
  hero: { title: string; lead: string; leadAccent: string; description: string[] };
  services: { icon: 'shield-check' | 'list-checks' | 'message-circle'; title: string; description: string }[];
  steps: { title: string; description: string }[];
};
export type HomeData = HomeContent & { products: Product[]; faqs: Faq[] };

export type Article = {
  id: string;
  category: string;
  icon: 'book-open' | 'receipt-text' | 'shield-check' | 'headphones';
  title: string;
  summary: string;
  sections: { title: string; text: string }[];
};

export type Selection = {
  id: string;
  productId: string;
  productName: string;
  priceCents: number;
  createdAt: string;
};
