import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSharedBrief, type PublicBrief } from './briefApi';
import BriefDocView from './BriefDocView';
import './briefTheme.css';
import './briefDocView.css';

/* ════════════════════════════════════════════════════════════
   /brief/:token — PUBLIC read-only view of a content brief.

   No auth: the token is the credential, and the `get-shared-brief` edge
   function (service role) enforces share_enabled + mints signed image URLs.

   This is a thin data wrapper — fetch, then hand off to <BriefDocView>, the
   Ember Clay reading layout shared with the in-app Preview. The display faces
   (Sora + Hanken Grotesk) are loaded only on this route.
════════════════════════════════════════════════════════════ */

export default function SharedBrief() {
  const { token } = useParams<{ token: string }>();
  const [brief, setBrief] = useState<PublicBrief | null>(null);
  // drive id → signed streaming URL, minted server-side on this request.
  const [images, setImages] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setErr('This link is missing its brief code.'); setLoading(false); return; }
    let off = false;
    fetchSharedBrief(token)
      .then(({ brief: b, images: imgs }) => {
        if (off) return;
        setBrief(b); setImages(imgs); setLoading(false);
      })
      .catch(e => { if (!off) { setErr(e.message); setLoading(false); } });
    return () => { off = true; };
  }, [token]);

  useEffect(() => {
    if (brief) document.title = `${brief.brand_name} — Creator Brief`;
  }, [brief]);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);

  if (loading) {
    return (
      <div className="bd bd-doc">
        <div className="bd-state"><div className="bd-spinner" /><p>Loading the brief…</p></div>
      </div>
    );
  }

  if (err || !brief) {
    return (
      <div className="bd bd-doc">
        <div className="bd-state">
          <h1>Brief unavailable</h1>
          <p>{err ?? 'This brief could not be loaded.'}</p>
          <span>Ask whoever sent the link to share it again.</span>
        </div>
      </div>
    );
  }

  // Drive-hosted logos arrive as `drive:<id>`; a pasted external URL is used as-is.
  const logoSrc = brief.logo_url
    ? (brief.logo_url.startsWith('drive:') ? images[brief.logo_url.slice(6)] : brief.logo_url)
    : '';

  return (
    <BriefDocView
      variant="share"
      brandName={brief.brand_name}
      month={brief.month}
      fallbackTitle={`${brief.brand_name} Creator Brief`}
      body={brief.body}
      logoSrc={logoSrc}
      resolveImage={id => images[id]}
    />
  );
}
