import { actorLabel, roleMeta } from './rbac';
import { describeSigner, invalidReasonMeta } from './signoff';
import type { ChecklistProject, PrintView } from './types';

export function buildPrintView(project: ChecklistProject, revisionId: string | 'current'): PrintView | undefined {
  if (revisionId === 'current') {
    return {
      name: project.name,
      aircraft: project.aircraft,
      revision: project.revision,
      status: project.status,
      stages: project.stages,
      items: project.items,
      signoffs: project.signoffs,
      submittedBy: project.submittedBy,
      frozenBy: project.frozenBy
    };
  }
  const revision = project.revisions.find((entry) => entry.id === revisionId);
  if (!revision) return undefined;
  return {
    name: project.name,
    aircraft: project.aircraft,
    revision: revision.revision,
    status: revision.status,
    note: revision.note,
    frozenAt: revision.createdAt,
    stages: revision.stages,
    items: revision.items,
    signoffs: revision.signoffs ?? [],
    submittedBy: revision.submittedBy,
    frozenBy: revision.frozenBy,
    legacy: revision.legacy
  };
}

export function statusText(status: PrintView['status']): string {
  return { draft: '编辑中', review: '复核中', frozen: '已冻结' }[status];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

/** 独立打印版 HTML：角色、关键项签认状态、失效原因与冻结留痕一并保留。 */
export function renderPrintableHtml(view: PrintView): string {
  const stages = view.stages.slice().sort((a, b) => a.order - b.order);
  const signoffCell = (itemId: string, critical: boolean): string => {
    if (!critical) return '<td class="muted">—</td>';
    const history = view.signoffs.filter((signoff) => signoff.itemId === itemId);
    const active = history.find((signoff) => !signoff.invalidated);
    if (active) return `<td class="signed">✓ ${escapeHtml(describeSigner(active))}<br><small>${escapeHtml(new Date(active.signedAt).toLocaleString('zh-CN'))}</small></td>`;
    const last = history[0];
    if (last) {
      const reasons = (last.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、');
      return `<td class="invalid">原签认已失效：${escapeHtml(reasons)}<br><small>${escapeHtml(describeSigner(last))} · ${escapeHtml(new Date(last.signedAt).toLocaleString('zh-CN'))}签认</small></td>`;
    }
    return '<td class="unsigned">未签认</td>';
  };

  const body = stages.map((stage) => {
    const rows = view.items
      .filter((item) => item.stageId === stage.id)
      .sort((a, b) => a.order - b.order)
      .map((item) => `
        <tr>
          <td>${item.critical ? '<strong class="critical">◆</strong> ' : ''}${escapeHtml(item.challenge)}</td>
          <td>${escapeHtml(item.response || '未填写')}</td>
          <td>${escapeHtml(item.abnormalProcedure || '—')}</td>
          ${signoffCell(item.id, item.critical)}
        </tr>`)
      .join('');
    return `<section><h2>${escapeHtml(stage.name)}</h2><p>${escapeHtml(stage.description)}</p><table><thead><tr><th>挑战语</th><th>预期回应</th><th>异常处置</th><th style="width:26%">关键项签认</th></tr></thead><tbody>${rows || '<tr><td colspan="4">本阶段暂无项目</td></tr>'}</tbody></table></section>`;
  }).join('');

  const legacyBanner = view.legacy
    ? '<div class="legacy">历史记录（旧版数据无角色与签认信息）· 只读查看，不能编辑、签认或重新冻结</div>'
    : '';
  const frozenMeta = view.status === 'frozen'
    ? `<div>冻结：${escapeHtml(actorLabel(view.frozenBy))}${view.frozenAt ? ` · ${escapeHtml(new Date(view.frozenAt).toLocaleString('zh-CN'))}` : ''}</div>`
    : '';
  const submitMeta = view.submittedBy ? `<div>提交复核：${escapeHtml(actorLabel(view.submittedBy))}</div>` : '';
  const noteMeta = view.note ? `<div>复核说明：${escapeHtml(view.note)}</div>` : '';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(view.name)} r${view.revision}</title><style>
    body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#111;margin:36px}
    h1{margin:0 0 4px} .meta{color:#555;margin-bottom:20px} .meta div{margin:2px 0}
    .legacy{border:1px solid #b58a00;background:#fff7e0;color:#7a5b00;padding:8px 12px;border-radius:6px;margin-bottom:18px;font-weight:700}
    h2{border-bottom:2px solid #222;padding-bottom:5px;margin-top:26px}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top} th{background:#eee}
    small{color:#666} .muted{color:#999} .signed{color:#116329;background:#e9f7ee} .invalid{color:#9f1d1d;background:#fdecec} .unsigned{color:#9a6700;background:#fdf3df}
    .critical{color:#b00020}
    @media print{body{margin:12mm}section{break-inside:avoid}}
  </style></head><body>
    ${legacyBanner}
    <h1>${escapeHtml(view.name)}</h1>
    <div class="meta">
      <div>${escapeHtml(view.aircraft)} · r${view.revision} · ${escapeHtml(statusText(view.status))} · 导出 ${escapeHtml(new Date().toLocaleString('zh-CN'))}</div>
      ${submitMeta}${frozenMeta}${noteMeta}
    </div>
    ${body}
  </body></html>`;
}

export function downloadPrintableHtml(view: PrintView): void {
  const url = URL.createObjectURL(new Blob([renderPrintableHtml(view)], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${view.name.replace(/[^\p{L}\p{N}-]+/gu, '-')}-r${view.revision}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function actorText(actor?: Parameters<typeof actorLabel>[0]): string {
  return actor ? actorLabel(actor) : '—';
}

export function roleText(role: keyof typeof roleMeta): string {
  return roleMeta[role].label;
}
