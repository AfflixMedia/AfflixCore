import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import TaskReminderOverlay from '../components/TaskReminderOverlay';

export type AckResponse = 'seen' | 'on_it' | 'done';

export interface TaskReminder {
  id: string;
  task_id: string;
  created_by: string | null;
  created_at: string;
  acknowledged_at: string | null;
  // Enriched (best-effort) for display:
  task_title: string;
  brand_name: string | null;
  priority: 'low' | 'mid' | 'high' | null;
  due_date: string | null;
  from_name: string | null;
}

interface Ctx {
  queue: TaskReminder[];
  acknowledge: (id: string, response: AckResponse) => Promise<void>;
}

const TaskReminderContext = createContext<Ctx | undefined>(undefined);

export function TaskReminderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<TaskReminder[]>([]);

  // Pull the display fields for one or more reminder rows. RLS lets the assignee
  // read their own task (title/brand/priority); the sender's name is best-effort.
  const enrich = useCallback(async (rows: any[]): Promise<TaskReminder[]> => {
    if (rows.length === 0) return [];
    const taskIds = Array.from(new Set(rows.map(r => r.task_id)));
    const senderIds = Array.from(new Set(rows.map(r => r.created_by).filter(Boolean))) as string[];

    const [tRes, brRes, pplRes] = await Promise.all([
      supabase.from('tasks').select('id,title,brand_id,priority,due_date').in('id', taskIds),
      Promise.resolve(null), // brands resolved below once we know brand_ids
      senderIds.length ? supabase.from('profiles').select('id,full_name,email').in('id', senderIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const tasks = (tRes.data ?? []) as any[];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const brandIds = Array.from(new Set(tasks.map(t => t.brand_id).filter(Boolean))) as string[];
    const brMap = new Map<string, string>();
    if (brandIds.length) {
      const { data: brs } = await supabase.from('brands').select('id,name').in('id', brandIds);
      (brs ?? []).forEach((b: any) => brMap.set(b.id, b.name));
    }
    const pplMap = new Map<string, any>();
    (((pplRes as any).data) ?? []).forEach((p: any) => pplMap.set(p.id, p));

    return rows.map(r => {
      const t = taskMap.get(r.task_id);
      const sender = r.created_by ? pplMap.get(r.created_by) : null;
      return {
        id: r.id,
        task_id: r.task_id,
        created_by: r.created_by,
        created_at: r.created_at,
        acknowledged_at: r.acknowledged_at,
        task_title: t?.title ?? 'A task',
        brand_name: t?.brand_id ? (brMap.get(t.brand_id) ?? null) : null,
        priority: t?.priority ?? null,
        due_date: t?.due_date ?? null,
        from_name: sender ? (sender.full_name || sender.email) : null,
      } as TaskReminder;
    });
  }, []);

  // On load (and whenever the user changes): show any reminders still waiting for
  // me — this is the "persist until acknowledged" requirement.
  const load = useCallback(async () => {
    if (!user) { setQueue([]); return; }
    const { data } = await supabase.from('task_reminders')
      .select('id,task_id,created_by,created_at,acknowledged_at')
      .eq('assignee_id', user.id).is('acknowledged_at', null)
      .order('created_at', { ascending: true });
    setQueue(await enrich((data as any[]) ?? []));
  }, [user, enrich]);

  useEffect(() => { load(); }, [load]);

  // Realtime: a new reminder for me appears instantly, on whatever page I'm on.
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`task-reminders:${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_reminders', filter: `assignee_id=eq.${user.id}` },
        async (p) => {
          const row = p.new as any;
          if (row.acknowledged_at) return;
          const [enriched] = await enrich([row]);
          setQueue(prev => prev.some(r => r.id === enriched.id) ? prev : [...prev, enriched]);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, enrich]);

  const acknowledge = async (id: string, response: AckResponse) => {
    // Optimistically drop it from the queue so the overlay advances/closes at once.
    setQueue(prev => prev.filter(r => r.id !== id));
    const { error } = await supabase.from('task_reminders')
      .update({ acknowledged_at: new Date().toISOString(), ack_response: response })
      .eq('id', id);
    if (error) { await load(); } // restore on failure
  };

  return (
    <TaskReminderContext.Provider value={{ queue, acknowledge }}>
      {children}
      <TaskReminderOverlay />
    </TaskReminderContext.Provider>
  );
}

export function useTaskReminders() {
  const c = useContext(TaskReminderContext);
  if (!c) throw new Error('useTaskReminders must be used inside TaskReminderProvider');
  return c;
}
