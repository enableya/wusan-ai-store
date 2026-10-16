import { Link } from 'react-router-dom';
import { Breadcrumb, Notice, PageHeading } from '../components/Page';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../hooks/usePageTitle';

const privacySections = [
  ['当前收集范围', '本站尚未接入登录、支付、邮件或交付服务。表单中的邮箱与咨询内容不会提交至服务器，也不会写入本机持久存储。'],
  ['浏览器本机存储', '外观偏好与主动保存的套餐清单使用浏览器本地存储。套餐清单仅包含商品标识、名称、保存时价格、随机清单编号和保存时间，不包含邮箱或账号凭据。可在我的订单页面删除清单。'],
  ['账号安全', '本站当前不收集账号密码、邮箱密码、多因素验证码或完整 Session。请勿在任何表单中输入上述信息。'],
  ['数据传输与第三方', '当前页面、字体与图标均使用本地资源，没有分析统计、广告追踪、第三方登录或邮件发送。后续实际接入的服务商、数据用途与保留规则需在正式隐私政策中明确。'],
  ['正式政策待确认', '本页是当前站点行为的说明，不是已经完成审核的正式隐私政策。经营主体、数据负责人、联系渠道、删除与身份验证流程尚待确认。'],
];
const termsSections = [
  ['独立服务说明', '伍叁 AI 为独立订阅服务站点，与 OpenAI 无官方隶属关系。ChatGPT 及相关品牌名称归相应权利人所有，名称仅用于识别所介绍的服务。'],
  ['当前交易状态', '当前提供实际套餐与售价展示和本机套餐清单，未开放在线交易。不会创建付费订单、收款、发送订单邮件或提供订阅交付。请勿依据本机套餐草稿进行付款。'],
  ['套餐与金额', '套餐页面展示本站实际月度售价，以人民币计价，不代表 OpenAI 官方定价或供应授权。历史套餐清单保留保存时的价格，当前售价以套餐页面为准。'],
  ['交付与售后条件', '服务供应、账号与地区条件、交付方式、交付时限、售后期限、退款政策和开票主体均待确认。支付宝是拟定支付渠道，不是交付方式。'],
  ['正式运营前的确认', '经营主体、收款主体、服务供应授权、客服渠道与正式条款仍需确定。本页为服务说明草稿，不能用于对外开展未确认的订阅销售。'],
];

export default function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const privacy = kind === 'privacy';
  const title = privacy ? '隐私说明' : '服务须知';
  usePageTitle(title);
  const sections = privacy ? privacySections : termsSections;
  return <div className="container page-space legal-page"><Breadcrumb items={[{ label: title }]} />
    <PageHeading title={title} eyebrow={privacy ? 'PRIVACY' : 'SERVICE NOTES'} description="更新于 2026 年 10 月 16 日" />
    <Notice>正式运营政策待经营主体确认，当前尚未开放交易。</Notice>
    <article className="legal-content">{sections.map(([heading, text], index) => <section key={heading}><h2>{index + 1}. {heading}</h2><p>{text}</p></section>)}
      <Link className="text-button" to="/support">相关疑问，请联系支持 <Icon name="arrow-right" /></Link>
    </article>
  </div>;
}
