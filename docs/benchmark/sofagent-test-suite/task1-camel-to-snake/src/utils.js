// utils.js — 工具函数层（被所有其他文件引用）
// 这里的函数名都是 camelCase，是 Task 1 的主要改造对象

function format_date_to_string(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function get_user_info(userId) {
  // 模拟数据库查询
  return { id: userId, name: 'Alice', email: 'alice@example.com' };
}

function calculate_total_price(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function validate_email_address(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generate_order_id(prefix) {
  return prefix + '-' + Date.now().toString(36);
}

module.exports = {
  format_date_to_string,
  get_user_info,
  calculate_total_price,
  validate_email_address,
  generate_order_id,
};
