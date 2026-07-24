import React from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { renderBriefMarkdown } from './markdown';
import { driveIdOf } from './markdown';
import {
  analyzeBrief, isEmptySection, stripNumber, plainText, shortUrl,
  type SectionView, type RefCard, type AngleCard,
} from './briefLayout';
import './briefTheme.css';
import './briefDocView.css';

/* ════════════════════════════════════════════════════════════
   BriefDocView — the Ember Clay reading layout (DESIGN.md).

   One presentational component for BOTH surfaces:
     · variant="share"   → the public /brief/:token page: sticky top bar
       (logo + title + search), fixed section sidebar (drawer on mobile),
       a guided driver.js tour, scroll-reveal animations and scroll-spy.
     · variant="preview" → the in-app Edit tab's Preview: the same document,
       single column, animated on mount, no page chrome.

   The structure (brand intro, product, reference-video cards, hooks, text
   overlays, content-angle cards, do / don't) is inferred from the brief's
   Markdown by briefLayout — so a generated, hand-written or imported brief all
   render identically without hand-tagging.
════════════════════════════════════════════════════════════ */

interface Props {
  brandName: string;
  month?: string | null;
  fallbackTitle: string;
  body: string;
  logoSrc?: string;
  /** drive id → displayable URL (signed streaming URL for Drive images). */
  resolveImage: (id: string) => string | undefined;
  variant?: 'share' | 'preview';
}

const EASE = [0.22, 0.8, 0.28, 1] as const;

/** Fade-and-rise wrapper: on scroll for the share page, on mount for preview. */
function Reveal({ children, delay = 0, mount, className }:
  { children: React.ReactNode; delay?: number; mount?: boolean; className?: string }) {
  const common = {
    className,
    initial: { opacity: 0, y: 22 },
    transition: { duration: 0.55, ease: EASE, delay },
  };
  return mount
    ? <motion.div {...common} animate={{ opacity: 1, y: 0 }}>{children}</motion.div>
    : <motion.div {...common} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.12 }}>{children}</motion.div>;
}

/** A card that tilts toward the pointer in 3D (disabled for reduced motion). */
function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [7, -7]), { stiffness: 220, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-9, 9]), { stiffness: 220, damping: 18 });

  const onMove = (e: React.PointerEvent) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const reset = () => { px.set(0.5); py.set(0.5); };

  return (
    <motion.div
      className={className}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={reduce ? undefined : { rotateX: rx, rotateY: ry }}
      whileHover={reduce ? undefined : { y: -4, boxShadow: 'var(--clay-hover)' }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
    >
      {children}
    </motion.div>
  );
}

export default function BriefDocView({
  brandName, month, fallbackTitle, body, logoSrc, resolveImage, variant = 'share',
}: Props) {
  const share = variant === 'share';
  const view = React.useMemo(() => {
    const v = analyzeBrief(body, fallbackTitle);
    // Empty scaffold sections (added at import so the editor offers the full
    // spine) stay off the reading page until they hold content.
    return { ...v, sections: v.sections.filter(s => !isEmptySection(s)) };
  }, [body, fallbackTitle]);

  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState('');
  const [navOpen, setNavOpen] = React.useState(false);
  const [copied, setCopied] = React.useState('');
  const [toast, setToast] = React.useState('');
  const toastTimer = React.useRef<number | undefined>(undefined);

  const md = React.useCallback(
    (fragment: string) => renderBriefMarkdown(fragment, resolveImage),
    [resolveImage],
  );

  const srcOf = React.useCallback((ref: string | null) => {
    if (!ref) return '';
    const id = driveIdOf(ref);
    return id ? (resolveImage(id) ?? '') : ref;
  }, [resolveImage]);

  const heroImg = logoSrc || srcOf(view.heroImageRef);

  // scroll-spy (share only)
  React.useEffect(() => {
    if (!share || !view.sections.length) return;
    const io = new IntersectionObserver(
      entries => {
        const seen = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: '-72px 0px -60% 0px' },
    );
    for (const s of document.querySelectorAll('.bd-sec')) io.observe(s);
    return () => io.disconnect();
  }, [share, view.sections.length]);

  // drawer: Esc + scroll lock
  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [navOpen]);

  React.useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text); setToast('Copied to clipboard');
    } catch {
      setToast('Press Ctrl/Cmd + C to copy');
    }
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => { setToast(''); setCopied(''); }, 1600);
  };

  const runTour = () => {
    const steps = [
      { element: '.bd-side', popover: { title: 'Jump around', description: 'Every section of the brief is here — tap one to jump straight to it.' } },
      { element: '.bd-find', popover: { title: 'Find a line fast', description: 'Search filters every hook, overlay and script line as you type.' } },
      { element: '.bd-copy, .bd-ov', popover: { title: 'Tap to copy', description: 'Tap any hook or overlay and it copies to your clipboard, ready to paste on screen.' } },
      { element: '.bd-refs', popover: { title: 'Reference videos', description: 'Study the structure of these — hooks, pacing and framing. Steal the structure, not the words.' } },
    ].filter(s => document.querySelector(s.element.split(',')[0].trim()));
    driver({ showProgress: true, animate: true, overlayColor: 'rgba(10,7,5,.75)', stagePadding: 8, stageRadius: 14, steps }).drive();
  };

  const needle = q.trim().toLowerCase();

  /* ── copyable line (hook / overlay) ── */
  const CopyLine = ({ text, compact }: { text: string; compact?: boolean }) => {
    const plain = plainText(text);
    const on = copied === plain;
    const html = md(text).replace(/^<p>|<\/p>\s*$/g, '');
    if (compact) {
      return (
        <button className={`bd-ov ${on ? 'done' : ''}`} onClick={() => copy(plain)} title="Copy this overlay">
          <span dangerouslySetInnerHTML={{ __html: html }} />
          <span className="oi" aria-hidden="true">{on ? <IcoCheck /> : <IcoCopy />}</span>
        </button>
      );
    }
    return (
      <button className={`bd-copy ${on ? 'done' : ''}`} onClick={() => copy(plain)} title="Copy this line">
        <span className="t" dangerouslySetInnerHTML={{ __html: html }} />
        <span className="act">{on ? <><IcoCheck /> Copied</> : <><IcoCopy /> Copy</>}</span>
      </button>
    );
  };

  const filterItems = (items: string[]) =>
    needle ? items.filter(t => t.toLowerCase().includes(needle)) : items;

  const renderSection = (s: SectionView, i: number) => {
    const inner = (() => {
      switch (s.kind) {
        case 'videos': {
          return (
            <>
              {!!s.intro.trim() && <div className="bd-md" dangerouslySetInnerHTML={{ __html: md(s.intro) }} />}
              <div className="bd-refs">
                {s.cards.map((c, ci) => <RefCardView key={ci} card={c} src={srcOf(c.imgRef)} md={md} />)}
              </div>
              {s.also.length > 0 && (
                <div className="bd-also">
                  {s.also.map((a, ai) => (
                    <a key={ai} className="bd-also-chip" href={a.url} target="_blank" rel="noopener noreferrer">
                      {a.label} <span className="ac" aria-hidden="true">↗</span> {shortUrl(a.url)}
                    </a>
                  ))}
                </div>
              )}
              {/* Content that shared the section but isn't part of the video
                  run (angles, ideas…) renders after the cards, never in them. */}
              {!!s.tail.trim() && (
                <div className="bd-md" dangerouslySetInnerHTML={{ __html: md(s.tail) }} />
              )}
            </>
          );
        }
        case 'lines': {
          const shown = filterItems(s.items);
          return (
            <>
              {!!s.intro.trim() && <div className="bd-md" dangerouslySetInnerHTML={{ __html: md(s.intro) }} />}
              {shown.length === 0
                ? <p className="bd-empty">No lines here match “{q}”.</p>
                : s.compact
                  ? <div className="bd-overlays">{shown.map((t, li) => <CopyLine key={li} text={t} compact />)}</div>
                  : <div className="bd-lines">{shown.map((t, li) => <CopyLine key={li} text={t} />)}</div>}
            </>
          );
        }
        case 'angles': {
          return (
            <>
              {!!s.intro.trim() && <div className="bd-md" dangerouslySetInnerHTML={{ __html: md(s.intro) }} />}
              <div className="bd-angles">
                {s.angles.map((a, ai) => <AngleView key={ai} angle={a} n={ai + 1} md={md} CopyLine={CopyLine} needle={needle} />)}
              </div>
            </>
          );
        }
        case 'rules': {
          return (
            <div className="bd-rules">
              {s.columns.map((col, ci) => (
                <div className={`bd-rule ${col.negative ? 'no' : ''}`} key={ci}>
                  <div className="bd-rule-h">
                    <span className="bd-rule-ico" aria-hidden="true">{col.negative ? <IcoNo /> : <IcoCheck />}</span>
                    <b>{col.label}</b>
                    <span>{col.negative ? 'Compliance' : 'Craft'}</span>
                  </div>
                  <ul>
                    {col.items.map((it, ii) => (
                      <li key={ii} dangerouslySetInnerHTML={{ __html: md(it).replace(/^<p>|<\/p>\s*$/g, '') }} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          );
        }
        default:
          return <div className="bd-md" dangerouslySetInnerHTML={{ __html: md(s.md) }} />;
      }
    })();

    const count =
      s.kind === 'lines' ? `${s.items.length} line${s.items.length === 1 ? '' : 's'}` :
      s.kind === 'videos' ? `${s.cards.length} to study` :
      s.kind === 'angles' ? `${s.angles.length} route${s.angles.length === 1 ? '' : 's'}` : '';

    return (
      <Reveal mount={!share} key={s.id}>
        <section className="bd-sec" id={s.id}>
          <div className="bd-head">
            <span className="bd-num">{String(i + 1).padStart(2, '0')}</span>
            <h2>{s.heading}</h2>
            <span className="bd-head-line" />
            {count && <span className="bd-count">{count}</span>}
          </div>
          {inner}
        </section>
      </Reveal>
    );
  };

  return (
    <div className={`bd bd-doc ${share ? '' : 'bd--preview'}`}>
      {share && (
        <header className="bd-bar">
          <div className="bd-bar-in">
            <button className="bd-menu" onClick={() => setNavOpen(o => !o)} aria-label="Sections" aria-expanded={navOpen}>
              <IcoMenu />
            </button>
            <a className="bd-brand" href="#bd-top">
              {heroImg && <img className="bd-brand-logo" src={heroImg} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              <span className="bd-brand-text">
                <b>{brandName}</b>
                <span>Creator brief{month ? ` · ${month}` : ''}</span>
              </span>
            </a>
            <div className="bd-bar-tools">
              <div className={`bd-find ${q ? 'has' : ''}`}>
                <span className="bd-find-ico" aria-hidden="true"><IcoSearch /></span>
                <input type="search" value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search lines…" aria-label="Search hooks and script lines" />
                {q && <button onClick={() => setQ('')} aria-label="Clear"><IcoX /></button>}
              </div>
              <button className="bd-tour" onClick={runTour}><IcoSpark /><span>Guide</span></button>
            </div>
          </div>
        </header>
      )}

      {/* hero */}
      <div className="bd-hero" id="bd-top">
        <motion.div
          className={`bd-hero-in ${heroImg ? '' : 'solo'}`}
          initial="hide" animate="show"
          variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } }}
        >
          <div>
            <motion.p className="bd-eyebrow" variants={fadeUp}>
              Creator brief{month ? ` · ${month}` : ''} · {brandName}
            </motion.p>
            <motion.h1 variants={fadeUp} dangerouslySetInnerHTML={{ __html: heroTitle(view.title) }} />
            {!!view.heroLedeMd.trim() && (
              <motion.div className="bd-lede bd-md" variants={fadeUp}
                dangerouslySetInnerHTML={{ __html: md(view.heroLedeMd) }} />
            )}
          </div>
          {heroImg && (
            <motion.figure className="bd-shot" variants={fadeUp}>
              <img src={heroImg} alt={brandName} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </motion.figure>
          )}
        </motion.div>
      </div>

      {/* body */}
      <div className="bd-layout">
        {share && (
          <>
            <aside className={`bd-side ${navOpen ? 'open' : ''}`} aria-label="Brief sections">
              <p className="bd-side-head">In this brief</p>
              <ol className="bd-toc">
                {view.sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className={active === s.id ? 'on' : ''} onClick={() => setNavOpen(false)}>
                      <span className="bd-toc-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="bd-toc-label">{stripNumber(s.heading)}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </aside>
            {navOpen && <button className="bd-scrim" aria-label="Close" onClick={() => setNavOpen(false)} />}
          </>
        )}

        <main className="bd-main">
          {view.sections.map(renderSection)}

          <Reveal mount={!share}>
            <footer className="bd-foot">
              <div>
                <b>{brandName}</b>
                <p>Don't invent claims, doses or results beyond this brief.</p>
              </div>
              <div className="bd-foot-credit">
                <span className="bd-foot-logo">
                  <img src="/afflix-logo-dark.png" alt="Afflix Media" />
                </span>
                <p>Prepared by Afflix Media</p>
              </div>
            </footer>
          </Reveal>
        </main>
      </div>

      <div className={`bd-toast ${toast ? 'up' : ''}`} role="status"><IcoCheck /> {toast}</div>
    </div>
  );
}

const fadeUp = {
  hide: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

/** Emphasise a bracketed span in the title, e.g. "…with [Magtein®]". */
function heroTitle(title: string): string {
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\[([^\]]+)\]/g, '<span class="amp">$1</span>');
}

/* ── reference-video card ── */
function RefCardView({ card, src, md }: { card: RefCard; src: string; md: (s: string) => string }) {
  const isTikTok = /tiktok\.com/i.test(card.link);
  return (
    <TiltCard className="bd-ref">
      <div className="bd-ref-top">
        {src && (
          <div className="bd-ref-phone">
            <img src={src} alt="" loading="lazy"
              onError={e => { ((e.target as HTMLImageElement).parentElement as HTMLElement).style.display = 'none'; }} />
          </div>
        )}
        <div className="bd-ref-body">
          <p className="bd-ref-tag">{card.tag}</p>
          <h4>{card.title}</h4>
          <ul>
            {card.bullets.map((b, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: md(b).replace(/^<p>|<\/p>\s*$/g, '') }} />
            ))}
          </ul>
        </div>
      </div>
      {card.link && (
        <a className="bd-ref-link" href={card.link} target="_blank" rel="noopener noreferrer">
          <b><span className="pl" aria-hidden="true"><IcoPlay /></span> {isTikTok ? 'Watch on TikTok' : 'Watch the reference'}</b>
          <span>{shortUrl(card.link)}</span>
        </a>
      )}
    </TiltCard>
  );
}

/* ── content-angle card ── */
function AngleView({ angle, n, md, CopyLine, needle }: {
  angle: AngleCard; n: number; md: (s: string) => string;
  CopyLine: React.FC<{ text: string; compact?: boolean }>; needle: string;
}) {
  const lines = needle
    ? angle.lines.filter(l => `${l.label} ${l.text}`.toLowerCase().includes(needle))
    : angle.lines;
  return (
    <div className="bd-angle">
      <div className="bd-angle-h">
        <span className="bd-angle-badge">{String(n).padStart(2, '0')}</span>
        <h3>{angle.label}</h3>
      </div>
      {angle.focus && (
        <p className="bd-angle-focus"><b>Focus:</b> {angle.focus}</p>
      )}
      <div className="bd-angle-lines">
        {lines.map((l, i) => (
          <div className="bd-angle-line" key={i}>
            {l.label && <p className="ll">{l.label}</p>}
            <CopyLine text={l.text} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── inline icons (no emoji, per design checklist) ── */
const IcoCopy = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" stroke="currentColor" strokeWidth="2" /></svg>;
const IcoCheck = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const IcoNo = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>;
const IcoMenu = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const IcoSearch = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const IcoX = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const IcoPlay = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>;
const IcoSpark = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>;
