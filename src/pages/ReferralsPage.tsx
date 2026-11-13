import { useCustomer } from '../app/CustomerProvider';
import { Withdrawals } from '../components/Withdrawals';
import { ReferralReport } from '../components/ReferralReport';
import { usePageTitle } from '../hooks/usePageTitle';
export default function ReferralsPage() {
  usePageTitle('邀请返利');
  const {user, login, share} = useCustomer();
  return <div className="container page-space referrals-page"><div className="referral-heading"><div><div className="eyebrow">INVITE & EARN</div><h1>邀请返利</h1><p>分享给好友，参与活动的每笔有效付款订单可获 5 元返利。</p></div><button className="button primary" onClick={share}>分享邀请链接</button></div>
    <section className="referral-intro"><strong>{user ? `${user.username}，你的专属邀请码：${user.inviteCode}` : '登录后开启邀请返利'}</strong><p>好友首次通过有效邀请链接建立归属后，邀请关系长期有效；之后购买参与活动的商品并成功付款，返利自动记入。本人或根据浏览器标识及账号使用记录识别的同设备自邀不计返利。Codex 接码不参与返利。未付款、已关闭、超过付款时限或全额退款订单不计返利。测试记录不参与正式结算。</p><p>已获得的有效返利可申请提现至支付宝，需后台审核通过后打款。</p>{!user && <button className="button primary" onClick={login}>登录 / 注册</button>}</section>
    {user && <><Withdrawals key={`withdrawals-${user.id}`} /><ReferralReport key={user.id} /></>}
  </div>;
}
