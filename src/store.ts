import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialState } from './data';
import { can, permissionDeniedMessage, type Permission } from './rbac';
import { buildBasis, freezeBlockers, reconcileSignoffs } from './signoff';
import { validateProject } from './validation';
import type {
  Actor,
  ChecklistItem,
  ChecklistProject,
  ChecklistRevision,
  CriticalSignoff,
  FlightStage,
  Role,
  WorkspaceState
} from './types';

const STORAGE_KEY = 'sologsb-1030-workspace-v1';
const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

/** 旧记录缺少角色/签认字段时补齐：旧冻结修订标记 legacy，仅可只读查看。 */
function migrateState(parsed: WorkspaceState): WorkspaceState {
  parsed.projects.forEach((project) => {
    project.signoffs ??= [];
    project.revisions.forEach((revision) => {
      if (!revision.signoffs) {
        revision.signoffs = [];
        revision.legacy = true;
      }
    });
  });
  return parsed;
}

function loadState(): WorkspaceState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as WorkspaceState;
      if (parsed.schemaVersion === 1 && parsed.projects?.length) return migrateState(parsed);
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

/** 编辑历史快照只含可编辑内容；撤销/重做不得影响角色签认与工作流状态。 */
interface EditableSnapshot {
  selectedProjectId: string;
  name: string;
  aircraft: string;
  stages: FlightStage[];
  items: ChecklistItem[];
}

function takeEditableSnapshot(state: WorkspaceState): EditableSnapshot | null {
  const project = state.projects.find((entry) => entry.id === state.selectedProjectId);
  if (!project) return null;
  return {
    selectedProjectId: project.id,
    name: project.name,
    aircraft: project.aircraft,
    stages: clone(project.stages),
    items: clone(project.items)
  };
}

function restoreEditableSnapshot(state: WorkspaceState, snapshot: EditableSnapshot): WorkspaceState {
  const next = clone(state);
  const project = next.projects.find((entry) => entry.id === snapshot.selectedProjectId);
  if (project) {
    project.name = snapshot.name;
    project.aircraft = snapshot.aircraft;
    project.stages = clone(snapshot.stages);
    project.items = clone(snapshot.items);
    project.signoffs = reconcileSignoffs(project, now());
    project.updatedAt = now();
  }
  return next;
}

export interface DeniedNotice {
  id: number;
  message: string;
}

export function useChecklistStore() {
  const [state, setState] = useState<WorkspaceState>(loadState);
  const [role, setRole] = useState<Role>(() => (localStorage.getItem('sologsb-1030-role') as Role) || 'captain');
  const [denied, setDenied] = useState<DeniedNotice | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const past = useRef<EditableSnapshot[]>([]);
  const future = useRef<EditableSnapshot[]>([]);
  const [, forceHistoryState] = useState(0);
  const denyId = useRef(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem('sologsb-1030-role', role);
  }, [role]);

  const raiseDenied = useCallback((permission: Permission) => {
    denyId.current += 1;
    setDenied({ id: denyId.current, message: permissionDeniedMessage(role, permission) });
  }, [role]);

  const pushHistory = useCallback((current: WorkspaceState) => {
    const snapshot = takeEditableSnapshot(current);
    if (!snapshot) return;
    past.current = [...past.current.slice(-39), snapshot];
    future.current = [];
    forceHistoryState((value) => value + 1);
  }, []);

  /** 工作流状态边界：签认/复核/冻结不属于可撤销编辑，清空历史防止借撤销跨角色回退。 */
  const clearHistory = useCallback(() => {
    past.current = [];
    future.current = [];
    forceHistoryState((value) => value + 1);
  }, []);

  /** 编辑类操作：仅 draft 可改，按角色权限放行；改动后立即重算签认有效性。 */
  const commit = useCallback((permission: Permission, mutator: (project: ChecklistProject) => void): boolean => {
    if (!can(role, permission)) {
      raiseDenied(permission);
      return false;
    }
    if (stateRef.current.projects.find((entry) => entry.id === stateRef.current.selectedProjectId)?.status !== 'draft') {
      return false;
    }
    setState((current) => {
      pushHistory(current);
      return updateSelected(current, (project) => {
        if (project.status !== 'draft') return;
        mutator(project);
        project.signoffs = reconcileSignoffs(project, now());
      });
    });
    return true;
  }, [role, raiseDenied, pushHistory]);

  const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) ?? state.projects[0];

  const selectProject = useCallback((id: string) => {
    clearHistory();
    setState((current) => ({ ...current, selectedProjectId: id }));
  }, [clearHistory]);

  const selectRole = useCallback((next: Role) => setRole(next), []);

  const addProject = useCallback(() => {
    clearHistory();
    setState((current) => {
      const next = clone(current);
      next.projects.push({
        id: uid('project'),
        name: 'Untitled checklist',
        aircraft: '新机型',
        revision: 1,
        status: 'draft',
        updatedAt: now(),
        reviewNote: '',
        stages: [{ id: uid('stage'), name: '飞行前检查', order: 0, description: '说明本阶段目标。' }],
        items: [],
        revisions: [],
        signoffs: []
      });
      next.selectedProjectId = next.projects[next.projects.length - 1].id;
      return next;
    });
  }, [clearHistory]);

  const updateProject = useCallback((patch: Partial<ChecklistProject>) => {
    commit('project:edit', (project) => {
      Object.assign(project, patch);
    });
  }, [commit]);

  const addStage = useCallback(() => {
    commit('stage:edit', (project) => {
      project.stages.push({ id: uid('stage'), name: '新飞行阶段', order: project.stages.length, description: '描述阶段目标和适用条件。' });
    });
  }, [commit]);

  const updateStage = useCallback((stageId: string, patch: Partial<FlightStage>) => {
    commit('stage:edit', (project) => {
      const stage = project.stages.find((entry) => entry.id === stageId);
      if (stage) Object.assign(stage, patch);
    });
  }, [commit]);

  const moveStage = useCallback((stageId: string, direction: -1 | 1) => {
    commit('stage:edit', (project) => {
      project.stages.sort((a, b) => a.order - b.order);
      const index = project.stages.findIndex((entry) => entry.id === stageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= project.stages.length) return;
      [project.stages[index], project.stages[target]] = [project.stages[target], project.stages[index]];
      project.stages.forEach((entry, order) => { entry.order = order; });
    });
  }, [commit]);

  const deleteStage = useCallback((stageId: string) => {
    commit('stage:edit', (project) => {
      if (project.items.some((item) => item.stageId === stageId)) return;
      project.stages = project.stages.filter((stage) => stage.id !== stageId).sort((a, b) => a.order - b.order);
      project.stages.forEach((stage, order) => { stage.order = order; });
    });
  }, [commit]);

  const addItem = useCallback((stageId: string, challenge = '', response = ''): string | null => {
    const id = uid('item');
    const allowed = commit('item:edit', (project) => {
      const stage = project.stages.find((entry) => entry.id === stageId);
      if (!stage) return;
      const order = project.items.filter((item) => item.stageId === stageId).length;
      project.items.push({ id, stageId, order, challenge, response, critical: false, preconditionIds: [], abnormalProcedure: '', updatedAt: now() });
    });
    return allowed ? id : null;
  }, [commit]);

  const updateItem = useCallback((itemId: string, patch: Partial<ChecklistItem>) => {
    commit('item:edit', (project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (item) Object.assign(item, patch, { updatedAt: now() });
    });
  }, [commit]);

  const deleteItem = useCallback((itemId: string) => {
    commit('item:edit', (project) => {
      project.items = project.items.filter((item) => item.id !== itemId);
      project.items.forEach((item) => { item.preconditionIds = item.preconditionIds.filter((id) => id !== itemId); });
      project.stages.forEach((stage) => {
        project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).forEach((item, order) => { item.order = order; });
      });
    });
  }, [commit]);

  const reorderItem = useCallback((sourceId: string, targetId: string, before = true) => {
    commit('item:edit', (project) => {
      const source = project.items.find((item) => item.id === sourceId);
      const target = project.items.find((item) => item.id === targetId);
      if (!source || !target || source.id === target.id) return;
      source.stageId = target.stageId;
      const siblings = project.items.filter((item) => item.stageId === target.stageId && item.id !== source.id).sort((a, b) => a.order - b.order);
      const targetIndex = siblings.findIndex((item) => item.id === target.id);
      siblings.splice(Math.max(0, targetIndex + (before ? 0 : 1)), 0, source);
      siblings.forEach((item, order) => { item.order = order; });
    });
  }, [commit]);

  const nudgeItem = useCallback((itemId: string, direction: -1 | 1) => {
    commit('item:edit', (project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const siblings = project.items.filter((entry) => entry.stageId === item.stageId).sort((a, b) => a.order - b.order);
      const index = siblings.findIndex((entry) => entry.id === itemId);
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;
      [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      siblings.forEach((entry, order) => { entry.order = order; });
    });
  }, [commit]);

  // ---- 复核员专属：提交/退回复核、关键项签认、冻结 ----

  const submitForReview = useCallback((reviewerName: string): boolean => {
    if (!can(role, 'workflow:review')) {
      raiseDenied('workflow:review');
      return false;
    }
    const project = stateRef.current.projects.find((entry) => entry.id === stateRef.current.selectedProjectId);
    if (!project || project.status !== 'draft') return false;
    const blockingErrors = validateProject(project).filter((issue) => issue.level === 'error').length;
    if (blockingErrors > 0) return false;
    const actor: Actor = { role, name: reviewerName.trim(), at: now() };
    clearHistory();
    setState((current) => {
      return updateSelected(current, (entry) => {
        entry.status = 'review';
        entry.reviewNote = '';
        entry.submittedBy = actor;
      });
    });
    return true;
  }, [role, raiseDenied, clearHistory]);

  const returnToDraft = useCallback((note: string, reviewerName: string): boolean => {
    if (!can(role, 'workflow:review')) {
      raiseDenied('workflow:review');
      return false;
    }
    const project = stateRef.current.projects.find((entry) => entry.id === stateRef.current.selectedProjectId);
    if (!project || project.status !== 'review') return false;
    clearHistory();
    setState((current) => {
      return updateSelected(current, (entry) => {
        entry.status = 'draft';
        entry.reviewNote = note.trim() || '复核员退回修改';
        entry.submittedBy = { role, name: reviewerName.trim(), at: now() };
      });
    });
    return true;
  }, [role, raiseDenied, clearHistory]);

  const signCritical = useCallback((itemId: string, reviewerName: string): boolean => {
    if (!can(role, 'signoff:manage')) {
      raiseDenied('signoff:manage');
      return false;
    }
    const project = stateRef.current.projects.find((entry) => entry.id === stateRef.current.selectedProjectId);
    if (!project || project.status === 'frozen') return false;
    const item = project.items.find((entry) => entry.id === itemId);
    if (!item || !item.critical) return false;
    const actor: Actor = { role, name: reviewerName.trim(), at: now() };
    setState((current) => updateSelected(current, (entry) => {
      const target = entry.items.find((candidate) => candidate.id === itemId);
      if (!target || !target.critical || entry.status === 'frozen') return;
      const record: CriticalSignoff = {
        id: uid('signoff'),
        itemId,
        revision: entry.revision,
        signedBy: actor,
        signedAt: now(),
        basis: buildBasis(target, entry.stages),
        invalidated: false
      };
      entry.signoffs = [...reconcileSignoffs(entry, now()), record];
    }));
    return true;
  }, [role, raiseDenied]);

  const freezeRevision = useCallback((note: string, reviewerName: string): boolean => {
    if (!can(role, 'workflow:freeze')) {
      raiseDenied('workflow:freeze');
      return false;
    }
    const project = stateRef.current.projects.find((entry) => entry.id === stateRef.current.selectedProjectId);
    if (!project || project.status !== 'review') return false;
    // 冻结门禁下沉到数据层：有阻断错误或关键项未全部有效签认时拒绝冻结。
    const blockingErrors = validateProject(project).filter((issue) => issue.level === 'error').length;
    if (blockingErrors > 0 || freezeBlockers(project).length > 0) return false;
    const actor: Actor = { role, name: reviewerName.trim(), at: now() };
    clearHistory();
    setState((current) => {
      return updateSelected(current, (entry) => {
        if (entry.status !== 'review') return;
        const snapshot: ChecklistRevision = {
          id: uid('revision'),
          revision: entry.revision,
          status: 'frozen',
          createdAt: now(),
          note: note.trim() || '复核通过并冻结',
          stages: clone(entry.stages),
          items: clone(entry.items),
          signoffs: clone(entry.signoffs),
          submittedBy: entry.submittedBy ? clone(entry.submittedBy) : undefined,
          frozenBy: actor
        };
        entry.revisions.unshift(snapshot);
        entry.status = 'frozen';
        entry.reviewNote = note.trim();
        entry.frozenBy = actor;
      });
    });
    return true;
  }, [role, raiseDenied, clearHistory]);

  const createRevision = useCallback((): boolean => {
    if (!can(role, 'item:edit')) {
      raiseDenied('item:edit');
      return false;
    }
    const project = stateRef.current.projects.find((entry) => entry.id === stateRef.current.selectedProjectId);
    if (!project || project.status !== 'frozen') return false;
    clearHistory();
    setState((current) => {
      return updateSelected(current, (entry) => {
        entry.revision += 1;
        entry.status = 'draft';
        entry.reviewNote = '';
        entry.submittedBy = undefined;
        entry.frozenBy = undefined;
        // 新修订的关键项签认必须重新完成；上一修订留痕已保存在其冻结快照中。
        entry.signoffs = [];
        entry.updatedAt = now();
      });
    });
    return true;
  }, [role, raiseDenied, clearHistory]);

  /** 历史中只含可编辑内容快照；撤销/重做仅编辑角色、仅草稿期放行，且不动签认与工作流状态。 */
  const undo = useCallback(() => {
    if (!can(role, 'item:edit') && !can(role, 'stage:edit')) {
      raiseDenied('item:edit');
      return;
    }
    setState((current) => {
      const project = current.projects.find((entry) => entry.id === current.selectedProjectId);
      if (project?.status !== 'draft') return current;
      const previous = past.current.pop();
      if (!previous) return current;
      const present = takeEditableSnapshot(current);
      if (present) future.current = [present, ...future.current].slice(0, 40);
      forceHistoryState((value) => value + 1);
      return restoreEditableSnapshot(current, previous);
    });
  }, [role, raiseDenied]);

  const redo = useCallback(() => {
    if (!can(role, 'item:edit') && !can(role, 'stage:edit')) {
      raiseDenied('item:edit');
      return;
    }
    setState((current) => {
      const project = current.projects.find((entry) => entry.id === current.selectedProjectId);
      if (project?.status !== 'draft') return current;
      const nextSnapshot = future.current.shift();
      if (!nextSnapshot) return current;
      const present = takeEditableSnapshot(current);
      if (present) past.current = [...past.current.slice(-39), present];
      forceHistoryState((value) => value + 1);
      return restoreEditableSnapshot(current, nextSnapshot);
    });
  }, [role, raiseDenied]);

  const saveNow = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setState((current) => updateSelected(current, () => undefined));
  }, [state]);

  return {
    state,
    role,
    denied,
    clearDenied: () => setDenied(null),
    selectedProject,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    selectProject,
    selectRole,
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
    submitForReview,
    returnToDraft,
    signCritical,
    freezeRevision,
    createRevision,
    undo,
    redo,
    saveNow
  };
}
