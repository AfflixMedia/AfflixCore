import { useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';

type Priority = 'low' | 'mid' | 'high';
type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'every_n_days';

interface Task {
  id: string;
  created_by: string | null;
  assignee_id: string;
  brand_id: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'done';
  priority: Priority;
  folder_id: string | null;
  label_ids: string[];
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  group_id: string | null;
  seen_at: string | null;
}
// A card in the assigner's list: either a single task (isGroup=false) or a set
// of rows sharing a group_id — one task assigned to several people.
interface TaskGroup { key: string; tasks: Task[]; isGroup: boolean; }
interface PersonLite { id: string; full_name: string | null; email: string; }
interface BrandLite { id: string; name: string; }
interface OrgItem { id: string; name: string; color: string | null; owner_id: string; }
// A reminder row (used to surface acknowledgements in the task list).
interface ReminderLite {
  id: string; task_id: string; assignee_id: string; created_by: string | null;
  created_at: string; acknowledged_at: string | null;
  ack_response: 'seen' | 'on_it' | 'done' | null;
}
// A recurring-task schedule (auto-assigns each period).
interface Recurrence {
  id: string; created_by: string | null; title: string; description: string | null;
  brand_id: string | null; priority: Priority; folder_id: string | null; label_ids: string[];
  assignee_ids: string[]; frequency: Exclude<Repeat, 'none'>;
  interval_days: number | null; weekday: number | null; day_of_month: number | null;
  due_offset_days: number | null; active: boolean; next_run: string; last_run_at: string | null;
  created_at: string;
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ACK_META: Record<'seen' | 'on_it' | 'done', { icon: string; label: string; cls: string }> = {
  seen: { icon: '👁', label: 'Seen', cls: 'seen' },
  on_it: { icon: '👍', label: 'On it', cls: 'onit' },
  done: { icon: '✅', label: 'Done', cls: 'done' },
};

// Plain-language description of the repeat settings on the create form.
function recurrencePreview(f: { repeat: Repeat; rep_weekday: number; rep_dom: number; rep_n: number }): string {
  switch (f.repeat) {
    case 'daily': return 'every day';
    case 'weekly': return `every ${WEEKDAYS[f.rep_weekday]}`;
    case 'monthly': return `monthly on day ${f.rep_dom}`;
    case 'every_n_days': return `every ${f.rep_n} days`;
    default: return '';
  }
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const ORG_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#64748b'];

// Task assignment. A Team Lead (or Bob) assigns tasks to APCs, sets a priority,
// organises them into folders + labels, and can push a blocking reminder. The
// APC sees "My tasks" and marks them done. Notifications fire via DB triggers.
export default function Tasks() {
  const { profile, user } = useAuth();
  const myId = user?.id;
  const isApc = profile?.role === 'apc';
  const isBob = profile?.role === 'bob';
  const canAssign = profile?.role === 'team_lead' || isBob;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Map<string, PersonLite>>(new Map());
  const [myApcs, setMyApcs] = useState<PersonLite[]>([]);
  const [teamLeads, setTeamLeads] = useState<PersonLite[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  // brand → its APC / Team Lead, so a brand chip can auto-fill the assignee.
  const [brandApc, setBrandApc] = useState<Map<string, string>>(new Map());
  const [brandLead, setBrandLead] = useState<Map<string, string>>(new Map());
  const [folders, setFolders] = useState<OrgItem[]>([]);
  const [labels, setLabels] = useState<OrgItem[]>([]);
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  // Latest reminder per task_id → drives the "acknowledged by" chip.
  const [reminderByTask, setReminderByTask] = useState<Map<string, ReminderLite>>(new Map());
  const [showRecur, setShowRecur] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filters (left rail)
  const [folderFilter, setFolderFilter] = useState<string>('all'); // 'all' | 'none' | folderId
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());

  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null); // editing a whole multi-assignee group
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null); // task open in detail popup
  const brandBarRef = useRef<HTMLDivElement>(null);
  const tlRailRef = useRef<HTMLDivElement>(null);
  const [tlOverflow, setTlOverflow] = useState(false); // show up/down arrows on the Team Lead rail
  const [form, setForm] = useState({
    assignee_ids: [] as string[], brand_id: '', title: '', description: '', due_date: '',
    priority: 'mid' as Priority, folder_id: '', label_ids: [] as string[],
    // Recurrence (new task only): 'none' = one-off. rep_due '' = no due date.
    repeat: 'none' as Repeat, rep_weekday: 1, rep_dom: 1, rep_n: 7, rep_due: '' as string,
  });
  const [saving, setSaving] = useState(false);
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  const [showOrg, setShowOrg] = useState(false);
  const [query, setQuery] = useState('');

  // `silent` reloads refresh data in place (after a mutation or a realtime event)
  // without flashing the full-page spinner — only the first load shows it.
  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setErr(null);
    // Materialize any due recurring tasks first, so they show up in this fetch.
    // Idempotent server-side; only staff have recurrences to generate.
    if (!opts?.silent && canAssign) {
      await supabase.rpc('generate_due_recurring_tasks');
    }
    const [tRes, brRes, apcRes, tlRes, fRes, lRes, abRes, tlbRes, recRes, remRes] = await Promise.all([
      supabase.from('tasks').select('*').order('status').order('due_date', { nullsFirst: false }).order('created_at', { ascending: false }),
      canAssign ? supabase.from('brands').select('id,name').order('name') : Promise.resolve({ data: [], error: null }),
      canAssign ? supabase.from('profiles').select('id,full_name,email').eq('role', 'apc').order('full_name') : Promise.resolve({ data: [], error: null }),
      isBob ? supabase.from('profiles').select('id,full_name,email').eq('role', 'team_lead').order('full_name') : Promise.resolve({ data: [], error: null }),
      supabase.from('task_folders').select('id,name,color,owner_id').order('name'),
      supabase.from('task_labels').select('id,name,color,owner_id').order('name'),
      canAssign ? supabase.from('apc_brands').select('apc_id,brand_id') : Promise.resolve({ data: [], error: null }),
      isBob ? supabase.from('team_lead_brands').select('team_lead_id,brand_id') : Promise.resolve({ data: [], error: null }),
      canAssign ? supabase.from('task_recurrences').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      supabase.from('task_reminders').select('id,task_id,assignee_id,created_by,created_at,acknowledged_at,ack_response').order('created_at', { ascending: false }),
    ]);
    if (tRes.error) { setErr(tRes.error.message); setLoading(false); return; }
    const ts = (tRes.data as Task[]) ?? [];
    setTasks(ts);
    setBrands(((brRes as any).data ?? []) as BrandLite[]);
    setMyApcs(((apcRes as any).data ?? []) as PersonLite[]);
    setTeamLeads(((tlRes as any).data ?? []) as PersonLite[]);
    setFolders(((fRes as any).data ?? []) as OrgItem[]);
    setLabels(((lRes as any).data ?? []) as OrgItem[]);
    setRecurrences(((recRes as any).data ?? []) as Recurrence[]);
    setBrandApc(new Map(((abRes as any).data ?? []).map((r: any) => [r.brand_id, r.apc_id])));
    setBrandLead(new Map(((tlbRes as any).data ?? []).map((r: any) => [r.brand_id, r.team_lead_id])));
    // Latest reminder per task (rows arrive newest-first, so first wins).
    const rmap = new Map<string, ReminderLite>();
    (((remRes as any).data ?? []) as ReminderLite[]).forEach(r => { if (!rmap.has(r.task_id)) rmap.set(r.task_id, r); });
    setReminderByTask(rmap);

    // Resolve names for assignees + creators (RLS returns what each role may see).
    const ids = Array.from(new Set(ts.flatMap(t => [t.assignee_id, t.created_by]).filter(Boolean) as string[]));
    if (ids.length > 0) {
      const { data: ppl } = await supabase.from('profiles').select('id,full_name,email').in('id', ids);
      const m = new Map<string, PersonLite>();
      (ppl ?? []).forEach((p: PersonLite) => m.set(p.id, p));
      setPeople(m);
    } else {
      setPeople(new Map());
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profile?.role]);

  // Live updates: re-load when a task, reminder (ack), or recurrence changes.
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel('tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load({ silent: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_reminders' }, () => load({ silent: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_recurrences' }, () => load({ silent: true }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [myId]);

  // Show the Team Lead rail's up/down arrows only when its avatars overflow.
  useEffect(() => {
    const el = tlRailRef.current;
    if (!el) { setTlOverflow(false); return; }
    const check = () => setTlOverflow(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [teamLeads.length, loading]);

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);
  const folderMap = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const labelMap = useMemo(() => new Map(labels.map(l => [l.id, l])), [labels]);
  // Every person we might need a name for (assignees, creators, brand owners).
  const allPeople = useMemo(() => {
    const m = new Map<string, string>();
    people.forEach((p, id) => m.set(id, p.full_name || p.email));
    myApcs.forEach(p => m.set(p.id, p.full_name || p.email));
    teamLeads.forEach(p => m.set(p.id, p.full_name || p.email));
    return m;
  }, [people, myApcs, teamLeads]);
  const personName = (id: string | null) => {
    if (!id) return '—';
    if (id === myId) return 'You';
    return allPeople.get(id) ?? '—';
  };
  // Who owns a brand: its APC, else (Bob's view) its Team Lead.
  const brandOwnerName = (brandId: string): string | null => {
    const id = brandApc.get(brandId) ?? (isBob ? brandLead.get(brandId) : undefined);
    return id ? (allPeople.get(id) ?? null) : null;
  };

  // Apply folder + label + text filters before splitting open/done.
  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(t => {
      if (folderFilter === 'none' && t.folder_id) return false;
      if (folderFilter !== 'all' && folderFilter !== 'none' && t.folder_id !== folderFilter) return false;
      if (labelFilter.size > 0 && !t.label_ids?.some(id => labelFilter.has(id))) return false;
      if (q) {
        const brand = t.brand_id ? (brandMap.get(t.brand_id) ?? '') : '';
        const hay = `${t.title} ${t.description ?? ''} ${brand}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, folderFilter, labelFilter, query, brandMap]);

  const openTasks = visibleTasks.filter(t => t.status === 'open');
  const doneTasks = visibleTasks.filter(t => t.status === 'done');

  // Collapse rows sharing a group_id into one card (assigner view only — an APC
  // only ever holds their own single row). Rows created together share every
  // shared field, so grouping after the folder/label/search filter is safe.
  const groups = useMemo<TaskGroup[]>(() => {
    if (!canAssign) return visibleTasks.map(t => ({ key: t.id, tasks: [t], isGroup: false }));
    const map = new Map<string, Task[]>();
    const order: string[] = [];
    for (const t of visibleTasks) {
      const key = t.group_id ?? t.id;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(t);
    }
    return order.map(key => {
      const ts = map.get(key)!;
      return { key, tasks: ts, isGroup: ts.length > 1 };
    });
  }, [visibleTasks, canAssign]);
  // A group is "open" while any member is open; "done" only when all are done.
  const openGroups = groups.filter(g => g.tasks.some(t => t.status === 'open'));
  const doneGroups = groups.filter(g => g.tasks.every(t => t.status === 'done'));

  // Ordered list the detail popup arrows step through (open first, then done).
  const ordered = useMemo(() => [...openTasks, ...doneTasks], [openTasks, doneTasks]);
  const detailIdx = detailId ? ordered.findIndex(t => t.id === detailId) : -1;
  const detailTask = detailIdx >= 0 ? ordered[detailIdx] : null;

  // Opening a task I'm assigned marks it seen (read receipt for the assigner).
  useEffect(() => {
    if (detailTask && detailTask.assignee_id === myId && !detailTask.seen_at) markSeen(detailTask);
    // eslint-disable-next-line
  }, [detailId]);

  // Open-task counts for the rail badges + header stats.
  const stats = useMemo(() => {
    const open = tasks.filter(t => t.status === 'open');
    const today = new Date().toISOString().slice(0, 10);
    const folder = new Map<string, number>();
    const label = new Map<string, number>();
    let noFolder = 0;
    open.forEach(t => {
      if (t.folder_id) folder.set(t.folder_id, (folder.get(t.folder_id) ?? 0) + 1); else noFolder++;
      (t.label_ids ?? []).forEach(id => label.set(id, (label.get(id) ?? 0) + 1));
    });
    return {
      total: open.length,
      noFolder,
      folder,
      label,
      high: open.filter(t => t.priority === 'high').length,
      overdue: open.filter(t => t.due_date && t.due_date < today).length,
    };
  }, [tasks]);

  const openAdd = (assigneeId?: string) => {
    setEditingId(null); setEditingGroupId(null);
    setForm({
      assignee_ids: assigneeId ? [assigneeId] : [], brand_id: '', title: '', description: '', due_date: '',
      priority: 'mid',
      folder_id: folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : '',
      label_ids: [],
      repeat: 'none', rep_weekday: 1, rep_dom: 1, rep_n: 7, rep_due: '',
    });
    setErr(null);
    setShow(true);
  };

  // Click a brand chip → New Task with the brand + its owner pre-filled.
  // APC owns the brand (apc_brands); Bob also falls back to the brand's Team Lead.
  const openAddForBrand = (brandId: string) => {
    setEditingId(null); setEditingGroupId(null);
    const apc = brandApc.get(brandId);
    const lead = brandLead.get(brandId);
    const owner = apc ?? (isBob ? lead : undefined);
    setForm({
      assignee_ids: owner ? [owner] : [],
      brand_id: brandId, title: '', description: '', due_date: '',
      priority: 'mid',
      folder_id: folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : '',
      label_ids: [],
      repeat: 'none', rep_weekday: 1, rep_dom: 1, rep_n: 7, rep_due: '',
    });
    setErr(null);
    setShow(true);
  };

  const scrollBrandBar = (dir: -1 | 1) => {
    brandBarRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  };
  const scrollTlRail = (dir: -1 | 1) => {
    tlRailRef.current?.scrollBy({ top: dir * 180, behavior: 'smooth' });
  };

  const openEdit = (t: Task) => {
    setEditingId(t.id); setEditingGroupId(null);
    setForm({
      assignee_ids: [t.assignee_id],
      brand_id: t.brand_id ?? '',
      title: t.title,
      description: t.description ?? '',
      due_date: t.due_date ?? '',
      priority: t.priority,
      folder_id: t.folder_id ?? '',
      label_ids: t.label_ids ?? [],
      repeat: 'none', rep_weekday: 1, rep_dom: 1, rep_n: 7, rep_due: '',
    });
    setErr(null);
    setShow(true);
  };

  // Edit every row of a multi-assignee group at once (shared fields only;
  // the set of assignees stays fixed).
  const openEditGroup = (g: TaskGroup) => {
    const t = g.tasks[0];
    setEditingId(null); setEditingGroupId(g.key);
    setForm({
      assignee_ids: g.tasks.map(x => x.assignee_id),
      brand_id: t.brand_id ?? '',
      title: t.title,
      description: t.description ?? '',
      due_date: t.due_date ?? '',
      priority: t.priority,
      folder_id: t.folder_id ?? '',
      label_ids: t.label_ids ?? [],
      repeat: 'none', rep_weekday: 1, rep_dom: 1, rep_n: 7, rep_due: '',
    });
    setErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!myId) return;
    setSaving(true); setErr(null);
    try {
      const base = {
        brand_id: form.brand_id || null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        due_date: form.due_date || null,
        priority: form.priority,
        folder_id: form.folder_id || null,
        label_ids: form.label_ids,
      };
      const ids = Array.from(new Set(form.assignee_ids)).filter(Boolean);
      if (editingId) {
        // A row targets one assignee; editing keeps the first selection.
        const { error } = await supabase.from('tasks').update({ assignee_id: ids[0], ...base }).eq('id', editingId);
        if (error) throw error;
      } else if (editingGroupId) {
        // Editing a whole group updates the shared fields on every member row.
        const { error } = await supabase.from('tasks').update(base).eq('group_id', editingGroupId);
        if (error) throw error;
      } else if (form.repeat !== 'none') {
        // Create a recurring schedule; it auto-assigns each period. next_run =
        // today so the first occurrence is generated immediately (below).
        if (ids.length === 0) throw new Error('Pick at least one person to assign to.');
        const rec = {
          created_by: myId,
          title: base.title, description: base.description, brand_id: base.brand_id,
          priority: base.priority, folder_id: base.folder_id, label_ids: base.label_ids,
          assignee_ids: ids,
          frequency: form.repeat,
          interval_days: form.repeat === 'every_n_days' ? Math.max(1, form.rep_n) : null,
          weekday: form.repeat === 'weekly' ? form.rep_weekday : null,
          day_of_month: form.repeat === 'monthly' ? form.rep_dom : null,
          due_offset_days: form.rep_due === '' ? null : Math.max(0, parseInt(form.rep_due, 10) || 0),
          next_run: new Date().toISOString().slice(0, 10),
        };
        const { error } = await supabase.from('task_recurrences').insert(rec);
        if (error) throw error;
        await supabase.rpc('generate_due_recurring_tasks'); // create the first occurrence now
      } else {
        // Create one task row per selected person (fan-out for multi-assign).
        // Rows created together share a group_id so the assigner sees one card.
        if (ids.length === 0) throw new Error('Pick at least one person to assign to.');
        const gid = ids.length > 1 ? crypto.randomUUID() : null;
        const rows = ids.map(id => ({ created_by: myId, assignee_id: id, group_id: gid, ...base }));
        const { error } = await supabase.from('tasks').insert(rows);
        if (error) throw error;
      }
      setShow(false);
      await load({ silent: true });
    } catch (e: any) {
      setErr(e?.message ?? (editingId || editingGroupId ? 'Failed to update task' : 'Failed to create task'));
    } finally {
      setSaving(false);
    }
  };

  const setDone = async (t: Task, done: boolean) => {
    const prev = tasks;
    setTasks(tasks.map(x => x.id === t.id ? { ...x, status: done ? 'done' : 'open' } : x));
    const { error } = await supabase.from('tasks')
      .update({ status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null })
      .eq('id', t.id);
    if (error) { setTasks(prev); alert(error.message); }
  };

  const remove = async (t: Task) => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    const prev = tasks;
    setTasks(tasks.filter(x => x.id !== t.id));
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) { setTasks(prev); alert(error.message); }
  };

  // Push a blocking reminder to the task's APC (assignee filled by DB trigger).
  const sendReminder = async (t: Task) => {
    if (!myId) return;
    const { error } = await supabase.from('task_reminders').insert({ task_id: t.id, created_by: myId });
    if (error) { alert(error.message); return; }
    setReminded(prev => new Set(prev).add(t.id));
    setTimeout(() => setReminded(prev => { const n = new Set(prev); n.delete(t.id); return n; }), 2500);
  };

  // ---- Group-level actions (multi-assignee cards) ----
  const toggleExpand = (key: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  // Remind every still-open assignee in the group at once.
  const remindGroup = async (g: TaskGroup) => {
    if (!myId) return;
    const openIds = g.tasks.filter(t => t.status === 'open').map(t => t.id);
    if (openIds.length === 0) return;
    const { error } = await supabase.from('task_reminders').insert(openIds.map(id => ({ task_id: id, created_by: myId })));
    if (error) { alert(error.message); return; }
    setReminded(prev => { const n = new Set(prev); n.add(g.key); return n; });
    setTimeout(() => setReminded(prev => { const n = new Set(prev); n.delete(g.key); return n; }), 2500);
  };
  // Delete the whole group (all member rows) in one go.
  const removeGroup = async (g: TaskGroup) => {
    if (!confirm(`Delete "${g.tasks[0].title}" for all ${g.tasks.length} people?`)) return;
    const ids = new Set(g.tasks.map(t => t.id));
    const prev = tasks;
    setTasks(tasks.filter(x => !ids.has(x.id)));
    const { error } = await supabase.from('tasks').delete().eq('group_id', g.key);
    if (error) { setTasks(prev); alert(error.message); }
  };

  // ---- Recurring-schedule actions ----
  const setRecurrenceActive = async (r: Recurrence, active: boolean) => {
    const prev = recurrences;
    setRecurrences(recurrences.map(x => x.id === r.id ? { ...x, active } : x));
    const { error } = await supabase.from('task_recurrences').update({ active }).eq('id', r.id);
    if (error) { setRecurrences(prev); alert(error.message); }
  };
  const removeRecurrence = async (r: Recurrence) => {
    if (!confirm(`Delete the recurring schedule "${r.title}"? Already-created tasks stay.`)) return;
    const prev = recurrences;
    setRecurrences(recurrences.filter(x => x.id !== r.id));
    const { error } = await supabase.from('task_recurrences').delete().eq('id', r.id);
    if (error) { setRecurrences(prev); alert(error.message); }
  };
  // Human label for a schedule, e.g. "Every Monday", "Monthly on day 1".
  const recurrenceLabel = (r: Recurrence): string => {
    switch (r.frequency) {
      case 'daily': return 'Every day';
      case 'every_n_days': return `Every ${r.interval_days ?? 1} days`;
      case 'weekly': return `Every ${WEEKDAYS[r.weekday ?? 0]}`;
      case 'monthly': return `Monthly on day ${r.day_of_month ?? 1}`;
      default: return '';
    }
  };

  // Mark my own task as seen the first time I open it (read receipt).
  const markSeen = async (t: Task) => {
    if (!myId || t.assignee_id !== myId || t.seen_at) return;
    const now = new Date().toISOString();
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, seen_at: now } : x));
    await supabase.from('tasks').update({ seen_at: now }).eq('id', t.id);
  };

  // WhatsApp-style read tick shown to assigners (blue = seen, grey = not seen).
  const seenTick = (t: Task) => {
    if (isApc) return null;
    const seen = !!t.seen_at;
    return (
      <span className={`ac-seen ${seen ? 'seen' : ''}`}
        title={seen ? `Seen ${new Date(t.seen_at!).toLocaleString()}` : 'Delivered · not seen yet'}>
        <i className="bi bi-check2-all" />
      </span>
    );
  };

  // The ack chip shown on a task: acknowledged response, or a pending "reminded".
  const ackChip = (taskId: string) => {
    const r = reminderByTask.get(taskId);
    if (!r) return null;
    if (r.acknowledged_at && r.ack_response) {
      const m = ACK_META[r.ack_response];
      return (
        <span className={`ac-ack ${m.cls}`} title={`Acknowledged ${new Date(r.acknowledged_at).toLocaleString()}`}>
          <span className="ac-ack-emoji">{m.icon}</span>{m.label}
        </span>
      );
    }
    return (
      <span className="ac-ack pending" title={`Reminded ${new Date(r.created_at).toLocaleString()} · awaiting acknowledgement`}>
        <i className="bi bi-alarm" /> Reminded
      </span>
    );
  };

  const toggleFormLabel = (id: string) => {
    setForm(f => ({
      ...f,
      label_ids: f.label_ids.includes(id) ? f.label_ids.filter(x => x !== id) : [...f.label_ids, id],
    }));
  };
  const toggleLabelFilter = (id: string) => {
    setLabelFilter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const TaskCard = ({ t }: { t: Task }) => {
    const overdue = t.status === 'open' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
    const canComplete = t.assignee_id === myId || t.created_by === myId || isBob;
    const canDelete = t.created_by === myId || isBob;
    const canEditTask = canAssign && (t.created_by === myId || isBob);
    const canRemind = !isApc && (t.created_by === myId || isBob);
    const folder = t.folder_id ? folderMap.get(t.folder_id) : null;
    const taskLabels = (t.label_ids ?? []).map(id => labelMap.get(id)).filter(Boolean) as OrgItem[];
    return (
      <div className={`ac-list-row ac-task ac-task--${t.priority} ${t.status === 'done' ? 'opacity-75' : ''}`}>
        <Avatar name={personName(t.assignee_id)} size="lg" />
        <div className="ac-row-main ac-task-open" role="button" tabIndex={0}
          title="Open task"
          onClick={() => setDetailId(t.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(t.id); } }}>
          <div className="ac-row-name d-flex align-items-center gap-2 flex-wrap">
            <span className={t.status === 'done' ? 'text-decoration-line-through text-muted' : ''}>{t.title}</span>
            <span className={`ac-prio-pill prio-${t.priority}`}>{t.priority}</span>
            {t.status === 'done'
              ? <Badge bg="success"><i className="bi bi-check2 me-1" />Done</Badge>
              : overdue && <Badge bg="danger">Overdue</Badge>}
          </div>
          {t.description && <div className="ac-row-sub ac-clamp1">{t.description}</div>}
          <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2 mt-1">
            {!isApc && <span><i className="bi bi-person me-1" />{personName(t.assignee_id)}{seenTick(t)}</span>}
            {isApc && t.created_by && <span><i className="bi bi-person-badge me-1" />from {personName(t.created_by)}</span>}
            {t.brand_id && <span className="ac-chip neutral"><i className="bi bi-shop" /> {brandMap.get(t.brand_id) ?? 'Brand'}</span>}
            {folder && <span className="ac-chip" style={{ borderColor: folder.color ?? undefined, color: folder.color ?? undefined }}><i className="bi bi-folder me-1" />{folder.name}</span>}
            {taskLabels.map(l => (
              <span key={l.id} className="ac-label-chip" style={{ background: (l.color ?? '#64748b') + '22', color: l.color ?? '#64748b' }}>
                <i className="bi bi-tag-fill me-1" />{l.name}
              </span>
            ))}
            {t.due_date && <span><i className="bi bi-calendar-event me-1" />due {new Date(t.due_date).toLocaleDateString()}</span>}
            {!isApc && ackChip(t.id)}
          </div>
        </div>
        <div className="ac-row-actions">
          {canRemind && t.status === 'open' && (
            <button className={`ac-icon-btn remind ${reminded.has(t.id) ? 'sent' : ''}`}
              title={reminded.has(t.id) ? 'Reminder sent' : 'Send blocking reminder'}
              aria-label={reminded.has(t.id) ? 'Reminder sent' : 'Send blocking reminder to assignee'}
              disabled={reminded.has(t.id)}
              onClick={() => sendReminder(t)}>
              <i className={`bi ${reminded.has(t.id) ? 'bi-check2-circle' : 'bi-alarm'}`} />
            </button>
          )}
          {canEditTask && (
            <button className="ac-icon-btn" title="Edit task" aria-label="Edit task"
              onClick={() => openEdit(t)}>
              <i className="bi bi-pencil" />
            </button>
          )}
          {canComplete && (
            <button className="ac-icon-btn" title={t.status === 'done' ? 'Reopen' : 'Mark done'}
              aria-label={t.status === 'done' ? 'Reopen task' : 'Mark task done'}
              onClick={() => setDone(t, t.status !== 'done')}>
              <i className={`bi ${t.status === 'done' ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'}`} />
            </button>
          )}
          {canDelete && (
            <button className="ac-icon-btn danger" title="Delete task" aria-label="Delete task" onClick={() => remove(t)}>
              <i className="bi bi-trash" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // One combined card for a task assigned to several people. Shows aggregate
  // progress + everyone's avatars; expands to per-person rows (each keeps its
  // own status / complete / remind / delete).
  const GroupCard = ({ g }: { g: TaskGroup }) => {
    const t0 = g.tasks[0];
    const today = new Date().toISOString().slice(0, 10);
    const doneCount = g.tasks.filter(t => t.status === 'done').length;
    const total = g.tasks.length;
    const allDone = doneCount === total;
    const anyOverdue = g.tasks.some(t => t.status === 'open' && t.due_date && t.due_date < today);
    const anyOpen = doneCount < total;
    const seenCount = g.tasks.filter(t => t.seen_at).length;
    const expanded = expandedGroups.has(g.key);
    const canManage = t0.created_by === myId || isBob;
    const canRemind = !isApc && canManage;
    const folder = t0.folder_id ? folderMap.get(t0.folder_id) : null;
    const taskLabels = (t0.label_ids ?? []).map(id => labelMap.get(id)).filter(Boolean) as OrgItem[];
    const groupReminded = reminded.has(g.key);
    return (
      <div className={`ac-list-row ac-task ac-task-group ac-task--${t0.priority} ${allDone ? 'opacity-75' : ''}`}>
        <button type="button" className="ac-group-avatars" onClick={() => toggleExpand(g.key)}
          aria-expanded={expanded} title={expanded ? 'Collapse' : 'Show people'}>
          {g.tasks.slice(0, 3).map(t => <Avatar key={t.id} name={personName(t.assignee_id)} size="sm" />)}
          {total > 3 && <span className="ac-group-more">+{total - 3}</span>}
        </button>
        <div className="ac-row-main ac-task-open" role="button" tabIndex={0}
          title={expanded ? 'Collapse' : 'Show people'}
          onClick={() => toggleExpand(g.key)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(g.key); } }}>
          <div className="ac-row-name d-flex align-items-center gap-2 flex-wrap">
            <i className={`bi bi-chevron-${expanded ? 'down' : 'right'} ac-group-caret`} />
            <span className={allDone ? 'text-decoration-line-through text-muted' : ''}>{t0.title}</span>
            <span className={`ac-prio-pill prio-${t0.priority}`}>{t0.priority}</span>
            <span className="ac-group-badge"><i className="bi bi-people-fill me-1" />{total}</span>
            {allDone
              ? <Badge bg="success"><i className="bi bi-check2 me-1" />Done</Badge>
              : anyOverdue && <Badge bg="danger">Overdue</Badge>}
          </div>
          {t0.description && <div className="ac-row-sub ac-clamp1">{t0.description}</div>}
          <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2 mt-1">
            <span className="ac-group-progress">
              <span className="ac-group-bar"><span style={{ width: `${(doneCount / total) * 100}%` }} /></span>
              {doneCount} of {total} done
            </span>
            <span className={`ac-seen ${seenCount === total ? 'seen' : ''}`} title={`${seenCount} of ${total} have seen this`}>
              <i className="bi bi-check2-all" /> {seenCount}/{total} seen
            </span>
            {t0.brand_id && <span className="ac-chip neutral"><i className="bi bi-shop" /> {brandMap.get(t0.brand_id) ?? 'Brand'}</span>}
            {folder && <span className="ac-chip" style={{ borderColor: folder.color ?? undefined, color: folder.color ?? undefined }}><i className="bi bi-folder me-1" />{folder.name}</span>}
            {taskLabels.map(l => (
              <span key={l.id} className="ac-label-chip" style={{ background: (l.color ?? '#64748b') + '22', color: l.color ?? '#64748b' }}>
                <i className="bi bi-tag-fill me-1" />{l.name}
              </span>
            ))}
            {t0.due_date && <span><i className="bi bi-calendar-event me-1" />due {new Date(t0.due_date).toLocaleDateString()}</span>}
          </div>

          {expanded && (
            <div className="ac-group-people" onClick={e => e.stopPropagation()}>
              {g.tasks.map(t => {
                const done = t.status === 'done';
                const overdue = !done && t.due_date && t.due_date < today;
                return (
                  <div key={t.id} className="ac-group-person">
                    <Avatar name={personName(t.assignee_id)} size="sm" />
                    <span className="ac-group-person-name">{personName(t.assignee_id)}{seenTick(t)}</span>
                    {done
                      ? <span className="ac-group-status done"><i className="bi bi-check2-circle me-1" />Done</span>
                      : overdue
                        ? <span className="ac-group-status over"><i className="bi bi-exclamation-triangle me-1" />Overdue</span>
                        : <span className="ac-group-status open">Open</span>}
                    {ackChip(t.id)}
                    <div className="ac-group-person-actions">
                      {canRemind && !done && (
                        <button className={`ac-icon-btn sm remind ${reminded.has(t.id) ? 'sent' : ''}`}
                          title={reminded.has(t.id) ? 'Reminder sent' : 'Remind this person'}
                          disabled={reminded.has(t.id)} onClick={() => sendReminder(t)}>
                          <i className={`bi ${reminded.has(t.id) ? 'bi-check2-circle' : 'bi-alarm'}`} />
                        </button>
                      )}
                      {canManage && (
                        <button className="ac-icon-btn sm" title={done ? 'Reopen' : 'Mark done'}
                          onClick={() => setDone(t, !done)}>
                          <i className={`bi ${done ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'}`} />
                        </button>
                      )}
                      {canManage && (
                        <button className="ac-icon-btn sm danger" title="Remove this person" onClick={() => remove(t)}>
                          <i className="bi bi-x-lg" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="ac-row-actions">
          {canRemind && anyOpen && (
            <button className={`ac-icon-btn remind ${groupReminded ? 'sent' : ''}`}
              title={groupReminded ? 'Reminders sent' : 'Remind everyone still open'}
              aria-label="Remind everyone still open"
              disabled={groupReminded} onClick={() => remindGroup(g)}>
              <i className={`bi ${groupReminded ? 'bi-check2-circle' : 'bi-alarm'}`} />
            </button>
          )}
          {canManage && (
            <button className="ac-icon-btn" title="Edit task for everyone" aria-label="Edit task for everyone"
              onClick={() => openEditGroup(g)}>
              <i className="bi bi-pencil" />
            </button>
          )}
          {canManage && (
            <button className="ac-icon-btn danger" title="Delete for everyone" aria-label="Delete for everyone"
              onClick={() => removeGroup(g)}>
              <i className="bi bi-trash" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderItem = (g: TaskGroup) => g.isGroup
    ? <GroupCard key={g.key} g={g} />
    : <TaskCard key={g.tasks[0].id} t={g.tasks[0]} />;

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>{isApc ? 'My Tasks' : 'Tasks'}</h2>
          <div className="ac-task-stats">
            <span className="ac-task-stat"><span className="ac-task-stat-num">{stats.total}</span> open</span>
            {stats.high > 0 && <span className="ac-task-stat high"><i className="bi bi-flag-fill" />{stats.high} high</span>}
            {stats.overdue > 0 && <span className="ac-task-stat over"><i className="bi bi-exclamation-triangle-fill" />{stats.overdue} overdue</span>}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="ac-task-search">
            <i className="bi bi-search" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search tasks…" aria-label="Search tasks" />
          </div>
          {canAssign && (
            <Button onClick={() => openAdd()}>
              <i className="bi bi-plus-lg me-1" /> New Task
            </Button>
          )}
        </div>
      </div>

      {/* Brand quick-assign bar — click a brand to start a task with its
          APC (and Team Lead, for Bob) auto-filled. Team Leads see only their brands. */}
      {canAssign && brands.length > 0 && (
        <div className="ac-brandbar">
          <button type="button" className="ac-brandbar-arrow" aria-label="Scroll brands left"
            onClick={() => scrollBrandBar(-1)}>
            <i className="bi bi-chevron-left" />
          </button>
          <div className="ac-brandbar-track" ref={brandBarRef}>
            {brands.map(b => {
              const owner = brandOwnerName(b.id);
              return (
                <button key={b.id} type="button" className="ac-brand-chip"
                  onClick={() => openAddForBrand(b.id)}
                  title={`New task for ${b.name}${owner ? ` · ${owner}` : ''}`}>
                  <Avatar name={b.name} size="sm" variant="dark" />
                  <span className="ac-brand-chip-text">
                    <span className="ac-brand-chip-name">{b.name}</span>
                    {owner && <span className="ac-brand-chip-owner">{owner}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" className="ac-brandbar-arrow" aria-label="Scroll brands right"
            onClick={() => scrollBrandBar(1)}>
            <i className="bi bi-chevron-right" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : err ? (
        <Alert variant="danger">{err}</Alert>
      ) : (
        <div className="ac-tasks-layout">
          {/* Left rail: folders + labels */}
          <aside className="ac-tasks-rail">
            <div className="ac-rail-head">
              <span>Folders</span>
              {canAssign && (
                <button className="ac-icon-btn sm" title="Manage folders & labels"
                  aria-label="Manage folders and labels" onClick={() => setShowOrg(true)}>
                  <i className="bi bi-gear" />
                </button>
              )}
            </div>
            <button className={`ac-rail-item ${folderFilter === 'all' ? 'active' : ''}`} onClick={() => setFolderFilter('all')}>
              <i className="bi bi-collection" /><span className="ac-rail-label">All tasks</span>
              <span className="ac-rail-count">{stats.total}</span>
            </button>
            {folders.map(f => (
              <button key={f.id} className={`ac-rail-item ${folderFilter === f.id ? 'active' : ''}`} onClick={() => setFolderFilter(f.id)}>
                <i className="bi bi-folder-fill" style={{ color: f.color ?? undefined }} />
                <span className="ac-rail-label">{f.name}</span>
                {(stats.folder.get(f.id) ?? 0) > 0 && <span className="ac-rail-count">{stats.folder.get(f.id)}</span>}
              </button>
            ))}
            <button className={`ac-rail-item ${folderFilter === 'none' ? 'active' : ''}`} onClick={() => setFolderFilter('none')}>
              <i className="bi bi-folder" /><span className="ac-rail-label">No folder</span>
              {stats.noFolder > 0 && <span className="ac-rail-count">{stats.noFolder}</span>}
            </button>

            {labels.length > 0 && (
              <>
                <div className="ac-rail-head mt-3"><span>Labels</span></div>
                <div className="d-flex flex-wrap gap-1">
                  {labels.map(l => (
                    <button key={l.id}
                      className={`ac-label-chip btn-reset ${labelFilter.has(l.id) ? 'on' : ''}`}
                      aria-pressed={labelFilter.has(l.id)}
                      style={{ background: (l.color ?? '#64748b') + (labelFilter.has(l.id) ? '' : '22'), color: labelFilter.has(l.id) ? '#fff' : (l.color ?? '#64748b') }}
                      onClick={() => toggleLabelFilter(l.id)}>
                      <i className="bi bi-tag-fill me-1" />{l.name}
                      {(stats.label.get(l.id) ?? 0) > 0 && <span className="ac-label-count">{stats.label.get(l.id)}</span>}
                    </button>
                  ))}
                </div>
                {labelFilter.size > 0 && (
                  <button className="ac-rail-clear" onClick={() => setLabelFilter(new Set())}>
                    <i className="bi bi-x-circle me-1" />Clear labels
                  </button>
                )}
              </>
            )}

            {/* Recurring schedules (auto-assigning "alarms") */}
            {canAssign && (
              <>
                <div className="ac-rail-head mt-3"><span>Automation</span></div>
                <button className="ac-rail-item" onClick={() => setShowRecur(true)}>
                  <i className="bi bi-arrow-repeat" /><span className="ac-rail-label">Recurring</span>
                  {recurrences.length > 0 && <span className="ac-rail-count">{recurrences.filter(r => r.active).length}</span>}
                </button>
              </>
            )}
          </aside>

          {/* Right pane: task list */}
          <div className="ac-tasks-main">
            {visibleTasks.length === 0 ? (
              <Card>
                <Card.Body>
                  <div className="ac-empty">
                    <div className="ac-empty-icon"><i className="bi bi-check2-square" /></div>
                    <h5>No tasks {isApc ? 'assigned to you' : 'here'}</h5>
                    <p>{canAssign ? 'Create a task and assign it to one of your APCs.' : 'Tasks your Team Lead assigns will appear here.'}</p>
                    {canAssign && (
                      <Button className="mt-3" onClick={() => openAdd()}><i className="bi bi-plus-lg me-1" /> New Task</Button>
                    )}
                  </div>
                </Card.Body>
              </Card>
            ) : (
              <>
                <div className="ac-task-section">
                  <span className="ac-task-section-dot open" />Open
                  <span className="ac-task-section-count">{openGroups.length}</span>
                </div>
                {openGroups.length === 0 ? (
                  <Card body className="text-muted text-center py-3 mb-4">Nothing open here. 🎉</Card>
                ) : (
                  <div className="ac-list mb-4">{openGroups.map(renderItem)}</div>
                )}
                {doneGroups.length > 0 && (
                  <>
                    <div className="ac-task-section">
                      <span className="ac-task-section-dot done" />Done
                      <span className="ac-task-section-count">{doneGroups.length}</span>
                    </div>
                    <div className="ac-list">{doneGroups.map(renderItem)}</div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Right rail: Team Leads (Bob only) — click an avatar to assign a task.
              Native scrollbar hidden; up/down arrows appear when the list overflows. */}
          {isBob && teamLeads.length > 0 && (
            <aside className="ac-tl-rail" aria-label="Assign a task to a Team Lead">
              <div className="ac-tl-rail-head">Team Leads</div>
              {tlOverflow && (
                <button type="button" className="ac-tl-arrow" aria-label="Scroll team leads up"
                  onClick={() => scrollTlRail(-1)}><i className="bi bi-chevron-up" /></button>
              )}
              <div className="ac-tl-track" ref={tlRailRef}>
                {teamLeads.map(tl => {
                  const name = tl.full_name || tl.email;
                  const open = tasks.filter(t => t.assignee_id === tl.id && t.status === 'open').length;
                  return (
                    <button key={tl.id} type="button" className="ac-tl-avatar-btn"
                      onClick={() => openAdd(tl.id)}
                      aria-label={`Assign a new task to ${name}`}>
                      <Avatar name={name} size="lg" variant="dark" />
                      {open > 0 && <span className="ac-tl-badge">{open}</span>}
                      <span className="ac-tl-tip">Assign task to {name}</span>
                    </button>
                  );
                })}
              </div>
              {tlOverflow && (
                <button type="button" className="ac-tl-arrow" aria-label="Scroll team leads down"
                  onClick={() => scrollTlRail(1)}><i className="bi bi-chevron-down" /></button>
              )}
            </aside>
          )}
        </div>
      )}

      {/* New task modal */}
      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editingId || editingGroupId ? 'Edit Task' : 'New Task'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>
                Assign to
                {!editingId && !editingGroupId && form.assignee_ids.length > 1 && (
                  <span className="text-muted ms-2 small">{form.assignee_ids.length} selected</span>
                )}
              </Form.Label>
              {editingGroupId ? (
                // Group edit changes shared fields for a fixed set of people.
                <>
                  <div className="ac-assignee-chips">
                    {form.assignee_ids.map(id => (
                      <span key={id} className="ac-assignee-chip static">
                        <Avatar name={personName(id)} size="sm" /> {personName(id)}
                      </span>
                    ))}
                  </div>
                  <Form.Text className="text-muted">Editing for all {form.assignee_ids.length} people. Changes apply to everyone; each keeps their own status.</Form.Text>
                </>
              ) : (
                <>
                  <AssigneePicker
                    apcs={myApcs} leads={teamLeads} isBob={isBob}
                    multiple={!editingId}
                    value={form.assignee_ids}
                    onChange={ids => setForm({ ...form, assignee_ids: ids })}
                  />
                  {editingId && <Form.Text className="text-muted">A task has one assignee. To give it to more people, create a new task.</Form.Text>}
                  {myApcs.length === 0 && teamLeads.length === 0 && <Form.Text className="text-danger d-block">You have no APCs yet.</Form.Text>}
                </>
              )}
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Upload week 3 creator videos" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Details <span className="text-muted">(optional)</span></Form.Label>
              <Form.Control as="textarea" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </Form.Group>
            <div className="d-flex gap-3 flex-wrap mb-3">
              <Form.Group className="flex-grow-1">
                <Form.Label>Priority</Form.Label>
                <Form.Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as Priority })}>
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group className="flex-grow-1">
                <Form.Label>Folder <span className="text-muted">(optional)</span></Form.Label>
                <Form.Select value={form.folder_id} onChange={e => setForm({ ...form, folder_id: e.target.value })}>
                  <option value="">No folder</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Form.Select>
              </Form.Group>
            </div>
            {labels.length > 0 && (
              <Form.Group className="mb-3">
                <Form.Label>Labels <span className="text-muted">(optional)</span></Form.Label>
                <div className="d-flex flex-wrap gap-1">
                  {labels.map(l => (
                    <button type="button" key={l.id}
                      className={`ac-label-chip btn-reset ${form.label_ids.includes(l.id) ? 'on' : ''}`}
                      style={{ background: (l.color ?? '#64748b') + (form.label_ids.includes(l.id) ? '' : '22'), color: form.label_ids.includes(l.id) ? '#fff' : (l.color ?? '#64748b') }}
                      onClick={() => toggleFormLabel(l.id)}>
                      <i className="bi bi-tag-fill me-1" />{l.name}
                    </button>
                  ))}
                </div>
              </Form.Group>
            )}
            <div className="d-flex gap-3 flex-wrap">
              <Form.Group className="flex-grow-1">
                <Form.Label>Brand <span className="text-muted">(optional)</span></Form.Label>
                <Form.Select value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">No specific brand</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Form.Select>
              </Form.Group>
              {/* One-off due date only when the task doesn't repeat. */}
              {form.repeat === 'none' && (
                <Form.Group>
                  <Form.Label>Due date <span className="text-muted">(optional)</span></Form.Label>
                  <Form.Control type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                </Form.Group>
              )}
            </div>

            {/* Repeat / "alarm" — new one-off tasks only. Creates a schedule that
                auto-assigns each period. */}
            {!editingId && !editingGroupId && (
              <div className="ac-repeat mt-3">
                <Form.Group>
                  <Form.Label><i className="bi bi-arrow-repeat me-1" />Repeat</Form.Label>
                  <Form.Select value={form.repeat} onChange={e => setForm({ ...form, repeat: e.target.value as Repeat })}>
                    <option value="none">Does not repeat (one-off)</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="every_n_days">Every N days</option>
                  </Form.Select>
                </Form.Group>
                {form.repeat !== 'none' && (
                  <div className="d-flex gap-3 flex-wrap mt-2">
                    {form.repeat === 'weekly' && (
                      <Form.Group className="flex-grow-1">
                        <Form.Label>On</Form.Label>
                        <Form.Select value={form.rep_weekday} onChange={e => setForm({ ...form, rep_weekday: parseInt(e.target.value, 10) })}>
                          {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </Form.Select>
                      </Form.Group>
                    )}
                    {form.repeat === 'monthly' && (
                      <Form.Group className="flex-grow-1">
                        <Form.Label>Day of month</Form.Label>
                        <Form.Control type="number" min={1} max={31} value={form.rep_dom}
                          onChange={e => setForm({ ...form, rep_dom: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })} />
                      </Form.Group>
                    )}
                    {form.repeat === 'every_n_days' && (
                      <Form.Group className="flex-grow-1">
                        <Form.Label>Every … days</Form.Label>
                        <Form.Control type="number" min={1} value={form.rep_n}
                          onChange={e => setForm({ ...form, rep_n: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                      </Form.Group>
                    )}
                    <Form.Group className="flex-grow-1">
                      <Form.Label>Each task is due</Form.Label>
                      <Form.Select value={form.rep_due} onChange={e => setForm({ ...form, rep_due: e.target.value })}>
                        <option value="">No due date</option>
                        <option value="0">Same day</option>
                        <option value="1">Next day</option>
                        <option value="3">In 3 days</option>
                        <option value="7">In 7 days</option>
                      </Form.Select>
                    </Form.Group>
                  </div>
                )}
                {form.repeat !== 'none' && (
                  <Form.Text className="text-muted d-block mt-1">
                    A new task will be created automatically {recurrencePreview(form)} and assigned to the {form.assignee_ids.length || 'selected'} {form.assignee_ids.length === 1 ? 'person' : 'people'}. The first one is created now.
                  </Form.Text>
                )}
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || form.assignee_ids.length === 0 || !form.title.trim()}>
              {saving
                ? (editingId || editingGroupId ? 'Saving…' : 'Creating…')
                : editingId || editingGroupId
                  ? 'Save changes'
                  : form.assignee_ids.length > 1
                    ? `Assign to ${form.assignee_ids.length} people`
                    : 'Assign task'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Task detail popup — full content + prev/next through the visible list */}
      <Modal show={!!detailTask} onHide={() => setDetailId(null)} centered size="lg">
        {detailTask && (() => {
          const t = detailTask;
          const today = new Date().toISOString().slice(0, 10);
          const overdue = t.status === 'open' && t.due_date && t.due_date < today;
          const canComplete = t.assignee_id === myId || t.created_by === myId || isBob;
          const canDelete = t.created_by === myId || isBob;
          const canEditTask = canAssign && (t.created_by === myId || isBob);
          const canRemind = !isApc && (t.created_by === myId || isBob);
          const folder = t.folder_id ? folderMap.get(t.folder_id) : null;
          const taskLabels = (t.label_ids ?? []).map(id => labelMap.get(id)).filter(Boolean) as OrgItem[];
          const goPrev = () => { if (detailIdx > 0) setDetailId(ordered[detailIdx - 1].id); };
          const goNext = () => { if (detailIdx >= 0 && detailIdx < ordered.length - 1) setDetailId(ordered[detailIdx + 1].id); };
          return (
            <>
              <Modal.Header closeButton>
                <div className="ac-task-detail-nav">
                  <button className="ac-icon-btn" disabled={detailIdx <= 0} onClick={goPrev}
                    title="Previous task" aria-label="Previous task"><i className="bi bi-chevron-left" /></button>
                  <span className="ac-task-detail-pos">{detailIdx + 1} / {ordered.length}</span>
                  <button className="ac-icon-btn" disabled={detailIdx >= ordered.length - 1} onClick={goNext}
                    title="Next task" aria-label="Next task"><i className="bi bi-chevron-right" /></button>
                </div>
              </Modal.Header>
              <Modal.Body>
                <div className="ac-task-detail-title">
                  <span className={`ac-prio-pill prio-${t.priority}`}>{t.priority}</span>
                  <h4 className={t.status === 'done' ? 'text-decoration-line-through text-muted mb-0' : 'mb-0'}>{t.title}</h4>
                  {t.status === 'done'
                    ? <Badge bg="success"><i className="bi bi-check2 me-1" />Done</Badge>
                    : overdue && <Badge bg="danger">Overdue</Badge>}
                </div>
                {t.description && <p className="ac-task-detail-desc">{t.description}</p>}
                <div className="ac-task-detail-meta">
                  <div><span className="lbl">Assignee</span><span className="val"><Avatar name={personName(t.assignee_id)} size="sm" /> {personName(t.assignee_id)}</span></div>
                  {!isApc && (
                    <div><span className="lbl">Seen</span>
                      <span className="val">
                        {t.seen_at
                          ? <>{seenTick(t)} <span className="text-muted ms-1">{new Date(t.seen_at).toLocaleString()}</span></>
                          : <>{seenTick(t)} <span className="text-muted ms-1">Not seen yet</span></>}
                      </span>
                    </div>
                  )}
                  {t.created_by && <div><span className="lbl">Assigned by</span><span className="val">{personName(t.created_by)}</span></div>}
                  {t.brand_id && <div><span className="lbl">Brand</span><span className="val"><i className="bi bi-shop me-1" />{brandMap.get(t.brand_id) ?? 'Brand'}</span></div>}
                  {t.due_date && <div><span className="lbl">Due</span><span className="val"><i className="bi bi-calendar-event me-1" />{new Date(t.due_date).toLocaleDateString()}</span></div>}
                  {folder && <div><span className="lbl">Folder</span><span className="val"><i className="bi bi-folder me-1" style={{ color: folder.color ?? undefined }} />{folder.name}</span></div>}
                  {taskLabels.length > 0 && (
                    <div><span className="lbl">Labels</span>
                      <span className="val d-flex flex-wrap gap-1">
                        {taskLabels.map(l => (
                          <span key={l.id} className="ac-label-chip" style={{ background: (l.color ?? '#64748b') + '22', color: l.color ?? '#64748b' }}>
                            <i className="bi bi-tag-fill me-1" />{l.name}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {(() => {
                    const r = reminderByTask.get(t.id);
                    if (!r) return null;
                    return (
                      <div><span className="lbl">Reminder</span>
                        <span className="val">
                          {r.acknowledged_at && r.ack_response
                            ? <>{ackChip(t.id)} <span className="text-muted ms-1">by {personName(t.assignee_id)} · {new Date(r.acknowledged_at).toLocaleString()}</span></>
                            : <>{ackChip(t.id)} <span className="text-muted ms-1">sent {new Date(r.created_at).toLocaleString()}</span></>}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </Modal.Body>
              <Modal.Footer className="justify-content-between">
                <div>
                  {canRemind && t.status === 'open' && (
                    <Button variant="outline-warning" size="sm" disabled={reminded.has(t.id)} onClick={() => sendReminder(t)}>
                      <i className={`bi ${reminded.has(t.id) ? 'bi-check2-circle' : 'bi-alarm'} me-1`} />{reminded.has(t.id) ? 'Reminder sent' : 'Remind'}
                    </Button>
                  )}
                </div>
                <div className="d-flex gap-2">
                  {canEditTask && <Button variant="outline-secondary" size="sm" onClick={() => { setDetailId(null); openEdit(t); }}><i className="bi bi-pencil me-1" />Edit</Button>}
                  {canComplete && <Button variant={t.status === 'done' ? 'outline-secondary' : 'success'} size="sm" onClick={() => setDone(t, t.status !== 'done')}><i className={`bi ${t.status === 'done' ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'} me-1`} />{t.status === 'done' ? 'Reopen' : 'Mark done'}</Button>}
                  {canDelete && <Button variant="outline-danger" size="sm" onClick={() => { remove(t); setDetailId(null); }}><i className="bi bi-trash me-1" />Delete</Button>}
                </div>
              </Modal.Footer>
            </>
          );
        })()}
      </Modal>

      {/* Manage folders & labels */}
      {canAssign && (
        <ManageOrgModal
          show={showOrg} onHide={() => setShowOrg(false)}
          folders={folders} labels={labels} myId={myId} isBob={isBob}
          onChanged={() => load({ silent: true })}
        />
      )}

      {/* Recurring schedules manager */}
      {canAssign && (
        <Modal show={showRecur} onHide={() => setShowRecur(false)} centered size="lg">
          <Modal.Header closeButton>
            <Modal.Title><i className="bi bi-arrow-repeat me-2" />Recurring tasks</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="text-muted small">
              These schedules auto-create and assign a task each period. Create one from the
              <strong> New Task </strong> dialog using the <strong>Repeat</strong> option.
            </p>
            {recurrences.length === 0 ? (
              <div className="ac-empty py-4">
                <div className="ac-empty-icon"><i className="bi bi-arrow-repeat" /></div>
                <h6>No recurring tasks yet</h6>
                <p className="small text-muted">Set a repeat when creating a task to schedule it here.</p>
              </div>
            ) : (
              <div className="ac-list">
                {recurrences.map(r => {
                  const folder = r.folder_id ? folderMap.get(r.folder_id) : null;
                  return (
                    <div key={r.id} className={`ac-list-row ac-task ac-task--${r.priority} ${r.active ? '' : 'opacity-75'}`}>
                      <div className="ac-recur-icon"><i className="bi bi-arrow-repeat" /></div>
                      <div className="ac-row-main">
                        <div className="ac-row-name d-flex align-items-center gap-2 flex-wrap">
                          <span className={r.active ? '' : 'text-muted'}>{r.title}</span>
                          <span className={`ac-prio-pill prio-${r.priority}`}>{r.priority}</span>
                          <span className="ac-group-badge"><i className="bi bi-clock-history me-1" />{recurrenceLabel(r)}</span>
                          {!r.active && <Badge bg="secondary">Paused</Badge>}
                        </div>
                        <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2 mt-1">
                          <span className="d-inline-flex align-items-center gap-1">
                            <i className="bi bi-people" />
                            {r.assignee_ids.slice(0, 3).map(id => <Avatar key={id} name={personName(id)} size="sm" />)}
                            {r.assignee_ids.length > 3 && <span>+{r.assignee_ids.length - 3}</span>}
                          </span>
                          {r.brand_id && <span className="ac-chip neutral"><i className="bi bi-shop" /> {brandMap.get(r.brand_id) ?? 'Brand'}</span>}
                          {folder && <span className="ac-chip" style={{ borderColor: folder.color ?? undefined, color: folder.color ?? undefined }}><i className="bi bi-folder me-1" />{folder.name}</span>}
                          {r.due_offset_days != null && <span><i className="bi bi-calendar-event me-1" />due {r.due_offset_days === 0 ? 'same day' : `+${r.due_offset_days}d`}</span>}
                          {r.active && <span className="text-muted"><i className="bi bi-arrow-right-short" />next {new Date(r.next_run).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="ac-row-actions">
                        <button className="ac-icon-btn" title={r.active ? 'Pause' : 'Resume'}
                          aria-label={r.active ? 'Pause schedule' : 'Resume schedule'}
                          onClick={() => setRecurrenceActive(r, !r.active)}>
                          <i className={`bi ${r.active ? 'bi-pause-circle' : 'bi-play-circle'}`} />
                        </button>
                        <button className="ac-icon-btn danger" title="Delete schedule" aria-label="Delete schedule"
                          onClick={() => removeRecurrence(r)}>
                          <i className="bi bi-trash" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Modal.Body>
        </Modal>
      )}
    </>
  );
}

// ---- Searchable (multi-)select for task assignees ----
// Bob picks from Team Leads + APCs, a Team Lead from their own APCs. In `multiple`
// mode (new task) selecting fans the task out to everyone chosen; on edit it acts
// as a single-select since a task row has one assignee.
function AssigneePicker({ apcs, leads, isBob, multiple, value, onChange }: {
  apcs: PersonLite[]; leads: PersonLite[]; isBob: boolean; multiple: boolean;
  value: string[]; onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nameOf = (p: PersonLite) => p.full_name || p.email;
  const selected = new Set(value);

  // Close the dropdown when clicking outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const needle = q.trim().toLowerCase();
  const match = (p: PersonLite) => !needle || nameOf(p).toLowerCase().includes(needle);
  const fLeads = leads.filter(match);
  const fApcs = apcs.filter(match);
  const byId = useMemo(() => {
    const m = new Map<string, PersonLite>();
    [...leads, ...apcs].forEach(p => m.set(p.id, p));
    return m;
  }, [leads, apcs]);

  const toggle = (id: string) => {
    if (!multiple) { onChange([id]); setOpen(false); return; }
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange(Array.from(n));
  };
  const addAll = (list: PersonLite[]) => {
    const n = new Set(selected);
    list.forEach(p => n.add(p.id));
    onChange(Array.from(n));
  };
  const removeChip = (id: string) => onChange(value.filter(x => x !== id));

  const Row = (p: PersonLite) => {
    const on = selected.has(p.id);
    return (
      <button type="button" key={p.id}
        className={`ac-assignee-opt ${on ? 'on' : ''}`}
        aria-pressed={on} onClick={() => toggle(p.id)}>
        <Avatar name={nameOf(p)} size="sm" />
        <span className="ac-assignee-opt-name">{nameOf(p)}</span>
        <i className={`bi ${on ? (multiple ? 'bi-check-square-fill' : 'bi-check-circle-fill') : (multiple ? 'bi-square' : 'bi-circle')}`} />
      </button>
    );
  };

  return (
    <div className="ac-assignee-picker" ref={ref}>
      {multiple && value.length > 0 && (
        <div className="ac-assignee-chips">
          {value.map(id => {
            const p = byId.get(id);
            return (
              <span key={id} className="ac-assignee-chip">
                {p ? nameOf(p) : 'Unknown'}
                <button type="button" aria-label="Remove" onClick={() => removeChip(id)}><i className="bi bi-x" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className={`ac-assignee-search ${open ? 'open' : ''}`} onClick={() => setOpen(true)}>
        <i className="bi bi-search" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search people…" aria-label="Search people to assign"
          aria-expanded={open} />
        <i className={`bi bi-chevron-${open ? 'up' : 'down'} ac-assignee-caret`} />
      </div>
      {open && (
        <div className="ac-assignee-dropdown">
          {multiple && (fApcs.length > 0 || fLeads.length > 0) && (
            <div className="ac-assignee-quick">
              {fApcs.length > 0 && (
                <button type="button" onClick={() => addAll(fApcs)}>
                  <i className="bi bi-people me-1" />Select all APCs{needle ? ' (filtered)' : ''} ({fApcs.length})
                </button>
              )}
              {isBob && fLeads.length > 0 && (
                <button type="button" onClick={() => addAll(fLeads)}>
                  <i className="bi bi-people me-1" />Select all Team Leads{needle ? ' (filtered)' : ''} ({fLeads.length})
                </button>
              )}
              {value.length > 0 && (
                <button type="button" className="clear" onClick={() => onChange([])}>
                  <i className="bi bi-x-circle me-1" />Clear
                </button>
              )}
            </div>
          )}
          <div className="ac-assignee-list">
            {fLeads.length === 0 && fApcs.length === 0 && (
              <div className="text-muted text-center py-2 small">No matches.</div>
            )}
            {isBob && fLeads.length > 0 && (
              <>
                <div className="ac-assignee-group">Team Leads</div>
                {fLeads.map(Row)}
              </>
            )}
            {fApcs.length > 0 && (
              <>
                {isBob && fLeads.length > 0 && <div className="ac-assignee-group">APCs</div>}
                {fApcs.map(Row)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Folders & labels manager (Bob + Team Leads manage what they own) ----
function ManageOrgModal({ show, onHide, folders, labels, myId, isBob, onChanged }: {
  show: boolean; onHide: () => void; folders: OrgItem[]; labels: OrgItem[];
  myId?: string; isBob: boolean; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'folders' | 'labels'>('folders');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(ORG_COLORS[2]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const table = tab === 'folders' ? 'task_folders' : 'task_labels';
  const items = tab === 'folders' ? folders : labels;
  const canEdit = (it: OrgItem) => isBob || it.owner_id === myId;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from(table).insert({ name: newName.trim(), color: newColor });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setNewName('');
    onChanged();
  };
  const rename = async (it: OrgItem, name: string) => {
    const { error } = await supabase.from(table).update({ name }).eq('id', it.id);
    if (error) alert(error.message); else onChanged();
  };
  const recolor = async (it: OrgItem, color: string) => {
    const { error } = await supabase.from(table).update({ color }).eq('id', it.id);
    if (error) alert(error.message); else onChanged();
  };
  const del = async (it: OrgItem) => {
    if (!confirm(`Delete ${tab === 'folders' ? 'folder' : 'label'} "${it.name}"?`)) return;
    const { error } = await supabase.from(table).delete().eq('id', it.id);
    if (error) alert(error.message); else onChanged();
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title>Organize tasks</Modal.Title></Modal.Header>
      <Modal.Body>
        {err && <Alert variant="danger">{err}</Alert>}
        <div className="ac-seg mb-3">
          <button className={tab === 'folders' ? 'active' : ''} onClick={() => setTab('folders')}>Folders</button>
          <button className={tab === 'labels' ? 'active' : ''} onClick={() => setTab('labels')}>Labels</button>
        </div>

        <Form onSubmit={add} className="d-flex align-items-end gap-2 mb-3">
          <Form.Group className="flex-grow-1">
            <Form.Label className="small text-muted mb-1">New {tab === 'folders' ? 'folder' : 'label'}</Form.Label>
            <Form.Control value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name…" />
          </Form.Group>
          <ColorDots value={newColor} onChange={setNewColor} />
          <Button type="submit" disabled={busy || !newName.trim()}><i className="bi bi-plus-lg" /></Button>
        </Form>

        <div className="ac-list">
          {items.length === 0 && <div className="text-muted text-center py-2">Nothing yet.</div>}
          {items.map(it => (
            <div key={it.id} className="ac-list-row align-items-center">
              <i className={`bi ${tab === 'folders' ? 'bi-folder-fill' : 'bi-tag-fill'}`} style={{ color: it.color ?? undefined, fontSize: 18 }} />
              <div className="ac-row-main">
                {canEdit(it)
                  ? <input className="ac-inline-input" defaultValue={it.name} onBlur={e => { if (e.target.value.trim() && e.target.value !== it.name) rename(it, e.target.value.trim()); }} />
                  : <span>{it.name}</span>}
              </div>
              {canEdit(it) && (
                <div className="d-flex align-items-center gap-2">
                  <ColorDots value={it.color ?? ORG_COLORS[6]} onChange={c => recolor(it, c)} />
                  <button className="ac-icon-btn danger" title="Delete" onClick={() => del(it)}><i className="bi bi-trash" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal.Body>
    </Modal>
  );
}

function ColorDots({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="d-flex gap-1">
      {ORG_COLORS.map(c => (
        <button key={c} type="button" title={c}
          onClick={() => onChange(c)}
          className="ac-color-dot"
          style={{ background: c, outline: value === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
      ))}
    </div>
  );
}
