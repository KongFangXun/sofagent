// report.js — 报表层，同时引用 order 和 customer（两条依赖链）
const { create_order_record, summarize_order_history } = require('./order');
const { register_customer, fetch_customer_contacts } = require('./customer');

function generate_monthly_report(customers, orders) {
  const profiles = customers.map((c) => register_customer(c));
  const orderSummary = summarize_order_history(orders);
  return {
    customerCount: profiles.length,
    orderSummary,
    generatedAt: new Date().toISOString(),
  };
}

function build_contact_directory(customerIds) {
  return customerIds.reduce((dir, id) => {
    dir[id] = fetch_customer_contacts(id);
    return dir;
  }, {});
}

module.exports = {
  generate_monthly_report,
  build_contact_directory,
};
