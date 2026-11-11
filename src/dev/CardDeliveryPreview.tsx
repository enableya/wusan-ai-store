// This entry is served only by scripts/dev-orders-mock.mjs, never by main.tsx.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MessageProvider } from '../app/MessageProvider';
import { UIProvider } from '../app/UIProvider';
import { ThemeProvider } from '../app/ThemeProvider';
import { PurchaseDialog } from '../components/ProductPurchase';
import { useApiResource } from '../hooks/useApiResource';
import { ApiState } from '../components/ApiState';
import type { Order } from '../types/orders';
import type { Product } from '../types/catalog';
import '../styles.css';
import '../pages/product-detail.css';

function Preview() {
  const product = useApiResource<Product>('/products/chatgpt-plus-account');
  const order = useApiResource<Order>('/orders/WS12345678901230000000000000088');
  const [open, setOpen] = useState(true);
  if (!product.data || !order.data) return <ApiState error={product.error || order.error} retry={() => {product.reload();order.reload();}} title="正在加载卡密交付预览" />;
  return <main className="container page-space">
    <h1>获取卡密 · 本地 Mock 预览</h1>
    <p>模拟已支付 ¥88 的订单，卡密为无效测试数据，不会发起支付或充值。</p>
    <button className="button primary" onClick={() => setOpen(true)}>查看获取卡密步骤</button>
    <PurchaseDialog product={product.data} order={order.data} open={open} onClose={() => setOpen(false)} onOrder={order.reload} />
  </main>;
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><ThemeProvider><MessageProvider><UIProvider><Preview /></UIProvider></MessageProvider></ThemeProvider></BrowserRouter></StrictMode>,
);
