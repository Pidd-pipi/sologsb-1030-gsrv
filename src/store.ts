import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialState } from './data';
import { ROLE_LABELS, ROLE_PERMISSIONS } from './types';
import type { ChecklistItem, ChecklistProject, ChecklistRevision, FlightStage, Permission, Role, SignOff, WorkflowStatus, WorkspaceState } from './types';

const STORAGE_KEY = 'sologsb-1030-workspace-v1';
const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

const STATUS_LABELS: Record<WorkflowStatus, string> = { draft: '编辑中', review: '复核中', frozen: '已冻结' };

const PERMISSION_LABELS: Record<Permission, string> = {
  'item:write': '维护检查项',
  'stage:write': '整理飞行阶段',
  'project:write': '修改项目资料',
  'signoff:manage': '签认关键项',
  'workflow:submit': '提交复核',
  'workflow:freeze': '冻结版本',
  'workflow:revise': '创建修订'
};

/** 关键项签认指纹：内容、顺序（含阶段）、前置条件或关键标记任一改动都会变化。。 */
export function signOffHash(item: ChecklistItem): string {
  const payload = JSON.stringify({
    challenge: item.challenge,
    response: item.response,
    abnormalProcedure: item.abnormalProcedure,
    order: item.order,
    stageId: item.stageId,
    preconditionIds: [...item.preconditionIds].sort(),
    critical: item.critical
  });
  let h = 0;
  for (let i = 0; i < payload.length; i += 1) {
    h = (Math.imul(h, 31) + payload.charCodeAt(i)) | 0;
  }
  return `s${(h >>> 0).toString(36)}`;
}

/** 对比改动前后的关键项，给出失效原因。 */
function changeReason(before: ChecklistItem, after: ChecklistItem): string {
  const reasons: string[] = [];
  if (JSON.stringify([...before.preconditionIds].sort()) !== JSON.stringify([...after.preconditionIds].sort())) reasons.push('前置条件已变更');
  if (before.order !== after.order || before.stageId !== after.stageId) reasons.push('顺序已调整');
  if (before.challenge !== after.challenge || before.response !== after.response || before.abnormalProcedure !== after.abnormalProcedure) reasons.push('内容已变更');
  if (before.critical !== after.critical) reasons.push('关键标记已变更');
  return reasons.length ? reasons.join('；') : '检查项已变更';
}

function invalidateSignOffs(project: ChecklistProject, itemId: string, reason: string) {
  project.signOffs.forEach((signOff) => {
    if (signOff.itemId === itemId && signOff.valid) {
      signOff.valid = false;
      signOff.invalidReason = reason;
      signOff.invalidAt = now();
    }
  });
}

function snapshotCriticalHashes(project: ChecklistProject): Map<string, string> {
  return new Map(project.items.filter((item) => item.critical).map((item) => [item.id, signOffHash(item)]));
}

function invalidateChangedSignOffs(project: ChecklistProject, before: Map<string, string>, reason: string) {
  project.items.forEach((item) => {
    if (item.critical && before.get(item.id) !== signOffHash(item)) {
      invalidateSignOffs(project, item.id, reason);
    }
  });
}

export function isItemSigned(project: ChecklistProject, item: ChecklistItem): boolean {
  return project.signOffs.some((signOff) => signOff.itemId === item.id && signOff.valid && signOff.hash === signOffHash(item));
}

function loadState(): WorkspaceState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as WorkspaceState;
      if (parsed.schemaVersion === 1 && parsed.projects?.length) {
        parsed.currentRole ??= 'captain';
        parsed.projects.forEach((project) => { project.signOffs ??= []; });
        return parsed;
      }
    }
  } catch {
    // Corrupted local draft falls back to the bundled operational checklist.
  }
  return createInitialState();
}

function updateSelected(state: WorkspaceState, mutator: (project: ChecklistProject) => void): WorkspaceState {
  const next = clone(state);
  const project = next.projects.find((entry) => entry.id === next.selectedProjectId);
  if (project) {
    mutator(project);
    project.updatedAt = now();
  }
  return next;
}

export function useChecklistStore() {
  const [state, setState] = useState<WorkspaceState>(loadState);
  const [actionError, setActionError] = useState<string | null>(null);
  const past = useRef<WorkspaceState[]>([]);
  const future = useRef<WorkspaceState[]>([]);
  const errorTimer = useRef<number | undefined>(undefined);
  const [, forceHistoryState] = useState(0);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const reject = useCallback((message: string) => {
    setActionError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setActionError(null), 3600);
  }, []);

  /** 权限与状态守卫：越权或状态不符时拒绝并提示，返回 null。 */
  const guard = useCallback((permission: Permission, allowedStatuses: WorkflowStatus[]) => {
    const current = stateRef.current;
    const project = current.projects.find((entry) => entry.id === current.selectedProjectId);
    if (!project) return null;
    if (!ROLE_PERMISSIONS[current.currentRole].includes(permission)) {
      reject(`越权操作已拒绝：${ROLE_LABELS[current.currentRole]}无权执行「${PERMISSION_LABELS[permission]}」。`);
      return null;
    }
    if (!allowedStatuses.includes(project.status)) {
      reject(`当前处于「${STATUS_LABELS[project.status]}」状态，不允许「${PERMISSION_LABELS[permission]}」。`);
      return null;
    }
    return { project, role: current.currentRole };
  }, [reject]);

  const commit = useCallback((mutator: (project: ChecklistProject) => void) => {
    setState((current) => {
      past.current = [...past.current.slice(-39), clone(current)];
      future.current = [];
      forceHistoryState((value) => value + 1);
      return updateSelected(current, mutator);
    });
  }, []);

  const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) ?? state.projects[0];

  const selectProject = useCallback((id: string) => {
    setState((current) => ({ ...current, selectedProjectId: id }));
  }, []);

  const setRole = useCallback((role: Role) => {
    setState((current) => ({ ...current, currentRole: role }));
  }, []);

  const can = useCallback((permission: Permission) => ROLE_PERMISSIONS[state.currentRole].includes(permission), [state.currentRole]);

  const addProject = useCallback(() => {
    const id = uid('project');
    setState((current) => {
      past.current = [...past.current.slice(-39), clone(current)];
      future.current = [];
      const next = clone(current);
      next.projects.push({
        id,
        name: 'Untitled checklist',
        aircraft: '新机型',
        revision: 1,
        status: 'draft',
        updatedAt: now(),
        reviewNote: '',
        stages: [{ id: uid('stage'), name: '飞行前检查', order: 0, description: '说明本阶段目标。' }],
        items: [],
        revisions: [],
        signOffs: []
      });
      next.selectedProjectId = id;
      return next;
    });
  }, []);

  const updateProject = useCallback((patch: Partial<ChecklistProject>) => {
    if (!guard('project:write', ['draft'])) return;
    commit((project) => { Object.assign(project, patch); });
  }, [guard, commit]);

  const addStage = useCallback(() => {
    if (!guard('stage:write', ['draft'])) return;
    commit((project) => {
      project.stages.push({ id: uid('stage'), name: '新飞行阶段', order: project.stages.length, description: '描述阶段目标和适用条件。' });
    });
  }, [guard, commit]);

  const updateStage = useCallback((stageId: string, patch: Partial<FlightStage>) => {
    if (!guard('stage:write', ['draft'])) return;
    commit((project) => {
      const stage = project.stages.find((entry) => entry.id === stageId);
      if (stage) Object.assign(stage, patch);
    });
  }, [guard, commit]);

  const moveStage = useCallback((stageId: string, direction: -1 | 1) => {
    if (!guard('stage:write', ['draft'])) return;
    commit((project) => {
      project.stages.sort((a, b) => a.order - b.order);
      const index = project.stages.findIndex((entry) => entry.id === stageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= project.stages.length) return;
      [project.stages[index], project.stages[target]] = [project.stages[target], project.stages[index]];
      project.stages.forEach((entry, order) => { entry.order = order; });
    });
  }, [guard, commit]);

  const deleteStage = useCallback((stageId: string) => {
    if (!guard('stage:write', ['draft'])) return;
    commit((project) => {
      if (project.items.some((item) => item.stageId === stageId)) return;
      project.stages = project.stages.filter((stage) => stage.id !== stageId).sort((a, b) => a.order - b.order);
      project.stages.forEach((stage, order) => { stage.order = order; });
    });
  }, [guard, commit]);

  const addItem = useCallback((stageId: string, challenge = '', response = '') => {
    if (!guard('item:write', ['draft'])) return '';
    const id = uid('item');
    commit((project) => {
      const stage = project.stages.find((entry) => entry.id === stageId);
      if (!stage) return;
      const order = project.items.filter((item) => item.stageId === stageId).length;
      project.items.push({ id, stageId, order, challenge, response, critical: false, preconditionIds: [], abnormalProcedure: '', updatedAt: now() });
    });
    return id;
  }, [guard, commit]);

  const updateItem = useCallback((itemId: string, patch: Partial<ChecklistItem>) => {
    if (!guard('item:write', ['draft'])) return;
    commit((project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const before = clone(item);
      Object.assign(item, patch, { updatedAt: now() });
      if (before.critical || item.critical) {
        if (signOffHash(before) !== signOffHash(item)) {
          invalidateSignOffs(project, itemId, changeReason(before, item));
        }
      }
    });
  }, [guard, commit]);

  const deleteItem = useCallback((itemId: string) => {
    if (!guard('item:write', ['draft'])) return;
    commit((project) => {
      const beforeHashes = snapshotCriticalHashes(project);
      project.items = project.items.filter((item) => item.id !== itemId);
      project.items.forEach((item) => { item.preconditionIds = item.preconditionIds.filter((id) => id !== itemId); });
      project.stages.forEach((stage) => {
        project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).forEach((item, order) => { item.order = order; });
      });
      // 被删除项的签认失效；其余项因前置条件被清理而失效。
      project.signOffs.forEach((signOff) => {
        if (signOff.itemId === itemId && signOff.valid) {
          signOff.valid = false;
          signOff.invalidReason = '检查项已删除';
          signOff.invalidAt = now();
        }
      });
      invalidateChangedSignOffs(project, beforeHashes, '前置条件已变更');
    });
  }, [guard, commit]);

  const reorderItem = useCallback((sourceId: string, targetId: string, before = true) => {
    if (!guard('item:write', ['draft'])) return;
    commit((project) => {
      const source = project.items.find((item) => item.id === sourceId);
      const target = project.items.find((item) => item.id === targetId);
      if (!source || !target || source.id === target.id) return;
      const beforeHashes = snapshotCriticalHashes(project);
      source.stageId = target.stageId;
      const siblings = project.items.filter((item) => item.stageId === target.stageId && item.id !== source.id).sort((a, b) => a.order - b.order);
      const targetIndex = siblings.findIndex((item) => item.id === target.id);
      siblings.splice(Math.max(0, targetIndex + (before ? 0 : 1)), 0, source);
      siblings.forEach((item, order) => { item.order = order; });
      invalidateChangedSignOffs(project, beforeHashes, '顺序已调整');
    });
  }, [guard, commit]);

  const nudgeItem = useCallback((itemId: string, direction: -1 | 1) => {
    if (!guard('item:write', ['draft'])) return;
    commit((project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const beforeHashes = snapshotCriticalHashes(project);
      const siblings = project.items.filter((entry) => entry.stageId === item.stageId).sort((a, b) => a.order - b.order);
      const index = siblings.findIndex((entry) => entry.id === itemId);
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;
      [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      siblings.forEach((entry, order) => { entry.order = order; });
      invalidateChangedSignOffs(project, beforeHashes, '顺序已调整');
    });
  }, [guard, commit]);

  const signOffItem = useCallback((itemId: string) => {
    const checked = guard('signoff:manage', ['draft', 'review']);
    if (!checked) return;
    const { role } = checked;
    commit((project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item || !item.critical) return;
      const existing = project.signOffs.find((signOff) => signOff.itemId === itemId);
      if (existing) {
        existing.signedBy = role;
        existing.signedAt = now();
        existing.hash = signOffHash(item);
        existing.valid = true;
        existing.invalidReason = undefined;
        existing.invalidAt = undefined;
      } else {
        const record: SignOff = { itemId, signedBy: role, signedAt: now(), hash: signOffHash(item), valid: true };
        project.signOffs.push(record);
      }
    });
  }, [guard, commit]);

  const revokeSignOff = useCallback((itemId: string) => {
    if (!guard('signoff:manage', ['draft', 'review'])) return;
    commit((project) => {
      project.signOffs = project.signOffs.filter((signOff) => signOff.itemId !== itemId);
    });
  }, [guard, commit]);

  const submitForReview = useCallback(() => {
    if (!guard('workflow:submit', ['draft'])) return;
    commit((project) => {
      project.status = 'review';
      project.reviewNote = '';
    });
  }, [guard, commit]);

  const returnToDraft = useCallback(() => {
    if (!guard('workflow:submit', ['review'])) return;
    commit((project) => {
      project.status = 'draft';
      project.reviewNote = '';
    });
  }, [guard, commit]);

  const freezeRevision = useCallback((note: string) => {
    const checked = guard('workflow:freeze', ['review']);
    if (!checked) return;
    const { project, role } = checked;
    const criticalItems = project.items.filter((item) => item.critical);
    if (criticalItems.length === 0) {
      reject('没有关键项，无法冻结。');
      return;
    }
    const unsigned = criticalItems.filter((item) => !isItemSigned(project, item));
    if (unsigned.length > 0) {
      reject(`还有 ${unsigned.length} 个关键项未签认，重新确认前不能冻结。`);
      return;
    }
    commit((draft) => {
      const snapshot: ChecklistRevision = {
        id: uid('revision'),
        revision: draft.revision,
        status: 'frozen',
        createdAt: now(),
        note: note.trim() || '复核通过并冻结',
        stages: clone(draft.stages),
        items: clone(draft.items),
        signOffs: clone(draft.signOffs),
        frozenBy: role
      };
      draft.revisions.unshift(snapshot);
      draft.status = 'frozen';
      draft.reviewNote = note.trim();
    });
  }, [guard, commit, reject]);

  const createRevision = useCallback(() => {
    if (!guard('workflow:revise', ['frozen'])) return;
    commit((project) => {
      project.revision += 1;
      project.status = 'draft';
      project.reviewNote = '';
      project.signOffs = [];
      project.updatedAt = now();
    });
  }, [guard, commit]);

  const undo = useCallback(() => {
    setState((current) => {
      const previous = past.current.pop();
      if (!previous) return current;
      future.current = [clone(current), ...future.current].slice(0, 40);
      forceHistoryState((value) => value + 1);
      return { ...previous, currentRole: current.currentRole };
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = future.current.shift();
      if (!next) return current;
      past.current = [...past.current.slice(-39), clone(current)];
      forceHistoryState((value) => value + 1);
      return { ...next, currentRole: current.currentRole };
    });
  }, []);

  const saveNow = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setState((current) => updateSelected(current, () => undefined));
  }, [state]);

  const criticalItems = selectedProject.items.filter((item) => item.critical);
  const allCriticalSigned = criticalItems.length > 0 && criticalItems.every((item) => isItemSigned(selectedProject, item));

  return {
    state,
    selectedProject,
    actionError,
    currentRole: state.currentRole,
    can,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    criticalItems,
    allCriticalSigned,
    selectProject,
    setRole,
    addProject,
    updateProject,
    addStage,
    updateStage,
    moveStage,
    deleteStage,
    addItem,
    updateItem,
    deleteItem,
    reorderItem,
    nudgeItem,
    signOffItem,
    revokeSignOff,
    submitForReview,
    returnToDraft,
    freezeRevision,
    createRevision,
    undo,
    redo,
    saveNow
  };
}
