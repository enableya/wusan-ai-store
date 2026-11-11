import type { RedemptionEvent, RedemptionResult } from '../types/redemption';
import { redemptionProgress } from '../lib/redemption-progress';

export function RedemptionHistory({result}: {result:RedemptionResult|null}) {
  const progress = redemptionProgress(result);
  const events: RedemptionEvent[] = result?.timeline?.length ? result.timeline : [{title:progress.title,detail:progress.detail,at:null,source:'query'}];
  const earlier = events.slice(0,-6), recent = events.slice(-6);
  const list = (items: RedemptionEvent[]) => <ol className="redemption-history-list">{items.map((event,index)=><li key={`${event.at}-${event.title}-${index}`}>
    <strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}
    <small>{event.source === 'provider' ? '通道记录' : event.at ? '状态查询' : '当前状态'}{event.at && <> · <time dateTime={event.at} title={event.at}>{new Date(event.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</time></>}</small>
  </li>)}</ol>;
  return <section className="redemption-history" aria-label="充值处理记录"><h4>处理记录</h4>
    {earlier.length>0 && <details><summary>查看更早 {earlier.length} 条记录</summary>{list(earlier)}</details>}
    {list(recent)}
  </section>;
}
