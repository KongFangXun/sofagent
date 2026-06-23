// auth.js — 认证模块
// 陷阱：这里的 isEmail 和 validator.js 里的【实现不同】！
// validator.js 用正则，这里只用 includes('@') —— 行为不同，不能合并！

function isEmail(email) {
  if (typeof email !== 'string') return false;
  return email.includes('@') && email.length > 3;
}

function hashPassword(password) {
  // 模拟 hash（不要用于生产）
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = ((hash << 5) - hash) + password.charCodeAt(i);
    hash = hash & hash;
  }
  return 'h' + Math.abs(hash).toString(36);
}

function authenticate(email, password) {
  if (!isEmail(email)) {
    return { success: false, reason: 'invalid email' };
  }
  if (password.length < 6) {
    return { success: false, reason: 'password too short' };
  }
  return { success: true, token: hashPassword(password) };
}

module.exports = { isEmail, hashPassword, authenticate };
