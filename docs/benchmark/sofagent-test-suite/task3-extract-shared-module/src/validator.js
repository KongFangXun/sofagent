// validator.js — 验证器模块
// isEmpty 已提取到 shared.js
// isEmail 用正则实现（和 auth.js 里的 isEmail 实现不同——假重复，保留不动）

const { isEmpty } = require('./shared');

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

function validateAll(obj, rules) {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    if (rule === 'required' && isEmpty(obj[field])) {
      errors.push(`${field} is required`);
    }
    if (rule === 'email' && !isEmail(obj[field])) {
      errors.push(`${field} must be a valid email`);
    }
  }
  return errors;
}

module.exports = { isEmail, isPhone, validateAll };
