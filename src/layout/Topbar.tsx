import { Button, Dropdown } from 'react-bootstrap';
import { useAuth } from '../auth/AuthContext';

export default function Topbar() {
  const { profile, signOut } = useAuth();
  return (
    <div className="ac-topbar">
      <div className="fw-semibold">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</div>
      <Dropdown align="end">
        <Dropdown.Toggle variant="light" size="sm">
          <i className="bi bi-person-circle me-2" />
          {profile?.email}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.ItemText>Role: <strong>{profile?.role}</strong></Dropdown.ItemText>
          <Dropdown.Divider />
          <Dropdown.Item as="button" onClick={signOut}>Sign out</Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}
