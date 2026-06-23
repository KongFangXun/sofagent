// index.js — 入口
const { logger } = require('./logger');
const db = require('./db');
const http = require('./http');
const cache = require('./cache');
const queue = require('./queue');

function main() {
  console.log('=== Test Suite Task 4 ===');

  // DB 测试
  db.insert('user', { name: 'Bob' });
  console.log('Query:', db.query('user', 1));
  console.log('Update:', db.update('user', 1, { name: 'Alice2' }));
  console.log('Tx:', db.transaction([
    { type: 'insert', table: 'user', data: { name: 'Carol' } },
    { type: 'update', table: 'user', id: 1, data: { name: 'Alice' } },
  ]));

  // HTTP 测试
  console.log('GET:', http.get('https://api.example.com/test'));
  console.log('POST:', http.post('https://api.example.com/test', { x: 1 }));
  console.log('Retry:', http.requestWithRetry('GET', 'https://api.example.com/test', null, 3));

  // Cache 测试
  cache.setCached('key1', 'value1');
  console.log('Cache:', cache.getCached('key1'));
  cache.invalidate('key1');
  console.log('Cache after invalidate:', cache.getCached('key1'));

  // Queue 测试
  queue.enqueue({ type: 'email', payload: { to: 'a@b.com' } });
  queue.enqueue({ type: 'sms', payload: { to: '13800000000' } });
  queue.enqueue({ type: 'push', payload: { token: 'abc' } });
  console.log('Queue status:', queue.getQueueStatus());
  console.log('Process:', queue.processQueue(2));
  console.log('Queue status after:', queue.getQueueStatus());

  console.log('=== All OK ===');
}

main();
