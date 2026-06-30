import { Alert, Button } from 'react-bootstrap';

/**
 * Read-only banner shown when another teammate is currently editing the report.
 * The "Take over editing" button bumps the current editor to read-only and
 * hands editing control to this user (see useEditLock).
 */
export default function EditLockBanner({ editorName, onTakeOver }: {
  editorName: string;
  onTakeOver: () => void;
}) {
  return (
    <Alert variant="info" className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
      <div className="d-flex align-items-center gap-2">
        <i className="bi bi-pencil-fill" />
        <div>
          <strong>{editorName}</strong> is currently editing this report.{' '}
          You're in read-only mode — any changes here won't be saved.
        </div>
      </div>
      <Button size="sm" variant="outline-primary" onClick={onTakeOver}>
        <i className="bi bi-unlock me-1" /> Take over editing
      </Button>
    </Alert>
  );
}
