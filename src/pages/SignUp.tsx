import { FormEvent, useState } from 'react';
import { Card, Form, Button, Alert } from 'react-bootstrap';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function SignUp() {
  const { signUp, session } = useAuth();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await signUp(email, password, fullName);
    setBusy(false);
    if (error) setErr(error); else setOk(true);
  };

  return (
    <div className="ac-auth-wrap">
      <Card className="ac-auth-card shadow">
        <Card.Body className="p-4">
          <h3 className="mb-1">Create account</h3>
          <p className="text-muted mb-4">Join Afflix Core</p>
          {err && <Alert variant="danger">{err}</Alert>}
          {ok && <Alert variant="success">Account created. Check your email if confirmation is enabled, then sign in.</Alert>}
          <Form onSubmit={onSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control required value={fullName} onChange={e => setFullName(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
            </Form.Group>
            <Button type="submit" disabled={busy} className="w-100">
              {busy ? 'Creating…' : 'Sign up'}
            </Button>
          </Form>
          <p className="text-center mt-3 mb-0 small">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
