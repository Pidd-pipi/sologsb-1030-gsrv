export type WorkflowStatus = 'draft' | 'review' | 'frozen';
export type IssueLevel = 'error' | 'warning' | 'info';
export type IssueType = 'duplicate' | 'missing-response' | 'unreachable-precondition' | 'stage-order' | 'orphan-stage';

/** 试飞准备室共享终端上的三种值班角色，权限互斥。 */
export type Role = 'captain' | 'reviewer' | 'librarian';

/** 关键项签认失效原因：内容改动、顺序/阶段改动、前置条件改动。 */
export type SignoffInvalidReason = 'content' | 'order' | 'precondition';

export interface FlightStage {
  id: string;
  name: string;
  order: number;
  description: string;
}

export interface ChecklistItem {
  id: string;
  stageId: string;
  order: number;
  challenge: string;
  response: string;
  critical: boolean;
  preconditionIds: string[];
  abnormalProcedure: string;
  updatedAt: string;
}

/** 一次操作的角色留痕：角色、署名与时间。 */
export interface Actor {
  role: Role;
  name: string;
  at: string;
}

/** 签认时锁定的关键项依据快照，用于事后比对并判定失效原因。 */
export interface SignoffBasis {
  challenge: string;
  response: string;
  critical: boolean;
  abnormalProcedure: string;
  preconditionIds: string[];
  stageId: string;
  order: number;
  stageOrder: number;
}

/** 关键项签认记录；失效后不删除，随冻结快照永久保留。 */
export interface CriticalSignoff {
  id: string;
  itemId: string;
  revision: number;
  signedBy: Actor;
  signedAt: string;
  basis: SignoffBasis;
  invalidated: boolean;
  invalidReasons?: SignoffInvalidReason[];
  invalidDetail?: string;
  invalidatedAt?: string;
}

export interface ChecklistRevision {
  id: string;
  revision: number;
  status: WorkflowStatus;
  createdAt: string;
  note: string;
  stages: FlightStage[];
  items: ChecklistItem[];
  /** 冻结时刻的全部签认记录（含已失效记录与失效原因）。 */
  signoffs: CriticalSignoff[];
  submittedBy?: Actor;
  frozenBy?: Actor;
  /** 旧版记录没有角色/签认信息时置位，仅允许只读历史查看。 */
  legacy?: boolean;
}

export interface ChecklistProject {
  id: string;
  name: string;
  aircraft: string;
  revision: number;
  status: WorkflowStatus;
  updatedAt: string;
  reviewNote: string;
  stages: FlightStage[];
  items: ChecklistItem[];
  revisions: ChecklistRevision[];
  /** 当前修订累积的关键项签认历史，冻结时整体写入快照。 */
  signoffs: CriticalSignoff[];
  submittedBy?: Actor;
  frozenBy?: Actor;
}

export interface WorkspaceState {
  schemaVersion: 1;
  selectedProjectId: string;
  projects: ChecklistProject[];
}

export interface ValidationIssue {
  id: string;
  type: IssueType;
  level: IssueLevel;
  stageId?: string;
  itemId?: string;
  title: string;
  detail: string;
}

export interface VersionOption {
  id: string;
  label: string;
}

export interface DiffEntry {
  type: 'added' | 'removed' | 'changed' | 'stage';
  key: string;
  stage: string;
  before: string;
  after: string;
}

/** 打印/预览统一视图，可来自当前工作区或任意冻结快照。 */
export interface PrintView {
  name: string;
  aircraft: string;
  revision: number;
  status: WorkflowStatus;
  note?: string;
  frozenAt?: string;
  stages: FlightStage[];
  items: ChecklistItem[];
  signoffs: CriticalSignoff[];
  submittedBy?: Actor;
  frozenBy?: Actor;
  legacy?: boolean;
}
