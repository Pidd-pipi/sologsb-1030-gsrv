export type WorkflowStatus = 'draft' | 'review' | 'frozen';
export type IssueLevel = 'error' | 'warning' | 'info';
export type IssueType = 'duplicate' | 'missing-response' | 'unreachable-precondition' | 'stage-order' | 'orphan-stage';

/** 试飞准备室共用终端的三个值班角色。 */
export type Role = 'captain' | 'reviewer' | 'librarian';

/** 角色可执行的操作权限。 */
export type Permission =
  | 'item:write'
  | 'stage:write'
  | 'project:write'
  | 'signoff:manage'
  | 'workflow:submit'
  | 'workflow:freeze'
  | 'workflow:revise';

export const ROLE_LABELS: Record<Role, string> = {
  captain: '机长',
  reviewer: '复核员',
  librarian: '资料员'
};

export const ROLE_SHORT: Record<Role, string> = {
  captain: '机长',
  reviewer: '复核',
  librarian: '资料'
};

/** 每个角色的职责边界：机长只维护检查项，复核员只处理关键项签认，资料员只整理飞行阶段。 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  captain: ['item:write', 'workflow:submit', 'workflow:revise'],
  reviewer: ['signoff:manage', 'workflow:freeze'],
  librarian: ['stage:write', 'project:write', 'workflow:submit', 'workflow:revise']
};

/** 关键项签认记录。失效后保留记录与失效原因，随冻结快照与打印稿留存。 */
export interface SignOff {
  itemId: string;
  signedBy: Role;
  signedAt: string;
  /** 签认时关键项内容/顺序/前置条件的指纹，用于判定是否失效。 */
  hash: string;
  valid: boolean;
  invalidReason?: string;
  invalidAt?: string;
}

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

export interface ChecklistRevision {
  id: string;
  revision: number;
  status: WorkflowStatus;
  createdAt: string;
  note: string;
  stages: FlightStage[];
  items: ChecklistItem[];
  /** 冻结时的签认记录；旧版本可能缺失（按只读历史查看）。 */
  signOffs?: SignOff[];
  /** 冻结操作人角色；旧版本可能缺失。 */
  frozenBy?: Role;
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
  /** 当前草稿的关键项签认记录。 */
  signOffs: SignOff[];
}

export interface WorkspaceState {
  schemaVersion: 1;
  selectedProjectId: string;
  projects: ChecklistProject[];
  /** 共用终端当前值班角色。 */
  currentRole: Role;
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
