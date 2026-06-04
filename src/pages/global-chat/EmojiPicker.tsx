// A tiny, dependency-free emoji picker. Curated common emojis grouped into a
// few tabs — enough for chat without pulling in a heavy emoji library.
import { useState } from 'react';

const GROUPS: { key: string; icon: string; emojis: string[] }[] = [
  {
    key: 'smileys', icon: 'bi-emoji-smile',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','🙂','🙃','😉','😊','😇','🥰','😍','😘','😗','😋','😛','😜','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤯','😳','🥵','🥶','😱','😨','😰','😥','🤗','🤔','🤭','🤫','😴','😌','😬','🙄'],
  },
  {
    key: 'gestures', icon: 'bi-hand-thumbs-up',
    emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙌','🤝','🙏','💪','👋','🤙','👆','👇','👈','👉','✋','🖐️','🤚','👊','✊','🫶','🫡','🫰','💯','✅','❌','⭐','🔥','✨','🎉','🎊','💡','⚡','💥','💫'],
  },
  {
    key: 'hearts', icon: 'bi-heart',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'],
  },
  {
    key: 'objects', icon: 'bi-star',
    emojis: ['📈','📉','📊','💰','💵','💸','🛒','📦','📅','📌','📎','✏️','📝','📁','📂','🔗','📞','📱','💻','⌨️','🖥️','🚀','🏆','🎯','⏰','⏳','🔔','📣','💬','👀','🤖','☕','🍕','🎁','🌟','☑️'],
  },
];

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [tab, setTab] = useState(0);
  return (
    <div className="ac-emoji-picker">
      <div className="ac-emoji-tabs">
        {GROUPS.map((g, i) => (
          <button
            key={g.key}
            type="button"
            className={`ac-emoji-tab ${i === tab ? 'active' : ''}`}
            onClick={() => setTab(i)}
            title={g.key}
          >
            <i className={`bi ${g.icon}`} />
          </button>
        ))}
      </div>
      <div className="ac-emoji-grid">
        {GROUPS[tab].emojis.map((e, i) => (
          <button key={`${e}-${i}`} type="button" className="ac-emoji-btn" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
