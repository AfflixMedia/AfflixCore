// Public creator contract signing page — /sign/:token (no auth).
//
// The handler generates the link from the Paid Collab workspace's Contract
// column. Here the creator reads the exact agreement PDF snapshot that was
// generated for their deal, types their name, draws (or uploads) a signature
// and confirms ONCE — the signature is frozen server-side afterwards, so
// re-opening the link only offers the signed PDF download.
//
// Everything runs through two service-role edge functions:
//   get-creator-contract  → payload + signing state
//   sign-creator-contract → one-shot signature, notifies the handler(s)

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { svgToPngDataUrl } from '../lib/imageUpload';
import './handler-collab/handlerCollab.css';

type ContractState = {
  payload: Record<string, any>;
  brand_name: string;
  creator_name: string;
  signed_at: string | null;
  signer_name: string | null;
  signer_signature: string | null;
};

export default function SignContract() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [contract, setContract] = useState<ContractState | null>(null);

  const [pdfUrl, setPdfUrl] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [uploadedSig, setUploadedSig] = useState<string | null>(null);
  const [padDirty, setPadDirty] = useState(false);
  const [signing, setSigning] = useState(false);
  const [err, setErr] = useState('');

  const padRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  /* ── load the contract ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-creator-contract', { body: { token } });
        if (error) throw await fnError(error);
        if (!alive) return;
        setContract(data.contract as ContractState);
        setName((data.contract?.signer_name || data.contract?.creator_name || '') as string);
      } catch (e: any) {
        if (alive) setLoadErr(e.message || 'Could not open this signing link.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  /* ── render the PDF the creator is signing (or their signed copy) ── */
  const signed = !!contract?.signed_at;
  useEffect(() => {
    if (!contract) return;
    let alive = true;
    let url = '';
    (async () => {
      try {
        const { creatorContractObjectUrl } = await import('./handler-collab/contractPdf');
        url = await creatorContractObjectUrl({
          ...(contract.payload as any),
          creatorSignatureDataUrl: contract.signer_signature || null,
          creatorSignedName: contract.signer_name || '',
          creatorSignedAt: contract.signed_at || null,
        });
        if (!alive) { URL.revokeObjectURL(url); return; }
        setPdfUrl(url);
      } catch { /* the page still works without the inline preview */ }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [contract]);

  /* ── signature pad ── */
  const padPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = padRef.current!, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  function padDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const c = padRef.current!;
    try { c.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    const ctx = c.getContext('2d')!;
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1B2430';
    const p = padPos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y); ctx.stroke();
    drawing.current = true;
    setPadDirty(true); setUploadedSig(null);
  }
  function padMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = padRef.current!.getContext('2d')!;
    const p = padPos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  const padUp = () => { drawing.current = false; };
  const clearPad = useCallback(() => {
    const c = padRef.current;
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setPadDirty(false);
  }, []);

  async function onUploadSvg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploadedSig(await svgToPngDataUrl(file));
      clearPad();
    } catch (ex: any) { setErr(`Could not read that SVG: ${ex.message || ''}`); }
  }

  async function sign() {
    setErr('');
    const cleanName = name.trim();
    if (!cleanName) { setErr('Please type your full name.'); return; }
    const signature = uploadedSig || (padDirty && padRef.current ? padRef.current.toDataURL('image/png') : '');
    if (!signature) { setErr('Please draw or upload your signature.'); return; }
    if (!agreed) { setErr('Please confirm you have read and agree to the agreement.'); return; }
    setSigning(true);
    try {
      const { data, error } = await supabase.functions.invoke('sign-creator-contract', {
        body: { token, signer_name: cleanName, signature, agreed: true },
      });
      if (error) throw await fnError(error);
      setContract(prev => (prev ? { ...prev, ...data.contract } : prev));
    } catch (e: any) {
      setErr(e.message || 'Could not submit your signature.');
    }
    setSigning(false);
  }

  async function download() {
    if (!contract) return;
    try {
      const { downloadCreatorContract } = await import('./handler-collab/contractPdf');
      await downloadCreatorContract({
        ...(contract.payload as any),
        creatorSignatureDataUrl: contract.signer_signature || null,
        creatorSignedName: contract.signer_name || '',
        creatorSignedAt: contract.signed_at || null,
      });
    } catch (e: any) { setErr(e.message || 'Could not build the PDF.'); }
  }

  if (loading) return <div className="pc-app pc-sign-page"><div className="pc-spinner" /></div>;

  if (loadErr || !contract) {
    return (
      <div className="pc-app pc-sign-page">
        <div className="pc-sign-card pc-sign-msg">
          <div className="pc-empty-icon">🔒</div>
          <h2>Link unavailable</h2>
          <p>{loadErr || 'This signing link is not valid.'}</p>
          <p className="pc-sign-fine">If you think this is a mistake, contact the person who sent you the link.</p>
        </div>
      </div>
    );
  }

  const previewSig = uploadedSig || null;

  return (
    <div className="pc-app pc-sign-page">
      <div className="pc-sign-head">
        <div>
          <div className="pc-sign-brand">{contract.brand_name}</div>
          <h1>Content Creation Agreement</h1>
          <div className="pc-sign-sub">Prepared for {contract.creator_name || contract.payload?.username || 'you'}</div>
        </div>
        {signed && <span className="pc-sign-badge"><i className="bi bi-patch-check-fill" /> Signed</span>}
      </div>

      <div className="pc-sign-card">
        <div className="pc-sign-cardhead">
          <span>{signed ? 'Your signed agreement' : 'Read the full agreement'}</span>
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={download} disabled={!signed}>
            {signed ? 'Download PDF' : 'Download available after signing'}
          </button>
        </div>
        {pdfUrl
          ? <iframe className="pc-sign-pdf" src={pdfUrl} title="Content Creation Agreement" />
          : <div className="pc-sign-pdf pc-sign-pdf-fallback">Preparing the document…</div>}
      </div>

      {signed ? (
        <div className="pc-sign-card pc-sign-done">
          <i className="bi bi-patch-check-fill" />
          <div>
            <b>Signed by {contract.signer_name}</b>
            <div className="pc-sign-fine">{new Date(contract.signed_at as string).toLocaleString()}</div>
            <div className="pc-sign-fine">This agreement is final — the signature can no longer be changed. Download your copy above.</div>
          </div>
        </div>
      ) : (
        <div className="pc-sign-card">
          <div className="pc-sign-cardhead"><span>Sign the agreement</span></div>
          <div className="pc-sign-body">
            <div className="pc-field">
              <label>Your full name</label>
              <input className="pc-input" placeholder="Full legal name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="pc-field">
              <label>Your signature</label>
              {previewSig && (
                <div className="pc-sig-preview">
                  <img src={previewSig} alt="Signature" />
                  <span className="pc-sig-preview-l">Uploaded signature</span>
                  <button type="button" className="pc-multix" title="Remove" onClick={() => setUploadedSig(null)}>×</button>
                </div>
              )}
              <canvas ref={padRef} className="pc-sigpad" width={560} height={170}
                onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerLeave={padUp} />
              <div className="pc-sig-actions">
                <span className="pc-sig-hint">Draw above with your mouse or finger, or</span>
                <label className="pc-btn pc-btn-ghost pc-btn-sm pc-sign-upload">
                  Upload SVG
                  <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={onUploadSvg} />
                </label>
                {padDirty && <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={clearPad}>Clear</button>}
              </div>
            </div>
            <label className="pc-sign-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>I have read the agreement above and agree to its terms. I understand that signing is final and my signature cannot be changed afterwards.</span>
            </label>
            {err && <div className="pc-formerr">{err}</div>}
            <button className="pc-btn pc-btn-primary pc-sign-submit" onClick={sign} disabled={signing}>
              {signing ? 'Signing…' : 'Sign & submit'}
            </button>
            <div className="pc-sign-fine">Once submitted, {contract.brand_name} is notified and you can download your signed copy right here.</div>
          </div>
        </div>
      )}
    </div>
  );
}
