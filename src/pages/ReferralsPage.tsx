import { useCustomer } from '../app/CustomerProvider';
import { Withdrawals } from '../components/Withdrawals';
import { ReferralReport } from '../components/ReferralReport';
import { usePageTitle } from '../hooks/usePageTitle';
export default function ReferralsPage() {
  usePageTitle('邀请返利');
  const {user, login, share} = useCustomer();
  return <div className="container page-space referrals-page"><div className="referral-heading"><div><div className="eyebrow">INVITE & EARN</div><h1>邀请返利</h1><p>分享给好友，每笔有效付款订单可获 5 元返利。</p></div><button className="button primary" onClick={share}>分享邀请链接</button></div>
    <section className="referral-intro"><strong>{user ? `${user.username}，你的专属邀请码：${user.inviteCode}` : '登录后开启邀请返利'}</strong><p>好友首次打开邀请链接后，归属保留 30 天；在此期间下单并成功付款，返利自动记入。本人及同一已登录浏览器的订单不计返利。未付款、已关闭、已过期或全额退款订单不计返利。测试记录不参与正式结算。</p><p>已获得的有效返利可申请提现至支付宝，需后台审核通过后打款。</p>{!user && <button className="button primary" onClick={login}>登录 / 注册</button>}</section>
    {user && <><Withdrawals key={`withdrawals-${user.id}`} /><ReferralReport key={user.id} /></>}
  </div>;
}
