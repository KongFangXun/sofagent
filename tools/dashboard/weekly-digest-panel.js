/* ============================================================
 * weekly-digest-panel.js · 治理周报面板（F-29 接线批 UI 消费点）
 * ============================================================
 * 为什么外置：dashboard.html 已到 2800 行冻结上限（check-dashboard.sh），
 * 与 judge-probes-panel.js 同风格：ES5、无框架、无内联 style。
 *
 * 数据源：GET /api/weekly-digest → { ok, report:{ weekId, window, nodeStats,
 *          decisionHighlights, decisionKinds, anomalies, interventions, notes } }
 * 生产者：daemon 周报巡检 weekly-digest.ts 写 <dataDir>/dashboard/digest-<weekId>.json
 * 空态纪律：无周报时显示「尚未生成」，不伪造空表（与其它面板一致）。
 * ============================================================ */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '&': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 节点统计小表：只列非零项，零值不占行（空态纪律：不补零） */
  function renderNodeStats(ns) {
    if (!ns) return '';
    var rows = [];
    Object.keys(ns).forEach(function (k) {
      var v = ns[k];
      if (v === null || v === undefined || v === 0) return;
      rows.push('<tr><td>' + esc(k) + '</td><td style="text-align:right">' + esc(v) + '</td></tr>');
    });
    if (!rows.length) return '';
    return '<table class="kv-table"><tbody>' + rows.join('') + '</tbody></table>';
  }

  /** 决策类型分布：横向标签行 */
  function renderKinds(kinds) {
    if (!kinds || !kinds.length) return '';
    return '<div class="chip-row">' + kinds.map(function (k) {
      return '<span class="badge-pass">' + esc(k.kind) + ' ×' + esc(k.count) + '</span>';
    }).join('') + '</div>';
  }

  /** 异常态计数：非零才亮，零静默（与 anomalies 语义对齐——零异常不该刷屏） */
  function renderAnomalies(a) {
    if (!a) return '';
    var parts = [];
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === 0 || v === null || v === undefined) return;
      var cls = k === 'total' ? 'badge-warn' : 'badge-fail';
      parts.push('<span class="' + cls + '">' + esc(k) + ' ' + esc(v) + '</span>');
    });
    return parts.length ? '<div class="chip-row">' + parts.join('') + '</div>' : '';
  }

  function render(payload) {
    var meta = document.getElementById('weeklyDigestMeta');
    var box = document.getElementById('weeklyDigestBox');
    if (!box) return;
    if (!payload || !payload.ok || !payload.report) {
      box.innerHTML = '<div class="info-note">尚未生成周报——daemon 周报巡检（weekly-digest）按周写入 digest-*.json，' +
        (payload && payload.hint ? esc(payload.hint) : '') + '</div>';
      if (meta) meta.textContent = '无数据';
      return;
    }
    var r = payload.report;
    if (meta) meta.textContent = '周 ' + esc(r.weekId) + ' · 生成于 ' + esc((r.generatedAt || '').slice(0, 16));
    var html = [];
    if (r.window) html.push('<div class="info-note">统计窗口：' + esc(r.window.start) + ' → ' + esc(r.window.end) + '（' + esc(r.window.days) + ' 天）</div>');
    var stats = renderNodeStats(r.nodeStats);
    if (stats) html.push('<div style="margin-top:8px"><b>节点统计</b></div>' + stats);
    var kinds = renderKinds(r.decisionKinds);
    if (kinds) html.push('<div style="margin-top:8px"><b>决策类型</b></div>' + kinds);
    var anom = renderAnomalies(r.anomalies);
    if (anom) html.push('<div style="margin-top:8px"><b>异常态</b></div>' + anom);
    if (Array.isArray(r.notes) && r.notes.length) {
      html.push('<div style="margin-top:8px"><b>备注</b></div><ul>' + r.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>');
    }
    box.innerHTML = html.length ? html.join('') : '<div class="info-note">本期周报无实质内容</div>';
  }

  function mount() {
    fetch('/api/weekly-digest')
      .then(function (res) { return res.json(); })
      .then(render)
      .catch(function () {
        var box = document.getElementById('weeklyDigestBox');
        if (box) box.innerHTML = '<div class="info-note">周报数据加载失败（/api/weekly-digest 不可达）</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
