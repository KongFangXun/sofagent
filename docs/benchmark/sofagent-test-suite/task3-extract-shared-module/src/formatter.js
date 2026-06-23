// formatter.js — 格式化模块
// isEmpty 和 formatDate 已提取到 shared.js

const { isEmpty, formatDate } = require('./shared');

function formatPhone(phone) {
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  return phone;
}

function formatOutput(data) {
  if (isEmpty(data)) return 'N/A';
  return JSON.stringify(data);
}

module.exports = { formatDate, formatPhone, formatOutput };
