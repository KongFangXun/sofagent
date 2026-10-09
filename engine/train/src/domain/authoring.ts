// ============================================================
// domain/authoring.ts · 配方与诊断域（模板 / 配方 / 分析 / 诊断 / 试跑 / 算力外推）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/train/domain/authoring），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/authoring"。
// ============================================================
/* @public */ export {
  analyzeTrainNeed,
  deriveTrainScenario,
  findInterviewNode,
  pickDefaultTemplate,
  saveTrainAnalyzeReport,
  trainAnalyzeReportPath,
} from '../train-analyze';
/* @public */ export type {
  TrainGoalDerivation,
  TrainAnalyzeResult,
  TrainAnalyzeOptions,
} from '../train-analyze';
/* @public */ export {
  TRAIN_SCENARIO_TEMPLATES,
  SCENARIO_MATCH_HINTS,
  findTrainTemplate,
  listTrainTemplates,
  loadExternalRecipes,
  instantiateTrainTemplate,
  validateMoeTargetModules,
  MOE_REQUIRED_EXPERT_MODULES,
} from '../train-templates';
/* @public */ export type {
  TrainScenario,
  TrainMethod,
  TrainScenarioTemplate,
  InstantiateTrainTemplateInput,
  QloraTemplateInstance,
  PlainTemplateInstance,
  TrainTemplateInstance,
  MoeValidationResult,
  MoeValidationError,
  MoeValidationOk,
  LoadExternalRecipesResult,
} from '../train-templates';
/* @public */ export {
  instantiateRlTemplate,
  findRlTemplate,
  listRlTemplates,
  registerRlRecipes,
  SCALE_ADVANTAGE_NORMALIZATION,
  SCALE_CISPO_CLIP_EPS,
  SCALE_SKIP_ZERO_VARIANCE,
  SCALE_WARMUP_RATIO,
} from '../rl-templates';
/* @public */ export type {
  RlTemplate,
  RlRecipeId,
  RlTemplateInstance,
  RlTemplateInstantiateInput,
} from '../rl-templates';
/* @public */ export {
  buildQloraTemplate,
  DENSE_TARGET_MODULES,
  MOE_TARGET_MODULES,
} from '../qlora-template';
/* @public */ export type {
  QloraTemplateInput,
  QloraOumiConfig,
} from '../qlora-template';
/* @public */ export {
  diagnoseTrainFailure,
  classifyTrainFailure,
  saveTrainDiagnoseReport,
  trainDiagnoseReportPath,
  FAILURE_CATEGORIES,
  FAILURE_PRESCRIPTIONS,
} from '../train-diagnose';
/* @public */ export type {
  TrainFailureCategory,
  FailureCategoryDef,
  FailurePrescription,
  DiagnoseContext,
  TrainDiagnoseReport,
} from '../train-diagnose';
/* @public */ export {
  estimateVram,
  runDryrun,
} from '../train-dryrun';
/* @public */ export type {
  VramEstimateInput,
  VramEstimate,
  DryrunCheck,
  DryrunResult,
  DryrunInput,
} from '../train-dryrun';
/* @public */ export {
  sigmoid,
  fitSigmoid,
  extrapolate,
  suggestNextPilotCompute,
} from '../scale-curve';
/* @public */ export type {
  ScaleCurvePoint,
  SigmoidParams,
  FitQuality,
  FitResult,
  Extrapolation,
} from '../scale-curve';
