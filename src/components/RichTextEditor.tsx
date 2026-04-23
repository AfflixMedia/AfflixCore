import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

const MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }, { font: [] }],
    [{ size: ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
    [{ align: [] }],
    ['blockquote', 'code-block'],
    ['link'],
    ['clean'],
  ],
};

const FORMATS = [
  'header', 'font', 'size',
  'bold', 'italic', 'underline', 'strike',
  'color', 'background',
  'list', 'bullet', 'check',
  'align',
  'blockquote', 'code-block',
  'link',
];

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  return (
    <div className="ac-rte" style={{ minHeight }}>
      <ReactQuill
        theme="snow"
        modules={MODULES}
        formats={FORMATS}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}
