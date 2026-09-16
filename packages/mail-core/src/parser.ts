// MIME 解析 + HTML 清洗管道
// 安全要点(对应技术架构 §4.3):
//  - HTML 经 sanitize-html 白名单清洗,剥离 script/iframe/事件属性
//  - 远程图片默认拦截(改写为占位),前端按需加载

import { simpleParser, type AddressObject } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { convert as htmlToText } from 'html-to-text';
import type { ParsedEmail, ParsedAttachment } from './types';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font', 'center']),
  allowedAttributes: {
    '*': ['style', 'class', 'width', 'height', 'align', 'valign', 'bgcolor', 'color'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'data-cid'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid', 'data'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
  },
};

/** 拦截远程图片:把 http(s) 图 src 改写为 data-blocked-src,由前端决定是否加载 */
function blockRemoteImages(html: string): string {
  return html.replace(
    /(<img[^>]+src=["'])(https?:\/\/[^"']+)(["'])/gi,
    (_m, prefix: string, url: string, quote: string) =>
      `${prefix}about:blank${quote} data-blocked-src="${url}"`,
  );
}

function addrArray(obj?: AddressObject | AddressObject[]): { name?: string; address: string }[] {
  if (!obj) return [];
  const arr = Array.isArray(obj) ? obj : [obj];
  return arr
    .flatMap((o) => o.value ?? [])
    .map((a) => ({ name: a.name || undefined, address: a.address || '' }))
    .filter((a) => a.address);
}

function makeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** 解析原始 .eml 为标准化的 ParsedEmail */
export async function parseEmail(raw: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw);

  const html = parsed.html ?? null;
  const bodyHtmlSafe = html ? blockRemoteImages(sanitizeHtml(html, SANITIZE_OPTIONS)) : null;
  // 纯 HTML 邮件没有 text/plain 部分,从 HTML 提取纯文本(供索引与 LLM 使用)
  const bodyText = parsed.text ?? (html
    ? htmlToText(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] })
    : '');

  const attachments: ParsedAttachment[] = (parsed.attachments ?? [])
    .filter((a) => a.content)
    .map((a) => ({
      filename: a.filename || 'unnamed',
      mimeType: a.contentType || 'application/octet-stream',
      sizeBytes: a.size ?? a.content.length,
      content: a.content,
      isInline: a.contentDisposition === 'inline' || Boolean(a.cid),
      contentId: a.cid || undefined,
    }));

  return {
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    subject: parsed.subject ?? '(无主题)',
    from: parsed.from?.value?.[0]
      ? { name: parsed.from.value[0].name || undefined, address: parsed.from.value[0].address || '' }
      : null,
    to: addrArray(parsed.to),
    cc: addrArray(parsed.cc),
    date: parsed.date ?? null,
    bodyText,
    bodyHtmlSafe,
    snippet: makeSnippet(bodyText),
    attachments,
    raw,
  };
}
