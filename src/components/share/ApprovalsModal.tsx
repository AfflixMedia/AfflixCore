import { useState, useMemo, useEffect } from 'react';
import { Modal, Button, Form, Alert, Badge } from 'react-bootstrap';
import DOMPurify from 'dompurify';
import { WeeklyReportContent, normalizeContent } from '../../lib/reportSchema';
import { formatRange } from '../../lib/dates';

export interface PendingApprovalReport {
  id: string;
  brand_id: string;
  brand_name: string;
  week_number: number;
  week_start: string;
  week_end: string;
  content: WeeklyReportContent;
}

export type ApprovalChoice = 'approved' | 'changes_requested' | null;

interface DraftDecision {
  choice: ApprovalChoice;
  comment: string;
}

export interface ExistingDecisionInfo {
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  decided_by_name: string;
  decided_at: string;
}

interface Props {
  show: boolean;
  pending: PendingApprovalReport[];
  defaultName: string;
  /** Map of report_id → previously-submitted decision via this link, for pre-fill / re-edit. */
  existingDecisions?: Record<string, ExistingDecisionInfo>;
  onClose: () => void;
  onSubmit: (decisions: { report_id: string; decision: 'approved' | 'changes_requested'; comment: string; decided_by_name: string }[]) => Promise<void>;
}

export default function ApprovalsModal({ show, pending, defaultName, existingDecisions, onClose, onSubmit }: Props) {
  const [name, setName] = useState(defaultName);
  const [drafts, setDrafts] = useState<Record<string, DraftDecision>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // When the dialog (re-)opens, seed drafts from any existing decisions so the
  // user sees their previous choice + comment and can update them.
  useEffect(() => {
    if (!show) return;
    const seeded: Record<string, DraftDecision> = {};
    if (existingDecisions) {
      for (const p of pending) {
        const e = existingDecisions[p.id];
        if (e) seeded[p.id] = { choice: e.decision, comment: e.comment ?? '' };
      }
    }
    setDrafts(seeded);
    setName(defaultName);
    setErr(null);
  }, [show, pending, existingDecisions, defaultName]);

  const setDraft = (reportId: string, patch: Partial<DraftDecision>) =>
    setDrafts(prev => {
      const cur = prev[reportId] ?? { choice: null, comment: '' };
      return { ...prev, [reportId]: { ...cur, ...patch } };
    });

  const decided = useMemo(() => Object.entries(drafts).filter(([, d]) => d.choice != null), [drafts]);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Please enter your name first.'); return; }
    if (decided.length === 0) { setErr('Choose Approve or Request changes for at least one item, or close this dialog.'); return; }
    setSubmitting(true);
    try {
      await onSubmit(decided.map(([report_id, d]) => ({
        report_id,
        decision: d.choice as 'approved' | 'changes_requested',
        comment: d.comment.trim(),
        decided_by_name: name.trim(),
      })));
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} size="lg" centered backdrop="static" dialogClassName="ac-popup-modal">
      <Modal.Header className="ac-popup-header">
        <Modal.Title>
          <i className="bi bi-shield-check me-2" />
          {pending.length === 1 ? 'Approval requested' : `${pending.length} approvals requested`}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="ac-popup-body">
        <p className="text-muted mb-3">
          Please review the following requests from your account manager. Approve or request changes; comments are optional.
        </p>

        {err && <Alert variant="danger" className="py-2">{err}</Alert>}

        <Form.Group className="mb-3">
          <Form.Label className="small fw-semibold">Your name</Form.Label>
          <Form.Control
            value={name} onChange={e => setName(e.target.value)}
            placeholder="So we can credit your decision"
            disabled={submitting}
          />
        </Form.Group>

        {pending.map(p => {
          const draft = drafts[p.id] ?? { choice: null, comment: '' };
          const existing = existingDecisions?.[p.id];
          const safeHtml = DOMPurify.sanitize(p.content.approval?.content ?? '');
          return (
            <div key={p.id} className="ac-approval-item mb-3">
              <div className="d-flex flex-wrap align-items-center justify-content-between mb-2 gap-2">
                <div>
                  <Badge bg="dark" className="me-2">{p.brand_name}</Badge>
                  <span className="fw-semibold">Week #{p.week_number}</span>
                  <small className="text-muted ms-2">{formatRange(p.week_start, p.week_end)}</small>
                </div>
                {existing && (
                  <Badge bg={existing.decision === 'approved' ? 'success' : 'warning'} text={existing.decision === 'approved' ? undefined : 'dark'}>
                    Already {existing.decision === 'approved' ? 'approved' : 'asked for changes'}
                  </Badge>
                )}
              </div>
              <div className="ac-rte-view ac-approval-content mb-3"
                   dangerouslySetInnerHTML={{ __html: safeHtml }} />
              <div className="d-flex gap-2 flex-wrap mb-2">
                <Button
                  variant={draft.choice === 'approved' ? 'success' : 'outline-success'}
                  onClick={() => setDraft(p.id, { choice: 'approved' })}
                  disabled={submitting}
                >
                  <i className="bi bi-check-circle me-1" /> Approve
                </Button>
                <Button
                  variant={draft.choice === 'changes_requested' ? 'warning' : 'outline-warning'}
                  onClick={() => setDraft(p.id, { choice: 'changes_requested' })}
                  disabled={submitting}
                >
                  <i className="bi bi-arrow-repeat me-1" /> Request changes
                </Button>
              </div>
              <Form.Control
                as="textarea" rows={2}
                placeholder="Comment (optional)"
                value={draft.comment}
                onChange={e => setDraft(p.id, { comment: e.target.value })}
                disabled={submitting}
              />
            </div>
          );
        })}
      </Modal.Body>
      <Modal.Footer className="ac-popup-footer">
        <Button variant="link" className="text-muted" onClick={onClose} disabled={submitting}>
          Skip for now
        </Button>
        <Button variant="primary" onClick={submit} disabled={submitting || decided.length === 0}>
          {submitting ? 'Submitting…' : `Submit ${decided.length || ''} decision${decided.length === 1 ? '' : 's'}`.trim()}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
