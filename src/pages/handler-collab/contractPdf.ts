// Content Creation Agreement PDF — the standard Afflix creator contract,
// generated per deal from the handler workspace ("Contract" column).
// Layout mirrors the reference agreement (title, sections 1–8, brand +
// creator signature blocks); only the deal facts change: brand name,
// creator username, videos count, deal amount, payment method, dates and
// the featured product line.
// jspdf is imported lazily so it stays out of the main bundle.

export type ContractInput = {
  brandName: string;
  creatorName?: string;
  username: string;          // TikTok username, no leading @
  amount: number;            // deal USD
  videosCount: number;       // 0 = unknown → neutral wording
  paymentMethod: string;     // "Zelle" / "PayPal" / "Zelle or PayPal"
  effectiveDate?: string | null; // ISO YYYY-MM-DD (onboarding date); null = today
  productNames?: string[];   // featured product(s); [] = "<brand> products"
  // Handler's contract-template settings (signature block only):
  repName?: string;              // Brand Representative name
  signatureDataUrl?: string | null; // PNG data URL, drawn/embedded on the Signature line
};

type Seg = { t: string; b?: boolean };

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 100) return String(n);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

function fmtContractDate(iso?: string | null): string {
  const d = iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso) : new Date();
  if (isNaN(d.getTime())) return iso || '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)} / ${p(d.getDate())} / ${d.getFullYear()}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export async function downloadCreatorContract(input: ContractInput) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 72; // 1" margins, like the reference doc
  let y = M + 14;

  const brand = (input.brandName || 'Brand').trim();
  const username = (input.username || '').trim();
  const count = Math.max(0, Math.round(input.videosCount || 0));
  const amountTxt = `USD $${Math.round(input.amount || 0).toLocaleString()}`;
  const method = input.paymentMethod || 'Zelle';
  const dateTxt = fmtContractDate(input.effectiveDate);
  const featuring = input.productNames && input.productNames.length
    ? joinNames(input.productNames)
    : `${brand} products`;
  // "six (6)" when the deal size is known, neutral wording when it isn't
  const nWords = count > 0 ? `${numWords(count)} (${count})` : 'the agreed number of';
  const nShort = count > 0 ? `${numWords(count)}` : 'the agreed';

  const ensure = (need: number) => {
    if (y + need > H - M) { doc.addPage(); y = M + 6; }
  };

  // Mixed bold/normal paragraph with word wrap, optional bullet (filled dot
  // for top-level, stroked circle for sub-items — cp1252 has no ○ glyph).
  function para(segs: Seg[], opts: { size?: number; indent?: number; bullet?: 'dot' | 'circle'; after?: number } = {}) {
    const size = opts.size ?? 11;
    const indent = opts.indent ?? 0;
    const maxW = W - M * 2 - indent;
    const words: { w: string; b: boolean }[] = [];
    segs.forEach(s => String(s.t).split(/\s+/).forEach(w => { if (w) words.push({ w, b: !!s.b }); }));
    doc.setFontSize(size);
    doc.setFont('helvetica', 'normal');
    const spaceW = doc.getTextWidth(' ');
    const wWidth = (word: { w: string; b: boolean }) => {
      doc.setFont('helvetica', word.b ? 'bold' : 'normal');
      return doc.getTextWidth(word.w);
    };
    const lines: { w: string; b: boolean }[][] = [];
    let line: { w: string; b: boolean }[] = [], lw = 0;
    for (const word of words) {
      const ww = wWidth(word);
      if (line.length && lw + spaceW + ww > maxW) { lines.push(line); line = [word]; lw = ww; }
      else { lw += (line.length ? spaceW : 0) + ww; line.push(word); }
    }
    if (line.length) lines.push(line);
    const lineH = size * 1.5;
    lines.forEach((ln, i) => {
      ensure(lineH);
      if (i === 0 && opts.bullet) {
        doc.setDrawColor(40, 40, 40); doc.setFillColor(40, 40, 40); doc.setLineWidth(1);
        doc.circle(M + indent - 13, y - size * 0.32, 2, opts.bullet === 'dot' ? 'F' : 'S');
      }
      let x = M + indent;
      for (const word of ln) {
        doc.setFont('helvetica', word.b ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(35, 35, 35);
        doc.text(word.w, x, y);
        x += doc.getTextWidth(word.w) + spaceW;
      }
      y += lineH;
    });
    y += opts.after ?? 6;
  }

  function heading(t: string) {
    y += 10;
    ensure(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0, 0, 0);
    doc.text(t, M, y);
    y += 21;
  }

  function rule() {
    ensure(30);
    doc.setDrawColor(185, 185, 185); doc.setLineWidth(0.8);
    doc.line(M, y, W - M, y);
    y += 28;
  }

  /* ── title ── */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(0, 0, 0);
  doc.text('CONTENT CREATION AGREEMENT', W / 2, y, { align: 'center' });
  y += 42;

  para([{ t: 'This Content Creation Agreement ("Agreement") is entered into between:' }], { after: 12 });
  para([{ t: 'Brand:', b: true }, { t: brand }], { after: 2 });
  para([{ t: 'Creator:', b: true }, { t: username || input.creatorName || '—' }], { after: 2 });
  para([{ t: 'Effective Date:', b: true }, { t: dateTxt }], { after: 4 });

  heading('1. Purpose');
  para([{ t: 'The Creator agrees to create and publish' }, { t: `${nWords} original TikTok videos`, b: true }, { t: `featuring ${featuring} on the Creator's official TikTok account.` }]);

  heading('2. Deliverables');
  para([{ t: 'The Creator agrees to:' }], { after: 4 });
  para([{ t: 'Create and publish a total of' }, { t: `${nWords} TikTok videos`, b: true }, { t: `featuring ${brand}.` }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: "Keep the videos publicly available on the Creator's TikTok account." }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: 'After all' }, { t: `${nShort} videos`, b: true }, { t: 'have been posted, provide the Brand with:' }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: 'The links to all' }, { t: `${nShort} published TikTok videos.`, b: true }], { indent: 44, bullet: 'circle', after: 2 });
  para([{ t: 'The TikTok Spark Ad Codes (Ad Authorization Codes) for each video for 365 days.' }], { indent: 44, bullet: 'circle' });

  heading('3. Compensation');
  para([{ t: 'Upon successful completion of all deliverables outlined in this Agreement, the Brand agrees to pay the Creator:' }], { after: 4 });
  para([{ t: 'Payment Amount:', b: true }, { t: amountTxt, b: true }], { after: 2 });
  para([{ t: 'Payment Method:', b: true }, { t: method, b: true }], { after: 8 });
  para([{ t: 'Payment will be sent after the Brand has received and verified:' }], { after: 4 });
  para([{ t: 'All' }, { t: `${nWords} published TikTok video links;`, b: true }, { t: 'and' }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: 'The corresponding TikTok Spark Ad Codes.' }], { indent: 22, bullet: 'dot' });

  heading('4. Creator Responsibilities');
  para([{ t: 'The Creator confirms that:' }], { after: 4 });
  para([{ t: 'All content created will be original.' }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: "The videos will be published on the Creator's TikTok account." }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: 'The provided video links and Spark Ad Codes will be valid and functional.' }], { indent: 22, bullet: 'dot' });

  heading('5. Brand Responsibilities');
  para([{ t: 'The Brand agrees to:' }], { after: 4 });
  para([{ t: 'Review the submitted deliverables in a timely manner.' }], { indent: 22, bullet: 'dot', after: 2 });
  para([{ t: 'Send the full payment of' }, { t: amountTxt, b: true }, { t: 'via' }, { t: method, b: true }, { t: 'after all agreed deliverables have been completed and received.' }], { indent: 22, bullet: 'dot' });

  heading('6. Ownership');
  para([{ t: 'The Creator retains ownership of the original content. Any additional content usage rights beyond the delivery of Spark Ad Codes must be agreed upon separately in writing.' }]);

  heading('7. Termination');
  para([{ t: 'Either party may terminate this Agreement only through written mutual consent. If the Creator fails to complete the agreed deliverables, the Brand shall have no obligation to issue payment.' }]);

  heading('8. Entire Agreement');
  para([{ t: 'This document represents the complete agreement between both parties and supersedes all prior discussions or communications relating to this collaboration.' }], { after: 16 });

  // "Signature:" line with the handler's saved signature image drawn over the
  // blank line (reference doc has a handwritten scrawl there). Falls back to
  // the plain underscore line when no image is available/parsable.
  function signatureLine(img?: string | null) {
    if (!img) { para([{ t: 'Signature:', b: true }, { t: '____________________' }], { after: 6 }); return; }
    let w = 120, h = 32;
    try {
      const props = doc.getImageProperties(img);
      if (props?.width && props?.height) w = Math.min(160, (props.width / props.height) * h);
    } catch { signatureLine(null); return; }
    y += 12; // headroom so the image doesn't overlap the line above
    ensure(h + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(35, 35, 35);
    doc.text('Signature:', M, y);
    const lx = M + doc.getTextWidth('Signature:') + 10;
    try { doc.addImage(img, 'PNG', lx, y - h + 8, w, h); } catch {}
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.7);
    doc.line(lx, y + 3, lx + Math.max(120, w + 20), y + 3);
    y += 11 * 1.5 + 6;
  }

  /* ── signatures ── */
  ensure(170);
  rule();
  para([{ t: 'Brand Representative', b: true }], { size: 12, after: 8 });
  para([{ t: 'Brand:', b: true }, { t: brand }], { after: 6 });
  if (input.repName) para([{ t: 'Representative:', b: true }, { t: input.repName }], { after: 6 });
  signatureLine(input.signatureDataUrl);
  para([{ t: 'Date:', b: true }, { t: dateTxt }], { after: 14 });

  ensure(170);
  rule();
  para([{ t: 'Creator', b: true }], { size: 12, after: 8 });
  para([{ t: 'Username:', b: true }, { t: username || '____________________' }], { after: 6 });
  para([{ t: 'Name:', b: true }, { t: input.creatorName || '______________________' }], { after: 6 });
  para([{ t: 'Signature:', b: true }, { t: '____________________' }], { after: 6 });
  para([{ t: 'Date:', b: true }, { t: '______________________' }]);

  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const who = input.creatorName || username || 'Creator';
  doc.save(`${safe(who)} x ${safe(brand)} - Contract.pdf`);
}
