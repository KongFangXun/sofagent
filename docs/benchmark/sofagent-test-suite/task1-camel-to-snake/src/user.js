// user.js — 用户业务层，引用 utils
const {
  get_user_info,
  validate_email_address,
  format_date_to_string,
} = require('./utils');

function build_user_profile(rawInput) {
  if (!validate_email_address(rawInput.email)) {
    throw new Error('Invalid email');
  }
  const userInfo = get_user_info(rawInput.id);
  return {
    ...userInfo,
    email: rawInput.email,
    registeredAt: format_date_to_string(new Date()),
  };
}

function list_user_contacts(userId) {
  const userInfo = get_user_info(userId);
  return [
    { type: 'email', value: userInfo.email },
  ];
}

module.exports = {
  build_user_profile,
  list_user_contacts,
};
