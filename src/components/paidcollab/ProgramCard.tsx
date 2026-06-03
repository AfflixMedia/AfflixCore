import { Card, Badge } from 'react-bootstrap';
import {
  ProgramSummary, programDisplayName, programPeriodLabel, isProgramEnded,
  fmtMoney, fmtNumber,
} from '../../lib/paidCollabSchema';

interface Props {
  summary: ProgramSummary;
  /** Optional brand name — shown when this card is rendered in a multi-brand list. */
  brandName?: string;
  onClick?: () => void;
}

/**
 * Compact card showing a program's at-a-glance status. Used on:
 *  - Bob's BrandDetail → Paid Collab tab (program list)
 *  - Client portal → Brand detail (programs for a single brand)
 *  - Client portal → Programs page (all programs across all brands)
 */
export default function ProgramCard({ summary, brandName, onClick }: Props) {
  const { program, creatorCount, videosPipeline, videosLive,
          paymentPending, allVideosPosted, spent } = summary;
  const ended = isProgramEnded(program);
  const c = program.currency || 'USD';
  const accent = paymentPending > 0 ? '#e8862e' : ended ? '#6c757d' : '#198754';

  return (
    <Card
      className={`h-100 shadow-sm ${paymentPending > 0 ? 'ac-payment-pending-card' : ''}`}
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        borderLeft: `4px solid ${accent}`,
        transition: 'transform .15s, box-shadow .15s',
      }}
    >
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div className="flex-grow-1 min-w-0">
            {brandName && (
              <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>
                {brandName}
              </div>
            )}
            <div className="fs-5 fw-semibold text-truncate">
              {programDisplayName(program)}
            </div>
            <div className="text-muted small">
              <i className="bi bi-calendar-range me-1" />{programPeriodLabel(program)}
            </div>
          </div>
          <div className="d-flex flex-column align-items-end gap-1">
            {ended
              ? <Badge bg="secondary"><i className="bi bi-flag-fill me-1" />Ended</Badge>
              : <Badge bg="success"><i className="bi bi-broadcast me-1" />Active</Badge>}
            {allVideosPosted && !paymentPending && !ended && (
              <Badge bg="info"><i className="bi bi-check2-circle me-1" />All posted</Badge>
            )}
          </div>
        </div>

        {paymentPending > 0 && (
          <div className="ac-payment-pending-badge mb-2 d-inline-flex align-items-center gap-2 px-2 py-1 rounded"
               style={{ backgroundColor: '#e8862e', color: '#fff', fontSize: '.8rem' }}>
            <i className="bi bi-cash-stack" />
            <strong>
              {paymentPending} payment{paymentPending === 1 ? '' : 's'} pending
            </strong>
          </div>
        )}

        <div className="row g-2 mt-auto small">
          <div className="col-6">
            <div className="text-muted" style={{ fontSize: '.7rem' }}>Creators</div>
            <div className="fw-bold">{fmtNumber(creatorCount)}</div>
          </div>
          <div className="col-6">
            <div className="text-muted" style={{ fontSize: '.7rem' }}>Videos (pipeline / live)</div>
            <div className="fw-bold">
              <span style={{ color: '#fd7e14' }}>{fmtNumber(videosPipeline)}</span>
              <span className="text-muted mx-1">/</span>
              <span style={{ color: '#198754' }}>{fmtNumber(videosLive)}</span>
            </div>
          </div>
          <div className="col-12 pt-1">
            <div className="text-muted" style={{ fontSize: '.7rem' }}>Spent on fees</div>
            <div className="fw-bold">{fmtMoney(spent, c)} <span className="text-muted">/ {fmtMoney(Number(program.total_budget || 0), c)}</span></div>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
