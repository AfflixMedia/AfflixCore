// Apple-style emoji picker backed by `emoji-picker-react`. Keeps the same
// `onPick(emoji)` contract so the composer wiring is unchanged.
import Picker, { EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react';

export default function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="ac-emoji-picker">
      <Picker
        onEmojiClick={(d: EmojiClickData) => onPick(d.emoji)}
        emojiStyle={EmojiStyle.APPLE}
        theme={Theme.LIGHT}
        width={320}
        height={400}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
        searchPlaceholder="Search emoji"
      />
    </div>
  );
}
