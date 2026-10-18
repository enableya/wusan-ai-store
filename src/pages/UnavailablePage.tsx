import { EmptyPage } from '../components/Page';
import { usePageTitle } from '../hooks/usePageTitle';

export default function UnavailablePage() {
  usePageTitle('页面不存在');
  return <EmptyPage title="这个页面暂时找不到" description="链接可能有误，回到套餐目录继续浏览吧。" button="返回首页" to="/" />;
}
