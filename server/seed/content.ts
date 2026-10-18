import type { Article, HomeContent } from '../../src/types/catalog.ts';

export const home: HomeContent = {
  hero: {
    title: 'ChatGPT 订阅服务',
    lead: '给每一个好想法，',
    leadAccent: '多一点可能。',
    description: ['从日常学习，到专注创作。', '找到适合你的 Plus / Pro 月度方案。'],
  },
  services: [
    { icon: 'shield-check', title: '账号安全，放在第一位', description: '不收集密码或完整登录凭据' },
    { icon: 'list-checks', title: '服务条件，清楚说明', description: '购买前了解价格、周期与售后范围' },
    { icon: 'message-circle', title: '有疑问，先了解再选择', description: '从购买指南到订单查询，随时查阅' },
  ],
  steps: [
    { title: '选择订阅套餐', description: '按使用需求浏览，核对周期与服务条件。' },
    { title: '确认下单信息', description: '核对套餐与联系邮箱，阅读服务须知。' },
    { title: '支付宝付款与查询', description: '前往支付宝付款，在订单中核实支付结果。' },
  ],
};

export const faqs = [
  {
    question: '这是 ChatGPT 官方网站吗？',
    answer: '不是。伍叁 AI 是独立的订阅服务站点，与 OpenAI 无官方隶属关系。ChatGPT 名称仅用于识别所介绍的服务。',
  },
  {
    question: '现在可以购买套餐吗？',
    answer: '本站支持支付宝网站支付。收银台显示可用后，可确认邮箱、创建订单并前往支付宝付款；显示“待配置”时暂不能付款。支付完成不代表订阅已交付，具体交付条件请在购买前确认。',
  },
  {
    question: '需要提供账号密码或 Session 吗？',
    answer: '不需要。当前页面不会收集账号密码、Session、邮箱密码或验证码。正式交付方案尚未确认，请不要通过任何表单提交敏感账号资料。',
  },
  {
    question: '订阅会自动续费吗？',
    answer: '本站当前不支持自动续费或自动扣款。正式订阅周期与后续续费规则将以购买前展示的服务条件为准。',
  },
];

export const articles: Article[] = [
  {
    id: 'getting-started', category: '购买指南', icon: 'book-open',
    title: '第一次订阅，从这里开始', summary: '了解套餐选择、信息核对与订阅流程。',
    sections: [
      { title: '选择适合的套餐', text: '在套餐目录中按 Plus 或 Pro 筛选，进入详情查看周期、本站实际售价和服务条件。所有金额均以人民币按月计价，订单金额由服务器核对并保存。' },
      { title: '核对订阅条件', text: '购买前应确认价格、账号或地区要求、服务供应、交付方式及售后范围。目前未确认的条件会明确显示为待确认。' },
      { title: '确认联系信息', text: '下单时的联系邮箱会保存至服务器，用于订单联系，不代表需要订阅的账号。邮件通知与邮箱验证码找回尚未接入，请保留原浏览器的订单访问凭证。' },
      { title: '付款与交付', text: '付款通过支付宝官方收银台完成，不自动续费。返回网站后可查询支付结果，以服务端验签通知或主动查询结果为准，页面跳转与付款截图不能作为到账依据。订阅交付与退款需由经营方另行处理。' },
    ],
  },
  {
    id: 'find-orders', category: '订单查询', icon: 'receipt-text',
    title: '查询订单与跨设备找回', summary: '区分本机套餐清单与经过验证的真实订单。',
    sections: [
      { title: '本机套餐清单', text: '保存的套餐草稿仅保留商品、保存时的本站售价和保存时间，存在当前浏览器中。历史价格不会随目录修改而改变。这些清单不是订单，也不表示已经付款。' },
      { title: '真实订单查询', text: '我的订单展示当前浏览器有权访问的服务器订单，可查看金额、付款状态并继续付款。订单号本身不能访问私有订单；清除 Cookie 或更换设备后，原浏览器访问凭证将不可用。' },
      { title: '通过邮箱找回', text: '邮件服务上线后，需要通过联系邮箱接收验证码或一次性链接，验证成功后才能访问所属订单。当前不会发送验证码。' },
    ],
  },
  {
    id: 'account-safety', category: '账号安全', icon: 'shield-check',
    title: '保护你的账号与个人信息', summary: '不分享密码、验证码或完整登录凭据。',
    sections: [
      { title: '不要提交敏感信息', text: '请勿在咨询或售后说明中填写账号密码、邮箱密码、多因素验证码或完整 Session。本站当前不需要任何账号授权。' },
      { title: '确认服务主体', text: '伍叁 AI 不是 OpenAI 官方站点。正式购买前请确认经营主体、服务条件与实际收款方；当前经营主体信息尚待配置。' },
      { title: '交付方案待确认', text: '正式交付将以确认可执行且满足授权要求的方案为准。当前不提供收集高敏感账号凭据的操作教程。' },
    ],
  },
  {
    id: 'after-sales', category: '售后服务', icon: 'headphones',
    title: '售后咨询与服务范围', summary: '了解联系客服前应准备哪些非敏感信息。',
    sections: [
      { title: '售后条件', text: '交付时间、售后期限、退款政策及客服响应时间均待经营主体确认。目前不承诺具体交付时限、无条件退款或开票。' },
      { title: '准备咨询信息', text: '可提供订单引用号、支付宝交易号、问题类型和非敏感的问题说明。不要附上完整账号凭据。' },
      { title: '联系客服', text: '客服邮箱及服务时间尚待配置，当前咨询表单不会提交。正式上线后会显示有效联系方式与受理状态。' },
    ],
  },
];
