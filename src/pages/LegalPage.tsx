import { Link } from 'react-router-dom';
import { Breadcrumb, Notice, PageHeading } from '../components/Page';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApiResource } from '../hooks/useApiResource';
import type { PaymentConfig } from '../types/orders';

const privacySections = [
  ['订单数据', '创建订单时，服务器保存联系邮箱、商品与价格快照、条款确认对应的提交记录、订单号、创建时间和付款状态；支付确认后保存支付宝交易号与到账确认时间。邮箱用于订单联系，邮件通知与邮箱找回尚未开通。'],
  ['浏览器与 Cookie', '订单通过当前浏览器的随机访问凭证识别。该凭证保存在 HttpOnly、SameSite Cookie 中，HTTPS 部署时启用 Secure；服务器仅保存其摘要。请勿与他人共享浏览器或清除 Cookie，订单号本身不能查询私有订单。外观偏好与套餐草稿保存在本机，草稿不包含邮箱。'],
  ['支付宝支付', '付款在支付宝官方收银台完成，本站向支付宝发送订单号、商品名称、金额及回调地址，不发送联系邮箱。本站不接触支付密码、银行卡资料或支付宝登录凭据。支付宝按其政策处理支付信息；本站对支付通知验签并核实订单与金额。'],
  ['商品访问统计', '成功打开商品详情时，本站记录商品编号、名称、访问时间、运行环境和随机访客标识的摘要，用于后台汇总商品点击量。同一浏览器对同一商品 30 分钟内重复打开不重复计数，管理员浏览不计入。随机访客 Cookie 为 HttpOnly、有效期 30 天；单次统计编号保存在会话存储中。该统计不记录 IP 地址、邮箱或支付资料，不使用第三方统计服务。'],
  ['账号与咨询信息', '本站不收集用户的第三方账号密码、邮箱密码、多因素验证码或完整 Session。管理后台使用独立账号，服务器保存密码哈希和登录会话摘要。客服咨询表单仍未接入提交服务，不会持久保存输入的咨询内容。当前没有广告追踪或第三方登录。'],
  ['数据管理与联系', '订单与支付记录保存在经营方服务器，用于交易核对和售后处理。数据保存期限、删除申请与经营主体联系渠道需由经营方在正式运营前补充并公布。删除浏览器草稿不会删除服务器订单或发起退款。'],
];
const termsSections = [
  ['独立服务说明', '伍叁 AI 为独立订阅服务站点，与 OpenAI 无官方隶属关系。ChatGPT 及相关品牌名称归相应权利人所有，名称仅用于识别所介绍的服务。'],
  ['订单与支付', '支付宝配置完成且下单页显示可用后，可创建服务器订单并前往支付宝付款。待配置时不创建可支付订单。本机套餐草稿不是订单或付款凭证。沙箱订单仅用于测试，不产生真实扣款或服务交付。'],
  ['套餐、金额与付款期限', '以服务器创建订单时保存的商品、周期及人民币金额为准，商品展示不代表 OpenAI 官方定价或供应授权。订单付款期限为 30 分钟，不自动续费。过期或状态不明确时应先查询支付结果，避免重复付款。'],
  ['付款结果', '本站根据支付宝验签通知或服务端交易查询确认付款。浏览器返回、截图、前端提示均不单独作为到账依据。支付结果可能延迟，请在订单页查询；已付款不等于订阅已交付。'],
  ['交付、售后与退款', '账号与地区条件、服务供应、交付方式和时限、售后及退款条件，以经营方公布并在购买前确认的方案为准。未确认内容会明确标注。本站尚未接入自动订阅交付或在线退款，相关事宜需联系经营方处理；支付宝仅为支付渠道。'],
  ['订单访问与正式运营', '订单暂由下单浏览器的访问凭证保护，跨设备邮箱找回与订单邮件尚未开放。正式收款前经营方需补充主体、客服及服务条款信息，确认支付签约与服务供应条件。'],
];

export default function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const privacy = kind === 'privacy';
  const title = privacy ? '隐私说明' : '服务须知';
  usePageTitle(title);
  const payment = useApiResource<PaymentConfig>('/payments/config');
  const sections = privacy ? privacySections : termsSections;
  return <div className="container page-space legal-page"><Breadcrumb items={[{ label: title }]} />
    <PageHeading title={title} eyebrow={privacy ? 'PRIVACY' : 'SERVICE NOTES'} description="更新于 2026 年 10 月 18 日" />
    <Notice>{payment.data?.message || '支付状态请以下单页为准。'} 正式运营政策与经营主体信息待补充。</Notice>
    <article className="legal-content">{sections.map(([heading, text], index) => <section key={heading}><h2>{index + 1}. {heading}</h2><p>{text}</p></section>)}
      <Link className="text-button" to="/support">相关疑问，请联系支持 <Icon name="arrow-right" /></Link>
    </article>
  </div>;
}
