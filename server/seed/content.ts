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
    { title: '完成订阅与查询', description: '正式开放后付款，在订单中跟踪进度。' },
  ],
};

export const faqs = [
  {
    question: '这是 ChatGPT 官方网站吗？',
    answer: '不是。伍叁 AI 是独立的订阅服务站点，与 OpenAI 无官方隶属关系。ChatGPT 名称仅用于识别所介绍的服务。',
  },
  {
    question: '现在可以购买套餐吗？',
    answer: '当前展示的是本站实际月度售价，可以查看套餐并保存本机清单。在线下单、支付与订阅交付尚未接入，因此暂不能通过网站完成购买。',
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
      { title: '选择适合的套餐', text: '在套餐目录中按 Plus 或 Pro 筛选，进入详情查看周期、本站实际售价和服务条件。所有金额均以人民币按月计价，在线下单尚未开放。' },
      { title: '核对订阅条件', text: '购买前应确认价格、账号或地区要求、服务供应、交付方式及售后范围。目前未确认的条件会明确显示为待确认。' },
      { title: '确认联系信息', text: '联系邮箱用于订单通知与找回，不代表需要订阅的账号。当前邮件与订单服务尚未接入，不会发送邮件，也不会提交或持久保存输入的邮箱。' },
      { title: '付款与交付', text: '支付与交付尚未开放。正式上线后，订单状态必须由服务端核实，不以页面跳转或付款截图作为成功依据。' },
    ],
  },
  {
    id: 'find-orders', category: '订单查询', icon: 'receipt-text',
    title: '查询订单与跨设备找回', summary: '区分本机套餐清单与经过验证的真实订单。',
    sections: [
      { title: '本机套餐清单', text: '保存的套餐草稿仅保留商品、保存时的本站售价和保存时间，存在当前浏览器中。历史价格不会随目录修改而改变。这些清单不是订单，也不表示已经付款。' },
      { title: '真实订单查询', text: '真实订单服务尚未开放。后续订单列表将展示付款、交付及售后状态，访问私有信息前需要验证身份。' },
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
      { title: '准备咨询信息', text: '正式上线后可提供订单引用号、问题类型和非敏感的问题说明。不要附上完整账号凭据。' },
      { title: '联系客服', text: '客服邮箱及服务时间尚待配置，当前咨询表单不会提交。正式上线后会显示有效联系方式与受理状态。' },
    ],
  },
];
