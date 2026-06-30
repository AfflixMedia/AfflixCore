import { FormEvent, useState } from 'react';
import { Card, Form, Button, Alert, Row, Col } from 'react-bootstrap';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

const ROLE_LABELS: Record<string, string> = {
  bob: 'Admin',
  team_lead: 'Team Lead',
  apc: 'Account Manager',
  paid_collab_client: 'Paid Collab Client',
  paid_collab_handler: 'Paid Collab Handler',
  pending: 'Pending',
};

export default function Profile() {
  const { profile, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    const email = profile?.email || user?.email;
    if (!email) {
      setErr('Could not determine your account email. Please sign in again.');
      return;
    }
    if (password.length < 6 || password.length > 72) {
      setErr('Password must be between 6 and 72 characters.');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    if (password === currentPassword) {
      setErr('New password must be different from your current password.');
      return;
    }

    setBusy(true);
    // Verify the current password by re-authenticating before allowing a change —
    // updateUser() alone does NOT check the existing password.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      setBusy(false);
      setErr('Your current password is incorrect.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setCurrentPassword('');
    setPassword('');
    setConfirm('');
    setMsg('Your password has been updated.');
  };

  return (
    <div>
      <h4 className="mb-4">My Profile</h4>
      <Row className="g-4">
        <Col lg={6}>
          <Card className="shadow-sm h-100">
            <Card.Body className="p-4">
              <h6 className="text-muted text-uppercase small mb-3">Account details</h6>
              <div className="mb-3">
                <div className="text-muted small">Name</div>
                <div className="fw-semibold">{profile?.full_name || '—'}</div>
              </div>
              <div className="mb-3">
                <div className="text-muted small">Email</div>
                <div className="fw-semibold">{profile?.email || user?.email || '—'}</div>
              </div>
              <div className="mb-0">
                <div className="text-muted small">Role</div>
                <div className="fw-semibold">
                  {profile?.role ? (ROLE_LABELS[profile.role] ?? profile.role) : '—'}
                </div>
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={6}>
          <Card className="shadow-sm h-100">
            <Card.Body className="p-4">
              <h6 className="text-muted text-uppercase small mb-3">Reset password</h6>
              {err && <Alert variant="danger">{err}</Alert>}
              {msg && <Alert variant="success">{msg}</Alert>}
              <Form onSubmit={onSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Current password</Form.Label>
                  <Form.Control
                    type="password"
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>New password</Form.Label>
                  <Form.Control
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Confirm new password</Form.Label>
                  <Form.Control
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                  />
                </Form.Group>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Updating…' : 'Update password'}
                </Button>
              </Form>
              <hr className="my-4" />
              <p className="small text-muted mb-0">
                <i className="bi bi-info-circle me-1" />
                Forgot your password and can&apos;t sign in? Please contact your administrator
                (Bob) to have it reset for you.
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
