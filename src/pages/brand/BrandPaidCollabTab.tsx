import { Card } from 'react-bootstrap';

export default function BrandPaidCollabTab() {
  return (
    <Card body className="text-center text-muted py-5">
      <div style={{ fontSize: '2.5rem' }} className="mb-2"><i className="bi bi-people" /></div>
      <h5 className="mb-1">Paid Collab — coming soon</h5>
      <p className="mb-0 small">Track paid creator collaborations for this brand.</p>
    </Card>
  );
}
