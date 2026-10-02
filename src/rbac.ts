import type { Role } from './types';

/**
 * 角色边界（共享终端，三类值班员互不可越权）：
 * - captain 机长：只维护检查项本身（含关键标记、前置条件、顺序）。
 * - reviewer 复核员：只处理关键项签认、提交复核后的退回与冻结。
 * - librarian 资料员：只整理飞行阶段与项目资料（阶段名称/顺序/说明）。
 */
export type Permission =
  | 'item:edit'
  | 'stage:edit'
  | 'project:edit'
  | 'signoff:manage'
  | 'workflow:review'
  | 'workflow:freeze';

export const roleMeta: Record<Role, { label: string; short: string; color: 'blue' | 'red' | 'amber'; scope: string }> = {
  captain: { label: '机长', short: '机长', color: 'blue', scope: '维护检查项：挑战语、回应、关键标记、前置条件与顺序' },
  reviewer: { label: '复核员', short: '复核', color: 'red', scope: '处理关键项签认，复核通过后冻结，或退回编辑' },
  librarian: { label: '资料员', short: '资料', color: 'amber', scope: '整理飞行阶段：阶段名称、说明、先后顺序与项目资料' }
};

export const roleOrder: Role[] = ['captain', 'reviewer', 'librarian'];

/** 各动作只允许一个角色发起；命中表外的动作一律拒绝。 */
const rolePermissions: Record<Role, Permission[]> = {
  captain: ['item:edit'],
  reviewer: ['signoff:manage', 'workflow:review', 'workflow:freeze'],
  librarian: ['stage:edit', 'project:edit']
};

export function can(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export function permissionDeniedMessage(role: Role, permission: Permission): string {
  const target = permissionLabel(permission);
  return `越权操作已拒绝：${roleMeta[role].label}只能${roleMeta[role].scope}，不能${target}。`;
}

export function permissionLabel(permission: Permission): string {
  switch (permission) {
    case 'item:edit':
      return '维护检查项';
    case 'stage:edit':
      return '整理飞行阶段';
    case 'project:edit':
      return '修改项目资料';
    case 'signoff:manage':
      return '处理关键项签认';
    case 'workflow:review':
      return '处理复核流程';
    case 'workflow:freeze':
      return '冻结发布';
  }
}

export function actorLabel(actor?: { role: Role; name: string }): string {
  if (!actor) return '—';
  return `${roleMeta[actor.role].label}${actor.name ? ` ${actor.name}` : ''}`;
}
