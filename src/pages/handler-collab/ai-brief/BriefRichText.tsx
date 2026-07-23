import React from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

/* ════════════════════════════════════════════════════════════
   The WYSIWYG surface for one text block of a brief.

   Deliberately a separate editor from components/RichTextEditor (the reporting
   one): the brief round-trips through Markdown, so the toolbar is limited to
   formats Markdown can actually carry — anything else would look editable and
   then vanish on save. Images are the exception worth wiring: they upload to
   Drive and come back as a signed URL to display.
════════════════════════════════════════════════════════════ */

const FORMATS = [
  'header', 'bold', 'italic', 'underline',
  'list', 'indent', 'blockquote', 'code', 'link', 'image',
];

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Uploads a picked file and returns the src to embed (a signed Drive URL). */
  onImage?: () => Promise<string | null>;
  placeholder?: string;
}

export default function BriefRichText({ value, onChange, onImage, placeholder }: Props) {
  const ref = React.useRef<ReactQuill | null>(null);

  // Kept in a ref so the toolbar handler (built once) always calls the latest
  // uploader without re-creating the module config, which would remount Quill.
  const imageRef = React.useRef(onImage);
  imageRef.current = onImage;

  const modules = React.useMemo(() => ({
    toolbar: {
      container: [
        [{ header: [3, 4, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'bullet' }, { list: 'ordered' }],
        [{ indent: '-1' }, { indent: '+1' }],
        ['blockquote', 'link', 'image'],
        ['clean'],
      ],
      handlers: {
        image: async () => {
          const upload = imageRef.current;
          if (!upload) return;
          const editor = ref.current?.getEditor();
          const at = editor?.getSelection(true)?.index ?? editor?.getLength() ?? 0;
          const src = await upload();
          if (!src || !editor) return;
          editor.insertEmbed(at, 'image', src, 'user');
          editor.setSelection(at + 1, 0, 'silent');
        },
      },
    },
    clipboard: { matchVisual: false },
  }), []);

  return (
    <div className="pc-aib-rte">
      <ReactQuill
        ref={ref}
        theme="snow"
        modules={modules}
        formats={FORMATS}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}
