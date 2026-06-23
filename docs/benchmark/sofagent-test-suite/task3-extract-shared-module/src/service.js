// service.js — 业务服务层，引用 validator / formatter / auth / repository
const validator = require('./validator');
const formatter = require('./formatter');
const auth = require('./auth');
const repository = require('./repository');

function registerUser(input) {
  const errors = validator.validateAll(input, {
    name: 'required',
    email: 'email',
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const authResult = auth.authenticate(input.email, input.password || 'default123');
  if (!authResult.success) {
    return { ok: false, errors: [authResult.reason] };
  }
  const record = repository.createRecord(Date.now().toString(), input.name);
  return {
    ok: true,
    record,
    token: authResult.token,
    display: formatter.formatOutput(record),
  };
}

function queryByDate(dateStr) {
  const records = repository.findAfterDate(dateStr);
  return records.map((r) => ({
    id: r.id,
    name: formatter.formatOutput(r.name),
    date: formatter.formatDate(r.createdAt),
  }));
}

module.exports = { registerUser, queryByDate };
