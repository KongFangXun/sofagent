// index.js — 入口
const service = require('./service');
const validator = require('./validator');
const formatter = require('./formatter');
const auth = require('./auth');
const shared = require('./shared');

function main() {
  console.log('=== Test Suite Task 3 ===');

  // 注册测试
  console.log('Register:', service.registerUser({ name: 'Carol', email: 'carol@test.com' }));
  console.log('Register (bad):', service.registerUser({ name: '', email: 'bad' }));

  // 查询测试
  console.log('Query:', service.queryByDate('2024-01-01'));

  // 直接使用各模块（验证提取后不破坏）
  console.log('isEmpty:', shared.isEmpty(''));
  console.log('isEmail (validator):', validator.isEmail('a@b.com'));
  console.log('isEmail (auth):', auth.isEmail('a@b.com'));
  console.log('formatPhone:', formatter.formatPhone(13812345678));

  console.log('=== All OK ===');
}

main();
