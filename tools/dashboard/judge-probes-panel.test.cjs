// 判定探针面板渲染单测（纯函数，无需浏览器）
const assert = require('assert');
const { renderFindings, renderUsage, levelBadge } = require('./judge-probes-panel.js');

// ① 无快照 / 空 findings ⇒ 空态文案，不伪造空表
assert.ok(renderFindings(null).includes('尚无探针结论'));
assert.ok(renderFindings({ findings: [] }).includes('尚无探针结论'));

// ② 三档级别用不同徽章（alert/warn/ok 可区分）
assert.ok(levelBadge('alert').includes('badge-fail'));
assert.ok(levelBadge('warn').includes('badge-warn'));
assert.ok(levelBadge('ok').includes('badge-pass'));

// ③ 四探针逐条渲染：探针名 / 实测 / 阈值 / n 全在
const html = renderFindings({
  findings: [
    { probe: 'distribution-drift', severity: 'warn', metric: 0.088, threshold: 'warn≥0.05', n: 40 },
    { probe: 'probability-anomaly', severity: 'ok', metric: 0.45, threshold: '|μ-0.5|≤0.03', n: 40 },
    { probe: 'abstain-mutation', severity: 'alert', metric: 0.3, threshold: 'alert≥0.2', n: 40 },
    { probe: 'length-latency-correlation', severity: 'ok', metric: 0, threshold: 'warn≥0.35', n: 40 },
  ],
});
['distribution-drift', 'probability-anomaly', 'abstain-mutation', 'length-latency-correlation'].forEach((p) => {
  assert.ok(html.includes(p), `缺探针 ${p}`);
});
assert.ok(html.includes('n=40'));
assert.ok(html.includes('实测 0.3'));

// ④ 「无人消费」与「被推翻」必须可区分（两个不同徽章，不合并成一个数）
const both = renderUsage({ n: 10, adoptionRate: 0.5, askRate: 0.3, denyRate: 0.1, overrideRate: 0.2, unconsumed: true, overridden: true });
assert.ok(both.includes('无人消费') && both.includes('上线即被推翻'));
const onlyUnconsumed = renderUsage({ n: 10, adoptionRate: null, askRate: 0.2, denyRate: 0.1, overrideRate: null, unconsumed: true, overridden: false });
assert.ok(onlyUnconsumed.includes('无人消费') && !onlyUnconsumed.includes('上线即被推翻'));
// ⑤ 无 usage ⇒ 显式「未提供」，不补零
assert.ok(renderUsage(undefined).includes('未提供'));

console.log('judge-probes-panel: 5 组断言全过');
