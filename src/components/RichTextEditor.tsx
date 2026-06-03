import { useMemo, useRef } from 'react';
import ReactQuill, { Quill } from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

// Register a tiny block-level <hr> embed once so the toolbar can insert dividers.
const BlockEmbed = Quill.import('blots/block/embed') as any;
class DividerBlot extends BlockEmbed {
  static blotName = 'divider';
  static tagName = 'hr';
}
if (!(Quill as any).__divider_registered__) {
  Quill.register('formats/divider', DividerBlot, true);
  (Quill as any).__divider_registered__ = true;
}

const FORMATS = [
  'header', 'font', 'size',
  'bold', 'italic', 'underline', 'strike',
  'color', 'background',
  'list', 'indent',
  'align',
  'blockquote', 'code-block',
  'link',
  'divider',
];

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const quillRef = useRef<ReactQuill | null>(null);

  const modules = useMemo(() => ({
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }, { font: [] }],
        [{ size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
        [{ indent: '-1' }, { indent: '+1' }],
        [{ align: [] }],
        ['blockquote', 'code-block'],
        ['link', 'divider'],
        ['clean'],
      ],
      handlers: {
        divider: function (this: any) {
          const editor = this.quill;
          const range = editor.getSelection(true);
          editor.insertText(range.index, '\n', 'user');
          editor.insertEmbed(range.index + 1, 'divider', true, 'user');
          editor.setSelection(range.index + 2, 0, 'silent');
        },
      },
    },
  }), []);

  return (
    <div className="ac-rte" style={{ minHeight }}>
      <ReactQuill
        ref={quillRef}
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
