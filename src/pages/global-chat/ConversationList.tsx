// Left pane: filter bar (All / Unread / Groups), search, conversation rows with
// unread badges, and the floating "start a chat" button.
import { useMemo, useState } from 'react';
import { Badge, Form, InputGroup } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ConversationView, ChatFilter } from './types';
import { roleLabel, roleBadge, shortTime } from './types';
import { toPlainText } from './messageFormat';

interface Props {
  views: ConversationView[];
  activeId: string | null;
  myId: string;
  onSelect: (conversationId: string) => void;
  onStartChat: () => void;
}

const FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
];

export default function ConversationList({ views, activeId, myId, onSelect, onStartChat }: Props) {
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [q, setQ] = useState('');

  const totalUnread = useMemo(() => views.reduce((s, v) => s + v.unread, 0), [views]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return views.filter(v => {
      if (filter === 'unread' && v.unread === 0) return false;
      if (filter === 'groups' && !v.conversation.is_group) return false;
      if (needle && !`${v.title} ${v.lastBody ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [views, filter, q]);

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
                <Avatar name={v.title} variant={v.conversation.is_group ? 'dark' : 'brand'} />
                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-center gap-2">
                    <span className="ac-chat-row-name text-truncate">{v.title}</span>
                    {!v.conversation.is_group && v.otherUser && (
                      <Badge bg={roleBadge(v.otherUser.role)} className="ac-role-badge">
                        {roleLabel(v.otherUser.role)}
                      </Badge>
                    )}
                    <span className="ac-chat-row-time ms-auto">{shortTime(v.lastAt)}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
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
