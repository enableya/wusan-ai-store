import { EmptyPage } from '../components/Page';
import { usePageTitle } from '../hooks/usePageTitle';

export default function UnavailablePage({ kind }: { kind: 'payment' | 'not-found' }) {
  usePageTitle(kind === 'payment' ? '支付暂未开放' : '页面不存在');
  return kind === 'payment'
    ? <EmptyPage title="支付暂未开放" description="当前不会生成收款二维码或付款链接，也不会将任何记录标记为已支付。" button="返回我的订单" to="/orders" icon="lock-keyhole" />
    : <EmptyPage title="这个页面暂时找不到" description="链接可能有误，回到套餐目录继续浏览吧。" button="返回首页" to="/" />;
}
