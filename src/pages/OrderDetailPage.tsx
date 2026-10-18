import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Breadcrumb, EmptyPage, Notice, PageHeading } from '../components/Page';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSelections } from '../hooks/useSelections';
import { formatDate, money } from '../lib/format';
import { useApiResource } from '../hooks/useApiResource';
import type { Product } from '../types/catalog';
import PaymentPage from './PaymentPage';

export default function OrderDetailPage() {
  const { orderRef } = useParams();
  const selection = useSelections().find((item) => item.id === orderRef);
  return selection ? <DraftDetail /> : <PaymentPage />;
}

function DraftDetail() {
  const { orderRef } = useParams();
  const selection = useSelections().find((item) => item.id === orderRef);
  const catalog = useApiResource<Product>(selection ? `/products/${encodeURIComponent(selection.productId)}` : null);
  usePageTitle('套餐清单');
  if (!selection) return <EmptyPage title="无法查看这个订单" description="当前没有可访问的记录。真实订单需验证身份后访问，本机清单也可能已被删除。" button="返回我的订单" to="/orders" icon="lock-keyhole" />;
  const product = catalog.data;
  const priceChanged = product?.priceCents != null && product.priceCents !== selection.priceCents;
  return <div className="container page-space">
    <Breadcrumb items={[{ label: '我的订单', to: '/orders' }, { label: '套餐草稿' }]} />
    <PageHeading title="套餐草稿详情" eyebrow="LOCAL SELECTION" description="仅保存在此浏览器，未创建真实订单。" />
    <Notice>此记录是套餐清单，不是付款凭证。联系邮箱未保存。</Notice>
    {catalog.error && <Notice>{catalog.error.status === 404 ? '该套餐已下架或不存在，以下保留保存时的信息。' : '最新售价暂时无法获取，以下为保存时价格。'}
      {catalog.error.status !== 404 && <button className="text-button" type="button" onClick={catalog.reload}>重试</button>}</Notice>}
    {priceChanged && <Notice>该清单保存后套餐价格已更新，当前本站售价为 ¥{money(product.priceCents!)} / 月。<Link to={`/products/${product.id}`}>查看当前套餐</Link></Notice>}
    <div className="detail-layout"><section className="order-detail-main">
      <div className="section-heading"><h2>订阅信息</h2><span className="status-badge pending">套餐草稿</span></div>
      <dl className="spec-list"><div><dt>商品</dt><dd>{selection.productName}</dd></div><div><dt>周期 / 数量</dt><dd>1 个月 / 1 份</dd></div>
        <div><dt>本机清单编号</dt><dd className="mono">{selection.id.slice(0, 16)}</dd></div>
        <div><dt>保存时间</dt><dd>{formatDate(selection.createdAt)}</dd></div><div><dt>保存时价格</dt><dd>¥{money(selection.priceCents)}</dd></div><div><dt>付款状态</dt><dd>未付款</dd></div><div><dt>交付状态</dt><dd>未开始</dd></div>
      </dl>
      <h2 className="subsection-title">订阅进度</h2><ol className="timeline">
        <li className="current"><span /><div><h3>套餐清单已保存</h3><p>仅本机草稿，不会发送邮件或创建交付任务。</p></div></li>
        <li><span /><div><h3>付款确认</h3><p>草稿不可直接付款，请按最新价格重新创建订单。</p></div></li><li><span /><div><h3>服务交付</h3><p>交付方案及处理时限待确认。</p></div></li><li><span /><div><h3>完成订阅</h3><p>未开始。</p></div></li>
      </ol>
    </section><aside className="purchase-panel"><h2>清单操作</h2><p className="body-copy">此清单不是订单。下单前需重新核对当前价格与服务条件，请勿提交账号密码或完整登录凭据。</p>
      {product?.selectable && <Link className="button primary full-width" to={`/checkout/${selection.productId}`}>按当前价格下单</Link>}
      <Link className="button secondary full-width spaced-button" to="/support"><Icon name="headphones" />联系支持</Link>
      <Link className="text-button spaced-button" to="/orders"><Icon name="arrow-left" />返回我的订单</Link>
    </aside></div>
  </div>;
}
