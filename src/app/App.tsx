import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import SiteLayout from '../layouts/SiteLayout';

const HomePage = lazy(() => import('../pages/HomePage'));
const ProductPage = lazy(() => import('../pages/ProductPage'));
const CheckoutPage = lazy(() => import('../pages/CheckoutPage'));
const OrdersPage = lazy(() => import('../pages/OrdersPage'));
const OrderDetailPage = lazy(() => import('../pages/OrderDetailPage'));
const PaymentPage = lazy(() => import('../pages/PaymentPage'));
const HelpPage = lazy(() => import('../pages/HelpPage'));
const HelpArticlePage = lazy(() => import('../pages/HelpArticlePage'));
const SupportPage = lazy(() => import('../pages/SupportPage'));
const LegalPage = lazy(() => import('../pages/LegalPage'));
const UnavailablePage = lazy(() => import('../pages/UnavailablePage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));

export default function App() {
  return <ErrorBoundary><Suspense fallback={<div className="container page-space loading-page" role="status">正在加载…</div>}>
    <Routes><Route path="admin" element={<AdminPage />} /><Route element={<SiteLayout />}>
      <Route index element={<HomePage />} />
      <Route path="products/:productId" element={<ProductPage />} />
      <Route path="checkout/:productId" element={<CheckoutPage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="orders/:orderRef" element={<OrderDetailPage />} />
      <Route path="help" element={<HelpPage />} />
      <Route path="help/:articleId" element={<HelpArticlePage />} />
      <Route path="support" element={<SupportPage />} />
      <Route path="terms" element={<LegalPage kind="terms" />} />
      <Route path="privacy" element={<LegalPage kind="privacy" />} />
      <Route path="pay" element={<PaymentPage />} />
      <Route path="pay/:orderRef" element={<PaymentPage />} />
      <Route path="*" element={<UnavailablePage />} />
    </Route></Routes>
  </Suspense></ErrorBoundary>;
}
