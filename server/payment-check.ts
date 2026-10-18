import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, environment, projectRoot } from './config.ts';

// Presence/permissions only: never read private key contents, sign a request or create a trade.
const env = process.env;
const checks: { name: string; passed: boolean }[] = [];
const add = (name: string, passed: boolean) => checks.push({ name, passed });
const production = env.ALIPAY_ENV === 'production';
add('payment_environment', ['sandbox', 'production'].includes(env.ALIPAY_ENV || ''));
add('enabled_flag', ['true', 'false'].includes(env.ALIPAY_ENABLED || ''));
add('database_is_separate', !!env.DATABASE_PATH && (!production || resolve(config.databasePath) !== resolve(projectRoot, 'server/data/sandbox.sqlite')));
let origin = '';
try {
  const url = new URL(env.PUBLIC_SITE_URL || '');
  origin = url.origin;
  add('site_origin', (url.protocol === 'https:' || (!production && url.protocol === 'http:')) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash);
  if (production) add('public_hostname', !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
} catch { add('site_origin', false); }
function privateFile(name: string, path?: string) {
  try {
    if (!path) throw new Error();
    const info = statSync(path);
    accessSync(path, constants.R_OK);
    add(name, info.isFile() && info.size > 0 && (info.mode & 0o007) === 0 && (info.mode & 0o022) === 0);
  } catch { add(name, false); }
}
if (production) {
  add('formal_app_id', /^\d{16}$/.test(env.ALIPAY_APP_ID || ''));
  add('formal_seller_id', /^2088\d{12}$/.test(env.ALIPAY_SELLER_ID || ''));
  try {
    const url = new URL(env.ALIPAY_NOTIFY_URL || '');
    add('notify_endpoint', url.origin === origin && url.protocol === 'https:' && url.pathname === '/api/payments/alipay/notify' && !url.search && !url.hash && !url.username && !url.password);
  } catch { add('notify_endpoint', false); }
  privateFile('private_key_file', env.ALIPAY_PRIVATE_KEY_PATH);
  privateFile('alipay_public_key_file', env.ALIPAY_PUBLIC_KEY_PATH);
} else {
  privateFile('sandbox_config_file', resolve(projectRoot, '.alipay-sandbox.json'));
}
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({
  environment: environment.profile,
  paymentsEnabled: env.ALIPAY_ENABLED === 'true',
  configurationChecksPassed: passed,
  checks,
  externalVerification: production
    ? ['正式应用上线及产品权限', '同一应用的密钥匹配与签名', '公网 HTTPS 和适用上线要求', '真实付款、通知验签、重复通知与查询补偿']
    : ['沙箱配置由官方工具校验', '用户在沙箱收银台完成付款并查询结果'],
  note: '仅检查配置及文件权限；未读取密钥内容、联网验证或发起交易，不代表正式收款已就绪。',
}, null, 2));
if (!passed) process.exitCode = 1;
