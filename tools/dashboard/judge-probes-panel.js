/* ============================================================
 * judge-probes-panel.js · 判定层失效探测面板（F6.4 #4 UI 消费点）
 * ============================================================
 * 为什么外置：dashboard.html 已到 2800 行冻结上限，门禁原文要求
 * 「新增能力走模块化，不在此文件继续堆」（check-dashboard.sh ⑨）。
 * 本文件与 dashboard.js 同风格：ES5、无框架、无内联 style（只用既有类）。
 *
 * 数据源：GET /api/judge-probes → { ok, snapshot:{ ts, findings[], panel, usage? } }
 * 生产者：sofagent-orchestrator judge-probes --data-dir <dir>
 * 空态纪律：无快照时显示「尚未采集」，不伪造空表（与 dashboard 其它面板一致）。
 * ============================================================ */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function levelBadge(sev) {
    var cls = sev === 'alert' ? 'badge-fail' : sev === 'warn' ? 'badge-warn' : 'badge-pass';
    var txt = sev === 'alert' ? '🔴 alert' : sev === 'warn' ? '🟡 warn' : '🟢 ok';
    return '<span class="' + cls + '">' + txt + '</span>';
  }

  /** 四指标 + 两个可区分红旗：无人消费（集成问题）与上线即被推翻（质量问题）分开显示 */
  function renderUsage(u) {
    if (!u) return '<div class="info-note">判定使用度量：未提供（不补零）</div>';
    var pct = function (x) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1) + '%'; };
    var flags = [];
    if (u.unconsumed) flags.push('<span class="badge-warn">无人消费</span>');
    if (u.overridden) flags.push('<span class="badge-fail">上线即被推翻</span>');
    return '<div class="info-note">判定使用：n=' + esc(u.n) +
      ' · 采纳率 ' + pct(u.adoptionRate) +
      ' · ASK ' + pct(u.askRate) +
      ' · DENY ' + pct(u.denyRate) +
      ' · 推翻率 ' + pct(u.overrideRate) +
      ' · 红旗：' + (flags.length ? flags.join(' ') : '无') + '</div>';
  }

  function renderFindings(snap) {
    if (!snap || !snap.findings || !snap.findings.length) {
      return '<div class="info-note">尚无探针结论（先跑 judge-probes 生成快照）</div>';
    }
    var rows = snap.findings.map(function (f) {
      return '<div class="audit-row">' + levelBadge(f.severity) +
        '<span class="audit-rule">' + esc(f.probe) + '</span>' +
        '<span class="audit-task">实测 ' + esc(f.metric) + ' · 阈值 ' + esc(f.threshold) + '</span>' +
        '<span class="audit-time">n=' + esc(f.n) + '</span></div>';
    }).join('');
    return rows + renderUsage(snap.usage);
  }

  function mount() {
    var box = document.getElementById('judgeProbesBox');
    if (!box) return;
    var meta = document.getElementById('judgeProbesMeta');
    fetch('/api/judge-probes')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) {
          box.innerHTML = '<div class="info-note">' + esc((j && j.hint) || '尚未采集探针数据') + '</div>';
          if (meta) meta.textContent = '—';
          return;
        }
        box.innerHTML = renderFindings(j.snapshot);
        if (meta) meta.textContent = String(j.snapshot.ts || '').replace('T', ' ').slice(0, 19);
      })
      .catch(function () {
        box.innerHTML = '<div class="info-note">探针接口不可达（dashboard 未启动或路由缺失）</div>';
        if (meta) meta.textContent = '—';
      });
  }

  // 供 node 侧单测：无 document 时只导出纯函数，不挂载（不改变浏览器行为）
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { renderFindings: renderFindings, renderUsage: renderUsage, levelBadge: levelBadge };
    }
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
