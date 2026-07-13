import { useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import Avatar from '../components/Avatar';

type Priority = 'low' | 'mid' | 'high';
type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'every_n_days';
type Status = 'open' | 'in_progress' | 'in_review' | 'done';
// Whose tasks the list shows: everything I can see / assigned TO me / assigned BY me.
type ViewFilter = 'all' | 'mine' | 'byme';

interface Task {
  id: string;
  created_by: string | null;
  assignee_id: string;
  brand_id: string | null;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  folder_id: string | null;
  label_ids: string[];
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  group_id: string | null;
  seen_at: string | null;
  recurrence_id: string | null;
  review_note: string | null;
}
// One firing of a recurrence (history record).
interface RecurrenceRun {
  id: string; recurrence_id: string; run_on: string; group_id: string | null;
  task_count: number; created_at: string;
}
// A card in the assigner's list: either a single task (isGroup=false) or a set
// of rows sharing a group_id — one task assigned to several people.
interface TaskGroup { key: string; tasks: Task[]; isGroup: boolean; }
interface PersonLite { id: string; full_name: string | null; email: string; avatar_url?: string | null; }
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
const STATUS_META: Record<Status, { label: string; icon: string; cls: string }> = {
  open:        { label: 'Not started', icon: 'bi-circle', cls: 'todo' },
  in_progress: { label: 'In progress', icon: 'bi-hourglass-split', cls: 'doing' },
  in_review:   { label: 'In review', icon: 'bi-send-check', cls: 'review' },
  done:        { label: 'Completed', icon: 'bi-check2-circle', cls: 'done' },
};
const ORG_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#64748b'];

// Task assignment. A Team Lead (or Bob, or an INTERNAL Paid Collab Handler)
// assigns tasks to APCs, sets a priority, organises them into folders + labels,
// and can push a blocking reminder. The APC sees "My tasks" and marks them
// done. Notifications fire via DB triggers.
export default function Tasks() {
  const { profile, user } = useAuth();
  const { notifications, markReadByTypes } = useNotifications();
  const myId = user?.id;
  // Ads Managers use the APC persona on this page: "My tasks" + upward
  // assignment to Bobs only (they have no Team Lead, so the my-lead fetch
  // below naturally comes back empty; no Remind / Repeat, like an APC).
  const isAdsManager = profile?.role === 'ads_manager';
  const isApc = profile?.role === 'apc' || isAdsManager;
  const isTeamLead = profile?.role === 'team_lead';
  const isBob = profile?.role === 'bob';
  const isSuperBob = isBob && !!profile?.is_superbob;
  // Internal handlers assign to the APCs of their brands, and upward to their
  // brands' Team Lead(s) + any Bob (external handlers never reach /tasks).
  const isInternalHandler = profile?.role === 'paid_collab_handler' && !!profile?.is_internal_handler;
  const canAssign = profile?.role === 'team_lead' || isBob || isInternalHandler;
  // An APC can also create tasks — upward only (their Team Lead + Bobs).
  const canCreate = canAssign || isApc;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Map<string, PersonLite>>(new Map());
  const [myApcs, setMyApcs] = useState<PersonLite[]>([]);
  const [teamLeads, setTeamLeads] = useState<PersonLite[]>([]);
  // Internal Paid Collab Handlers (Bob only — he can assign tasks to them).
  const [handlers, setHandlers] = useState<PersonLite[]>([]);
  // Ads Managers (Bob only — he can assign tasks to them too).
  const [adsManagers, setAdsManagers] = useState<PersonLite[]>([]);
  // Bobs — a Bob assigns to the other Bobs; an APC assigns "up" to any Bob.
  const [bobs, setBobs] = useState<PersonLite[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  // brand → its APC / Team Lead, so a brand chip can auto-fill the assignee.
  const [brandApc, setBrandApc] = useState<Map<string, string>>(new Map());
  const [brandLead, setBrandLead] = useState<Map<string, string>>(new Map());
  const [folders, setFolders] = useState<OrgItem[]>([]);
  const [labels, setLabels] = useState<OrgItem[]>([]);
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [recurrenceRuns, setRecurrenceRuns] = useState<RecurrenceRun[]>([]);
  // Latest reminder per task_id → drives the "acknowledged by" chip.
  const [reminderByTask, setReminderByTask] = useState<Map<string, ReminderLite>>(new Map());
  const [showRecur, setShowRecur] = useState(false);
  const [runHist, setRunHist] = useState<string | null>(null); // recurrence whose history is expanded
  const [repeatOpen, setRepeatOpen] = useState(false); // Repeat section expanded in the New Task modal
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filters (left rail)
  const [folderFilter, setFolderFilter] = useState<string>('all'); // 'all' | 'none' | folderId
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all'); // Active-tab sub-filter
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all'); // all / assigned to me / assigned by me
  // Completed tasks live in their own tab — never mixed into the Active list.
  const [mainTab, setMainTab] = useState<'active' | 'completed'>('active');
  // Brand quick-assign strip starts collapsed to keep the page calm.
  const [brandBarOpen, setBrandBarOpen] = useState(() => localStorage.getItem('ac_tasks_brandbar') === '1');
  const toggleBrandBar = () => {
    setBrandBarOpen(o => { localStorage.setItem('ac_tasks_brandbar', o ? '0' : '1'); return !o; });
  };

  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null); // editing a whole multi-assignee group
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null); // task open in detail popup
  // Right-rail person whose task list popup is open (null = closed).
  const [railPerson, setRailPerson] = useState<PersonLite | null>(null);
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
  // Which tab the organize modal opens on — the rail's "+" buttons pick it.
  const [orgTab, setOrgTab] = useState<'folders' | 'labels'>('folders');
  const openOrg = (tab: 'folders' | 'labels') => { setOrgTab(tab); setShowOrg(true); };
  const [query, setQuery] = useState('');

  // `silent` reloads refresh data in place (after a mutation or a realtime event)
  // without flashing the full-page spinner — only the first load shows it.
  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setErr(null);
    // Before fetching: materialize any due recurring tasks (assigner only) and
    // fire auto-reminders for tasks whose due date has arrived (all users, so an
    // assignee opening their own list triggers their own due reminders). Both are
    // idempotent server-side.
    if (!opts?.silent) {
      const pre: PromiseLike<any>[] = [supabase.rpc('fire_due_task_reminders')];
      if (canAssign) pre.push(supabase.rpc('generate_due_recurring_tasks'));
      await Promise.all(pre);
    }
    const [tRes, brRes, apcRes, tlRes, hRes, fRes, lRes, abRes, tlbRes, recRes, remRes, runRes, bobRes, myLeadRes, amRes] = await Promise.all([
      supabase.from('tasks').select('*').order('status').order('due_date', { nullsFirst: false }).order('created_at', { ascending: false }),
      canCreate ? supabase.from('brands').select('id,name').order('name') : Promise.resolve({ data: [], error: null }),
      // A Team Lead's picker/rail only shows THEIR team (an unassigned APC
      // would fail the manages_apc insert gate anyway); Bob sees every APC.
      canAssign ? (isTeamLead
        ? supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'apc').eq('team_lead_id', myId ?? '').order('full_name')
        : supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'apc').order('full_name')) : Promise.resolve({ data: [], error: null }),
      // Internal handlers also load Team Leads — RLS scopes them to the leads
      // of the handler's own brands (assignable upward + shown as brand owners).
      // A Team Lead loads the OTHER leads (assignable peer-to-peer).
      (isBob || isInternalHandler || isTeamLead) ? supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'team_lead').neq('id', myId ?? '').order('full_name') : Promise.resolve({ data: [], error: null }),
      isBob ? supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'paid_collab_handler').eq('is_internal_handler', true).order('full_name') : Promise.resolve({ data: [], error: null }),
      supabase.from('task_folders').select('id,name,color,owner_id').order('name'),
      supabase.from('task_labels').select('id,name,color,owner_id').order('name'),
      canAssign ? supabase.from('apc_brands').select('apc_id,brand_id') : Promise.resolve({ data: [], error: null }),
      (isBob || isInternalHandler) ? supabase.from('team_lead_brands').select('team_lead_id,brand_id') : Promise.resolve({ data: [], error: null }),
      canAssign ? supabase.from('task_recurrences').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      supabase.from('task_reminders').select('id,task_id,assignee_id,created_by,created_at,acknowledged_at,ack_response').order('created_at', { ascending: false }),
      canAssign ? supabase.from('task_recurrence_runs').select('*').order('run_on', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      (isBob || isApc || isInternalHandler) ? supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'bob').order('full_name') : Promise.resolve({ data: [], error: null }),
      // An APC's own Team Lead (their other upward assignment target).
      (isApc && profile?.team_lead_id) ? supabase.from('profiles').select('id,full_name,email,avatar_url').eq('id', profile.team_lead_id) : Promise.resolve({ data: [], error: null }),
      isBob ? supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'ads_manager').order('full_name') : Promise.resolve({ data: [], error: null }),
    ]);
    if (tRes.error) { setErr(tRes.error.message); setLoading(false); return; }
    const ts = (tRes.data as Task[]) ?? [];
    setTasks(ts);
    setBrands(((brRes as any).data ?? []) as BrandLite[]);
    setMyApcs(((apcRes as any).data ?? []) as PersonLite[]);
    // For an APC, "teamLeads" holds just their own lead (their upward target).
    setTeamLeads(((isApc ? (myLeadRes as any).data : (tlRes as any).data) ?? []) as PersonLite[]);
    setHandlers(((hRes as any).data ?? []) as PersonLite[]);
    setAdsManagers(((amRes as any).data ?? []) as PersonLite[]);
    setBobs(((bobRes as any).data ?? []) as PersonLite[]);
    setFolders(((fRes as any).data ?? []) as OrgItem[]);
    setLabels(((lRes as any).data ?? []) as OrgItem[]);
    setRecurrences(((recRes as any).data ?? []) as Recurrence[]);
    setRecurrenceRuns(((runRes as any).data ?? []) as RecurrenceRun[]);
    setBrandApc(new Map(((abRes as any).data ?? []).map((r: any) => [r.brand_id, r.apc_id])));
    setBrandLead(new Map(((tlbRes as any).data ?? []).map((r: any) => [r.brand_id, r.team_lead_id])));
    // Latest reminder per task (rows arrive newest-first, so first wins).
    const rmap = new Map<string, ReminderLite>();
    (((remRes as any).data ?? []) as ReminderLite[]).forEach(r => { if (!rmap.has(r.task_id)) rmap.set(r.task_id, r); });
    setReminderByTask(rmap);

    // Resolve names for assignees + creators (RLS returns what each role may see).
    const ids = Array.from(new Set(ts.flatMap(t => [t.assignee_id, t.created_by]).filter(Boolean) as string[]));
    if (ids.length > 0) {
      const { data: ppl } = await supabase.from('profiles').select('id,full_name,email,avatar_url').in('id', ids);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_recurrence_runs' }, () => load({ silent: true }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [myId]);

  // Being on the Tasks page means task notifications are "seen": clear them so
  // the sidebar badge goes away even when the user never opens the bell. Keyed
  // on a boolean so a new 'task' notification arriving WHILE here clears too.
  const hasUnreadTaskNotifs = notifications.some(n => !n.read_at && (n.type === 'task' || n.type === 'task_reminder_ack'));
  useEffect(() => {
    if (hasUnreadTaskNotifs) markReadByTypes(['task', 'task_reminder_ack']);
    // eslint-disable-next-line
  }, [hasUnreadTaskNotifs]);

  // Show the right rail's up/down arrows only when its avatars overflow.
  useEffect(() => {
    const el = tlRailRef.current;
    if (!el) { setTlOverflow(false); return; }
    const check = () => setTlOverflow(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [teamLeads.length, myApcs.length, loading]);

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);
  // Maps keep the FULL set so a task's folder/label chip renders even when the
  // owner is someone else (e.g. an APC viewing a task their Team Lead filed).
  const folderMap = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const labelMap = useMemo(() => new Map(labels.map(l => [l.id, l])), [labels]);
  // …but the rail / create form / organize modal only show what I OWN (Bob = all),
  // since folders & labels are each assigner's own private organisation.
  const myFolders = useMemo(() => folders.filter(f => isBob || f.owner_id === myId), [folders, isBob, myId]);
  const myLabels = useMemo(() => labels.filter(l => isBob || l.owner_id === myId), [labels, isBob, myId]);
  // Firing history grouped per schedule (runs already arrive newest-first).
  const runsByRecurrence = useMemo(() => {
    const m = new Map<string, RecurrenceRun[]>();
    recurrenceRuns.forEach(run => { const a = m.get(run.recurrence_id) ?? []; a.push(run); m.set(run.recurrence_id, a); });
    return m;
  }, [recurrenceRuns]);
  // Everyone except me — a Bob doesn't assign a task to himself via the picker.
  const otherBobs = useMemo(() => bobs.filter(b => b.id !== myId), [bobs, myId]);
  // Every person we might need a name for (assignees, creators, brand owners).
  const allPeople = useMemo(() => {
    const m = new Map<string, string>();
    people.forEach((p, id) => m.set(id, p.full_name || p.email));
    myApcs.forEach(p => m.set(p.id, p.full_name || p.email));
    teamLeads.forEach(p => m.set(p.id, p.full_name || p.email));
    handlers.forEach(p => m.set(p.id, p.full_name || p.email));
    bobs.forEach(p => m.set(p.id, p.full_name || p.email));
    return m;
  }, [people, myApcs, teamLeads, handlers, bobs]);
  const personName = (id: string | null) => {
    if (!id) return '—';
    if (id === myId) return 'You';
    return allPeople.get(id) ?? '—';
  };
  // Profile photo per person (assignees, creators, brand owners).
  const allAvatars = useMemo(() => {
    const m = new Map<string, string | null | undefined>();
    people.forEach((p, id) => m.set(id, p.avatar_url));
    myApcs.forEach(p => m.set(p.id, p.avatar_url));
    teamLeads.forEach(p => m.set(p.id, p.avatar_url));
    handlers.forEach(p => m.set(p.id, p.avatar_url));
    bobs.forEach(p => m.set(p.id, p.avatar_url));
    if (myId && profile?.avatar_url) m.set(myId, profile.avatar_url);
    return m;
  }, [people, myApcs, teamLeads, handlers, bobs, myId, profile?.avatar_url]);
  const personAvatar = (id: string | null) => (id ? allAvatars.get(id) ?? null : null);
  // Brand names under each APC — shown in the assignee picker so the assigner
  // (especially an internal handler) sees whose brands sit under which APC.
  const apcBrandNames = useMemo(() => {
    const m = new Map<string, string[]>();
    brandApc.forEach((apcId, brandId) => {
      const name = brandMap.get(brandId);
      if (!name) return;
      const arr = m.get(apcId) ?? [];
      arr.push(name);
      m.set(apcId, arr);
    });
    m.forEach(arr => arr.sort((a, b) => a.localeCompare(b)));
    return m;
  }, [brandApc, brandMap]);
  // Who owns a brand: its APC, else (Bob / internal handler) its Team Lead.
  const brandOwnerName = (brandId: string): string | null => {
    const id = brandApc.get(brandId) ?? ((isBob || isInternalHandler) ? brandLead.get(brandId) : undefined);
    return id ? (allPeople.get(id) ?? null) : null;
  };

  // Apply view + folder + label + text filters (but NOT the status filter yet —
  // we need this set to compute the per-status counts on the filter control).
  const scopedTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(t => {
      if (viewFilter === 'mine' && t.assignee_id !== myId) return false;
      if (viewFilter === 'byme' && (t.created_by !== myId || t.assignee_id === myId)) return false;
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
  }, [tasks, viewFilter, myId, folderFilter, labelFilter, query, brandMap]);

  // Counts for the view tabs (whole task set — not narrowed by other filters)
  // + how many of my open tasks I haven't opened yet ("new").
  const viewCounts = useMemo(() => {
    const open = tasks.filter(t => t.status !== 'done');
    return {
      all: open.length,
      mine: open.filter(t => t.assignee_id === myId).length,
      byme: open.filter(t => t.created_by === myId && t.assignee_id !== myId).length,
      mineNew: open.filter(t => t.assignee_id === myId && !t.seen_at).length,
    };
  }, [tasks, myId]);

  // Counts for the status filter pills (over the folder/label/search scope).
  const statusCounts = useMemo(() => ({
    all: scopedTasks.length,
    open: scopedTasks.filter(t => t.status === 'open').length,
    in_progress: scopedTasks.filter(t => t.status === 'in_progress').length,
    in_review: scopedTasks.filter(t => t.status === 'in_review').length,
    done: scopedTasks.filter(t => t.status === 'done').length,
  }), [scopedTasks]);

  // The status sub-filter only applies on the Active tab; the Completed tab
  // always shows everything (the group split below keeps only fully-done cards).
  const visibleTasks = useMemo(() => {
    const sf = mainTab === 'completed' ? 'all' : statusFilter;
    return sf === 'all' ? scopedTasks : scopedTasks.filter(t => t.status === sf);
  }, [scopedTasks, statusFilter, mainTab]);

  // "Active" = anything not completed (not started + in progress); "Done" = completed.
  const openTasks = visibleTasks.filter(t => t.status !== 'done');
  const doneTasks = visibleTasks.filter(t => t.status === 'done');

  // Collapse rows sharing a group_id into one card (assigner view only — an APC
  // only ever holds their own single row). Rows created together share every
  // shared field, so grouping after the folder/label/search filter is safe.
  const groups = useMemo<TaskGroup[]>(() => {
    if (!canCreate) return visibleTasks.map(t => ({ key: t.id, tasks: [t], isGroup: false }));
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
  // A group is "active" while any member isn't completed; "done" only when all are.
  const openGroups = groups.filter(g => g.tasks.some(t => t.status !== 'done'));
  const doneGroups = groups.filter(g => g.tasks.every(t => t.status === 'done'));

  // Ordered list the detail popup arrows step through (open first, then done).
  const ordered = useMemo(() => [...openTasks, ...doneTasks], [openTasks, doneTasks]);
  const detailIdx = detailId ? ordered.findIndex(t => t.id === detailId) : -1;
  // Fall back to the full task set so a task opened from outside the filtered
  // list (e.g. the rail person popup) still shows; prev/next just disable.
  const detailTask = detailIdx >= 0
    ? ordered[detailIdx]
    : (detailId ? tasks.find(t => t.id === detailId) ?? null : null);

  // Opening a task I'm assigned marks it seen (read receipt for the assigner).
  useEffect(() => {
    if (detailTask && detailTask.assignee_id === myId && !detailTask.seen_at) markSeen(detailTask);
    // eslint-disable-next-line
  }, [detailId]);

  // Active-task counts (not completed) for the rail badges + header stats.
  const stats = useMemo(() => {
    const open = tasks.filter(t => t.status !== 'done');
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
    setEditingId(null); setEditingGroupId(null); setRepeatOpen(false);
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
  // APC owns the brand (apc_brands); Bob also falls back to the brand's Team
  // Lead. An APC assigns upward, so their prefill is their own Team Lead.
  const openAddForBrand = (brandId: string) => {
    setEditingId(null); setEditingGroupId(null); setRepeatOpen(false);
    const apc = brandApc.get(brandId);
    const lead = brandLead.get(brandId);
    const owner = isApc ? (profile?.team_lead_id ?? undefined) : (apc ?? (isBob ? lead : undefined));
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

  // Move a task between states. completed_at only set when completed.
  const setStatus = async (t: Task, status: Status) => {
    if (t.status === status) return;
    const prev = tasks;
    const completed_at = status === 'done' ? new Date().toISOString() : null;
    setTasks(tasks.map(x => x.id === t.id ? { ...x, status, completed_at } : x));
    const { error } = await supabase.from('tasks').update({ status, completed_at }).eq('id', t.id);
    if (error) { setTasks(prev); alert(error.message); }
  };

  // Statuses the current viewer can set on a task. Tasks assigned by someone
  // else end at "Submit for review" — only the assigner completes them. Two
  // exceptions: a BOB assignee completes directly (no upward review for the
  // boss), and the SUPER BOSS has the full set on any task. Self-created /
  // creator-less tasks keep the direct done option.
  const statusOptionsFor = (t: Task): Status[] => {
    if (isSuperBob) return ['open', 'in_progress', 'in_review', 'done'];
    if (isBob) return ['open', 'in_progress', 'done'];
    return t.created_by && t.created_by !== t.assignee_id
      ? ['open', 'in_progress', 'in_review']
      : ['open', 'in_progress', 'done'];
  };

  // Assigner's decision on an in-review task: Accept → done, Reject → back to
  // in progress (optional note stored on the task + sent in the notification).
  const decideReview = async (t: Task, accept: boolean) => {
    let review_note: string | null = null;
    if (!accept) {
      const note = prompt('Optional note for the assignee (why is it going back?):');
      if (note === null) return;                 // cancelled the reject
      review_note = note.trim() || null;
    }
    const status: Status = accept ? 'done' : 'in_progress';
    const completed_at = accept ? new Date().toISOString() : null;
    const prev = tasks;
    setTasks(tasks.map(x => x.id === t.id ? { ...x, status, completed_at, review_note } : x));
    const { error } = await supabase.from('tasks')
      .update({ status, completed_at, review_note }).eq('id', t.id);
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
  // An APC sees it too on tasks THEY assigned upward (to their lead / a Bob).
  const seenTick = (t: Task) => {
    if (isApc && t.created_by !== myId) return null;
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

  // Status control: three one-click buttons (Not started / In progress /
  // Completed) — the current state shows its label, the others are icon-only.
  // Read-only pill when the viewer can't update. `size` "sm" is used inside
  // grouped per-person rows.
  const StatusControl = ({ t, canUpdate, size }: { t: Task; canUpdate: boolean; size?: 'sm' }) => {
    const m = STATUS_META[t.status];
    if (!canUpdate) {
      return (
        <span className={`ac-status-pill ${m.cls} ${size === 'sm' ? 'sm' : ''}`}>
          <i className={`bi ${m.icon} me-1`} />{m.label}
        </span>
      );
    }
    return (
      <div className={`ac-status-click ${size === 'sm' ? 'sm' : ''}`} role="group"
        aria-label="Set task status" onClick={e => e.stopPropagation()}>
        {statusOptionsFor(t).map(s => {
          const sm = STATUS_META[s];
          const on = t.status === s;
          const title = s === 'in_review' && !on ? 'Submit for review' : sm.label;
          return (
            <button type="button" key={s}
              className={`ac-status-click-opt ${sm.cls} ${on ? 'on' : ''}`}
              aria-pressed={on} title={title} aria-label={title}
              onClick={() => setStatus(t, s)}>
              <i className={`bi ${sm.icon}`} />
              {on && <span className="ac-status-click-lbl">{sm.label}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  // Accept / Reject controls the ASSIGNER (creator, or Bob) sees on a task
  // that was submitted for review.
  const ReviewActions = ({ t, size }: { t: Task; size?: 'sm' }) => (
    <div className={`ac-review-actions ${size === 'sm' ? 'sm' : ''}`} onClick={e => e.stopPropagation()}>
      <button type="button" className="ac-review-btn accept" title="Accept — mark completed"
        onClick={() => decideReview(t, true)}>
        <i className="bi bi-check-lg" />Accept
      </button>
      <button type="button" className="ac-review-btn reject" title="Send back to the assignee"
        onClick={() => decideReview(t, false)}>
        <i className="bi bi-arrow-counterclockwise" />Reject
      </button>
    </div>
  );
  const canReview = (t: Task) => t.status === 'in_review' && (t.created_by === myId || isBob);

  const TaskCard = ({ t }: { t: Task }) => {
    const overdue = t.status !== 'done' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
    // Status belongs to the person the task is assigned to — the assigner
    // (even a regular Bob) only reads it; nudging happens via Remind. The
    // Super Boss is the exception: full status control over any task.
    const canSetStatus = t.assignee_id === myId || isSuperBob;
    const canDelete = t.created_by === myId || isBob;
    const canEditTask = canCreate && (t.created_by === myId || isBob);
    const canRemind = !isApc && (t.created_by === myId || isBob);
    // Assigned to me and never opened → highlight as "new" until I open it.
    const isNew = t.assignee_id === myId && !t.seen_at && t.status !== 'done';
    const folder = t.folder_id ? folderMap.get(t.folder_id) : null;
    const taskLabels = (t.label_ids ?? []).map(id => labelMap.get(id)).filter(Boolean) as OrgItem[];
    return (
      <div className={`ac-list-row ac-task ac-task--${t.priority} ${isNew ? 'ac-task--unseen' : ''} ${t.status === 'done' ? 'opacity-75' : ''}`}>
        <Avatar name={personName(t.assignee_id)} src={personAvatar(t.assignee_id)} size="lg" />
        <div className="ac-row-main ac-task-open" role="button" tabIndex={0}
          title="Open task"
          onClick={() => setDetailId(t.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(t.id); } }}>
          <div className="ac-row-name d-flex align-items-center gap-2 flex-wrap">
            <span className={t.status === 'done' ? 'text-decoration-line-through text-muted' : ''}>{t.title}</span>
            {isNew && <span className="ac-new-pill">New</span>}
            {t.recurrence_id && <i className="bi bi-arrow-repeat ac-recur-mark" title="Created by a recurring schedule" />}
            <span className={`ac-prio-pill prio-${t.priority}`}>{t.priority}</span>
            {overdue && <Badge bg="danger">Overdue</Badge>}
            {t.review_note && t.status !== 'done' && t.status !== 'in_review' && (
              <Badge bg="warning" text="dark" title={t.review_note}>
                <i className="bi bi-arrow-counterclockwise me-1" />Sent back
              </Badge>
            )}
          </div>
          {t.description && <div className="ac-row-sub ac-clamp1">{t.description}</div>}
          <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2 mt-1">
            {(!isApc || t.created_by === myId) && <span><i className="bi bi-person me-1" />{personName(t.assignee_id)}{seenTick(t)}</span>}
            {isApc && t.created_by && t.created_by !== myId && <span><i className="bi bi-person-badge me-1" />from {personName(t.created_by)}</span>}
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
        <div className="ac-task-side">
          <StatusControl t={t} canUpdate={canSetStatus} />
          {canReview(t) && <ReviewActions t={t} />}
          <div className="ac-row-actions">
            {canRemind && t.status !== 'done' && (
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
            {canDelete && (
              <button className="ac-icon-btn danger" title="Delete task" aria-label="Delete task" onClick={() => remove(t)}>
                <i className="bi bi-trash" />
              </button>
            )}
          </div>
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
    const anyOverdue = g.tasks.some(t => t.status !== 'done' && t.due_date && t.due_date < today);
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
          {g.tasks.slice(0, 3).map(t => <Avatar key={t.id} name={personName(t.assignee_id)} src={personAvatar(t.assignee_id)} size="sm" />)}
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
                    <Avatar name={personName(t.assignee_id)} src={personAvatar(t.assignee_id)} size="sm" />
                    <span className="ac-group-person-name">{personName(t.assignee_id)}{seenTick(t)}</span>
                    {/* Each member's status is theirs alone — assigners only read it (Super Boss excepted). */}
                    <StatusControl t={t} canUpdate={t.assignee_id === myId || isSuperBob} size="sm" />
                    {canReview(t) && <ReviewActions t={t} size="sm" />}
                    {overdue && <span className="ac-group-status over"><i className="bi bi-exclamation-triangle me-1" />Overdue</span>}
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

  // One avatar in the right rail. With open tasks it opens the person's task
  // list popup (assign from there); with none it jumps straight to New Task.
  const RailBtn = ({ p, variant }: { p: PersonLite; variant?: 'dark' }) => {
    const name = p.full_name || p.email;
    const open = tasks.filter(t => t.assignee_id === p.id && t.status !== 'done').length;
    return (
      <button type="button" className="ac-tl-avatar-btn"
        onClick={() => (open > 0 ? setRailPerson(p) : openAdd(p.id))}
        aria-label={open > 0
          ? `View ${name}'s ${open} open task${open === 1 ? '' : 's'}`
          : `Assign a new task to ${name}`}>
        <Avatar name={name} src={p.avatar_url} size="lg" variant={variant} />
        {open > 0 && <span className="ac-tl-badge">{open}</span>}
        <span className="ac-tl-tip">{open > 0
          ? `${name} · ${open} open task${open === 1 ? '' : 's'}`
          : `Assign task to ${name}`}</span>
      </button>
    );
  };

  return (
    <>
      <div className="ac-page-header ac-tasks-header">
        <div className="ac-tasks-head-left">
          <div className="ac-tasks-head-icon"><i className="bi bi-check2-square" /></div>
          <div className="ac-tasks-head-text">
            <h2>{isApc ? 'My Tasks' : 'Tasks'}</h2>
            <div className="ac-task-stats">
              <span className="ac-task-stat"><span className="ac-task-stat-num">{stats.total}</span> open</span>
              {viewCounts.mineNew > 0 && (
                <button type="button" className="ac-task-stat new" title="Tasks assigned to you that you haven't opened yet"
                  onClick={() => { setMainTab('active'); setViewFilter('mine'); }}>
                  <i className="bi bi-envelope-exclamation-fill" />{viewCounts.mineNew} new for you
                </button>
              )}
              {stats.high > 0 && <span className="ac-task-stat high"><i className="bi bi-flag-fill" />{stats.high} high</span>}
              {stats.overdue > 0 && <span className="ac-task-stat over"><i className="bi bi-exclamation-triangle-fill" />{stats.overdue} overdue</span>}
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="ac-task-search">
            <i className="bi bi-search" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search tasks…" aria-label="Search tasks" />
          </div>
          {canCreate && (
            <Button onClick={() => openAdd()}>
              <i className="bi bi-plus-lg me-1" /> New Task
            </Button>
          )}
        </div>
      </div>

      {/* Brand quick-assign — collapsed to one calm row by default; expanding
          shows the brand chips (click one to start a task with its APC / Team
          Lead auto-filled). Team Leads / APCs see only their brands; an APC's
          chip pre-fills their own Team Lead (they assign upward). */}
      {canCreate && brands.length > 0 && (
        <div className={`ac-brandbar-wrap ${brandBarOpen ? 'open' : ''}`}>
          <button type="button" className="ac-brandbar-toggle" aria-expanded={brandBarOpen}
            onClick={toggleBrandBar}>
            <i className="bi bi-shop" />
            <span>Quick assign by brand</span>
            <span className="ac-brandbar-count">{brands.length}</span>
            <i className={`bi bi-chevron-${brandBarOpen ? 'up' : 'down'} ms-auto`} />
          </button>
          {brandBarOpen && (
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
              <span><i className="bi bi-folder2 me-1" />Folders</span>
              {canAssign && (
                <button className="ac-rail-add" title="Add folder"
                  aria-label="Add a folder" onClick={() => openOrg('folders')}>
                  <i className="bi bi-plus-lg" />
                </button>
              )}
            </div>
            <button className={`ac-rail-item ${folderFilter === 'all' ? 'active' : ''}`} onClick={() => setFolderFilter('all')}>
              <i className="bi bi-collection" /><span className="ac-rail-label">All tasks</span>
              <span className="ac-rail-count">{stats.total}</span>
            </button>
            {/* Folder list scrolls once it grows past a few rows. */}
            <div className="ac-rail-scroll">
              {myFolders.map(f => (
                <button key={f.id} className={`ac-rail-item ${folderFilter === f.id ? 'active' : ''}`} onClick={() => setFolderFilter(f.id)}>
                  <i className="bi bi-folder-fill" style={{ color: f.color ?? undefined }} />
                  <span className="ac-rail-label">{f.name}</span>
                  {(stats.folder.get(f.id) ?? 0) > 0 && <span className="ac-rail-count">{stats.folder.get(f.id)}</span>}
                </button>
              ))}
            </div>
            <button className={`ac-rail-item ${folderFilter === 'none' ? 'active' : ''}`} onClick={() => setFolderFilter('none')}>
              <i className="bi bi-folder" /><span className="ac-rail-label">No folder</span>
              {stats.noFolder > 0 && <span className="ac-rail-count">{stats.noFolder}</span>}
            </button>

            {(myLabels.length > 0 || canAssign) && (
              <>
                <div className="ac-rail-head mt-3">
                  <span><i className="bi bi-tags me-1" />Labels</span>
                  {canAssign && (
                    <button className="ac-rail-add" title="Add label"
                      aria-label="Add a label" onClick={() => openOrg('labels')}>
                      <i className="bi bi-plus-lg" />
                    </button>
                  )}
                </div>
                {myLabels.length === 0 ? (
                  <div className="ac-rail-empty">No labels yet — add one to tag tasks.</div>
                ) : (
                  <>
                    <div className="d-flex flex-wrap gap-1 ac-rail-scroll labels">
                      {myLabels.map(l => (
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
              </>
            )}

            {/* Recurring schedules (auto-assigning "alarms") */}
            {canAssign && (
              <>
                <div className="ac-rail-head mt-3"><span><i className="bi bi-arrow-repeat me-1" />Automation</span></div>
                <button className="ac-rail-item" onClick={() => setShowRecur(true)}>
                  <i className="bi bi-arrow-repeat" /><span className="ac-rail-label">Recurring</span>
                  {recurrences.length > 0 && <span className="ac-rail-count">{recurrences.filter(r => r.active).length}</span>}
                </button>
              </>
            )}
          </aside>

          {/* Right pane: task list */}
          <div className="ac-tasks-main">
            {/* Primary tabs: Active work vs Completed (kept apart on purpose) */}
            <div className="ac-tasks-tabs" role="tablist" aria-label="Active or completed tasks">
              <button type="button" role="tab" aria-selected={mainTab === 'active'}
                className={`ac-tasks-tab ${mainTab === 'active' ? 'on' : ''}`}
                onClick={() => setMainTab('active')}>
                <i className="bi bi-lightning-charge-fill" />Active
                <span className="ac-tasks-tab-n">{statusCounts.open + statusCounts.in_progress + statusCounts.in_review}</span>
              </button>
              <button type="button" role="tab" aria-selected={mainTab === 'completed'}
                className={`ac-tasks-tab done ${mainTab === 'completed' ? 'on' : ''}`}
                onClick={() => setMainTab('completed')}>
                <i className="bi bi-check2-circle" />Completed
                <span className="ac-tasks-tab-n">{statusCounts.done}</span>
              </button>
            </div>

            {/* Toolbar: whose tasks (view tabs) + Active-only status sub-filter */}
            <div className="ac-tasks-toolbar">
              <div className="ac-view-tabs" role="group" aria-label="Whose tasks to show">
                <button type="button" className={`ac-view-tab ${viewFilter === 'all' ? 'on' : ''}`}
                  aria-pressed={viewFilter === 'all'} onClick={() => setViewFilter('all')}>
                  All <span className="ac-view-tab-n">{viewCounts.all}</span>
                </button>
                <button type="button" className={`ac-view-tab ${viewFilter === 'mine' ? 'on' : ''}`}
                  aria-pressed={viewFilter === 'mine'} onClick={() => setViewFilter('mine')}>
                  <i className="bi bi-person-check me-1" />Assigned to me
                  <span className="ac-view-tab-n">{viewCounts.mine}</span>
                  {viewCounts.mineNew > 0 && <span className="ac-view-tab-new">{viewCounts.mineNew} new</span>}
                </button>
                {canCreate && (
                  <button type="button" className={`ac-view-tab ${viewFilter === 'byme' ? 'on' : ''}`}
                    aria-pressed={viewFilter === 'byme'} onClick={() => setViewFilter('byme')}>
                    <i className="bi bi-send me-1" />Assigned by me
                    <span className="ac-view-tab-n">{viewCounts.byme}</span>
                  </button>
                )}
              </div>
              {mainTab === 'active' && (
                <div className="ac-status-filter" role="group" aria-label="Filter by status">
                  <button className={`ac-status-filter-opt ${statusFilter === 'all' ? 'on' : ''}`} onClick={() => setStatusFilter('all')}>
                    All <span className="ac-status-filter-n">{statusCounts.open + statusCounts.in_progress + statusCounts.in_review}</span>
                  </button>
                  {(['open', 'in_progress', 'in_review'] as Status[]).map(s => (
                    <button key={s}
                      className={`ac-status-filter-opt ${STATUS_META[s].cls} ${statusFilter === s ? 'on' : ''}`}
                      onClick={() => setStatusFilter(s)}>
                      <i className={`bi ${STATUS_META[s].icon} me-1`} />{STATUS_META[s].label}
                      <span className="ac-status-filter-n">{statusCounts[s]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {mainTab === 'active' ? (
              openGroups.length === 0 ? (
                <Card>
                  <Card.Body>
                    <div className="ac-empty">
                      <div className="ac-empty-icon"><i className="bi bi-check2-square" /></div>
                      <h5>{viewFilter === 'mine' ? 'No active tasks assigned to you'
                        : viewFilter === 'byme' ? "You haven't assigned any active tasks"
                        : 'No active tasks'}</h5>
                      <p>{canAssign
                        ? (isTeamLead
                          ? 'Create a task and assign it to one of your APCs or another Team Lead.'
                          : 'Create a task and assign it to one of your APCs.')
                        : isApc
                          ? 'Tasks assigned to you appear here — and you can assign a task to your Team Lead or Bob.'
                          : 'Tasks your Team Lead assigns will appear here.'}</p>
                      {canCreate && (
                        <Button className="mt-3" onClick={() => openAdd()}><i className="bi bi-plus-lg me-1" /> New Task</Button>
                      )}
                    </div>
                  </Card.Body>
                </Card>
              ) : (
                <div className="ac-list">{openGroups.map(renderItem)}</div>
              )
            ) : (
              doneGroups.length === 0 ? (
                <Card>
                  <Card.Body>
                    <div className="ac-empty">
                      <div className="ac-empty-icon"><i className="bi bi-check2-circle" /></div>
                      <h5>Nothing completed yet</h5>
                      <p>Tasks marked Completed move here, out of the active list.</p>
                    </div>
                  </Card.Body>
                </Card>
              ) : (
                <div className="ac-list">{doneGroups.map(renderItem)}</div>
              )
            )}
          </div>

          {/* Right rail: click an avatar to see that person's open tasks (and
              assign more from there) — or, when they have none, to start a new
              task straight away. Every role that can create tasks gets it —
              each group only holds the people that role may assign to (Bob:
              everyone; Team Lead: their APCs + the other leads; APC: their
              lead + the Bobs; internal handler: their brands' people — the
              other groups come back empty). Native scrollbar hidden; up/down
              arrows appear on overflow. */}
          {canCreate && (teamLeads.length > 0 || myApcs.length > 0 || handlers.length > 0 || adsManagers.length > 0 || otherBobs.length > 0) && (
            <aside className="ac-tl-rail" aria-label="Assign a task to a Bob, Team Lead, APC, Ads Manager, or Handler">
              {tlOverflow && (
                <button type="button" className="ac-tl-arrow" aria-label="Scroll up"
                  onClick={() => scrollTlRail(-1)}><i className="bi bi-chevron-up" /></button>
              )}
              <div className="ac-tl-track" ref={tlRailRef}>
                {otherBobs.length > 0 && <div className="ac-tl-rail-head">Bobs</div>}
                {otherBobs.map(b => <RailBtn key={b.id} p={b} variant="dark" />)}
                {teamLeads.length > 0 && <div className={`ac-tl-rail-head ${otherBobs.length > 0 ? 'mt-2' : ''}`}>{isApc ? 'My Team Lead' : 'Team Leads'}</div>}
                {teamLeads.map(tl => <RailBtn key={tl.id} p={tl} variant="dark" />)}
                {myApcs.length > 0 && <div className="ac-tl-rail-head mt-2">APCs</div>}
                {myApcs.map(apc => <RailBtn key={apc.id} p={apc} />)}
                {adsManagers.length > 0 && <div className="ac-tl-rail-head mt-2">Ads Managers</div>}
                {adsManagers.map(am => <RailBtn key={am.id} p={am} />)}
                {handlers.length > 0 && <div className="ac-tl-rail-head mt-2">Handlers</div>}
                {handlers.map(h => <RailBtn key={h.id} p={h} />)}
              </div>
              {tlOverflow && (
                <button type="button" className="ac-tl-arrow" aria-label="Scroll down"
                  onClick={() => scrollTlRail(1)}><i className="bi bi-chevron-down" /></button>
              )}
            </aside>
          )}
        </div>
      )}

      {/* New task modal */}
      <Modal show={show} onHide={() => setShow(false)} centered size="lg"
        dialogClassName={`ac-task-modal ac-task--${form.priority}`}>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <div className="ac-modal-head">
              <div className="ac-modal-head-icon"><i className="bi bi-check2-square" /></div>
              <div>
                <Modal.Title>{editingId || editingGroupId ? 'Edit Task' : 'New Task'}</Modal.Title>
                <div className="ac-modal-sub">
                  {editingGroupId ? 'Update this task for everyone assigned'
                    : editingId ? 'Update the task details'
                    : 'Assign work to your team'}
                </div>
              </div>
            </div>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            {/* The what first (big title + details), then the who, then options. */}
            <Form.Group className="mb-2">
              <Form.Label htmlFor="ac-tm-title" className="visually-hidden">Title</Form.Label>
              <Form.Control id="ac-tm-title" className="ac-tm-title-input" required autoFocus
                value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="Task title — e.g. Upload week 3 creator videos" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="ac-tm-desc" className="visually-hidden">Details (optional)</Form.Label>
              <Form.Control id="ac-tm-desc" as="textarea" rows={3} className="ac-tm-desc-input"
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Add details… (optional)" />
            </Form.Group>

            <div className="ac-tm-block">
              <div className="ac-form-eyebrow">
                <i className="bi bi-people me-1" />Assign to
                {!editingId && !editingGroupId && form.assignee_ids.length > 1 && (
                  <span className="ac-tm-eyebrow-note">{form.assignee_ids.length} selected</span>
                )}
              </div>
              {editingGroupId ? (
                // Group edit changes shared fields for a fixed set of people.
                <>
                  <div className="ac-assignee-chips">
                    {form.assignee_ids.map(id => (
                      <span key={id} className="ac-assignee-chip static">
                        <Avatar name={personName(id)} src={personAvatar(id)} size="sm" /> {personName(id)}
                      </span>
                    ))}
                  </div>
                  <Form.Text className="text-muted">Editing for all {form.assignee_ids.length} people. Changes apply to everyone; each keeps their own status.</Form.Text>
                </>
              ) : (
                <>
                  <AssigneePicker
                    apcs={myApcs} leads={teamLeads} handlers={handlers} adsManagers={adsManagers} bobs={otherBobs}
                    isBob={isBob} isApc={isApc} isInternalHandler={isInternalHandler}
                    brandsByApc={apcBrandNames}
                    multiple={!editingId}
                    value={form.assignee_ids}
                    onChange={ids => setForm({ ...form, assignee_ids: ids })}
                  />
                  {editingId && <Form.Text className="text-muted">A task has one assignee. To give it to more people, create a new task.</Form.Text>}
                  {myApcs.length === 0 && teamLeads.length === 0 && handlers.length === 0 && adsManagers.length === 0 && otherBobs.length === 0 && <Form.Text className="text-danger d-block">{isInternalHandler ? 'No one to assign a task to yet.' : isApc ? 'No one to assign a task to yet.' : 'You have no APCs yet.'}</Form.Text>}
                </>
              )}
            </div>

            <div className="ac-tm-block">
              <div className="ac-form-eyebrow"><i className="bi bi-sliders me-1" />Options</div>
              <div className="ac-tm-grid">
                <Form.Group>
                  <Form.Label className="ac-tm-lbl">Priority</Form.Label>
                  <div className="ac-prio-choice" role="group" aria-label="Priority">
                    {PRIORITIES.map(p => (
                      <button type="button" key={p.value}
                        className={`ac-prio-opt prio-${p.value} ${form.priority === p.value ? 'on' : ''}`}
                        aria-pressed={form.priority === p.value}
                        onClick={() => setForm({ ...form, priority: p.value })}>
                        <i className="bi bi-flag-fill" />{p.label}
                      </button>
                    ))}
                  </div>
                </Form.Group>
                {/* One-off due date only when the task doesn't repeat. */}
                {form.repeat === 'none' && (
                  <Form.Group>
                    <Form.Label className="ac-tm-lbl" htmlFor="ac-tm-due">Due date <span className="text-muted">(optional)</span></Form.Label>
                    <Form.Control id="ac-tm-due" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                  </Form.Group>
                )}
                <Form.Group>
                  <Form.Label className="ac-tm-lbl" htmlFor="ac-tm-brand">Brand <span className="text-muted">(optional)</span></Form.Label>
                  <Form.Select id="ac-tm-brand" value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })}>
                    <option value="">No specific brand</option>
                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Form.Select>
                </Form.Group>
                <Form.Group>
                  <Form.Label className="ac-tm-lbl" htmlFor="ac-tm-folder">Folder <span className="text-muted">(optional)</span></Form.Label>
                  <Form.Select id="ac-tm-folder" value={form.folder_id} onChange={e => setForm({ ...form, folder_id: e.target.value })}>
                    <option value="">No folder</option>
                    {myFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </Form.Select>
                </Form.Group>
              </div>
              {myLabels.length > 0 && (
                <Form.Group className="mt-3">
                  <Form.Label className="ac-tm-lbl">Labels <span className="text-muted">(optional)</span></Form.Label>
                  <div className="d-flex flex-wrap gap-1">
                    {myLabels.map(l => (
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
            </div>

            {/* Repeat / "alarm" — new one-off tasks only. Creates a schedule that
                auto-assigns each period. Assigner roles only (not APCs). */}
            {!editingId && !editingGroupId && canAssign && (() => {
              const expanded = repeatOpen || form.repeat !== 'none';
              return (
              <div className="ac-repeat mt-3">
                <button type="button" className="ac-repeat-head" aria-expanded={expanded}
                  onClick={() => setRepeatOpen(o => !o)}>
                  <span className="ac-repeat-title"><i className="bi bi-arrow-repeat me-1" />Repeat</span>
                  <span className="ac-repeat-sum">
                    {form.repeat === 'none' ? 'Does not repeat' : recurrencePreview(form)}
                    <i className={`bi bi-chevron-${expanded ? 'up' : 'down'} ms-2`} />
                  </span>
                </button>
                {expanded && (
                <div className="ac-repeat-body mt-2">
                <Form.Group>
                  <Form.Label className="small text-muted mb-1">Frequency</Form.Label>
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
              </div>
              );
            })()}
          </Modal.Body>
          <Modal.Footer className="justify-content-between">
            <div className="ac-modal-foot-hint">
              {!editingId && !editingGroupId && form.assignee_ids.length > 0 && (
                <><i className="bi bi-person-check me-1" />{form.assignee_ids.length} {form.assignee_ids.length === 1 ? 'person' : 'people'} selected
                  {form.repeat !== 'none' && <> · <i className="bi bi-arrow-repeat mx-1" />repeats {recurrencePreview(form)}</>}</>
              )}
            </div>
            <div className="d-flex gap-2">
              <Button variant="light" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="ac-modal-cta" disabled={saving || form.assignee_ids.length === 0 || !form.title.trim()}>
                {saving
                  ? (editingId || editingGroupId ? 'Saving…' : 'Creating…')
                  : editingId || editingGroupId
                    ? <><i className="bi bi-check2 me-1" />Save changes</>
                    : form.assignee_ids.length > 1
                      ? <><i className="bi bi-send me-1" />Assign to {form.assignee_ids.length} people</>
                      : <><i className="bi bi-send me-1" />Assign task</>}
              </Button>
            </div>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Task detail popup — full content + prev/next through the visible list */}
      <Modal show={!!detailTask} onHide={() => setDetailId(null)} centered size="lg">
        {detailTask && (() => {
          const t = detailTask;
          const today = new Date().toISOString().slice(0, 10);
          const overdue = t.status !== 'done' && t.due_date && t.due_date < today;
          const sm = STATUS_META[t.status];
          // Only the assignee moves the status; assigners just read it —
          // except the Super Boss, who has full status control.
          const canSetStatus = t.assignee_id === myId || isSuperBob;
          const canDelete = t.created_by === myId || isBob;
          const canEditTask = canCreate && (t.created_by === myId || isBob);
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
                  <span className="ac-task-detail-pos">{detailIdx >= 0 ? detailIdx + 1 : '–'} / {ordered.length}</span>
                  <button className="ac-icon-btn" disabled={detailIdx >= ordered.length - 1} onClick={goNext}
                    title="Next task" aria-label="Next task"><i className="bi bi-chevron-right" /></button>
                </div>
              </Modal.Header>
              <Modal.Body>
                <div className="ac-task-detail-title">
                  <span className={`ac-prio-pill prio-${t.priority}`}>{t.priority}</span>
                  <h4 className={t.status === 'done' ? 'text-decoration-line-through text-muted mb-0' : 'mb-0'}>{t.title}</h4>
                  <span className={`ac-status-pill ${sm.cls}`}><i className={`bi ${sm.icon} me-1`} />{sm.label}</span>
                  {overdue && <Badge bg="danger">Overdue</Badge>}
                </div>
                {t.description && <p className="ac-task-detail-desc">{t.description}</p>}
                <div className="ac-task-detail-meta">
                  <div><span className="lbl">Assignee</span><span className="val"><Avatar name={personName(t.assignee_id)} src={personAvatar(t.assignee_id)} size="sm" /> {personName(t.assignee_id)}</span></div>
                  {(!isApc || t.created_by === myId) && (
                    <div><span className="lbl">Seen</span>
                      <span className="val">
                        {t.seen_at
                          ? <>{seenTick(t)} <span className="text-muted ms-1">{new Date(t.seen_at).toLocaleString()}</span></>
                          : <>{seenTick(t)} <span className="text-muted ms-1">Not seen yet</span></>}
                      </span>
                    </div>
                  )}
                  {t.created_by && <div><span className="lbl">Assigned by</span><span className="val">{personName(t.created_by)}</span></div>}
                  {t.review_note && t.status !== 'done' && (
                    <div><span className="lbl">Review note</span><span className="val"><i className="bi bi-chat-left-text me-1" />{t.review_note}</span></div>
                  )}
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
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  {canSetStatus && (
                    <div className="ac-status-seg" role="group" aria-label="Task status">
                      {statusOptionsFor(t).map(s => (
                        <button type="button" key={s}
                          className={`ac-status-seg-opt ${STATUS_META[s].cls} ${t.status === s ? 'on' : ''}`}
                          aria-pressed={t.status === s}
                          onClick={() => setStatus(t, s)}>
                          <i className={`bi ${STATUS_META[s].icon} me-1`} />
                          {s === 'in_review' && t.status !== 'in_review' ? 'Submit for review' : STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  )}
                  {canReview(t) && <ReviewActions t={t} />}
                  {canRemind && t.status !== 'done' && (
                    <Button variant="outline-warning" size="sm" disabled={reminded.has(t.id)} onClick={() => sendReminder(t)}>
                      <i className={`bi ${reminded.has(t.id) ? 'bi-check2-circle' : 'bi-alarm'} me-1`} />{reminded.has(t.id) ? 'Reminder sent' : 'Remind'}
                    </Button>
                  )}
                </div>
                <div className="d-flex gap-2">
                  {canEditTask && <Button variant="outline-secondary" size="sm" onClick={() => { setDetailId(null); openEdit(t); }}><i className="bi bi-pencil me-1" />Edit</Button>}
                  {canDelete && <Button variant="outline-danger" size="sm" onClick={() => { remove(t); setDetailId(null); }}><i className="bi bi-trash me-1" />Delete</Button>}
                </div>
              </Modal.Footer>
            </>
          );
        })()}
      </Modal>

      {/* Person tasks popup — opened from the right rail when the person has
          open tasks: their list first (click one → task detail), plus a button
          to assign them another task. */}
      <Modal show={!!railPerson} onHide={() => setRailPerson(null)} centered>
        {railPerson && (() => {
          const p = railPerson;
          const name = p.full_name || p.email;
          const theirs = tasks.filter(t => t.assignee_id === p.id);
          const active = theirs.filter(t => t.status !== 'done');
          const doneCount = theirs.length - active.length;
          const today = new Date().toISOString().slice(0, 10);
          return (
            <>
              <Modal.Header closeButton>
                <div className="ac-modal-head">
                  <Avatar name={name} src={p.avatar_url} size="lg" />
                  <div>
                    <Modal.Title>{name}</Modal.Title>
                    <div className="ac-modal-sub">
                      {active.length} open task{active.length === 1 ? '' : 's'}
                      {doneCount > 0 && <> · {doneCount} completed</>}
                    </div>
                  </div>
                </div>
              </Modal.Header>
              <Modal.Body>
                {active.length === 0 ? (
                  <div className="text-muted text-center py-3">No open tasks.</div>
                ) : (
                  <div className="ac-person-tasks">
                    {active.map(t => {
                      const m = STATUS_META[t.status];
                      const overdue = t.due_date && t.due_date < today;
                      return (
                        <button key={t.id} type="button" className="ac-person-task"
                          title="Open task details"
                          onClick={() => { setRailPerson(null); setDetailId(t.id); }}>
                          <span className={`ac-prio-pill prio-${t.priority}`}>{t.priority}</span>
                          <span className="ac-person-task-main">
                            <span className="ac-person-task-title">{t.title}</span>
                            <span className="ac-person-task-sub">
                              {t.brand_id && <span><i className="bi bi-shop me-1" />{brandMap.get(t.brand_id) ?? 'Brand'}</span>}
                              {t.due_date && (
                                <span className={overdue ? 'text-danger' : ''}>
                                  <i className="bi bi-calendar-event me-1" />due {new Date(t.due_date).toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          </span>
                          {overdue && <Badge bg="danger">Overdue</Badge>}
                          <span className={`ac-status-pill ${m.cls} sm`}><i className={`bi ${m.icon} me-1`} />{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="light" onClick={() => setRailPerson(null)}>Close</Button>
                <Button onClick={() => { setRailPerson(null); openAdd(p.id); }}>
                  <i className="bi bi-plus-lg me-1" />Assign another task
                </Button>
              </Modal.Footer>
            </>
          );
        })()}
      </Modal>

      {/* Manage folders & labels */}
      {canAssign && (
        <ManageOrgModal
          show={showOrg} onHide={() => setShowOrg(false)} initialTab={orgTab}
          folders={myFolders} labels={myLabels} myId={myId} isBob={isBob}
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
                            {r.assignee_ids.slice(0, 3).map(id => <Avatar key={id} name={personName(id)} src={personAvatar(id)} size="sm" />)}
                            {r.assignee_ids.length > 3 && <span>+{r.assignee_ids.length - 3}</span>}
                          </span>
                          {r.brand_id && <span className="ac-chip neutral"><i className="bi bi-shop" /> {brandMap.get(r.brand_id) ?? 'Brand'}</span>}
                          {folder && <span className="ac-chip" style={{ borderColor: folder.color ?? undefined, color: folder.color ?? undefined }}><i className="bi bi-folder me-1" />{folder.name}</span>}
                          {r.due_offset_days != null && <span><i className="bi bi-calendar-event me-1" />due {r.due_offset_days === 0 ? 'same day' : `+${r.due_offset_days}d`}</span>}
                          {r.active && <span className="text-muted"><i className="bi bi-arrow-right-short" />next {new Date(r.next_run).toLocaleDateString()}</span>}
                        </div>
                        {(() => {
                          const runs = runsByRecurrence.get(r.id) ?? [];
                          if (runs.length === 0) return <div className="ac-row-sub text-muted mt-1"><i className="bi bi-clock-history me-1" />Not run yet</div>;
                          const totalTasks = runs.reduce((s, x) => s + x.task_count, 0);
                          const open = runHist === r.id;
                          return (
                            <>
                              <button type="button" className="ac-run-hist-toggle mt-1"
                                onClick={() => setRunHist(open ? null : r.id)} aria-expanded={open}>
                                <i className={`bi bi-chevron-${open ? 'down' : 'right'} me-1`} />
                                Fired {runs.length}× · {totalTasks} task{totalTasks === 1 ? '' : 's'} created · last {new Date(runs[0].run_on).toLocaleDateString()}
                              </button>
                              {open && (
                                <div className="ac-run-hist">
                                  {runs.slice(0, 12).map(run => (
                                    <div key={run.id} className="ac-run-hist-row">
                                      <i className="bi bi-dot" />
                                      <span>{new Date(run.run_on).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                      <span className="text-muted">— {run.task_count} task{run.task_count === 1 ? '' : 's'}</span>
                                    </div>
                                  ))}
                                  {runs.length > 12 && <div className="text-muted small ps-3">+{runs.length - 12} earlier…</div>}
                                </div>
                              )}
                            </>
                          );
                        })()}
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
// Bob picks from the other Bobs + Team Leads + APCs + internal Handlers, a
// Team Lead from their APCs + the OTHER Team Leads, an internal Handler from
// their brands' APCs/leads, and an APC assigns UP: their own Team
// Lead + the Bobs. APC rows show the brands under that APC. In `multiple`
// mode (new task) selecting fans the task out to everyone chosen; on edit it acts
// as a single-select since a task row has one assignee.
function AssigneePicker({ apcs, leads, handlers = [], adsManagers = [], bobs = [], isBob, isApc = false, isInternalHandler = false, brandsByApc, multiple, value, onChange }: {
  apcs: PersonLite[]; leads: PersonLite[]; handlers?: PersonLite[]; adsManagers?: PersonLite[]; bobs?: PersonLite[];
  isBob: boolean; isApc?: boolean; isInternalHandler?: boolean;
  brandsByApc?: Map<string, string[]>; multiple: boolean;
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
  // APCs also match on their brand names, so "assign to whoever runs brand X" works.
  const match = (p: PersonLite) =>
    !needle
    || nameOf(p).toLowerCase().includes(needle)
    || (brandsByApc?.get(p.id) ?? []).some(b => b.toLowerCase().includes(needle));
  const fLeads = leads.filter(p => !needle || nameOf(p).toLowerCase().includes(needle));
  const fHandlers = handlers.filter(p => !needle || nameOf(p).toLowerCase().includes(needle));
  const fAdsManagers = adsManagers.filter(p => !needle || nameOf(p).toLowerCase().includes(needle));
  const fBobs = bobs.filter(p => !needle || nameOf(p).toLowerCase().includes(needle));
  const fApcs = apcs.filter(match);
  const byId = useMemo(() => {
    const m = new Map<string, PersonLite>();
    [...leads, ...handlers, ...adsManagers, ...bobs, ...apcs].forEach(p => m.set(p.id, p));
    return m;
  }, [leads, handlers, adsManagers, bobs, apcs]);

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

  const Row = (p: PersonLite, brands?: string[]) => {
    const on = selected.has(p.id);
    return (
      <button type="button" key={p.id}
        className={`ac-assignee-opt ${on ? 'on' : ''}`}
        aria-pressed={on} onClick={() => toggle(p.id)}>
        <Avatar name={nameOf(p)} src={p.avatar_url} size="sm" />
        <span className="ac-assignee-opt-name">
          {nameOf(p)}
          {brands && brands.length > 0 && (
            <span className="ac-assignee-opt-sub" title={brands.join(', ')}>
              <i className="bi bi-shop me-1" />
              {brands.slice(0, 3).join(', ')}{brands.length > 3 ? ` +${brands.length - 3}` : ''}
            </span>
          )}
        </span>
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
              {!isApc && fLeads.length > 0 && (
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
            {fLeads.length === 0 && fApcs.length === 0 && fHandlers.length === 0 && fAdsManagers.length === 0 && fBobs.length === 0 && (
              <div className="text-muted text-center py-2 small">No matches.</div>
            )}
            {fBobs.length > 0 && (
              <>
                <div className="ac-assignee-group">{fBobs.length === 1 ? 'Bob' : 'Bobs'}</div>
                {fBobs.map(p => Row(p))}
              </>
            )}
            {fLeads.length > 0 && (
              <>
                <div className="ac-assignee-group">{isApc ? 'My Team Lead' : 'Team Leads'}</div>
                {fLeads.map(p => Row(p))}
              </>
            )}
            {fApcs.length > 0 && (
              <>
                {(fLeads.length > 0 || fHandlers.length > 0 || fAdsManagers.length > 0 || fBobs.length > 0) && <div className="ac-assignee-group">APCs</div>}
                {fApcs.map(p => Row(p, brandsByApc?.get(p.id)))}
              </>
            )}
            {isBob && fAdsManagers.length > 0 && (
              <>
                <div className="ac-assignee-group">Ads Managers</div>
                {fAdsManagers.map(p => Row(p))}
              </>
            )}
            {isBob && fHandlers.length > 0 && (
              <>
                <div className="ac-assignee-group">Paid Collab Handlers</div>
                {fHandlers.map(p => Row(p))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Folders & labels manager (Bob + Team Leads manage what they own) ----
function ManageOrgModal({ show, onHide, initialTab = 'folders', folders, labels, myId, isBob, onChanged }: {
  show: boolean; onHide: () => void; initialTab?: 'folders' | 'labels';
  folders: OrgItem[]; labels: OrgItem[];
  myId?: string; isBob: boolean; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'folders' | 'labels'>(initialTab);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(ORG_COLORS[2]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Each open lands on the tab whose "+" was clicked, with a clean composer.
  useEffect(() => {
    if (show) { setTab(initialTab); setNewName(''); setErr(null); }
  }, [show, initialTab]);

  const table = tab === 'folders' ? 'task_folders' : 'task_labels';
  const items = tab === 'folders' ? folders : labels;
  const canEdit = (it: OrgItem) => isBob || it.owner_id === myId;

  const kind = tab === 'folders' ? 'folder' : 'label';
  // A name I already own (case-insensitive), optionally ignoring one row (rename).
  const isDuplicate = (name: string, ignoreId?: string) =>
    items.some(it => canEdit(it) && it.id !== ignoreId && it.name.trim().toLowerCase() === name.trim().toLowerCase());

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (isDuplicate(name)) { setErr(`A ${kind} named "${name}" already exists.`); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from(table).insert({ name, color: newColor });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setNewName('');
    onChanged();
  };
  const rename = async (it: OrgItem, name: string) => {
    if (isDuplicate(name, it.id)) { alert(`A ${kind} named "${name}" already exists.`); onChanged(); return; }
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
    <Modal show={show} onHide={onHide} centered dialogClassName="ac-org-modal">
      <Modal.Header closeButton>
        <div className="ac-modal-head">
          <div className="ac-modal-head-icon"><i className="bi bi-collection" /></div>
          <div>
            <Modal.Title>Organize tasks</Modal.Title>
            <div className="ac-modal-sub">Folders group tasks; labels tag them across folders</div>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body>
        {err && <Alert variant="danger">{err}</Alert>}

        <div className="ac-org-tabs" role="group" aria-label="Folders or labels">
          <button type="button" className={`ac-org-tab ${tab === 'folders' ? 'on' : ''}`}
            aria-pressed={tab === 'folders'} onClick={() => setTab('folders')}>
            <i className="bi bi-folder2" />Folders
            <span className="ac-org-tab-n">{folders.length}</span>
          </button>
          <button type="button" className={`ac-org-tab ${tab === 'labels' ? 'on' : ''}`}
            aria-pressed={tab === 'labels'} onClick={() => setTab('labels')}>
            <i className="bi bi-tags" />Labels
            <span className="ac-org-tab-n">{labels.length}</span>
          </button>
        </div>

        {/* Composer: name + colour + add */}
        <Form onSubmit={add} className="ac-org-new">
          <div className="ac-org-new-row">
            <Form.Label htmlFor="ac-org-name" className="visually-hidden">New {kind} name</Form.Label>
            <Form.Control id="ac-org-name" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder={`New ${kind} name…`} />
            <Button type="submit" disabled={busy || !newName.trim()}>
              <i className="bi bi-plus-lg me-1" />Add
            </Button>
          </div>
          <div className="ac-org-new-colors">
            <span className="ac-org-color-lbl">Colour</span>
            <ColorDots value={newColor} onChange={setNewColor} />
          </div>
        </Form>

        <div className="ac-org-list">
          {items.length === 0 && (
            <div className="ac-org-empty">
              <i className={`bi ${tab === 'folders' ? 'bi-folder2-open' : 'bi-tags'}`} />
              <span>No {kind}s yet — create your first one above.</span>
            </div>
          )}
          {items.map(it => (
            <div key={it.id} className="ac-org-row">
              <span className="ac-org-swatch" style={{ background: (it.color ?? '#64748b') + '22', color: it.color ?? '#64748b' }}>
                <i className={`bi ${tab === 'folders' ? 'bi-folder-fill' : 'bi-tag-fill'}`} />
              </span>
              <div className="ac-org-row-main">
                {canEdit(it)
                  ? <input className="ac-inline-input" defaultValue={it.name} aria-label={`Rename ${it.name}`}
                      onBlur={e => { if (e.target.value.trim() && e.target.value !== it.name) rename(it, e.target.value.trim()); }} />
                  : <span className="ac-org-row-name">{it.name}</span>}
              </div>
              {canEdit(it) && (
                <div className="ac-org-row-actions">
                  <ColorDots value={it.color ?? ORG_COLORS[6]} onChange={c => recolor(it, c)} />
                  <button className="ac-icon-btn sm danger" title={`Delete ${kind}`} aria-label={`Delete ${it.name}`}
                    onClick={() => del(it)}><i className="bi bi-trash" /></button>
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
