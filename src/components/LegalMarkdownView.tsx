import React from 'react';

interface LegalMarkdownViewProps {
  content: string;
  compact?: boolean;
}

type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'code'; value: string }
  | { type: 'placeholder'; value: string };

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  // Match **bold**, `code`, or legal redaction/verification placeholders like [公司主体A] / [条号待核对]
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[(?:公司主体|当事人|自然人|案号|身份证|手机号|银行卡|邮箱|地址|条号待核对|具体日期待核实|金额待核实|视当庭核对[^\]]+|请点开[^\]]+)[^\]]*\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push({ type: 'bold', value: token.slice(2, -2) });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push({ type: 'code', value: token.slice(1, -1) });
    } else {
      parts.push({ type: 'placeholder', value: token });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}

function renderInlineNodes(text: string, keyPrefix: string): React.ReactNode {
  const parts = parseInline(text);
  return parts.map((p, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (p.type === 'bold') {
      return (
        <strong key={key} className="font-semibold text-[#0E223D]">
          {p.value}
        </strong>
      );
    }
    if (p.type === 'code') {
      return (
        <code
          key={key}
          className="rounded bg-[#F1ECE0] px-1.5 py-0.5 font-mono text-[0.9em] text-[#0E223D]"
        >
          {p.value}
        </code>
      );
    }
    if (p.type === 'placeholder') {
      const isWarn = p.value.includes('待核') || p.value.includes('请点开') || p.value.includes('视当庭');
      return (
        <span
          key={key}
          className={`inline-block rounded px-1.5 py-0.5 text-[0.88em] font-semibold mx-0.5 align-baseline ${
            isWarn
              ? 'bg-amber-50 text-amber-900 border border-amber-200/90'
              : 'bg-emerald-50 text-emerald-900 border border-emerald-200/80'
          }`}
        >
          {p.value}
        </span>
      );
    }
    return <React.Fragment key={key}>{p.value}</React.Fragment>;
  });
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Zero-dependency, XSS-safe Chinese legal prose renderer.
 * Renders headings, bold emphasis, bullet/ordered lists, blockquotes, horizontal rules,
 * verification/redaction badges, and scrollable Markdown tables in editorial stationery style.
 */
export const LegalMarkdownView: React.FC<LegalMarkdownViewProps> = ({ content, compact = false }) => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(
        <hr key={`b-${blockKey++}`} className="my-3.5 border-0 h-px bg-gradient-to-r from-[#DFD7C5] via-[#C9A463]/50 to-transparent" />
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`b-${blockKey++}`}
          className="my-2.5 overflow-x-auto rounded-lg border border-[#E5DEC9] bg-[#F7F4EC] p-3 font-mono text-xs leading-6 text-[#1E2736]"
        >
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const titleText = headingMatch[2].trim();
      const k = `b-${blockKey++}`;
      if (level === 1) {
        blocks.push(
          <h3
            key={k}
            className="mt-4 mb-2 font-display text-base sm:text-[17px] font-bold text-[#0E223D] pb-1.5 border-b border-[#E7E0CF]"
          >
            {renderInlineNodes(titleText, k)}
          </h3>
        );
      } else if (level === 2) {
        blocks.push(
          <h4
            key={k}
            className="mt-4 mb-2 flex items-center gap-2 font-display text-sm sm:text-[15px] font-bold text-[#0E223D]"
          >
            <span className="h-3.5 w-[3px] rounded-full bg-[#B89254] flex-none" />
            <span>{renderInlineNodes(titleText, k)}</span>
          </h4>
        );
      } else {
        blocks.push(
          <h5 key={k} className="mt-3 mb-1.5 text-[13px] sm:text-sm font-bold text-[#1A3152]">
            {renderInlineNodes(titleText, k)}
          </h5>
        );
      }
      i += 1;
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|')) break;
        rows.push(splitTableRow(rowLine));
        i += 1;
      }
      const k = `b-${blockKey++}`;
      blocks.push(
        <div
          key={k}
          className="my-3 overflow-x-auto rounded-lg border border-[#E2DAC7] bg-white shadow-[0_2px_10px_-6px_rgba(14,34,61,0.12)]"
        >
          <table className="min-w-full border-collapse text-left text-xs leading-5">
            <thead>
              <tr className="bg-[#F4EFE3] border-b border-[#DDD3BE]">
                {headers.map((h, ci) => (
                  <th
                    key={`${k}-h-${ci}`}
                    className="px-3 py-2 font-semibold text-[#0E223D] whitespace-nowrap border-r border-[#E8E1D1] last:border-r-0"
                  >
                    {renderInlineNodes(h, `${k}-h-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEE8DA]">
              {rows.map((cells, ri) => (
                <tr key={`${k}-r-${ri}`} className={ri % 2 === 1 ? 'bg-[#FCFBF8]' : 'bg-white'}>
                  {headers.map((_, ci) => (
                    <td
                      key={`${k}-r-${ri}-c-${ci}`}
                      className="px-3 py-2 align-top text-[#222A36] border-r border-[#F0EAE0] last:border-r-0"
                    >
                      {renderInlineNodes(cells[ci] ?? '', `${k}-r-${ri}-c-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const k = `b-${blockKey++}`;
      blocks.push(
        <blockquote
          key={k}
          className="my-2.5 rounded-r-lg border-l-[3px] border-[#B89254] bg-[#F8F5ED] px-3.5 py-2.5 text-xs sm:text-[13px] leading-6 text-[#384152]"
        >
          {quoteLines.map((ql, qi) => (
            <p key={`${k}-${qi}`} className={qi > 0 ? 'mt-1' : ''}>
              {renderInlineNodes(ql, `${k}-${qi}`)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, '').trim());
        i += 1;
      }
      const k = `b-${blockKey++}`;
      blocks.push(
        <ul key={k} className="my-2 space-y-1.5 pl-1">
          {items.map((item, idx) => (
            <li key={`${k}-${idx}`} className="flex items-start gap-2 leading-[1.8] text-[#1E2430]">
              <span className="mt-[9px] h-1.5 w-1.5 rounded-full bg-[#B89254] flex-none" />
              <span className="min-w-0 flex-1">{renderInlineNodes(item, `${k}-${idx}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+[.、]\s*/.test(trimmed)) {
      const items: { marker: string; body: string }[] = [];
      while (i < lines.length && /^\s*\d+[.、]\s*/.test(lines[i])) {
        const m = lines[i].trim().match(/^(\d+[.、])\s*(.*)$/);
        if (m) {
          items.push({ marker: m[1], body: m[2] });
        }
        i += 1;
      }
      const k = `b-${blockKey++}`;
      blocks.push(
        <ol key={k} className="my-2 space-y-1.5 pl-0.5">
          {items.map((item, idx) => (
            <li key={`${k}-${idx}`} className="flex items-start gap-2 leading-[1.8] text-[#1E2430]">
              <span className="font-num text-[12px] font-semibold text-[#9A7538] min-w-[1.35rem] pt-[1px] flex-none">
                {item.marker}
              </span>
              <span className="min-w-0 flex-1">{renderInlineNodes(item.body, `${k}-${idx}`)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        !curTrim ||
        /^(#{1,4})\s+/.test(curTrim) ||
        curTrim.startsWith('```') ||
        curTrim.startsWith('>') ||
        /^[-*•]\s+/.test(curTrim) ||
        /^\d+[.、]\s*/.test(curTrim) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim) ||
        (curTrim.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }

    const k = `b-${blockKey++}`;
    blocks.push(
      <p key={k} className="my-2 leading-[1.85] text-[#1B2230] whitespace-pre-wrap">
        {paraLines.map((pl, pi) => (
          <React.Fragment key={`${k}-l-${pi}`}>
            {pi > 0 && <br />}
            {renderInlineNodes(pl, `${k}-l-${pi}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return (
    <div className={compact ? 'text-xs' : 'text-[13px] sm:text-[14px]'}>
      {blocks}
    </div>
  );
};
