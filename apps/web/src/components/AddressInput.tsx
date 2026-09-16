import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContactDto } from '@ai-mail/shared';

/* ============ 收件地址输入框:带联系人自动补全 ============
   输入时对"当前正在编辑的地址片段"(最后一个分隔符之后的部分)
   匹配通讯录,下拉推荐;↑↓ 选择,Enter/Tab 采纳,Esc 关闭。 */

const SEPARATOR_RE = /[,;，;]/;

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  contacts: ContactDto[];
  placeholder?: string;
  className?: string;
}

export default function AddressInput({ id, value, onChange, contacts, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 当前正在输入的地址片段(最后一个分隔符之后)
  const token = useMemo(() => {
    const parts = value.split(SEPARATOR_RE);
    return parts[parts.length - 1]?.trim() ?? '';
  }, [value]);

  const suggestions = useMemo(() => {
    if (!token) return [];
    const q = token.toLowerCase();
    return contacts
      .filter((c) => c.email.toLowerCase().includes(q) || (c.name && c.name.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [contacts, token]);

  // 关闭时机:建议列表为空,或点到了组件外
  useEffect(() => {
    if (suggestions.length === 0) { setOpen(false); setActiveIndex(0); }
  }, [suggestions.length]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function pick(contact: ContactDto) {
    // 用完整地址替换当前片段,补上分隔符,光标自然落在末尾
    const parts = value.split(SEPARATOR_RE);
    parts[parts.length - 1] = ` ${contact.email}, `;
    onChange(parts.join(','));
    setOpen(false);
    document.getElementById(id)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[activeIndex]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <input
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls={suggestions.length > 0 ? `${id}-listbox` : undefined}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="paper absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-[var(--hairline)] py-1 shadow-[var(--shadow-pop)]"
        >
          {suggestions.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // 避免抢走输入框焦点
                onClick={() => pick(c)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors ${
                  i === activeIndex ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--paper)] font-serif text-[11px] font-semibold text-[var(--ink-2)]">
                  {(c.name || c.email).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {c.name && <span className="font-medium text-[var(--ink-1)]">{c.name} </span>}
                  <span className="text-[var(--ink-3)]">{c.email}</span>
                </span>
                {c.usageCount > 0 && (
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ink-4)]">往来 {c.usageCount} 封</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
