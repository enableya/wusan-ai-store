import type {Product} from '../types/catalog';

export function CardProductDetails({product}: {product:Product}) {
  return <div className="item-details-content">
    <div className="item-details-intro"><span className="eyebrow">伍叁 AI · 成品号</span><h3>{product.name}</h3><p>{product.details.entitlements}</p><div className="item-detail-tags"><span>卡密交付</span><span>支付宝支付</span><span>订单查询</span></div></div>
    <section className="item-detail-section"><h3><span className="item-section-number">01</span>商品信息</h3><dl className="item-specifications"><div><dt>商品名称</dt><dd>{product.name}</dd></div><div><dt>交付方式</dt><dd>付款确认后获取一条成品号卡密</dd></div><div><dt>账号信息</dt><dd>以卡密交付内容及说明为准</dd></div><div><dt>订单查询</dt><dd>通过购买时的联系方式与查询密码找回订单</dd></div></dl></section>
    <section className="item-detail-section"><h3><span className="item-section-number">02</span>购买流程</h3><ol className="item-purchase-steps">
      <li><span>01</span><div><h4>信息确认</h4><p>核对商品，填写常用联系方式并设置订单查询密码。</p></div></li>
      <li><span>02</span><div><h4>确认付款</h4><p>核对订单金额，使用支付宝付款，等待服务端确认到账。</p></div></li>
      <li><span>03</span><div><h4>获取卡密</h4><p>付款确认后查看并复制卡密，之后可在“我的订单”再次查看。</p></div></li>
    </ol></section>
    <section className="item-detail-section"><h3><span className="item-section-number">03</span>使用与售后</h3><p>{product.details.afterSales || '请妥善保管卡密，按交付内容中的说明使用。如遇卡密交付问题，请提供订单号联系支持。'}</p></section>
  </div>;
}
