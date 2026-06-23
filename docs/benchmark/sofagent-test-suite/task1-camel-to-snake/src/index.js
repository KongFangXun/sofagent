// index.js — 入口文件，聚合所有模块
const { format_date_to_string, get_user_info } = require('./utils');
const { build_user_profile, list_user_contacts } = require('./user');
const { create_order_record, summarize_order_history } = require('./order');
const { register_customer } = require('./customer');
const { generate_monthly_report, build_contact_directory } = require('./report');

function main() {
  console.log('=== Test Suite Task 1 ===');
  console.log('Today:', format_date_to_string(new Date()));

  const user = get_user_info(1001);
  console.log('User:', user);

  const profile = build_user_profile({ id: 1001, email: 'bob@example.com' });
  console.log('Profile:', profile);

  const contacts = list_user_contacts(1001);
  console.log('Contacts:', contacts);

  const order = create_order_record(1001, [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 },
  ]);
  console.log('Order:', order);

  const customer = register_customer({ id: 2002, email: 'carol@example.com' });
  console.log('Customer:', customer);

  const report = generate_monthly_report(
    [{ id: 2002, email: 'carol@example.com' }],
    [order]
  );
  console.log('Report:', report);

  const directory = build_contact_directory([1001]);
  console.log('Directory:', directory);

  console.log('=== All OK ===');
}

main();
