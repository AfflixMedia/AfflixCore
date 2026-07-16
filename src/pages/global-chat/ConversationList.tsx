// Left pane: filter bar (All / Unread / Groups / Brands / Archive), search,
// conversation rows with unread badges, and the floating "start a chat" button.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Form, InputGroup } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ConversationView, ChatFilter, ChatContact } from './types';
import { roleLabel, roleBadge, shortTime, contactName } from './types';
import { toPlainText } from './messageFormat';

interface Props {
  views: ConversationView[];
  activeId: string | null;
  myId: string;
  brandLeadByBrand: Map<string, ChatContact>; // brand_id → owning Team Lead
  onSelect: (conversationId: string) => void;
  onStartChat: () => void;
  onOpenAnnouncement: () => void;
}

const FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
];

export default function ConversationList({ views, activeId, myId, brandLeadByBrand, onSelect, onStartChat, onOpenAnnouncement }: Props) {
  // A single primary filter. Base tabs ('all' | 'unread' | 'groups' | 'archived')
  // plus per-Team-Lead brand filters keyed 'lead:<id>' (and 'lead:none' for brand
  // groups with no Team Lead) — the lead chips sit in the same row and act like tabs.
  const [filter, setFilter] = useState<string>('unread');
  const [q, setQ] = useState('');

  // Filter strip overflow: hidden scrollbar + left/right nudge arrows.
  const stripRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const updateArrows = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    updateArrows();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateArrows]);
  const nudge = (dir: -1 | 1) =>
    stripRef.current?.scrollBy({ left: dir * 120, behavior: 'smooth' });

  // Archived (left/removed) chats only count toward unread in their own tab.
  const totalUnread = useMemo(
    () => views.reduce((s, v) => s + (v.archived ? 0 : v.unread), 0), [views]);
  const archivedCount = useMemo(() => views.filter(v => v.archived).length, [views]);

  // Team Lead chips for the Brands tab — one per lead that owns a visible brand
  // group, plus an "Unassigned" bucket for brand groups with no Team Lead.
  const leadChips = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    let noneCount = 0;
    views.forEach(v => {
      if (!v.conversation.brand_id || v.archived) return;
      const lead = brandLeadByBrand.get(v.conversation.brand_id);
      if (lead) {
        const e = map.get(lead.id) ?? { id: lead.id, name: contactName(lead), count: 0 };
        e.count++; map.set(lead.id, e);
      } else { noneCount++; }
    });
    const leads = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return { leads, noneCount };
  }, [views, brandLeadByBrand]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const leadSel = filter.startsWith('lead:') ? filter.slice(5) : null;
    let list = views.filter(v => {
      // Archived chats live only under the Archive tab; every other tab hides them.
      if (filter === 'archived' ? !v.archived : v.archived) return false;
      if (filter === 'unread' && v.unread === 0) return false;
      // Groups tab excludes brand groups (those have their own lead filters).
      if (filter === 'groups' && (!v.conversation.is_group || v.conversation.brand_id)) return false;
      if (leadSel !== null) {
        // Lead filter: only that Team Lead's brand groups (nothing else mixed in).
        if (!v.conversation.brand_id) return false;
        const leadId = brandLeadByBrand.get(v.conversation.brand_id)?.id ?? 'none';
        if (leadId !== leadSel) return false;
      }
      if (needle && !`${v.title} ${v.lastBody ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // Lead filters show only brand chats — order them alphabetically (the
    // recency ordering stays on the other tabs).
    if (leadSel !== null) list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [views, filter, q, brandLeadByBrand]);

  return (
    <div className="ac-chat-list">
      <div className="ac-chat-list-head">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h5 className="mb-0">Chats {totalUnread > 0 && <Badge bg="danger" pill>{totalUnread}</Badge>}</h5>
        </div>
        <InputGroup size="sm" className="mb-2">
          <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
          <Form.Control placeholder="Search chats…" value={q} onChange={e => setQ(e.target.value)} />
        </InputGroup>
        <div className="ac-chat-filters">
          {canLeft && (
            <button type="button" className="ac-chat-filter-arrow" aria-label="Scroll filters left"
              onClick={() => nudge(-1)}>
              <i className="bi bi-chevron-left" />
            </button>
          )}
          <div className="ac-chat-filters-strip" ref={stripRef} onScroll={updateArrows}>
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                className={`ac-chat-filter ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {f.key === 'unread' && totalUnread > 0 && <span className="ms-1">({totalUnread})</span>}
              </button>
            ))}
            {/* Per-Team-Lead brand filters — act like tabs, isolate that lead's brand groups */}
            {leadChips.leads.map(l => (
              <button
                key={l.id}
                type="button"
                title={`${l.name}'s brand groups`}
                className={`ac-chat-filter ${filter === `lead:${l.id}` ? 'active' : ''}`}
                onClick={() => setFilter(`lead:${l.id}`)}
              >
                <i className="bi bi-person-badge me-1" />{l.name}
                <span className="ms-1">({l.count})</span>
              </button>
            ))}
            {leadChips.noneCount > 0 && (
              <button
                type="button"
                title="Brand groups with no Team Lead"
                className={`ac-chat-filter ${filter === 'lead:none' ? 'active' : ''}`}
                onClick={() => setFilter('lead:none')}
              >
                <i className="bi bi-shop me-1" />Unassigned
                <span className="ms-1">({leadChips.noneCount})</span>
              </button>
            )}
            {/* Archive always last, after the lead chips */}
            <button
              type="button"
              className={`ac-chat-filter ${filter === 'archived' ? 'active' : ''}`}
              onClick={() => setFilter('archived')}
            >
              Archive
              {archivedCount > 0 && <span className="ms-1">({archivedCount})</span>}
            </button>
          </div>
          {canRight && (
            <button type="button" className="ac-chat-filter-arrow" aria-label="Scroll filters right"
              onClick={() => nudge(1)}>
              <i className="bi bi-chevron-right" />
            </button>
          )}
          <button
            type="button"
            className="ac-chat-filter ac-ann-filter"
            title="Announcements"
            onClick={onOpenAnnouncement}
          >
            <i className="bi bi-megaphone-fill" />
          </button>
        </div>
      </div>

      <div className="ac-chat-list-scroll">
        {shown.length === 0 ? (
          <div className="text-muted small text-center py-4 px-3">
            {views.length === 0
              ? 'No chats yet. Tap the button below to start one.'
              : 'No chats match this filter.'}
          </div>
        ) : (
          shown.map(v => {
            const isActive = v.conversation.id === activeId;
            const previewPrefix = v.lastSenderId === myId ? 'You: ' : '';
            return (
              <button
                key={v.conversation.id}
                type="button"
                className={`ac-chat-row ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(v.conversation.id)}
              >
                <Avatar
                  name={v.title}
                  src={v.conversation.is_group ? undefined : v.otherUser?.avatar_url}
                  variant={v.conversation.is_group ? 'dark' : 'brand'}
                />
                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-center gap-2">
                    {v.conversation.brand_id && <i className="bi bi-shop ac-chat-row-brand" title="Brand group" />}
                    <span className="ac-chat-row-name text-truncate">{v.title}</span>
                    {!v.conversation.is_group && v.otherUser && (
                      <Badge bg={roleBadge(v.otherUser.role)} className="ac-role-badge">
                        {roleLabel(v.otherUser.role, v.otherUser.is_superbob)}
                      </Badge>
                    )}
                    <span className="ac-chat-row-time ms-auto">{shortTime(v.lastAt)}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {v.lastSenderId === myId && v.lastReceipt && (
                      <span className={`ac-ticks ${v.lastReceipt}`}>
                        <i className={`bi ${v.lastReceipt === 'sent' ? 'bi-check2' : 'bi-check2-all'}`} />
                      </span>
                    )}
                    <span className={`ac-chat-row-preview text-truncate ${v.unread > 0 ? 'unread' : ''}`}>
                      {v.lastBody ? `${previewPrefix}${toPlainText(v.lastBody)}` : <span className="fst-italic">No messages yet</span>}
                    </span>
                    {v.unread > 0 && (
                      <span className="ac-unread-dot">{v.unread > 99 ? '99+' : v.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <button type="button" className="ac-start-chat-btn" title="Start a chat" onClick={onStartChat}>
        <i className="bi bi-pencil-square" />
      </button>
    </div>
  );
}
