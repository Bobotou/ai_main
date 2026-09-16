// 富文本编辑器:TipTap(StarterKit 含 Markdown 快捷输入:# 空格→标题、**b**→加粗、- 空格→列表、> 空格→引用)
// + 工具栏 + AI 润色(场景化选项,改写全文后回填)

import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { api } from '../api';
import { Sparkle, X } from './icons';

/* ============ 工具栏图标(方笔触线稿,16×16) ============ */
const S = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IcoBold = () => <svg {...S}><path d="M7 5h6a3.5 3.5 0 1 1 0 7H7z" /><path d="M7 12h7a3.5 3.5 0 1 1 0 7H7z" /></svg>;
const IcoItalic = () => <svg {...S}><line x1="19" y1="5" x2="10" y2="5" /><line x1="14" y1="19" x2="5" y2="19" /><line x1="15" y1="4" x2="9" y2="20" /></svg>;
const IcoH1 = () => <svg {...S}><path d="M4 12h8" /><path d="M4 18V6" /><path d="M12 18V6" /><path d="M17 9l3-2v11" /></svg>;
const IcoH2 = () => <svg {...S}><path d="M4 12h8" /><path d="M4 18V6" /><path d="M12 18V6" /><path d="M15 10.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1 2.5 2.3c0 2.7-5 4.2-5 7.7h5" /></svg>;
const IcoList = () => <svg {...S}><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r=".8" fill="currentColor" /><circle cx="4.5" cy="12" r=".8" fill="currentColor" /><circle cx="4.5" cy="18" r=".8" fill="currentColor" /></svg>;
const IcoOrderedList = () => <svg {...S}><line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" /><text x="3" y="7.5" fontSize="6" fill="currentColor" stroke="none">1</text><text x="3" y="13.5" fontSize="6" fill="currentColor" stroke="none">2</text><text x="3" y="19.5" fontSize="6" fill="currentColor" stroke="none">3</text></svg>;
const IcoQuote = () => <svg {...S}><path d="M3 21c3-2 4-4.5 4-9H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4c0 5-2 8-5 10" /><path d="M14 21c3-2 4-4.5 4-9h-3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4c0 5-2 8-5 10" /></svg>;
const IcoCode = () => <svg {...S}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
const IcoUndo = () => <svg {...S}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>;
const IcoRedo = () => <svg {...S}><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 15-6.7L21 13" /></svg>;

/* ============ AI 润色场景 ============ */

interface PolishOption {
  key: string;
  label: string;
  prompt: string;
  group: '语气' | '操作' | '翻译';
}

const POLISH_OPTIONS: PolishOption[] = [
  // 语气
  { key: 'formal', label: '更正式', group: '语气', prompt: '改写得更正式、专业,适合商务场合' },
  { key: 'friendly', label: '更亲切', group: '语气', prompt: '改写得更友好、自然、有温度,但不失分寸' },
  { key: 'concise', label: '更简洁', group: '语气', prompt: '大幅精简,删除一切冗余,只保留核心信息' },
  { key: 'polite', label: '更委婉', group: '语气', prompt: '改写得更委婉、得体,尤其让拒绝/催促显得体面' },
  { key: 'confident', label: '更自信', group: '语气', prompt: '改写得更笃定、有说服力,去掉犹豫和过度道歉' },
  // 操作
  { key: 'polish', label: '纠错润色', group: '操作', prompt: '修正错别字与语病,优化措辞,不改变原意与语气' },
  { key: 'expand', label: '扩写', group: '操作', prompt: '适度扩写,补充细节与过渡,让内容更完整,但不要注水' },
  { key: 'reply-positive', label: '同意对方', group: '操作', prompt: '以同意/接受对方请求的方向改写,给出积极的确认' },
  { key: 'reply-decline', label: '婉拒对方', group: '操作', prompt: '以婉拒对方请求的方向改写,给出得体的理由和替代方案(如适用)' },
  // 翻译
  { key: 'to-en', label: '译为英文', group: '翻译', prompt: '翻译为地道的英文商务邮件,保持结构与语气' },
  { key: 'to-zh', label: '译为中文', group: '翻译', prompt: '翻译为自然的简体中文,保持结构与语气' },
];

/* ============ 编辑器 ============ */

interface Props {
  content: string;                  // 受控 HTML
  onChange: (html: string) => void;
  placeholder?: string;
  /** AI 润色上下文:回复场景带上原邮件 */
  contextMessageId?: string;
}

export default function RichEditor({ content, onChange, placeholder, contextMessageId }: Props) {
  const [polishOpen, setPolishOpen] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit],
    content: content || '<p></p>',
    editorProps: {
      attributes: {
        class: 'tiptap',
        'data-placeholder': placeholder ?? '正文…支持 Markdown 快捷输入:# 空格→标题、**加粗**、- 空格→列表、> 空格→引用',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // 外部内容变化(如 AI 代笔整段替换)时同步进编辑器
  const lastSynced = useRef(content);
  useEffect(() => {
    if (editor && content !== lastSynced.current && content !== editor.getHTML()) {
      lastSynced.current = content;
      editor.commands.setContent(content || '<p></p>', false);
    }
  }, [content, editor]);

  if (!editor) return null;

  const Btn = ({ active, title, onClick, children }: { active?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // 保持选区
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors hover:bg-[var(--surface-hover)] ${active ? 'active bg-[var(--accent-soft)] text-[var(--accent-strong)]' : 'text-[var(--ink-3)]'}`}
    >{children}</button>
  );

  return (
    <div className="paper rounded-xl border border-[var(--hairline)] transition-colors focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-ring)]">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--hairline)] px-2 py-1.5">
        <Btn title="加粗 (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><IcoBold /></Btn>
        <Btn title="斜体 (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><IcoItalic /></Btn>
        <span className="mx-1 h-4 w-px bg-[var(--hairline)]" />
        <Btn title="标题 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><IcoH1 /></Btn>
        <Btn title="标题 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><IcoH2 /></Btn>
        <span className="mx-1 h-4 w-px bg-[var(--hairline)]" />
        <Btn title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><IcoList /></Btn>
        <Btn title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><IcoOrderedList /></Btn>
        <Btn title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><IcoQuote /></Btn>
        <Btn title="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><IcoCode /></Btn>
        <span className="mx-1 h-4 w-px bg-[var(--hairline)]" />
        <Btn title="撤销 (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()}><IcoUndo /></Btn>
        <Btn title="重做 (Ctrl+Shift+Z)" onClick={() => editor.chain().focus().redo().run()}><IcoRedo /></Btn>

        <button
          type="button"
          onClick={() => setPolishOpen((v) => !v)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
            polishOpen ? 'bg-[var(--seal-soft)] text-[var(--seal)]' : 'text-[var(--seal)] hover:bg-[var(--seal-soft)]'
          }`}
        >
          <Sparkle className="!h-3.5 !w-3.5" /> AI 润色
        </button>
      </div>

      {/* 编辑区:颗粒素纸(不带横线,避免与换行错位) */}
      <EditorContent editor={editor} className="px-4 py-3" />

      {/* AI 润色面板 */}
      {polishOpen && (
        <PolishPanel
          editor={editor}
          contextMessageId={contextMessageId}
          onApplied={() => setPolishOpen(false)}
        />
      )}
    </div>
  );
}

/* ============ AI 润色面板 ============ */

function PolishPanel({ editor, contextMessageId, onApplied }: {
  editor: Editor;
  contextMessageId?: string;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [lastText, setLastText] = useState('');

  const groups = ['语气', '操作', '翻译'] as const;

  async function run(option: PolishOption) {
    setBusy(option.key); setError(''); setPreview(null);
    const text = editor.getText();
    if (!text.trim()) { setError('先写点内容再润色'); setBusy(null); return; }
    try {
      const { text: rewritten } = await api<{ text: string }>('/api/ai/rewrite', {
        method: 'POST',
        body: JSON.stringify({
          // 后端现有 action 枚举之外的场景用 prompt 传递(见后端 rewrite 扩展)
          action: option.key,
          text,
          contextMessageId,
        }),
      });
      if (!rewritten?.trim()) { setError('AI 返回为空,请重试'); setBusy(null); return; }
      setLastText(text);
      setPreview(rewritten);
    } catch (err) {
      setError(err instanceof Error ? err.message : '润色失败');
    } finally { setBusy(null); }
  }

  function applyPreview() {
    if (!preview || !editor) return;
    editor.commands.setContent(preview, true);
    onApplied();
  }

  return (
    <div className="border-t border-[var(--hairline)] bg-[var(--canvas)] px-4 py-3.5">
      {preview === null ? (
        <>
          <p className="mb-2.5 text-[12px] font-medium text-[var(--ink-3)]">选择润色方向(将改写全文,应用前可预览)</p>
          {groups.map((g) => (
            <div key={g} className="mb-2 flex items-center gap-2 flex-wrap">
              <span className="w-8 shrink-0 text-[11.5px] text-[var(--ink-4)]">{g}</span>
              {POLISH_OPTIONS.filter((o) => o.group === g).map((o) => (
                <button
                  key={o.key}
                  disabled={busy !== null}
                  onClick={() => run(o)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                    busy === o.key
                      ? 'border-[var(--seal)] bg-[var(--seal-soft)] text-[var(--seal)]'
                      : 'border-[var(--hairline)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--seal)] hover:text-[var(--seal)]'
                  } disabled:opacity-50`}
                >
                  {busy === o.key ? '润色中…' : o.label}
                </button>
              ))}
            </div>
          ))}
          {error && <p className="mt-2 text-[12px] text-[var(--important)]">{error}</p>}
        </>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-medium text-[var(--ink-3)]">润色结果预览(原文可随时恢复)</p>
            <button onClick={() => setPreview(null)} className="rounded-md p-1 text-[var(--ink-4)] hover:bg-[var(--surface-hover)]"><X className="!h-3.5 !w-3.5" /></button>
          </div>
          <div className="tiptap paper max-h-44 overflow-y-auto rounded-lg border border-[var(--hairline)] px-3.5 py-2.5 text-[13.5px]"
               dangerouslySetInnerHTML={{ __html: preview }} />
          <div className="mt-2.5 flex justify-end gap-2.5">
            <button className="btn-ghost !py-1.5 !text-[12.5px]" onClick={() => { setPreview(null); }}>不采用</button>
            <button className="btn-primary !py-1.5 !text-[12.5px]" onClick={applyPreview}>替换正文</button>
          </div>
        </div>
      )}
    </div>
  );
}
