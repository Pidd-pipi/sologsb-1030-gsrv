import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  Flex,
  Grid,
  Heading,
  IconButton,
  Progress,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip
} from '@radix-ui/themes';
import { buildVersionOptions, diffVersions } from './diff';
import { actorLabel, can, roleMeta, roleOrder } from './rbac';
import { buildPrintView, downloadPrintableHtml, statusText } from './print';
import {
  activeSignoff,
  computeCriticalBatches,
  describeSigner,
  freezeBlockers,
  invalidReasonMeta,
  latestSignoff,
  signoffHistory
} from './signoff';
import { useChecklistStore } from './store';
import type { ChecklistItem, ChecklistProject, CriticalSignoff, PrintView, Role, ValidationIssue, WorkflowStatus } from './types';
import { validateProject } from './validation';

const statusMeta: Record<WorkflowStatus, { label: string; color: 'gray' | 'amber' | 'green'; description: string }> = {
  draft: { label: '编辑中', color: 'gray', description: '机长维护检查项、资料员整理阶段，完成后由复核员接单。' },
  review: { label: '复核中', color: 'amber', description: '内容已锁定，复核员逐条签认关键项，全部确认后才能冻结。' },
  frozen: { label: '已冻结', color: 'green', description: '只读发布版本；需要修改时由机长创建新修订。' }
};

const issueMeta = {
  error: { color: 'red' as const, label: '阻断' },
  warning: { color: 'amber' as const, label: '警告' },
  info: { color: 'blue' as const, label: '提示' }
};

function App() {
  const store = useChecklistStore();
  const project = store.selectedProject;
  const role = store.role;
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => (localStorage.getItem('sologsb-1030-theme') === 'dark' ? 'dark' : 'light'));
  const [reviewerName, setReviewerName] = useState(() => localStorage.getItem('sologsb-1030-name-reviewer') ?? '');
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(project.items[0]?.id ?? '');
  const [quickStageId, setQuickStageId] = useState(project.stages[0]?.id ?? '');
  const [newChallenge, setNewChallenge] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [activeTab, setActiveTab] = useState('editor');
  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeNote, setFreezeNote] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [leftVersion, setLeftVersion] = useState('current');
  const [rightVersion, setRightVersion] = useState(project.revisions[0]?.id ?? '');
  const [printVersion, setPrintVersion] = useState<string>('current');
  const [savePulse, setSavePulse] = useState(false);
  const challengeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;
  const selectedItem = project.items.find((item) => item.id === selectedItemId);
  const versionOptions = useMemo(() => buildVersionOptions(project), [project]);
  const diffEntries = useMemo(() => diffVersions(project, leftVersion, rightVersion), [project, leftVersion, rightVersion]);
  const batchPlan = useMemo(() => computeCriticalBatches(project), [project]);
  const blockers = useMemo(() => freezeBlockers(project), [project]);
  const printView = useMemo(() => buildPrintView(project, printVersion), [project, printVersion]);
  const currentView = useMemo(() => buildPrintView(project, 'current'), [project]);
  const canEditItems = role === 'captain' && project.status === 'draft';
  const canEditStages = role === 'librarian' && project.status === 'draft';
  const isReviewer = role === 'reviewer';
  const canSign = isReviewer && project.status !== 'frozen';
  const freezeDisabledReason = errors > 0
    ? `存在 ${errors} 个阻断校验问题，不能冻结`
    : blockers.length > 0
      ? `还有 ${blockers.length} 个关键项未完成有效签认，重新确认前不能冻结`
      : '';

  const filteredStages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return project.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        stage,
        items: project.items
          .filter((item) => item.stageId === stage.id)
          .filter((item) => !query || [stage.name, stage.description, item.challenge, item.response, item.abnormalProcedure].some((value) => value.toLocaleLowerCase('zh-CN').includes(query)))
          .sort((a, b) => a.order - b.order)
      }))
      .filter((group) => !query || group.items.length > 0 || group.stage.name.toLocaleLowerCase('zh-CN').includes(query));
  }, [project, search]);

  useEffect(() => {
    if (!project.items.some((item) => item.id === selectedItemId)) setSelectedItemId(project.items[0]?.id ?? '');
    if (!project.stages.some((stage) => stage.id === quickStageId)) setQuickStageId(project.stages[0]?.id ?? '');
    if (!versionOptions.some((option) => option.id === leftVersion)) setLeftVersion('current');
    if (!versionOptions.some((option) => option.id === rightVersion)) setRightVersion(versionOptions[1]?.id ?? '');
    if (!versionOptions.some((option) => option.id === printVersion)) setPrintVersion('current');
  }, [project.id, project.items, project.stages, project.revision, selectedItemId, quickStageId, versionOptions, leftVersion, rightVersion, printVersion]);

  useEffect(() => {
    localStorage.setItem('sologsb-1030-theme', appearance);
  }, [appearance]);

  useEffect(() => {
    localStorage.setItem('sologsb-1030-name-reviewer', reviewerName);
  }, [reviewerName]);

  // 越权提示停留几秒后自动消失。
  useEffect(() => {
    if (!store.denied) return;
    const timer = window.setTimeout(() => store.clearDenied(), 6000);
    return () => window.clearTimeout(timer);
  }, [store.denied, store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, [contenteditable="true"]') ?? false;
      if (modifier && event.key.toLocaleLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        store.saveNow();
        setSavePulse(true);
        window.setTimeout(() => setSavePulse(false), 1200);
        return;
      }
      if (modifier && event.key === 'Enter') {
        event.preventDefault();
        quickAddItem();
        return;
      }
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && selectedItemId) {
        event.preventDefault();
        store.nudgeItem(selectedItemId, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        challengeRef.current?.focus();
        return;
      }
      if (event.key === '?' && !typing) {
        event.preventDefault();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function quickAddItem() {
    if (!quickStageId || !newChallenge.trim()) return;
    const id = store.addItem(quickStageId, newChallenge.trim(), newResponse.trim());
    if (!id) return;
    setSelectedItemId(id);
    setNewChallenge('');
    setNewResponse('');
    challengeRef.current?.focus();
  }

  function selectIssue(issue: ValidationIssue) {
    if (issue.itemId) setSelectedItemId(issue.itemId);
    setActiveTab('editor');
    if (issue.stageId) setQuickStageId(issue.stageId);
  }

  function printActiveView() {
    setActiveTab('print');
    window.setTimeout(() => window.print(), 220);
  }

  function togglePrecondition(item: ChecklistItem, preconditionId: string) {
    const ids = new Set(item.preconditionIds);
    ids.has(preconditionId) ? ids.delete(preconditionId) : ids.add(preconditionId);
    store.updateItem(item.id, { preconditionIds: [...ids] });
  }

  function duplicateItem(item: ChecklistItem) {
    const id = store.addItem(item.stageId, `${item.challenge} - COPY`, item.response);
    if (!id) return;
    window.setTimeout(() => {
      store.updateItem(id, {
        critical: item.critical,
        preconditionIds: [...item.preconditionIds],
        abnormalProcedure: item.abnormalProcedure
      });
      setSelectedItemId(id);
    }, 0);
  }

  return (
    <Theme appearance={appearance} accentColor="blue" grayColor="slate" radius="large" scaling="100%">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">FL</div>
            <div><Heading size="5">Flightline</Heading><Text size="1" color="gray">飞行检查单编写与校验</Text></div>
          </div>
          <div className="project-switcher">
            <Select.Root value={project.id} onValueChange={store.selectProject}>
              <Select.Trigger aria-label="选择检查单项目" variant="soft" />
              <Select.Content position="popper">
                {store.state.projects.map((entry) => <Select.Item key={entry.id} value={entry.id}>{entry.name}</Select.Item>)}
              </Select.Content>
            </Select.Root>
            <Button variant="soft" onClick={store.addProject}>新建项目</Button>
          </div>
          <div className="role-switcher" role="group" aria-label="值班角色切换">
            {roleOrder.map((value: Role) => (
              <button
                key={value}
                type="button"
                className={`role-tab role-${value} ${role === value ? 'active' : ''}`}
                onClick={() => store.selectRole(value)}
                title={roleMeta[value].scope}
              >
                {roleMeta[value].label}
              </button>
            ))}
            {isReviewer && (
              <TextField.Root
                className="role-name-input"
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                placeholder="复核员署名"
                aria-label="复核员署名"
              />
            )}
          </div>
          <div className="top-actions">
            <TextField.Root ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索检查项 / Ctrl+K" style={{ minWidth: 200 }}>
              <TextField.Slot>⌕</TextField.Slot>
            </TextField.Root>
            <Tooltip content="撤销 Ctrl/⌘+Z"><Button variant="soft" disabled={!store.canUndo} onClick={store.undo}>撤销</Button></Tooltip>
            <Tooltip content="重做 Shift+Ctrl/⌘+Z"><Button variant="soft" disabled={!store.canRedo} onClick={store.redo}>重做</Button></Tooltip>
            <Tooltip content="手动保存 Ctrl/⌘+S"><Button variant="soft" onClick={() => { store.saveNow(); setSavePulse(true); window.setTimeout(() => setSavePulse(false), 1200); }}>{savePulse ? '已保存' : '保存'}</Button></Tooltip>
            <Tooltip content="切换外观"><IconButton variant="soft" aria-label="切换明暗主题" onClick={() => setAppearance(appearance === 'light' ? 'dark' : 'light')}>{appearance === 'light' ? '◐' : '☀'}</IconButton></Tooltip>
            <Tooltip content="键盘帮助"><IconButton variant="soft" aria-label="键盘帮助" onClick={() => setShowHelp(true)}>?</IconButton></Tooltip>
          </div>
        </header>

        {store.denied && (
          <div className="denied-banner" role="alert">
            <span>⛔ {store.denied.message}</span>
            <button type="button" aria-label="关闭提示" onClick={store.clearDenied}>×</button>
          </div>
        )}

        <div className="workflow-bar">
          <div className="workflow-steps">
            {(['draft', 'review', 'frozen'] as WorkflowStatus[]).map((status, index) => (
              <div key={status} className={`workflow-step ${project.status === status ? 'active' : ''} ${status === 'draft' || project.revision > 1 ? 'done' : ''}`}>
                <span>{index + 1}</span><div><strong>{statusMeta[status].label}</strong><small>{statusMeta[status].description}</small></div>
              </div>
            ))}
          </div>
          <Flex gap="2" align="center" wrap="wrap">
            <Badge color={roleMeta[role].color} size="2">当前：{roleMeta[role].label}</Badge>
            <Badge color={statusMeta[project.status].color} size="2">r{project.revision} · {statusMeta[project.status].label}</Badge>
            <Text size="1" color="gray">{errors ? `${errors} 个阻断` : '无阻断问题'} · {warnings} 个警告 · 关键批次 {batchPlan.executableBatches}/{batchPlan.batches.length} 可执行</Text>
            {project.status === 'draft' && (
              <Tooltip content={isReviewer ? (errors ? `存在 ${errors} 个阻断问题，不能提交复核` : '复核员接单进入复核') : '仅复核员可以提交复核'}>
                <Button color="amber" disabled={!isReviewer || errors > 0} onClick={() => store.submitForReview(reviewerName)}>提交复核</Button>
              </Tooltip>
            )}
            {project.status === 'review' && (
              <>
                <Tooltip content={freezeDisabledReason || '复核员签认全部关键项后冻结发布'}>
                  <Button color="green" disabled={!isReviewer || Boolean(freezeDisabledReason)} onClick={() => setFreezeOpen(true)}>复核通过并冻结</Button>
                </Tooltip>
                <Tooltip content="仅复核员可以退回机长修改">
                  <Button variant="soft" color="amber" disabled={!isReviewer} onClick={() => setReturnOpen(true)}>退回修改</Button>
                </Tooltip>
              </>
            )}
            {project.status === 'frozen' && (
              <Tooltip content={can(role, 'item:edit') ? '冻结后由机长创建新修订继续修改' : '仅机长可以创建新修订'}>
                <Button disabled={role !== 'captain'} onClick={() => store.createRevision()}>创建修订 r{project.revision + 1}</Button>
              </Tooltip>
            )}
            <Button variant="soft" onClick={() => setShowPreview(true)}>只读预览</Button>
            <Button variant="soft" onClick={printActiveView}>打印</Button>
            <Button variant="soft" onClick={() => currentView && downloadPrintableHtml(currentView)}>导出打印版</Button>
          </Flex>
        </div>

        <main className="workspace">
          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="main-tabs">
              <Tabs.Trigger value="editor">编辑清单</Tabs.Trigger>
              <Tabs.Trigger value="signoff">
                关键项签认{' '}
                <Badge size="1" color={blockers.length ? 'red' : 'green'} variant="soft">
                  {batchPlan.signedBatches}/{batchPlan.batches.length} 批{blockers.length ? ` · ${blockers.length} 待确认` : ''}
                </Badge>
              </Tabs.Trigger>
              <Tabs.Trigger value="versions">版本差异 <Badge size="1" variant="soft">{project.revisions.length}</Badge></Tabs.Trigger>
              <Tabs.Trigger value="print">打印预览</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="editor">
              <div className="editor-grid">
                <aside className="stage-sidebar">
                  <Flex justify="between" align="center" mb="3">
                    <Heading size="3">飞行阶段</Heading>
                    <Tooltip content={canEditStages ? '资料员新增飞行阶段' : '仅资料员在编辑中可整理阶段'}>
                      <Button size="1" variant="soft" disabled={!canEditStages} onClick={store.addStage}>＋阶段</Button>
                    </Tooltip>
                  </Flex>
                  <ScrollArea type="auto" scrollbars="vertical" style={{ height: 'calc(100vh - 250px)' }}>
                    <div className="stage-nav">
                      {project.stages.slice().sort((a, b) => a.order - b.order).map((stage, index) => {
                        const count = project.items.filter((item) => item.stageId === stage.id).length;
                        const issueCount = issues.filter((issue) => issue.stageId === stage.id).length;
                        return (
                          <button key={stage.id} className={`stage-nav-item ${quickStageId === stage.id ? 'active' : ''}`} onClick={() => setQuickStageId(stage.id)}>
                            <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
                            <span><strong>{stage.name}</strong><small>{count} 项{issueCount ? ` · ${issueCount} 个问题` : ''}</small></span>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <Card className="project-card">
                    <Text size="1" color="gray">项目资料 · 资料员维护</Text>
                    <label><span>检查单名称</span><TextField.Root value={project.name} disabled={!canEditStages} onChange={(event) => store.updateProject({ name: event.target.value })} /></label>
                    <label><span>机型 / 注册号</span><TextField.Root value={project.aircraft} disabled={!canEditStages} onChange={(event) => store.updateProject({ aircraft: event.target.value })} /></label>
                  </Card>
                </aside>

                <section className="checklist-main">
                  <div className="list-heading">
                    <div><Heading size="6">{project.name}</Heading><Text color="gray">{project.aircraft} · {project.items.length} 个检查项 · {project.stages.length} 个阶段</Text></div>
                    <Badge color={project.status === 'draft' ? 'gray' : project.status === 'review' ? 'amber' : 'green'}>{statusMeta[project.status].label}</Badge>
                  </div>
                  {project.status === 'review' && <Callout.Root color="amber" mb="4"><Callout.Text>{statusMeta.review.description}</Callout.Text></Callout.Root>}
                  {project.status === 'frozen' && <Callout.Root color="green" mb="4"><Callout.Text>{statusMeta.frozen.description}</Callout.Text></Callout.Root>}
                  {project.status === 'draft' && role !== 'captain' && (
                    <Callout.Root color={role === 'reviewer' ? 'red' : 'amber'} mb="4">
                      <Callout.Text>
                        {role === 'reviewer'
                          ? '当前为复核员视角：不能编辑检查项或阶段，请在“关键项签认”页签处理签认。'
                          : '当前为资料员视角：仅可整理左侧飞行阶段与项目资料，检查项由机长维护。'}
                      </Callout.Text>
                    </Callout.Root>
                  )}

                  <div className="quick-entry">
                    <Select.Root value={quickStageId || undefined} onValueChange={setQuickStageId} disabled={!canEditItems}>
                      <Select.Trigger variant="soft" aria-label="新检查项所属阶段" />
                      <Select.Content position="popper">{project.stages.map((stage) => <Select.Item key={stage.id} value={stage.id}>{stage.name}</Select.Item>)}</Select.Content>
                    </Select.Root>
                    <TextField.Root ref={challengeRef} value={newChallenge} disabled={!canEditItems} placeholder="挑战语，如 起飞构型（按 / 聚焦）" onChange={(event) => setNewChallenge(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) quickAddItem(); }} />
                    <TextField.Root value={newResponse} disabled={!canEditItems} placeholder="预期回应" onChange={(event) => setNewResponse(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) quickAddItem(); }} />
                    <Button disabled={!canEditItems || !newChallenge.trim()} onClick={quickAddItem}>新增</Button>
                    <Text size="1" color="gray">机长录入 · Ctrl/⌘+Enter</Text>
                  </div>

                  <div className="stage-list">
                    {filteredStages.map(({ stage, items }, stageIndex) => (
                      <Card key={stage.id} className="stage-card">
                        <div className="stage-card-head">
                          <div className="drag-handle" title="阶段排序">⋮⋮</div>
                          <div className="stage-title">
                            <span className="sequence-chip">{stageIndex + 1}</span>
                            <input aria-label={`${stage.name} 阶段名称`} value={stage.name} disabled={!canEditStages} onChange={(event) => store.updateStage(stage.id, { name: event.target.value })} />
                            <TextField.Root value={stage.description} disabled={!canEditStages} onChange={(event) => store.updateStage(stage.id, { description: event.target.value })} />
                          </div>
                          <Flex gap="1">
                            <Tooltip content="仅资料员可调整阶段顺序"><span><Button size="1" variant="soft" disabled={!canEditStages || stage.order === 0} onClick={() => store.moveStage(stage.id, -1)}>上移</Button></span></Tooltip>
                            <Tooltip content="仅资料员可调整阶段顺序"><span><Button size="1" variant="soft" disabled={!canEditStages || stage.order === project.stages.length - 1} onClick={() => store.moveStage(stage.id, 1)}>下移</Button></span></Tooltip>
                            <Tooltip content="仅资料员可删除空阶段"><span><Button size="1" color="red" variant="soft" disabled={!canEditStages || items.length > 0} onClick={() => store.deleteStage(stage.id)}>删除</Button></span></Tooltip>
                          </Flex>
                        </div>
                        <div className="item-table">
                          {items.map((item) => {
                            const itemIssues = issues.filter((issue) => issue.itemId === item.id);
                            const signed = Boolean(activeSignoff(project, item.id));
                            const lastSignoff = latestSignoff(project, item.id);
                            return (
                              <article
                                key={item.id}
                                className={`checklist-row ${selectedItemId === item.id ? 'selected' : ''}`}
                                draggable={canEditItems}
                                onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                                onDragOver={(event) => { if (canEditItems) event.preventDefault(); }}
                                onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('text/plain'); if (source) store.reorderItem(source, item.id, true); }}
                                onClick={() => setSelectedItemId(item.id)}
                              >
                                <span className="drag-handle">⋮⋮</span>
                                <div className="check-item-copy">
                                  <Flex gap="2" align="center" wrap="wrap">
                                    <strong>{item.challenge || '未命名检查项'}</strong>
                                    {item.critical && <Badge color="red" size="1">关键</Badge>}
                                    {item.critical && signed && <Badge color="green" size="1">已签认</Badge>}
                                    {item.critical && !signed && lastSignoff?.invalidated && <Badge color="red" size="1">签认失效</Badge>}
                                    {item.critical && !signed && !lastSignoff?.invalidated && <Badge color="amber" size="1">待签认</Badge>}
                                    {item.preconditionIds.length > 0 && <Badge color="blue" size="1">{item.preconditionIds.length} 前置</Badge>}
                                    {itemIssues.length > 0 && <Badge color={itemIssues.some((issue) => issue.level === 'error') ? 'red' : 'amber'} size="1">{itemIssues.length} 问题</Badge>}
                                  </Flex>
                                  <span className={`response-preview ${!item.response ? 'missing' : ''}`}>{item.response || '缺少预期回应'}</span>
                                  {item.abnormalProcedure && <small>异常：{item.abnormalProcedure}</small>}
                                </div>
                                <div className="row-actions">
                                  <Button size="1" variant="ghost" disabled={!canEditItems} onClick={(event) => { event.stopPropagation(); store.nudgeItem(item.id, -1); }}>↑</Button>
                                  <Button size="1" variant="ghost" disabled={!canEditItems} onClick={(event) => { event.stopPropagation(); store.nudgeItem(item.id, 1); }}>↓</Button>
                                  <Button size="1" variant="ghost" disabled={!canEditItems} onClick={(event) => { event.stopPropagation(); duplicateItem(item); }}>复制</Button>
                                  <Button size="1" color="red" variant="ghost" disabled={!canEditItems} onClick={(event) => { event.stopPropagation(); if (window.confirm(`删除“${item.challenge}”？相关签认将立即失效。`)) store.deleteItem(item.id); }}>删除</Button>
                                </div>
                              </article>
                            );
                          })}
                          {!items.length && <button className="empty-row" disabled={!canEditItems} onClick={() => { setQuickStageId(stage.id); challengeRef.current?.focus(); }}>＋ 为本阶段新增第一个检查项（机长）</button>}
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>

                <aside className="inspector">
                  <ScrollArea type="auto" scrollbars="vertical" style={{ height: 'calc(100vh - 200px)' }}>
                    <div className="inspector-inner">
                      <section>
                        <Flex justify="between" align="center" mb="3"><Heading size="4">检查项详情</Heading>{selectedItem && <Badge variant="soft">#{selectedItem.order + 1}</Badge>}</Flex>
                        {selectedItem ? (
                          <div className="inspector-form">
                            <label><span>挑战语</span><TextField.Root value={selectedItem.challenge} disabled={!canEditItems} onChange={(event) => store.updateItem(selectedItem.id, { challenge: event.target.value })} /></label>
                            <label><span>预期回应</span><TextField.Root value={selectedItem.response} disabled={!canEditItems} onChange={(event) => store.updateItem(selectedItem.id, { response: event.target.value })} /></label>
                            <Flex justify="between" align="center"><Text size="2" weight="bold">关键标记（机长设置）</Text><Switch checked={selectedItem.critical} disabled={!canEditItems} onCheckedChange={(checked) => store.updateItem(selectedItem.id, { critical: checked })} /></Flex>
                            <label><span>异常处理</span><TextArea value={selectedItem.abnormalProcedure} disabled={!canEditItems} onChange={(event) => store.updateItem(selectedItem.id, { abnormalProcedure: event.target.value })} placeholder="异常条件、立即动作和后续步骤" /></label>
                            <div>
                              <Text size="2" weight="bold" mb="2" as="p">前置条件</Text>
                              <div className="precondition-list">
                                {project.items.filter((item) => item.id !== selectedItem.id).sort((a, b) => a.order - b.order).map((item) => (
                                  <label key={item.id} className="check-row">
                                    <input type="checkbox" checked={selectedItem.preconditionIds.includes(item.id)} disabled={!canEditItems} onChange={() => togglePrecondition(selectedItem, item.id)} />
                                    <span>{item.challenge || '未命名'}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <Text size="1" color="gray">Alt+↑/↓ 调整顺序 · 拖动左侧把手可跨阶段移动（机长）</Text>
                            <Separator size="4" />
                            <CriticalSignoffPanel
                              project={project}
                              item={selectedItem}
                              canSign={canSign}
                              reviewerName={reviewerName}
                              onSign={() => store.signCritical(selectedItem.id, reviewerName)}
                            />
                          </div>
                        ) : <Text color="gray">从清单中选择一个检查项进行编辑。</Text>}
                      </section>
                      <Separator size="4" />
                      <section>
                        <Flex justify="between" align="center" mb="2"><Heading size="4">发布校验</Heading><Badge color={errors ? 'red' : warnings ? 'amber' : 'green'}>{errors ? '未通过' : warnings ? '需确认' : '通过'}</Badge></Flex>
                        <Progress value={issues.length ? Math.max(8, 100 - errors * 22 - warnings * 8) : 100} color={errors ? 'red' : warnings ? 'amber' : 'green'} />
                        <div className="issue-list">
                          {issues.length ? issues.map((issue) => (
                            <button key={issue.id} className={`issue-card ${issue.level}`} onClick={() => selectIssue(issue)}>
                              <Badge color={issueMeta[issue.level].color} size="1">{issueMeta[issue.level].label}</Badge>
                              <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                            </button>
                          )) : <Callout.Root color="green"><Callout.Text>当前检查单通过全部结构与顺序校验。</Callout.Text></Callout.Root>}
                        </div>
                      </section>
                      <Separator size="4" />
                      <section>
                        <Heading size="4" mb="3">键盘操作</Heading>
                        <div className="shortcut-grid">
                          <span><kbd>/</kbd> 聚焦快速录入</span>
                          <span><kbd>⌘/Ctrl+Enter</kbd> 新增检查项</span>
                          <span><kbd>Alt+↑/↓</kbd> 移动选中项</span>
                          <span><kbd>⌘/Ctrl+Z</kbd> 撤销编辑</span>
                        </div>
                      </section>
                    </div>
                  </ScrollArea>
                </aside>
              </div>
            </Tabs.Content>

            <Tabs.Content value="signoff">
              <SignoffTab
                project={project}
                role={role}
                canSign={canSign}
                reviewerName={reviewerName}
                onSign={(itemId) => store.signCritical(itemId, reviewerName)}
                onSelectItem={(itemId) => { setSelectedItemId(itemId); setActiveTab('editor'); }}
              />
            </Tabs.Content>

            <Tabs.Content value="versions">
              <div className="content-page">
                <Heading size="7">版本差异</Heading>
                <Text color="gray" as="p">冻结版本不可修改；创建修订后形成新的编辑中版本。标注“历史旧档”的冻结记录缺少角色信息，仅供只读查看。</Text>
                <div className="version-controls">
                  <label><span>基准版本</span><Select.Root value={leftVersion} onValueChange={setLeftVersion}><Select.Trigger variant="soft" /><Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content></Select.Root></label>
                  <span className="version-arrow">→</span>
                  <label><span>比较版本</span><Select.Root value={rightVersion} onValueChange={setRightVersion}><Select.Trigger variant="soft" /><Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content></Select.Root></label>
                </div>
                <div className="diff-list">
                  {diffEntries.length ? diffEntries.map((entry) => (
                    <Card key={`${entry.type}-${entry.key}`} className="diff-card">
                      <Flex justify="between" align="center"><Badge color={entry.type === 'added' ? 'green' : entry.type === 'removed' ? 'red' : entry.type === 'stage' ? 'blue' : 'amber'}>{entry.type === 'added' ? '新增' : entry.type === 'removed' ? '删除' : entry.type === 'stage' ? '阶段' : '修改'}</Badge><Text size="1" color="gray">{entry.stage}</Text></Flex>
                      <Grid columns="2" gap="3" mt="3" className="diff-columns">
                        <div className="diff-before"><Text size="1" weight="bold">基准</Text><pre>{entry.before}</pre></div>
                        <div className="diff-after"><Text size="1" weight="bold">比较版本</Text><pre>{entry.after}</pre></div>
                      </Grid>
                    </Card>
                  )) : <div className="empty-page"><strong>两个版本没有差异</strong><span>选择不同版本后可查看新增、删除和修改的检查项。</span></div>}
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="print">
              <div className="content-page">
                <Flex justify="between" align="center" mb="4">
                  <div><Heading size="7">打印预览</Heading><Text color="gray" as="p">{project.name} · 选择当前版本或任意冻结快照 · 只读排版</Text></div>
                  <Flex gap="2" align="center">
                    <Select.Root value={printVersion} onValueChange={setPrintVersion}>
                      <Select.Trigger variant="soft" aria-label="选择打印版本" style={{ minWidth: 260 }} />
                      <Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content>
                    </Select.Root>
                    <Button variant="soft" disabled={!printView} onClick={() => printView && downloadPrintableHtml(printView)}>导出 HTML</Button>
                    <Button disabled={!printView} onClick={() => window.print()}>打印 / PDF</Button>
                  </Flex>
                </Flex>
                {printView && <PrintableChecklist view={printView} />}
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </main>
      </div>

      <Dialog.Root open={showPreview} onOpenChange={setShowPreview}>
        <Dialog.Content maxWidth="850px" className="preview-dialog">
          <Dialog.Title>只读检查单预览</Dialog.Title>
          <Dialog.Description size="2" color="gray">{project.name} · r{project.revision} · {statusMeta[project.status].label}</Dialog.Description>
          <div className="dialog-scroll">{currentView && <PrintableChecklist view={currentView} compact />}</div>
          <Flex gap="3" justify="end" mt="4"><Dialog.Close><Button variant="soft">关闭</Button></Dialog.Close><Button onClick={printActiveView}>打印</Button></Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={freezeOpen} onOpenChange={setFreezeOpen}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>冻结 r{project.revision}</Dialog.Title>
          <Dialog.Description size="2" color="gray">冻结快照将保留阶段、检查项、角色留痕、全部关键项签认及失效原因；冻结后只能由机长创建新修订。</Dialog.Description>
          <div className="freeze-form">
            <label><span>冻结人署名（复核员）</span><TextField.Root value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} placeholder="例如：张晨" /></label>
            <label><span>复核意见 / 版本说明</span><TextArea value={freezeNote} onChange={(event) => setFreezeNote(event.target.value)} placeholder="复核通过并冻结" /></label>
            {blockers.length > 0 && (
              <Callout.Root color="red">
                <Callout.Text>
                  以下关键项未完成有效签认，重新确认前不能冻结：
                  <ul className="blocker-list">
                    {blockers.map((blocker) => <li key={blocker.itemId}>{blocker.challenge} — {blocker.reason}</li>)}
                  </ul>
                </Callout.Text>
              </Callout.Root>
            )}
          </div>
          <Flex gap="3" justify="end" mt="4">
            <Dialog.Close><Button variant="soft">取消</Button></Dialog.Close>
            <Button color="green" disabled={Boolean(freezeDisabledReason)} onClick={() => { if (store.freezeRevision(freezeNote, reviewerName)) { setFreezeOpen(false); setFreezeNote(''); } }}>确认冻结</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={returnOpen} onOpenChange={setReturnOpen}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>退回机长修改</Dialog.Title>
          <Dialog.Description size="2" color="gray">退回后关键项内容、顺序或前置条件一旦改动，原签认立即失效，需重新签认后才能再次冻结。</Dialog.Description>
          <TextArea mt="4" value={returnNote} onChange={(event) => setReturnNote(event.target.value)} placeholder="退回原因，如：起飞构型回应需与手册对齐" />
          <Flex gap="3" justify="end" mt="4">
            <Dialog.Close><Button variant="soft">取消</Button></Dialog.Close>
            <Button color="amber" onClick={() => { if (store.returnToDraft(returnNote, reviewerName)) { setReturnOpen(false); setReturnNote(''); } }}>确认退回</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showHelp} onOpenChange={setShowHelp}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>键盘快速操作</Dialog.Title>
          <div className="help-list">
            <div><kbd>⌘/Ctrl + K</kbd><span>聚焦全局搜索</span></div>
            <div><kbd>/</kbd><span>聚焦快速录入挑战语</span></div>
            <div><kbd>⌘/Ctrl + Enter</kbd><span>新增检查项（机长）</span></div>
            <div><kbd>Alt + ↑ / ↓</kbd><span>移动当前选中检查项（机长）</span></div>
            <div><kbd>⌘/Ctrl + Z</kbd><span>撤销最近一次编辑</span></div>
            <div><kbd>⇧ + ⌘/Ctrl + Z</kbd><span>重做编辑</span></div>
            <div><kbd>⌘/Ctrl + S</kbd><span>立即保存到浏览器</span></div>
          </div>
          <Flex justify="end" mt="4"><Dialog.Close><Button>了解了</Button></Dialog.Close></Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Theme>
  );
}

function CriticalSignoffPanel({ project, item, canSign, reviewerName, onSign }: {
  project: Pick<ChecklistProject, 'signoffs' | 'status'>;
  item: ChecklistItem;
  canSign: boolean;
  reviewerName: string;
  onSign: () => void;
}) {
  const active = activeSignoff(project, item.id);
  const last = latestSignoff(project, item.id);
  const history = signoffHistory(project, item.id);
  if (!item.critical) {
    return <Callout.Root color="gray" size="1"><Callout.Text>非关键项，无需复核员签认。</Callout.Text></Callout.Root>;
  }
  return (
    <div className="signoff-panel">
      <Flex justify="between" align="center">
        <Text size="2" weight="bold">关键项签认（复核员）</Text>
        {active
          ? <Badge color="green">已签认</Badge>
          : last?.invalidated
            ? <Badge color="red">签认失效</Badge>
            : <Badge color="amber">待签认</Badge>}
      </Flex>
      {active && <Text size="1" color="green" as="p">✓ {describeSigner(active)} · {new Date(active.signedAt).toLocaleString('zh-CN')}</Text>}
      {!active && last?.invalidated && (
        <Callout.Root color="red" size="1" mt="2">
          <Callout.Text>
            失效原因：{(last.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、')}
            <br /><small>{last.invalidDetail}</small>
          </Callout.Text>
        </Callout.Root>
      )}
      <Tooltip content={canSign ? (reviewerName ? `以复核员 ${reviewerName} 身份签认` : '以复核员身份签认') : '仅复核员在非冻结状态可签认'}>
        <Button size="2" color="red" variant="soft" disabled={!canSign} onClick={onSign} mt="2">
          {active ? '重新签认' : last?.invalidated ? '失效后重新签认' : '签认本关键项'}
        </Button>
      </Tooltip>
      {history.length > 0 && (
        <details className="signoff-history">
          <summary>签认记录（{history.length}）</summary>
          {history.slice(0, 6).map((record) => (
            <div key={record.id} className="signoff-history-row">
              <Badge color={record.invalidated ? 'red' : 'green'} size="1">{record.invalidated ? '已失效' : '有效'}</Badge>
              <span>{describeSigner(record)} · {new Date(record.signedAt).toLocaleString('zh-CN')}</span>
              {record.invalidated && <small>{(record.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、')}</small>}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function SignoffTab({ project, role, canSign, reviewerName, onSign, onSelectItem }: {
  project: ChecklistProject;
  role: Role;
  canSign: boolean;
  reviewerName: string;
  onSign: (itemId: string) => void;
  onSelectItem: (itemId: string) => void;
}) {
  const frozen = project.status === 'frozen';
  const batchPlan = useMemo(() => computeCriticalBatches(project), [project]);
  return (
    <div className="content-page signoff-page">
      <Heading size="7">关键项签认</Heading>
      <Text color="gray" as="p">复核员按可执行批次逐条签认。关键项内容、顺序或前置条件任一改动，原签认立即失效并重算批次；重新确认前不能冻结。</Text>

      <Callout.Root color={role === 'reviewer' ? (frozen ? 'green' : 'red') : 'gray'} mt="3">
        <Callout.Text>
          {frozen
            ? '当前修订已冻结，签认记录随快照只读保留。'
            : role === 'reviewer'
              ? `复核员视角${reviewerName ? `：${reviewerName}` : ''}。共 ${project.items.filter((item) => item.critical).length} 个关键项、${batchPlan.batches.length} 个批次，已连续签认 ${batchPlan.executableBatches} 个批次可执行。`
              : `只读视角：关键项签认仅由复核员处理，当前角色为${roleMeta[role].label}。`}
        </Callout.Text>
      </Callout.Root>

      {!batchPlan.batches.length && (
        <div className="empty-page" style={{ marginTop: 18 }}><strong>暂无关键项</strong><span>机长在检查项详情中打开“关键标记”后，这里会出现签认批次。</span></div>
      )}

      <div className="batch-list">
        {batchPlan.batches.map((batch) => {
          const executable = batch.batchNo <= batchPlan.executableBatches;
          return (
            <Card key={batch.batchNo} className={`batch-card ${executable ? 'executable' : ''} ${batch.signed ? 'signed' : ''}`}>
              <Flex justify="between" align="center" mb="3">
                <Flex gap="2" align="center">
                  <span className="batch-chip">批次 {batch.batchNo}</span>
                  <Badge variant="soft">{batch.stageName}</Badge>
                  <Text size="1" color="gray">{batch.items.length} 个关键项</Text>
                </Flex>
                {batch.signed
                  ? <Badge color="green">本批已签认{executable ? ' · 可执行' : ' · 后续批次待重算'}</Badge>
                  : <Badge color="amber">{executable ? '等待签认' : '前序批次未全部有效，暂不可执行'}</Badge>}
              </Flex>
              <div className="batch-items">
                {batch.items.map((item) => (
                  <BatchSignoffRow key={item.id} item={item} project={project} canSign={canSign} onSign={onSign} onSelectItem={onSelectItem} />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function BatchSignoffRow({ item, project, canSign, onSign, onSelectItem }: {
  item: ChecklistItem;
  project: ChecklistProject;
  canSign: boolean;
  onSign: (itemId: string) => void;
  onSelectItem: (itemId: string) => void;
}) {
  const active = activeSignoff(project, item.id);
  const last = latestSignoff(project, item.id);
  return (
    <div className={`batch-row ${active ? 'is-signed' : last?.invalidated ? 'is-invalid' : ''}`}>
      <div className="batch-row-copy">
        <Flex gap="2" align="center" wrap="wrap">
          <strong>{item.challenge || '未命名检查项'}</strong>
          <Badge color="red" size="1">关键</Badge>
          <code>{item.response || '缺少回应'}</code>
        </Flex>
        {active ? (
          <Text size="1" color="green" as="p">✓ {describeSigner(active)} 于 {new Date(active.signedAt).toLocaleString('zh-CN')} 签认</Text>
        ) : last?.invalidated ? (
          <Text size="1" color="red" as="p">
            原签认（{describeSigner(last)}）已失效：{(last.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、')}
            <br /><small>{last.invalidDetail}</small>
          </Text>
        ) : (
          <Text size="1" color="amber" as="p">尚未签认，冻结前必须由复核员确认。</Text>
        )}
      </div>
      <Flex gap="2" align="center">
        <Button size="1" variant="ghost" onClick={() => onSelectItem(item.id)}>查看项</Button>
        <Tooltip content={canSign ? '复核员签认' : '仅复核员可签认'}>
          <Button size="1" color="red" variant={active ? 'soft' : 'solid'} disabled={!canSign} onClick={() => onSign(item.id)}>
            {active ? '重新签认' : '签认'}
          </Button>
        </Tooltip>
      </Flex>
    </div>
  );
}

function PrintableChecklist({ view, compact = false }: { view: PrintView; compact?: boolean }) {
  const stages = view.stages.slice().sort((a, b) => a.order - b.order);
  const criticalItems = view.items.filter((item) => item.critical);
  const signoffState = (itemId: string): { state: 'signed' | 'invalid' | 'unsigned'; signoff?: CriticalSignoff } => {
    const history = view.signoffs.filter((signoff) => signoff.itemId === itemId);
    const active = history.find((signoff) => !signoff.invalidated);
    if (active) return { state: 'signed', signoff: active };
    return history[0] ? { state: 'invalid', signoff: history[0] } : { state: 'unsigned' };
  };
  return (
    <article className={`print-sheet ${compact ? 'compact' : ''}`}>
      <header>
        <div>
          <Heading size="7">{view.name}</Heading>
          <Text color="gray" as="p">{view.aircraft} · r{view.revision} · {statusText(view.status)}{view.frozenAt ? ` · 冻结于 ${new Date(view.frozenAt).toLocaleString('zh-CN')}` : ''}</Text>
        </div>
        <Flex direction="column" gap="1" align="end">
          <Badge color={statusMeta[view.status].color}>{view.items.length} 项 · {criticalItems.length} 关键</Badge>
          {view.legacy && <Badge color="amber">历史旧档 · 只读</Badge>}
        </Flex>
      </header>

      {view.legacy && (
        <Callout.Root color="amber" mb="4">
          <Callout.Text>该冻结记录形成于角色留痕上线之前，没有角色、签认信息，按只读历史查看，不能编辑、签认或重新冻结。</Callout.Text>
        </Callout.Root>
      )}

      {!view.legacy && (
        <div className="print-audit">
          <div><span>提交复核</span><strong>{actorLabel(view.submittedBy)}</strong></div>
          <div><span>冻结发布</span><strong>{view.status === 'frozen' ? actorLabel(view.frozenBy) : '—'}</strong></div>
          <div><span>复核说明</span><strong>{view.note || '—'}</strong></div>
        </div>
      )}

      {stages.map((stage, index) => (
        <section key={stage.id}>
          <div className="print-stage-title"><span>{String(index + 1).padStart(2, '0')}</span><div><Heading size="5">{stage.name}</Heading><Text color="gray" size="1">{stage.description}</Text></div></div>
          <table>
            <thead><tr><th style={{ width: '28%' }}>挑战语</th><th style={{ width: '20%' }}>预期回应</th><th>异常处理</th><th style={{ width: '26%' }}>关键项签认</th></tr></thead>
            <tbody>
              {view.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).map((item) => {
                const state = signoffState(item.id);
                return (
                  <tr key={item.id}>
                    <td>{item.critical && <span className="critical-mark">◆</span>} {item.challenge}</td>
                    <td><strong>{item.response || '未填写'}</strong></td>
                    <td>{item.abnormalProcedure || '—'}</td>
                    <td>
                      {!item.critical && <span className="signoff-na">—</span>}
                      {item.critical && state.state === 'signed' && state.signoff && (
                        <span className="signoff-signed">✓ {describeSigner(state.signoff)}<br /><small>{new Date(state.signoff.signedAt).toLocaleString('zh-CN')}</small></span>
                      )}
                      {item.critical && state.state === 'invalid' && state.signoff && (
                        <span className="signoff-invalid">原签认失效：{(state.signoff.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、')}<br /><small>{describeSigner(state.signoff)} 签认 · {state.signoff.invalidDetail}</small></span>
                      )}
                      {item.critical && state.state === 'unsigned' && <span className="signoff-unsigned">未签认</span>}
                    </td>
                  </tr>
                );
              })}
              {!view.items.some((item) => item.stageId === stage.id) && <tr><td colSpan={4}>本阶段暂无检查项</td></tr>}
            </tbody>
          </table>
        </section>
      ))}

      {!view.legacy && criticalItems.length > 0 && (
        <section className="signoff-ledger">
          <Heading size="5" mb="2">关键项签认留痕</Heading>
          <table>
            <thead><tr><th>关键项</th><th>状态</th><th>签认角色</th><th>签认时间</th><th>失效原因</th></tr></thead>
            <tbody>
              {criticalItems.map((item) => {
                const state = signoffState(item.id);
                return (
                  <tr key={item.id}>
                    <td>{item.challenge || '未命名检查项'}</td>
                    <td>{state.state === 'signed' ? '有效' : state.state === 'invalid' ? '已失效' : '未签认'}</td>
                    <td>{state.signoff ? describeSigner(state.signoff) : '—'}</td>
                    <td>{state.signoff ? new Date(state.signoff.signedAt).toLocaleString('zh-CN') : '—'}</td>
                    <td>{state.state === 'invalid' && state.signoff ? (state.signoff.invalidReasons ?? []).map((reason) => invalidReasonMeta[reason].label).join('、') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}

export default App;
