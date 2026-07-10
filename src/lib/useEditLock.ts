import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * Collaborative "editing lock" for a single record, built on Supabase Realtime
 * presence (no DB schema). Everyone editing the same record joins a presence
 * channel; all clients deterministically agree on a single OWNER, who alone may
 * write. Everyone else is locked out (read-only) until the owner leaves or they
 * explicitly take over.
 *
 * Owner = the present client with the highest `claimSeq` (raised by "take over"),
 * tie-broken by earliest join, then userId — so every client computes the same
 * owner from the same presence state.
 *
 * The lock auto-releases the instant a tab closes/crashes (presence times out),
 * so there are no stuck locks to clean up.
 */

interface PresenceMeta {
  userId: string;
  name: string;
  joinedAt: number; // ms epoch — when this client first opened the editor
  claimSeq: number; // take-over counter; higher wins ownership
}

export interface EditLock {
  /** Presence has synced at least once — until then we optimistically allow editing. */
  ready: boolean;
  /** This client currently holds the edit lock (optimistically true until synced). */
  isOwner: boolean;
  /** Someone else currently owns the edit lock; this client must stay read-only. */
  isLockedOut: boolean;
  /** Name of the current owner when locked out (null otherwise). */
  editorName: string | null;
  /** Name of whoever currently holds control, whether that's me or someone else. */
  controllerName: string | null;
  /** How many other people (distinct users) are present on this record. */
  othersCount: number;
  /** Force ownership to this client (bumps the loser to read-only). */
  takeOver: () => void;
}

export function useEditLock(opts: {
  kind: string;
  id: string | undefined;
  userId: string | undefined;
  name: string;
  enabled?: boolean;
}): EditLock {
  const { kind, id, userId, name, enabled = true } = opts;

  const [ready, setReady] = useState(false);
  const [ownerMeta, setOwnerMeta] = useState<PresenceMeta | null>(null);
  const [metas, setMetas] = useState<PresenceMeta[]>([]);

  const joinedAtRef = useRef<number>(Date.now());
  const claimSeqRef = useRef<number>(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const metasRef = useRef<PresenceMeta[]>([]);
  // Latest name, so take-over re-tracks with current identity without re-subscribing.
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    if (!enabled || !id || !userId) return;

    const channel = supabase.channel(`report-edit:${kind}:${id}`, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    const sync = () => {
      const state = channel.presenceState<PresenceMeta>();
      const list = (Object.values(state).flat() as PresenceMeta[]).filter(m => !!m && !!m.userId);
      const owner = list.length === 0 ? null : [...list].sort((a, b) => {
        if (b.claimSeq !== a.claimSeq) return b.claimSeq - a.claimSeq; // higher claim wins
        if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt; // earlier join wins
        return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0; // stable final tiebreak
      })[0];
      metasRef.current = list;
      setMetas(list);
      setOwnerMeta(owner);
    };

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId,
            name: nameRef.current,
            joinedAt: joinedAtRef.current,
            claimSeq: claimSeqRef.current,
          } as PresenceMeta);
          setReady(true);
        }
      });

    return () => {
      setReady(false);
      setOwnerMeta(null);
      setMetas([]);
      metasRef.current = [];
      channelRef.current = null;
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [enabled, kind, id, userId]);

  const takeOver = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !userId) return;
    const maxSeq = metasRef.current.reduce((m, x) => Math.max(m, x.claimSeq ?? 0), 0);
    claimSeqRef.current = maxSeq + 1;
    void ch.track({
      userId,
      name: nameRef.current,
      joinedAt: joinedAtRef.current,
      claimSeq: claimSeqRef.current,
    } as PresenceMeta);
  }, [userId]);

  const isOwner = !ownerMeta || ownerMeta.userId === userId;
  const isLockedOut = ready && !isOwner;
  const othersCount = new Set(
    metas.filter(m => m.userId && m.userId !== userId).map(m => m.userId),
  ).size;

  return {
    ready,
    isOwner: ready ? isOwner : true,
    isLockedOut,
    editorName: isLockedOut ? (ownerMeta?.name ?? null) : null,
    controllerName: ownerMeta?.name ?? null,
    othersCount,
    takeOver,
  };
}
