import { roleMeta } from './rbac';
import type {
  ChecklistItem,
  ChecklistProject,
  CriticalSignoff,
  FlightStage,
  SignoffBasis,
  SignoffInvalidReason
} from './types';

export const invalidReasonMeta: Record<SignoffInvalidReason, { label: string; detail: string }> = {
  content: { label: '内容改动', detail: '关键项挑战语、预期回应、异常处置或关键标记发生改动' },
  order: { label: '顺序改动', detail: '关键项在阶段内的位置或所属飞行阶段发生改动' },
  precondition: { label: '前置条件改动', detail: '关键项的前置条件集合发生改动' }
};

export function buildBasis(item: ChecklistItem, stages: FlightStage[]): SignoffBasis {
  const stage = stages.find((entry) => entry.id === item.stageId);
  return {
    challenge: item.challenge,
    response: item.response,
    critical: item.critical,
    abnormalProcedure: item.abnormalProcedure,
    preconditionIds: [...item.preconditionIds],
    stageId: item.stageId,
    order: item.order,
    stageOrder: stage?.order ?? -1
  };
}

function reasonFor(before: SignoffBasis, after: SignoffBasis): SignoffInvalidReason[] {
  const reasons: SignoffInvalidReason[] = [];
  const contentChanged = before.challenge !== after.challenge
    || before.response !== after.response
    || before.critical !== after.critical
    || before.abnormalProcedure !== after.abnormalProcedure;
  const orderChanged = before.order !== after.order
    || before.stageId !== after.stageId
    || before.stageOrder !== after.stageOrder;
  const preconditionChanged = before.preconditionIds.join('|') !== after.preconditionIds.join('|');
  if (contentChanged) reasons.push('content');
  if (orderChanged) reasons.push('order');
  if (preconditionChanged) reasons.push('precondition');
  return reasons;
}

/**
 * 关键项内容、顺序或前置条件任一改动后，原签认立即失效。
 * 被删除的关键项同样按“内容改动（检查项已删除）”处理；
 * 非关键项（关键标记被取消）的签认也立即作废。
 */
export function reconcileSignoffs(project: ChecklistProject, at: string): CriticalSignoff[] {
  const itemById = new Map(project.items.map((item) => [item.id, item]));
  return project.signoffs.map((signoff) => {
    if (signoff.invalidated) return signoff;
    const item = itemById.get(signoff.itemId);
    if (!item) {
      return {
        ...signoff,
        invalidated: true,
        invalidReasons: ['content'],
        invalidDetail: '检查项已删除，签认依据不再存在。',
        invalidatedAt: at
      };
    }
    const reasons = reasonFor(signoff.basis, buildBasis(item, project.stages));
    if (!reasons.length) return signoff;
    const detail = reasons.map((reason) => invalidReasonMeta[reason].detail).join('；') + '，原签认失效，需复核员重新确认。';
    return { ...signoff, invalidated: true, invalidReasons: reasons, invalidDetail: detail, invalidatedAt: at };
  });
}

/** 当前仍有效的最新签认；最新一条记录已失效时返回 undefined。 */
export function activeSignoff(project: Pick<ChecklistProject, 'signoffs'>, itemId: string): CriticalSignoff | undefined {
  const last = latestSignoff(project, itemId);
  return last && !last.invalidated ? last : undefined;
}

/** 关键项最近一次签认记录（可能已失效）；记录按时间追加，取最后一条。 */
export function latestSignoff(project: Pick<ChecklistProject, 'signoffs'>, itemId: string): CriticalSignoff | undefined {
  for (let index = project.signoffs.length - 1; index >= 0; index -= 1) {
    const signoff = project.signoffs[index];
    if (signoff.itemId === itemId) return signoff;
  }
  return undefined;
}

export function signoffHistory(project: Pick<ChecklistProject, 'signoffs'>, itemId: string): CriticalSignoff[] {
  return project.signoffs.filter((signoff) => signoff.itemId === itemId);
}

export interface FreezeBlocker {
  itemId: string;
  challenge: string;
  signoff?: CriticalSignoff;
  reason: string;
}

/** 冻结门槛：关键项必须逐条持有当前修订下的有效签认。 */
export function freezeBlockers(project: ChecklistProject): FreezeBlocker[] {
  return project.items
    .filter((item) => item.critical)
    .map((item): FreezeBlocker | undefined => {
      const signoff = activeSignoff(project, item.id);
      if (signoff) return undefined;
      const last = latestSignoff(project, item.id);
      return {
        itemId: item.id,
        challenge: item.challenge || '未命名检查项',
        signoff: last,
        reason: last?.invalidated
          ? `原签认因${(last.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、')}已失效，需重新确认`
          : '关键项尚未经复核员签认'
      };
    })
    .filter((blocker): blocker is FreezeBlocker => Boolean(blocker));
}

export interface CriticalBatch {
  /** 全局批次序号（按执行顺序，自 1 起）。 */
  batchNo: number;
  stageId: string;
  stageName: string;
  items: ChecklistItem[];
  signed: boolean;
}

export interface BatchPlan {
  batches: CriticalBatch[];
  signedBatches: number;
  /** 已连续签认通过的批次数；其后批次即使签过也因重算视为不可执行。 */
  executableBatches: number;
}

/**
 * 重算可执行批次：按执行顺序（飞行阶段 → 阶段内序号）把关键项分组，
 * 相邻关键项归为同一批次；批次内全部有效签认才算通过。
 */
export function computeCriticalBatches(project: ChecklistProject): BatchPlan {
  const stageById = new Map(project.stages.map((stage) => [stage.id, stage]));
  const ordered = project.items
    .slice()
    .sort((a, b) => {
      const stageDelta = (stageById.get(a.stageId)?.order ?? 0) - (stageById.get(b.stageId)?.order ?? 0);
      return stageDelta !== 0 ? stageDelta : a.order - b.order;
    });

  const groups: ChecklistItem[][] = [];
  let previousCritical = false;
  for (const item of ordered) {
    if (!item.critical) {
      previousCritical = false;
      continue;
    }
    if (!previousCritical) groups.push([]);
    groups[groups.length - 1].push(item);
    previousCritical = true;
  }

  const batches: CriticalBatch[] = groups.map((items, index) => ({
    batchNo: index + 1,
    stageId: items[0].stageId,
    stageName: stageById.get(items[0].stageId)?.name ?? '未分配阶段',
    items,
    signed: items.every((item) => Boolean(activeSignoff(project, item.id)))
  }));

  let executableBatches = 0;
  for (const batch of batches) {
    if (!batch.signed) break;
    executableBatches += 1;
  }
  return { batches, signedBatches: batches.filter((batch) => batch.signed).length, executableBatches };
}

export function describeSigner(signoff: CriticalSignoff): string {
  return `${roleMeta[signoff.signedBy.role].label}${signoff.signedBy.name ? ` ${signoff.signedBy.name}` : ''}`;
}
