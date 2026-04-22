import { Card, Row, Col } from 'react-bootstrap';

export default function Dashboard() {
  return (
    <>
      <h2 className="mb-4">Dashboard</h2>
      <Row className="g-3">
        <Col md={4}>
          <Card body>
            <div className="text-muted small">Total Brands</div>
            <div className="fs-3 fw-semibold">—</div>
          </Card>
        </Col>
        <Col md={4}>
          <Card body>
            <div className="text-muted small">GMV (Last 30 Days)</div>
            <div className="fs-3 fw-semibold">—</div>
          </Card>
        </Col>
        <Col md={4}>
          <Card body>
            <div className="text-muted small">Active Clients</div>
            <div className="fs-3 fw-semibold">—</div>
          </Card>
        </Col>
      </Row>
      <p className="text-muted mt-4">Widgets to be defined.</p>
    </>
  );
}
