import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: any;
  read_at: string | null;
  created_at: string;
}

interface Ctx {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  markReadByConversation: (conversationId: string) => Promise<void>;
  markReadByTypes: (types: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const NotificationsContext = createContext<Ctx | undefined>(undefined);

const PAGE_SIZE = 50;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setNotifications([]); return; }
    setLoading(true);
    const { data } = await supabase.from('notifications')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    setNotifications((data as Notification[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Whether this browser has an active web-push subscription. When it does, the
  // service worker (sw.js `push`) already shows the OS notification once per
  // browser — so we must NOT also fire a foreground `new Notification()` here,
  // or the user sees duplicates (one per open tab + the push). The foreground
  // notification is only a fallback for when push isn't set up.
  const hasPushSub = useRef(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (active) hasPushSub.current = !!sub;
      } catch { /* ignore — fall back to foreground notification */ }
    })();
    return () => { active = false; };
  }, [user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`notif:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (p) => {
          const n = p.new as Notification;
          setNotifications(prev => [n, ...prev].slice(0, PAGE_SIZE));
          // Foreground OS notification. We normally suppress it when a web-push
          // subscription exists (the SW push would deliver one → avoid duplicates).
          // BUT the internal, realtime-inserted types below are NEVER sent through
          // send-push (only the client-facing share/comment edge functions call it),
          // so for them the in-tab popup is the ONLY delivery — always show it.
          const FOREGROUND_ALWAYS = new Set([
            'task', 'task_reminder', 'task_reminder_ack', 'chat', 'chat_mention', 'note_reminder',
          ]);
          const alwaysForeground = FOREGROUND_ALWAYS.has(n.type);
          if ((alwaysForeground || !hasPushSub.current) && 'Notification' in window && Notification.permission === 'granted') {
            try {
              const ni = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, icon: '/icon-192.png' });
              ni.onclick = () => { window.focus(); if (n.link) window.location.assign(n.link); };
            } catch (_) { /* some browsers require sw */ }
          }
        }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const markRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  };
  const markAllRead = async () => {
    if (!user) return;
    const ts = new Date().toISOString();
    setNotifications(prev => prev.map(n => n.read_at ? n : { ...n, read_at: ts }));
    await supabase.from('notifications').update({ read_at: ts }).eq('user_id', user.id).is('read_at', null);
  };
  // Mark every unread chat notification for one conversation as read — called
  // when the user opens that conversation, so the bell stays in sync.
  const markReadByConversation = async (conversationId: string) => {
    const ids = notifications
      .filter(n => !n.read_at && n.type === 'chat' && n.payload?.conversation_id === conversationId)
      .map(n => n.id);
    if (ids.length === 0) return;
    const ts = new Date().toISOString();
    setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, read_at: ts } : n));
    await supabase.from('notifications').update({ read_at: ts }).in('id', ids);
  };

  // Mark every unread notification of the given types as read — called when the
  // user opens the page those notifications point at (e.g. /tasks clears the
  // 'task' badge), so the sidebar count doesn't stick when they skip the bell.
  // Updates by user+type in the DB (not just loaded ids) to catch rows older
  // than the in-memory page.
  const markReadByTypes = async (types: string[]) => {
    if (!user) return;
    const ts = new Date().toISOString();
    setNotifications(prev => prev.map(n => !n.read_at && types.includes(n.type) ? { ...n, read_at: ts } : n));
    await supabase.from('notifications').update({ read_at: ts })
      .eq('user_id', user.id).is('read_at', null).in('type', types);
  };

  const remove = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  };

  const unreadCount = notifications.filter(n => !n.read_at).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, loading, markRead, markAllRead, markReadByConversation, markReadByTypes, remove }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const c = useContext(NotificationsContext);
  if (!c) throw new Error('useNotifications must be used inside NotificationsProvider');
  return c;
}
