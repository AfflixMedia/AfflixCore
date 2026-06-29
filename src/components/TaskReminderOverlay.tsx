import { useEffect, useRef, useState } from 'react';
import { useTaskReminders, AckResponse } from '../notifications/TaskReminderContext';

// Full-screen, non-dismissable alert pushed to a task's APC. It loops an alarm
// tone (Web Audio — no asset needed) until the APC acknowledges with one of three
// responses. The chosen response is recorded + notified back to the sender.

const ACKS: { key: AckResponse; emoji: string; label: string }[] = [
  { key: 'seen', emoji: '👁', label: 'Seen' },
  { key: 'on_it', emoji: '👍', label: 'On it' },
  { key: 'done', emoji: '✅', label: 'Done' },
];

// One two-tone urgent chirp on the given context.
function playChirp(ctx: AudioContext) {
  if (ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t0);
  osc.frequency.setValueAtTime(1175, t0 + 0.18);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
  gain.gain.setValueAtTime(0.25, t0 + 0.34);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.42);
}

export default function TaskReminderOverlay() {
  const { queue, acknowledge } = useTaskReminders();
  const current = queue[0];

  const ctxRef = useRef<AudioContext | null>(null);
  const beepTimer = useRef<number | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [busy, setBusy] = useState(false);

  const startLoop = (ctx: AudioContext) => {
    setNeedsTap(false);
    if (beepTimer.current) return;
    playChirp(ctx);
    beepTimer.current = window.setInterval(() => playChirp(ctx), 1100);
  };

  // Start / stop the alarm with the presence of an active reminder.
  useEffect(() => {
    if (!current) return;
    setBusy(false);

    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return; // no Web Audio — visual alert still covers the screen
    const ctx = new Ctor();
    ctxRef.current = ctx;

    if (ctx.state === 'suspended') {
      // Autoplay blocked — show a one-tap affordance; the alert is already visible.
      ctx.resume().then(() => {
        if (ctx.state === 'running') startLoop(ctx);
        else setNeedsTap(true);
      }).catch(() => setNeedsTap(true));
    } else {
      startLoop(ctx);
    }

    return () => {
      if (beepTimer.current) { clearInterval(beepTimer.current); beepTimer.current = null; }
      try { ctx.close(); } catch { /* ignore */ }
      ctxRef.current = null;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const enableSound = async () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try { await ctx.resume(); } catch { /* ignore */ }
    if (ctx.state === 'running') startLoop(ctx);
  };

  if (!current) return null;

  const onAck = async (response: AckResponse) => {
    if (busy) return;
    setBusy(true);
    await acknowledge(current.id, response);
    // The effect cleanup stops the alarm when `current` changes/clears.
  };

  const prio = current.priority ?? 'mid';

  return (
    <div className={`ac-reminder-overlay prio-${prio}`} role="alertdialog" aria-modal="true">
      <div className="ac-reminder-card">
        <div className="ac-reminder-bell"><i className="bi bi-alarm-fill" /></div>
        <div className="ac-reminder-kicker">Reminder{current.from_name ? ` from ${current.from_name}` : ''}</div>
        <h2 className="ac-reminder-title">{current.task_title}</h2>
        <div className="ac-reminder-meta">
          {current.brand_name && <span><i className="bi bi-shop me-1" />{current.brand_name}</span>}
          {current.due_date && <span><i className="bi bi-calendar-event me-1" />due {new Date(current.due_date).toLocaleDateString()}</span>}
          <span className={`ac-reminder-prio prio-${prio}`}>{prio} priority</span>
        </div>

        <p className="ac-reminder-ask">Acknowledge to dismiss</p>
        <div className="ac-reminder-acks">
          {ACKS.map(a => (
            <button key={a.key} className={`ac-reminder-ack ack-${a.key}`} disabled={busy} onClick={() => onAck(a.key)}>
              <span className="ac-reminder-emoji">{a.emoji}</span>
              <span className="ac-reminder-acklabel">{a.label}</span>
            </button>
          ))}
        </div>

        {needsTap && (
          <button className="ac-reminder-sound" onClick={enableSound}>
            <i className="bi bi-volume-up-fill me-1" /> Enable sound
          </button>
        )}
        {queue.length > 1 && (
          <div className="ac-reminder-more">+{queue.length - 1} more reminder{queue.length - 1 > 1 ? 's' : ''} after this</div>
        )}
      </div>
    </div>
  );
}
