// db.js — 数据库操作层
const { logger } = require('./logger');

const STORE = {
  user: { 1: { id: 1, name: 'Alice' } },
  config: { theme: 'dark', lang: 'zh' },
};

function query(table, id) {
  logger.info(`调用 query，参数: table=${table}, id=${id}`);
  const record = STORE[table] && STORE[table][id];
  if (!record) {
    logger.error(`失败 query，原因: Record ${table}/${id} not found`);
    throw new Error(`Record ${table}/${id} not found`);
  }
  logger.info(`完成 query，结果: ${JSON.stringify(record)}`);
  return record;
}

function insert(table, data) {
  logger.info(`调用 insert，参数: table=${table}, data=${JSON.stringify(data)}`);
  if (!STORE[table]) STORE[table] = {};
  const id = Date.now();
  STORE[table][id] = { ...data, id };
  logger.info(`完成 insert，结果: ${id}`);
  return id;
}

function update(table, id, patch) {
  logger.info(`调用 update，参数: table=${table}, id=${id}, patch=${JSON.stringify(patch)}`);
  if (!STORE[table] || !STORE[table][id]) {
    logger.error(`失败 update，原因: Cannot update ${table}/${id}: not found`);
    throw new Error(`Cannot update ${table}/${id}: not found`);
  }
  STORE[table][id] = { ...STORE[table][id], ...patch };
  const result = STORE[table][id];
  logger.info(`完成 update，结果: ${JSON.stringify(result)}`);
  return result;
}

function remove(table, id) {
  logger.info(`调用 remove，参数: table=${table}, id=${id}`);
  if (!STORE[table] || !STORE[table][id]) {
    logger.error(`失败 remove，原因: Record ${table}/${id} not found`);
    return false;
  }
  delete STORE[table][id];
  logger.info(`完成 remove，结果: true`);
  return true;
}

function transaction(operations) {
  logger.info(`调用 transaction，参数: operations count=${operations.length}`);
  const results = [];
  try {
    for (const op of operations) {
      if (op.type === 'insert') results.push(insert(op.table, op.data));
      else if (op.type === 'update') results.push(update(op.table, op.id, op.data));
      else if (op.type === 'remove') results.push(remove(op.table, op.id));
    }
    logger.info(`完成 transaction，结果: committed=true`);
    return { committed: true, results };
  } catch (e) {
    logger.error(`失败 transaction，原因: ${e.message}`);
    return { committed: false, error: e.message, partialResults: results };
  }
}

module.exports = { query, insert, update, remove, transaction };
