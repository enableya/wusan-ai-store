import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Notice, PageHeading } from '../components/Page';
import { site } from '../config/site';
import { usePageTitle } from '../hooks/usePageTitle';

export default function SupportPage() {
  usePageTitle('联系支持');
  return <div className="container page-space">
    <PageHeading title="联系支持" eyebrow="LET'S TALK" description="订阅前的疑问，或订阅后的问题，我们都重视。" />
    <div className="support-layout"><div className="support-info"><div className="support-symbol"><Icon name="headphones" /></div><h2>先把问题说清楚</h2>
      <p>{site.supportEmail ? '可以通过下方邮箱咨询，也可以先通过帮助中心了解套餐、订单和账号安全事项。' : '客服渠道正在准备中。你可以先通过帮助中心了解套餐、订单和账号安全事项。'}</p>
      <dl className="spec-list"><div><dt>经营主体</dt><dd>{site.merchantName || '待配置'}</dd></div><div><dt>客服邮箱</dt><dd>{site.supportEmail ? <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a> : '待配置'}</dd></div><div><dt>服务时间</dt><dd>{site.supportHours || '待确认'}</dd></div><div><dt>预计响应时间</dt><dd>{site.supportResponseTime || '待确认'}</dd></div></dl>
      <p className="field-hint">支付问题请准备订单号、支付宝交易号与问题说明。请先在订单页查询结果，勿重复付款；在线退款暂未接入。</p>
      <Link className="text-button" to="/help">前往帮助中心 <Icon name="arrow-right" /></Link>
    </div>
    <form className="support-form" onSubmit={(event) => event.preventDefault()}><h2>咨询与售后</h2><Notice subtle>咨询受理暂未开放，以下内容不会提交。</Notice>
      <label htmlFor="support-type">问题类型</label><select id="support-type" defaultValue="购买咨询"><option>购买咨询</option><option>订单查询</option><option>交付问题</option><option>售后与退款</option><option>其他问题</option></select>
      <label htmlFor="support-email">联系邮箱</label><input type="email" id="support-email" placeholder="you@example.com" maxLength={254} autoComplete="email" />
      <label htmlFor="support-order">订单引用号 <span className="muted">（选填）</span></label><input id="support-order" placeholder="如有订单，请填写订单引用号" maxLength={80} />
      <label htmlFor="support-message">问题说明</label><textarea id="support-message" rows={5} maxLength={1000} placeholder="请说明你的问题，不要填写密码、验证码或 Session。" />
      <p className="field-hint">请勿提交任何敏感账号凭据。</p><button className="button primary" type="button" disabled><Icon name="send" />受理暂未开放</button>
    </form></div>
  </div>;
}
