// queue.js — 队列处理层
const { logger } = require('./logger');

let queue = [];

function enqueue(task) {
  logger.info(`调用 enqueue，参数: task=${JSON.stringify(task)}`);
  if (!task || !task.type) {
    logger.error(`失败 enqueue，原因: Task must have a type`);
    throw new Error('Task must have a type');
  }
  task.id = Date.now() + Math.random();
  task.status = 'pending';
  queue.push(task);
  logger.info(`完成 enqueue，结果: ${task.id}`);
  return task.id;
}

function processQueue(batchSize) {
  logger.info(`调用 processQueue，参数: batchSize=${batchSize}`);
  const batch = queue.filter((t) => t.status === 'pending').slice(0, batchSize);
  if (batch.length === 0) {
    logger.info(`完成 processQueue，结果: { processed: 0, remaining: ${queue.length} }`);
    return { processed: 0, remaining: queue.length };
  }

  for (const task of batch) {
    try {
      task.status = 'done';
      task.result = `processed:${task.type}`;
    } catch (e) {
      task.status = 'failed';
      task.error = e.message;
      logger.error(`失败 processQueue task，原因: ${e.message}`);
    }
  }

  // 清理已完成超过 100 条的旧任务
  if (queue.length > 100) {
    queue = queue.filter((t) => t.status === 'pending');
  }

  const remaining = queue.filter((t) => t.status === 'pending').length;
  // 递归处理剩余任务
  if (remaining > 0) {
    const next = processQueue(batchSize);
    logger.info(`完成 processQueue，结果: { processed: ${batch.length + next.processed}, remaining: ${next.remaining} }`);
    return { processed: batch.length + next.processed, remaining: next.remaining };
  }

  logger.info(`完成 processQueue，结果: { processed: ${batch.length}, remaining: 0 }`);
  return { processed: batch.length, remaining: 0 };
}

function getQueueStatus() {
  logger.info(`调用 getQueueStatus，参数: (none)`);
  const result = {
    total: queue.length,
    pending: queue.filter((t) => t.status === 'pending').length,
    done: queue.filter((t) => t.status === 'done').length,
    failed: queue.filter((t) => t.status === 'failed').length,
  };
  logger.info(`完成 getQueueStatus，结果: ${JSON.stringify(result)}`);
  return result;
}

module.exports = { enqueue, processQueue, getQueueStatus };
