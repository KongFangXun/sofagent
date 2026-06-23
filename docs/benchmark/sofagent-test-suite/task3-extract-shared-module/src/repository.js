// repository.js — 数据访问层
// formatDate 已提取到 shared.js

const { formatDate } = require('./shared');

const STORE = {
  '1': { id: '1', name: 'Alice', createdAt: '2024-01-15' },
  '2': { id: '2', name: 'Bob', createdAt: '2024-03-20' },
};

function findById(id) {
  return STORE[id] || null;
}

function findAfterDate(date) {
  const cutoff = formatDate(date);
  return Object.values(STORE).filter((r) => r.createdAt >= cutoff);
}

function createRecord(id, name) {
  STORE[id] = { id, name, createdAt: formatDate(new Date()) };
  return STORE[id];
}

module.exports = { findById, findAfterDate, createRecord };
