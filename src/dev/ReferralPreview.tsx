// A Vite development-only entry; never imported by the production application.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageProvider } from '../app/MessageProvider';
import { ThemeProvider } from '../app/ThemeProvider';
import { ReferralReport } from '../components/ReferralReport';
import '../styles.css';

function Preview(){
  const [admin,setAdmin]=useState(false);
  return <main className="container page-space">
    <div className="eyebrow">LOCAL MOCK</div><h1>邀请返利原因预览</h1>
    <p className="referral-report-note">10 条内存模拟记录，使用实际返利判断和展示逻辑。包含正常入账、待付款、支付过期、关单、全额退款、同设备自邀、本人邀请、Codex 接码、超过 30 天仍正常入账和付款后识别同设备。</p>
    <p className="referral-report-note">刷新和筛选可直接验证，支付与提现均不可操作。测试数据不会写入商城数据库。</p>
    <div className="referral-mock-actions" role="group" aria-label="预览视角">
      <button className={`button ${admin?'secondary':'primary'}`} aria-pressed={!admin} onClick={()=>setAdmin(false)}>商城用户视角</button>
      <button className={`button ${admin?'primary':'secondary'}`} aria-pressed={admin} onClick={()=>setAdmin(true)}>管理员视角</button>
    </div>
    <ReferralReport key={String(admin)} admin={admin} endpoint={`/__dev/referrals${admin?'?view=admin':''}`} />
  </main>;
}
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider><MessageProvider><Preview /></MessageProvider></ThemeProvider></StrictMode>);
