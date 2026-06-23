// order.js — 订单业务层，引用 utils 和 user
const {
  calculate_total_price,
  generate_order_id,
  format_date_to_string,
} = require('./utils');
const { list_user_contacts } = require('./user');

function create_order_record(userId, items) {
  const orderId = generate_order_id('ORD');
  const total = calculate_total_price(items);
  const contacts = list_user_contacts(userId);
  return {
    orderId,
    userId,
    items,
    total,
    contacts,
    createdAt: format_date_to_string(new Date()),
  };
}

function summarize_order_history(orders) {
  const totalSpent = calculate_total_price(
    orders.flatMap((o) => o.items)
  );
  return {
    count: orders.length,
    totalSpent,
    lastOrderDate: orders.length
      ? format_date_to_string(new Date())
      : null,
  };
}

module.exports = {
  create_order_record,
  summarize_order_history,
};
