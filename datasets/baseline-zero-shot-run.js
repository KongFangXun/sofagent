
const { JudgeRuntime } = require("/Users/kongfangxun/WorkBuddy/sofagent/engine/orchestrator/dist/router/judge-runtime.js");
const { evaluateZeroShot } = require("/Users/kongfangxun/WorkBuddy/sofagent/engine/orchestrator/dist/router/judge-eval.js");
const enc = {
  modelRevision: "mock-contract-v1",
  maxContextTokens: 512,
  encode: (s) => [...s].map((ch) => [ch.charCodeAt(0), 1]),
  isSingleToken: (t) => t.length <= 8,
  decodeToken: (t) => String.fromCharCode(t),
};
const rt = new JudgeRuntime(enc);
const mk = (state, lang, truth) => ({
  state, questions: [{ kind: "noul", id: "q-block", question: "该变更应拦截吗？" }],
  answers: [{ kind: "noul", questionId: "q-block", probability: truth }],
  label: { source: "deterministic" }, provenance: { traceId: "t-" + state },
  enterpriseId: "self", lang,
});
const ds = [
  mk("+const secret = AKIA...", "zh", 0.95), mk("+const x = 1;", "zh", 0.1),
  mk("+add hardcoded password", "en", 0.9), mk("+refactor rename", "en", 0.15),
  mk("+delete config.yml", "zh", 0.85), mk("+update docs", "en", 0.2),
];
const r = evaluateZeroShot(rt, ds);
console.log(JSON.stringify({
  perCriterion: r.perCriterion.map(c => ({ id: c.criterionId, acc: +c.accuracy.toFixed(3), zh: +c.accuracyByLang.zh.toFixed(3), en: +c.accuracyByLang.en.toFixed(3), n: c.count })),
  ece: +r.calibration.ece.toFixed(3), eceZh: +r.calibration.eceByLang.zh.toFixed(3), eceEn: +r.calibration.eceByLang.en.toFixed(3),
  inDist: +r.inDistributionAccuracy.toFixed(3), outDist: +r.outOfDistributionAccuracy.toFixed(3),
  zhEnGap: +r.zhEnGap.toFixed(3), zhUsable: r.zhUsable,
  ms: r.runtime.elapsedMs, caveat: r.caveat,
  failuresZh: r.failuresByLang.zh.map(f => f.criterionId + ":" + f.mode),
  failuresEn: r.failuresByLang.en.map(f => f.criterionId + ":" + f.mode),
}, null, 1));
