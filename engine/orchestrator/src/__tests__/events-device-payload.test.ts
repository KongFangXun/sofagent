// ============================================================
// events-device-payload.test.ts · 设备面 payload 契约登记（v1.5.1 收口①）
// ============================================================
//
// 判定标准是「**同一契约只有一处定义**」：三个设备事件 payload 的唯一定义在
// `events/types.ts`，消费侧（daemon 设备订阅 / MCP 下发）从包入口 import，
// 不再各自复制一份本地类型。
//
// 本文件把「契约长什么样」钉成可执行断言——字段名一旦漂移，
// 两侧同时改才能过（这正是「两处定义」要防的静默失效）。
//
// 断言面：
//   ① 三个 payload 与支撑类型都从**包入口**（../index）可导入（barrel 导出在位）；
//   ② 字段名与消费侧读法逐一对应（构造满值对象后核对键集）；
//   ③ 三个事件类型常量在 EVENT_TYPES / REGISTERED_EVENT_TYPES 内
//      （否则节点 `on: device.upgrade` 会被 router 的类型门拒绝）。
//
// ⚠️ 未纳入本文件：daemon 侧本地副本是否已删除——那是跨包消费侧的改造，
// 由收货方（dev-device）完成；本文件只钉住**提供侧**的契约面。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPES,
  REGISTERED_EVENT_TYPES,
  type DeviceDeployPayload,
  type DeviceDeliverySignature,
  type DeviceTaskDispatchPayload,
  type DeviceTaskItem,
  type DeviceUpgradeComponent,
  type DeviceUpgradePayload,
  type DeviceUpgradeRollout,
  type DeviceUpgradeTier,
} from '../index';

/** 键集快照（按字典序，便于比对） */
function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

describe('收口① · 设备面 payload 契约（唯一定义在 events/types.ts）', () => {
  it('三个 payload 与支撑类型均可从包入口导入，且字段名与消费侧读法一致', () => {
    const tier: DeviceUpgradeTier = 'non-core';
    const component: DeviceUpgradeComponent = {
      name: 'core-runtime',
      version: '1.5.1',
      tier,
      artifact: 'npm:@sofagent/core@1.5.1',
      content: 'inline-bytes',
    };
    const rollout: DeviceUpgradeRollout = { percentage: 20, batchSize: 2 };
    const signature: DeviceDeliverySignature = {
      principal: 'enterprise-a',
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(32),
      constraintVersion: 1,
      responsibility: 'device.upgrade|sha256=deadbeef',
    };

    const upgrade: DeviceUpgradePayload = {
      targetVersion: '1.5.1',
      components: [component],
      rollout,
      deadline: '2026-12-31T00:00:00.000Z',
      signature,
    };
    // 四要素：目标版本 + 组件清单 + 灰度策略 + 截止窗口（+ 交付签名信封）
    expect(keysOf(upgrade)).toEqual(['components', 'deadline', 'rollout', 'signature', 'targetVersion']);
    expect(keysOf(component)).toEqual(['artifact', 'content', 'name', 'tier', 'version']);
    expect(keysOf(rollout)).toEqual(['batchSize', 'percentage']);

    const deploy: DeviceDeployPayload = {
      targetDevice: 'device-001',
      bundleId: 'bundle-7',
      bundle: { manifest: {}, 'workflow.yml': 'name: x' },
      importedAs: 'x-imported',
      signature,
    };
    // 同构平台 → 设备内容下发（携 skill/workflow 模板包）
    expect(keysOf(deploy)).toEqual(['bundle', 'bundleId', 'importedAs', 'signature', 'targetDevice']);

    const task: DeviceTaskItem = { title: '巡检', payload: 'run inspect', dispatchedBy: 'orchestrator' };
    const dispatch: DeviceTaskDispatchPayload = {
      targetDevice: 'device-001',
      tasks: [task],
      ttlMs: 60_000,
    };
    // 任务清单 + 目标设备 + 时效
    expect(keysOf(dispatch)).toEqual(['targetDevice', 'tasks', 'ttlMs']);
    expect(keysOf(task)).toEqual(['dispatchedBy', 'payload', 'title']);

    // 最小必需字段（其余可缺省——消费侧对所有可选字段都有缺省路径）
    const minimalUpgrade: DeviceUpgradePayload = { targetVersion: '1.5.1', components: [], rollout: {} };
    expect(keysOf(minimalUpgrade)).toEqual(['components', 'rollout', 'targetVersion']);
    const minimalDispatch: DeviceTaskDispatchPayload = { tasks: [] };
    expect(keysOf(minimalDispatch)).toEqual(['tasks']);
  });

  it('三个事件类型常量在注册表内（节点 on: device.* 才不会被类型门拒绝）', () => {
    expect(EVENT_TYPES.DEVICE_UPGRADE).toBe('device.upgrade');
    expect(EVENT_TYPES.DEVICE_DEPLOY).toBe('device.deploy');
    expect(EVENT_TYPES.DEVICE_TASK_DISPATCH).toBe('device.task.dispatch');
    for (const t of [EVENT_TYPES.DEVICE_UPGRADE, EVENT_TYPES.DEVICE_DEPLOY, EVENT_TYPES.DEVICE_TASK_DISPATCH]) {
      expect(REGISTERED_EVENT_TYPES).toContain(t);
    }
  });

  it('与第一章三类触发源共用同一注册表（不另立事件名事实源）', () => {
    // 8 个已登记类型：3（第一/三章）+ 3（设备面）+ timer.tick + anomaly.reported
    expect([...REGISTERED_EVENT_TYPES].sort()).toEqual(
      [
        EVENT_TYPES.ANOMALY_REPORTED,
        EVENT_TYPES.DEVICE_DEPLOY,
        EVENT_TYPES.DEVICE_TASK_DISPATCH,
        EVENT_TYPES.DEVICE_UPGRADE,
        EVENT_TYPES.NODE_OUTPUT,
        EVENT_TYPES.TIMER_TICK,
        EVENT_TYPES.WEBHOOK_FORM,
        EVENT_TYPES.WEBHOOK_IM,
      ].sort(),
    );
    expect(new Set(REGISTERED_EVENT_TYPES).size).toBe(REGISTERED_EVENT_TYPES.length);
  });
});
