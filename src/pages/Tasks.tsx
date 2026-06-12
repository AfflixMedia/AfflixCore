import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';

interface Task {
  id: string;
  created_by: string | null;
  assignee_id: string;
  brand_id: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'done';
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
}
interface PersonLite { id: string; full_name: string | null; email: string; }
interface BrandLite { id: string; name: string; }

// Task assignment. A Team Lead (or Bob) assigns tasks to APCs; the APC sees "My
// tasks" and marks them done. Notifications are fired by DB triggers.
export default function Tasks() {
  const { profile, user } = useAuth();
  const myId = user?.id;
  const isApc = profile?.role === 'apc';
  const canAssign = profile?.role === 'team_lead' || profile?.role === 'bob';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Map<string, PersonLite>>(new Map());
  const [myApcs, setMyApcs] = useState<PersonLite[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ assignee_id: '', brand_id: '', title: '', description: '', due_date: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [tRes, brRes, apcRes] = await Promise.all([
      supabase.from('tasks').select('*').order('status').order('due_date', { nullsFirst: false }).order('created_at', { ascending: false }),
      canAssign ? supabase.from('brands').select('id,name').order('name') : Promise.resolve({ data: [], error: null }),
      canAssign ? supabase.from('profiles').select('id,full_name,email').eq('role', 'apc').order('full_name') : Promise.resolve({ data: [], error: null }),
    ]);
    if (tRes.error) { setErr(tRes.error.message); setLoading(false); return; }
    const ts = (tRes.data as Task[]) ?? [];
    setTasks(ts);
    setBrands(((brRes as any).data ?? []) as BrandLite[]);
    setMyApcs(((apcRes as any).data ?? []) as PersonLite[]);

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

  // Live updates: re-load when a task row changes that concerns me.
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel('tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [myId]);

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);
  const personName = (id: string | null) => {
    if (!id) return '—';
    if (id === myId) return 'You';
    const p = people.get(id);
    return p ? (p.full_name || p.email) : '—';
  };

  const openTasks = tasks.filter(t => t.status === 'open');
  const doneTasks = tasks.filter(t => t.status === 'done');

  const openAdd = () => {
    setForm({ assignee_id: '', brand_id: '', title: '', description: '', due_date: '' });
    setErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!myId) return;
    setSaving(true); setErr(null);
    try {
      const { error } = await supabase.from('tasks').insert({
        created_by: myId,
        assignee_id: form.assignee_id,
        brand_id: form.brand_id || null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        due_date: form.due_date || null,
      });
      if (error) throw error;
      setShow(false);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create task');
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

  const TaskCard = ({ t }: { t: Task }) => {
    const overdue = t.status === 'open' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
    const canComplete = t.assignee_id === myId || t.created_by === myId || profile?.role === 'bob';
    const canDelete = t.created_by === myId || profile?.role === 'bob';
    return (
      <div className={`ac-list-row ${t.status === 'done' ? 'opacity-75' : ''}`}>
        <Avatar name={personName(t.assignee_id)} size="lg" />
        <div className="ac-row-main">
          <div className="ac-row-name d-flex align-items-center gap-2 flex-wrap">
            <span className={t.status === 'done' ? 'text-decoration-line-through text-muted' : ''}>{t.title}</span>
            {t.status === 'done'
              ? <Badge bg="success"><i className="bi bi-check2 me-1" />Done</Badge>
              : overdue && <Badge bg="danger">Overdue</Badge>}
          </div>
          {t.description && <div className="ac-row-sub">{t.description}</div>}
          <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2 mt-1">
            {!isApc && <span><i className="bi bi-person me-1" />{personName(t.assignee_id)}</span>}
            {isApc && t.created_by && <span><i className="bi bi-person-badge me-1" />from {personName(t.created_by)}</span>}
            {t.brand_id && <span className="ac-chip neutral"><i className="bi bi-shop" /> {brandMap.get(t.brand_id) ?? 'Brand'}</span>}
            {t.due_date && <span><i className="bi bi-calendar-event me-1" />due {new Date(t.due_date).toLocaleDateString()}</span>}
          </div>
        </div>
        <div className="ac-row-actions">
          {canComplete && (
            <button className="ac-icon-btn" title={t.status === 'done' ? 'Reopen' : 'Mark done'}
              onClick={() => setDone(t, t.status !== 'done')}>
              <i className={`bi ${t.status === 'done' ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'}`} />
            </button>
          )}
          {canDelete && (
            <button className="ac-icon-btn danger" title="Delete task" onClick={() => remove(t)}>
              <i className="bi bi-trash" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>{isApc ? 'My Tasks' : 'Tasks'}</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{openTasks.length}</span>
            <span className="ac-stat-label">open</span>
          </span>
        </div>
        {canAssign && (
          <Button onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" /> New Task
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : err ? (
        <Alert variant="danger">{err}</Alert>
      ) : tasks.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-check2-square" /></div>
              <h5>No tasks {isApc ? 'assigned to you' : 'yet'}</h5>
              <p>{canAssign ? 'Create a task and assign it to one of your APCs.' : 'Tasks your Team Lead assigns will appear here.'}</p>
              {canAssign && (
                <Button className="mt-3" onClick={openAdd}><i className="bi bi-plus-lg me-1" /> New Task</Button>
              )}
            </div>
          </Card.Body>
        </Card>
      ) : (
        <>
          <h6 className="text-muted mb-2">Open ({openTasks.length})</h6>
          {openTasks.length === 0 ? (
            <Card body className="text-muted text-center py-3 mb-4">Nothing open. 🎉</Card>
          ) : (
            <div className="ac-list mb-4">{openTasks.map(t => <TaskCard key={t.id} t={t} />)}</div>
          )}
          {doneTasks.length > 0 && (
            <>
              <h6 className="text-muted mb-2">Done ({doneTasks.length})</h6>
              <div className="ac-list">{doneTasks.map(t => <TaskCard key={t.id} t={t} />)}</div>
            </>
          )}
        </>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>New Task</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Assign to</Form.Label>
              <Form.Select required value={form.assignee_id} onChange={e => setForm({ ...form, assignee_id: e.target.value })}>
                <option value="">Choose an APC…</option>
                {myApcs.map(a => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
              </Form.Select>
              {myApcs.length === 0 && <Form.Text className="text-danger">You have no APCs yet.</Form.Text>}
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Upload week 3 creator videos" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Details <span className="text-muted">(optional)</span></Form.Label>
              <Form.Control as="textarea" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </Form.Group>
            <div className="d-flex gap-3 flex-wrap">
              <Form.Group className="flex-grow-1">
                <Form.Label>Brand <span className="text-muted">(optional)</span></Form.Label>
                <Form.Select value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">No specific brand</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group>
                <Form.Label>Due date <span className="text-muted">(optional)</span></Form.Label>
                <Form.Control type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </Form.Group>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.assignee_id || !form.title.trim()}>
              {saving ? 'Creating…' : 'Assign task'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
