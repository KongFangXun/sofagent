// customer.js — 客户层，引用 user（间接依赖 utils）
// 陷阱：这里把 format_date_to_string 赋值给一个变量后间接调用
const { build_user_profile, list_user_contacts } = require('./user');

const formatFn = require('./utils').format_date_to_string;

function register_customer(input) {
  const profile = build_user_profile(input);
  return {
    ...profile,
    customerId: 'CUST-' + profile.id,
    since: formatFn(new Date()),
  };
}

function fetch_customer_contacts(customerId) {
  // 注意：这里用 list_user_contacts 但传的是 customerId
  return list_user_contacts(customerId);
}

module.exports = {
  register_customer,
  fetch_customer_contacts,
};
