/* ============================================================
 * dashboard.js · 纯函数外置（W8 BUG-18）
 * ============================================================
 * 从 dashboard.html <script> 区逐字搬移的**纯函数**（不引用
 * document / window / alert / fetch——只吃参数吐字符串/数值）。
 * 搬移纪律：不改逻辑、不改命名；html 内同名定义已删除，靠
 * 本文件先于主 script 加载（<script src> 在前）保持定义次序。
 * 行数棘轮：外置后 dashboard.html 上限 3000 → 2800
 * （check-dashboard.sh ⑨）。
 * ============================================================ */

/* ===== Live Data 依赖 ===== */
function tryFetch(path){
  return fetch(path).then(function(r){if(!r.ok)throw new Error(r.status);return r.text()}).catch(function(){return null});
}

function parseJSONL(text){
  if(!text)return [];
  return text.trim().split('\n').filter(Boolean).map(function(line){
    try{return JSON.parse(line)}catch(e){return null}
  }).filter(Boolean);
}

/* ===== 训练任务 ===== */
function trainStatusBadge(status){
  var map={
    running:'badge-pass',checkpointing:'badge-warn',queued:'badge-warn',
    completed:'badge-pass',failed:'badge-fail',cancelled:'badge-warn',interrupted:'badge-warn'
  };
  var cls=map[status]||'badge-warn';
  return '<span class="'+cls+'">'+escapeHtml(status||'?')+'</span>';
}

/* 审计记录行渲染（recent / 加载更多共用） */
function renderAuditRows(records){
  return records.map(function(rec){
    var verdict=rec.exitCode===0?'PASS':(rec.exitCode===1?'WARN':'FAIL');
    var cls=verdict==='PASS'?'badge-pass':(verdict==='WARN'?'badge-warn':'badge-fail');
    // rule 列：FAIL/WARN 显示触发的规则码，PASS 显示 ✓
    var ruleCell=rec.rule
      ? '<span class="audit-rule" style="color:var(--'+(verdict==='FAIL'?'red':'amber')+')">'+escapeHtml(rec.rule)+'</span>'
      : '<span class="audit-rule icon-ok">✓</span>';
    return '<div class="audit-row"><span class="audit-time">'+escapeHtml(rec.time||'')+'</span><span class="audit-badge '+cls+'">'+verdict+'</span>'+ruleCell+'<span class="audit-task">'+escapeHtml(rec.task||'')+'</span></div>';
  }).join('');
}

/* ===== 通用工具 ===== */
function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

/* 统一空态组件：图标 + 文案 + CTA 按钮（产品化空态，替代「未检测到 xxx」） */
function emptyState(emoji,title,desc,ctaText,ctaFn){
  return '<div style="text-align:center;padding:26px 16px">'+
    '<div style="font-size:26px;line-height:1">'+emoji+'</div>'+
    '<div class="sub-title" style="margin-top:10px">'+escapeHtml(title)+'</div>'+
    (desc?'<div style="font-size:12px;color:var(--text-s);margin-top:4px;max-width:420px;margin-left:auto;margin-right:auto">'+escapeHtml(desc)+'</div>':'')+
    (ctaText?'<div style="margin-top:12px"><button class="btn btn-primary" onclick="'+ctaFn+'" style="padding:7px 16px;min-height:34px;font-size:12px;font-weight:600">'+escapeHtml(ctaText)+'</button></div>':'')+
    '</div>';
}

// ── 统一时间工具（v1.4.0 · 北京时间）────────────────────────────
// 审计/工作记录 timestamp 落盘为 UTC ISO（如 2026-07-28T13:05:42.416Z）。
// 此前多处直接 slice(0,10)/(5,16) 显示 UTC 时间 = 北美时间（差 8 小时）——
// 统一转北京时间（Asia/Shanghai）显示与按天分组。
var SOFAGENT_TZ = 'Asia/Shanghai';
function parseTs(raw){
  // Date 实例直接采用：String(Date) 形如 "Sun Oct 04 2026 ..."，new Date() 解析不了 ⇒ 会被兜底成 now，
  // 症状是「示例数据的近 7 天趋势图横轴 7 个标签全同」。此处收口，避免各调用点各自规避。
  if(raw instanceof Date)return isNaN(raw.getTime())?new Date():raw;
  var t=raw?new Date(String(raw).replace(' ','T').replace(/\.\d+Z$/,'Z')):new Date();
  if(isNaN(t.getTime()))t=new Date();return t;
}
// 北京时间 HH:MM 显示（审计日志行用）
function fmtTime(raw){return parseTs(raw).toLocaleTimeString('zh-CN',{timeZone:SOFAGENT_TZ,hour12:false,hour:'2-digit',minute:'2-digit'});}
// 北京时间 YYYY-MM-DD 日期（今日计数/按天分组/趋势图用）
function fmtDay(raw){return parseTs(raw).toLocaleDateString('en-CA',{timeZone:SOFAGENT_TZ});} // en-CA → YYYY-MM-DD
// 北京时间完整显示（门禁进度等用）：MM-DD HH:MM
function fmtDayTime(raw){var t=parseTs(raw);var d=t.toLocaleDateString('en-CA',{timeZone:SOFAGENT_TZ});var tm=t.toLocaleTimeString('zh-CN',{timeZone:SOFAGENT_TZ,hour12:false,hour:'2-digit',minute:'2-digit'});return d.slice(5)+' '+tm;}

function fmtUpdatedAt(raw){
  // 统一北京时间：ISO(UTC) → 北京时间 HH:MM:SS（此前直接 slice 会显示北美时间）
  var t=parseTs(raw);
  return '更新于 '+t.toLocaleTimeString('zh-CN',{timeZone:SOFAGENT_TZ,hour12:false});
}

/* ===== 工作明细格式化 ===== */
function fmtTokens(t){if(!t)return '—';return (t.input+t.output).toLocaleString()}
function fmtCost(c){
  if(c===null||c===undefined)return '—';
  // 成本统一人民币：引擎按美元计费（costUsd），展示 ×7.2 估算汇率换算为 ¥（数值为人民币估算）
  return '¥'+(c*7.2).toFixed(4);
}
function fmtMs(ms){if(ms===null||ms===undefined)return '—';if(ms<1000)return ms+'ms';if(ms<60000)return (ms/1000).toFixed(1)+'s';return (ms/60000).toFixed(1)+'min'}

/* 统一表格渲染：窄屏横向滚动 + 全量转义 */
function wlTable(headers,rows){
  if(!rows||!rows.length)return '<div class="hint12" style="padding:12px 0">暂无数据</div>';
  var head='<thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead>';
  var body='<tbody>'+rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+c+'</td>'}).join('')+'</tr>'}).join('')+'</tbody>';
  return '<div class="table-wrap"><table class="wl-table">'+head+body+'</table></div>';
}

/* 超支判定：costWarns 匹配 agent/workflow → 标红 + hover 显示超支说明 */
function costCell(cost,key,costWarns){
  if(costWarns&&costWarns.length){
    var hit=costWarns.find(function(w){return w.key===key});
    if(hit){
      return '<span class="cell-over" title="'+escapeHtml(hit.summary||'超支告警')+'">'+fmtCost(cost)+' <span class="delta"><i class="bi bi-exclamation-triangle"></i> 超支</span></span>';
    }
  }
  return fmtCost(cost);
}

/* ===== 知识库 ===== */
/* daemon 写入形态已改为纯文本表格，旧正则硬要求 [[ ]] 导致解析恒空：
   本体图谱「图谱视图」降级示例数据、知识库统计三项归零。
   返回 {name,domain,nodes}；表头行 / 分隔行 / 非表格行返回 null。 */
function parseIndexRow(line){
  var t=(line||'').trim();
  if(t.charAt(0)!=='|')return null;
  var cells=t.split('|');
  var name=(cells[1]||'').trim();
  if(!name||name==='页面'||/^[-:]+$/.test(name))return null;
  return {
    name:name.replace(/^\[\[|\]\]$/g,'').trim(),
    domain:(cells[2]||'').trim(),
    nodes:(cells[3]||'').trim()
  };
}

/* ===== 治理页格式化 ===== */
function govPct(rate){return rate===null||rate===undefined?'—':(rate*100).toFixed(1)+'%'}
function govSigned(x){return x===null||x===undefined?'—':(x>=0?'+':'')+(x*100).toFixed(1)+'%'}
function govMs(ms){
  if(ms===null||ms===undefined)return '—';
  if(ms<60000)return (ms/1000).toFixed(1)+' 秒';
  if(ms<3600000)return (ms/60000).toFixed(1)+' 分钟';
  return (ms/3600000).toFixed(1)+' 小时';
}
function govEsc(s){return String(s===null||s===undefined?'—':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

/* ===== 示例数据构造（loadSampleData 的纯函数面——数据与聚合计算外置） ===== */
/* 示例行时间**相对当前生成**（与「审计分析（近 7 天）」同一时间基准）——
   原先硬编码固定日期，会让同图内「记录行日期」与「趋势图横轴」对不上。 */
function buildSampleAuditRowsHtml(){
  var samples=[
    {time:'',verdict:'PASS',rule:'',task:'feat: 添加 A22 权限提升审计规则'},
    {time:'',verdict:'WARN',rule:'A19',task:'fix: 修复 daemon 启动顺序'},
    {time:'',verdict:'PASS',rule:'',task:'refactor: 重构 sparkline 渲染'},
    {time:'',verdict:'FAIL',rule:'A7',task:'update: 修改配置（未先读取）'},
    {time:'',verdict:'PASS',rule:'',task:'test: 新增文件系统审计测试'},
    {time:'',verdict:'WARN',rule:'A3',task:'feat: 跨目录修改（越界）'},
    {time:'',verdict:'PASS',rule:'',task:'docs: 更新 WIKI 导航'},
    {time:'',verdict:'PASS',rule:'',task:'chore: 升级依赖版本'}
  ];
  samples.forEach(function(s,i){s.time=fmtDayTime(new Date(Date.now()-(i*2+1)*3600*1000).toISOString())});
  return samples.map(function(r){
    var ruleCell=r.rule
      ? '<span class="audit-rule" style="color:var(--'+(r.verdict==='FAIL'?'red':'amber')+')">'+escapeHtml(r.rule)+'</span>'
      : '<span class="audit-rule icon-ok">✓</span>';
    return '<div class="audit-row"><span class="audit-time">'+escapeHtml(r.time)+'</span><span class="audit-badge badge-'+r.verdict.toLowerCase()+'">'+r.verdict+'</span>'+ruleCell+'<span class="audit-task">'+escapeHtml(r.task)+'</span></div>';
  }).join('');
}

/* 示例趋势：近 7 天每日 PASS/WARN/FAIL + 规则级通过率（聚合计算纯函数） */
function buildSampleTrendDays(){
  var samplePass=[19,17,20,13,18,11,16];
  var sampleWarn=[6,5,8,3,5,2,4];
  var sampleFail=[3,2,3,2,3,2,2];
  var sampleDays=[];
  for(var i=6;i>=0;i--){
    var dt=new Date(Date.now()-i*24*3600*1000);
    var t=samplePass[6-i],w=sampleWarn[6-i],f=sampleFail[6-i];
    var tasks=t+w+f, checks=tasks*22, rulePass=checks-(w+f)*2; // 每个违规任务平均触 2 条规则
    sampleDays.push({day:fmtDay(dt),pass:t,warn:w,fail:f,ruleAll:checks,rulePass:rulePass,ruleRate:Math.round(rulePass*100/checks)});
  }
  return sampleDays;
}
/* 通栏趋势图：规则检查口径——蓝柱审计次数(总检查) + 黄柱问题次数（左轴次数），绿线规则通过率（右轴比率）
 * 图内自洽：绿线 = 1 − 黄柱÷蓝柱，与左上角"规则通过率"同源 */
function buildDailyTrendSvg(days){
  var rawMax=Math.max.apply(null,days.map(function(d){return d.ruleAll||0}).concat([1]));
  // y 轴顶：按数量级取整齐数（1.1 余量后向上取整到 step 的倍数）——刻度好看且最高柱不贴顶
  // step 规则：≥5000 取千位 / ≥500 取百位 / ≥50 取十位 / 其余取个位
  var step=rawMax>=5000?1000:(rawMax>=500?100:(rawMax>=50?10:1));
  var maxCount=Math.ceil((rawMax*1.1)/step)*step;
  // viewBox 宽 500 匹配半宽卡片——图不再等比缩小，柱子视觉充实
  var W=500,padL=40,padR=40,top=10,base=132;
  var bw=(W-padL-padR)/days.length;
  var svg='';
  // 左轴：次数 0-maxCount（4 格）
  for(var g=0;g<=4;g++){
    var yy=base-(g/4)*(base-top);
    svg+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3"/>';
    svg+='<text x="'+(padL-6)+'" y="'+(yy+3)+'" text-anchor="end" font-size="10" fill="var(--text-t)">'+Math.round(maxCount*g/4)+'</text>';
    // 右轴：通过率 80-100%（0-100 会把波动压扁，80 起才能看到绿线波动）
    svg+='<text x="'+(W-padR+6)+'" y="'+(yy+3)+'" text-anchor="start" font-size="10" fill="var(--text-t)">'+(80+g*5)+'%</text>';
  }
  // 通过率 → y：80-100 映射到绘图区（<80 钳位到底）
  function rateY(rate){
    var r=Math.max(80,Math.min(100,rate));
    return base-((r-80)/20)*(base-top);
  }
  var ratePts=[];
  days.forEach(function(d,i){
    var checks=d.ruleAll||0;
    var issues=checks-(d.rulePass||0);
    var rate=checks>0?Math.round((d.rulePass||0)*100/checks):0;
    var cx=padL+i*bw+bw/2;
    // 柱更粗 + 绘图区更高（填满半宽卡片）
    var barW=Math.min(bw*0.24,26);
    var gap=6;
    // 双柱：审计次数(品牌淡蓝)；问题次数(灰)（蓝读主数据，灰读报警量）
    var h1=Math.max(3,checks/maxCount*(base-top));
    var h2=issues>0?Math.max(3,issues/maxCount*(base-top)):0;
    svg+='<rect x="'+(cx-barW-gap/2)+'" y="'+(base-h1)+'" width="'+barW+'" height="'+h1+'" rx="3" fill="var(--brand-l)"/>';
    if(h2>0)svg+='<rect x="'+(cx+gap/2)+'" y="'+(base-h2)+'" width="'+barW+'" height="'+h2+'" rx="3" fill="var(--text-t)"/>';
    svg+='<text x="'+(cx-barW/2-gap/2)+'" y="'+(base-h1-5)+'" text-anchor="middle" font-size="9" fill="var(--brand)">'+checks+'</text>';
    if(h2>0)svg+='<text x="'+(cx+barW/2+gap/2)+'" y="'+(base-h2-5)+'" text-anchor="middle" font-size="9" fill="var(--text-t)">'+issues+'</text>';
    svg+='<text x="'+cx+'" y="'+(base+17)+'" text-anchor="middle" font-size="10" fill="var(--text-t)">'+String(d.day).slice(5)+'</text>';
    ratePts.push([cx,rate]);
  });
  // 通过率线（品牌蓝，核心指标；右轴 80-100%）
  var line=ratePts.map(function(pt){return pt[0]+','+rateY(pt[1])}).join(' ');
  if(ratePts.length>1){
    svg+='<polyline points="'+line+'" fill="none" stroke="var(--brand)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>';
  }
  ratePts.forEach(function(pt){
    var yy=rateY(pt[1]);
    svg+='<circle cx="'+pt[0]+'" cy="'+yy+'" r="4" fill="#fff" stroke="var(--brand)" stroke-width="2.4"/>';
  });
  return svg;
}

/* 降级：summary 无 daily 时用 TOP3 画柱状（通栏版） */
function buildTop3TrendSvg(t){
  var rawMax=Math.max.apply(null,t.map(function(x){return x.count||0}).concat([1]));
  // y 轴顶：按数量级取整齐数（同主图）
  var step=rawMax>=5000?1000:(rawMax>=500?100:(rawMax>=50?10:1));
  var max=Math.ceil((rawMax*1.1)/step)*step;
  var W=500,padL=40,padR=20,base=132,top=10;
  var sw=(W-padL-padR)/t.length;
  var svg='<line x1="'+padL+'" y1="'+top+'" x2="'+(W-padR)+'" y2="'+top+'" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3"/>';
  svg+='<line x1="'+padL+'" y1="'+base+'" x2="'+(W-padR)+'" y2="'+base+'" stroke="var(--border)" stroke-width="1"/>';
  t.forEach(function(item,i){
    var h=Math.max(3,(item.count||0)/max*(base-top));
    var x=padL+i*sw+sw*0.25;
    var w=sw*0.5;
    svg+='<rect x="'+x+'" y="'+(base-h)+'" width="'+w+'" height="'+h+'" rx="4" fill="var(--brand-l)"/>';
    svg+='<text x="'+(x+w/2)+'" y="'+(base+16)+'" text-anchor="middle" font-size="11" fill="var(--text-t)">'+escapeHtml(item.code)+'</text>';
    svg+='<text x="'+(x+w/2)+'" y="'+(base+30)+'" text-anchor="middle" font-size="10" fill="var(--text-s)" font-weight="500">'+escapeHtml(item.name||'')+'</text>';
    svg+='<text x="'+(x+w/2)+'" y="'+(base-h-6)+'" text-anchor="middle" font-size="11" fill="var(--brand)">'+(item.count||0)+'</text>';
  });
  svg+='<text x="4" y="'+(top+4)+'" font-size="10" fill="var(--text-t)">'+max+'</text>';
  return svg;
}
