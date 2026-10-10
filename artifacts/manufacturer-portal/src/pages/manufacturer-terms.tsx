import { Fragment, type ReactNode } from "react";
import { Link } from "wouter";
// Draft of record lives with the other legal documents (content/legal/*.md).
import termsMarkdown from "../../../mobile/content/legal/manufacturer-terms.md?raw";

/** Version shown on the page and sent with signup (must match the API's MANUFACTURER_TERMS_VERSION). */
export const MANUFACTURER_TERMS_VERSION = /^Version:\s*(\S+)/m.exec(termsMarkdown)?.[1] ?? "";

type Block = { kind: "h1" | "h2" | "p"; text: string } | { kind: "ul"; items: string[] };

/** Small renderer for the legal drafts: headings, paragraphs, bullets, **bold** and [links](/x). */
function parse(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown
    .split(/\r?\n/)
    .filter((line) => !line.includes("[LAWYER REVIEW]") && !/^Version:/.test(line));
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# ")) blocks.push({ kind: "h1", text: line.slice(2) });
    else if (line.startsWith("## ")) blocks.push({ kind: "h2", text: line.slice(3) });
    else if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(line.slice(2));
      else blocks.push({ kind: "ul", items: [line.slice(2)] });
    } else blocks.push({ kind: "p", text: line });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    parts.push(text.slice(cursor, match.index));
    if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
    else parts.push(<a key={match.index} href={match[3]} className="underline underline-offset-2">{match[2]}</a>);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

const BLOCKS = parse(termsMarkdown);

export default function ManufacturerTerms() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6 md:px-10">
        <Link href="/" className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}brandthread-logo.png`} alt="" className="h-8 w-8 rounded-sm object-cover" />
          <span className="text-sm font-semibold uppercase tracking-tight">Brandthread</span>
          <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">MANUFACTURERS</span>
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 md:px-10" data-testid="page-manufacturer-terms">
        {BLOCKS.map((block, index) => (
          <Fragment key={index}>
            {block.kind === "h1" && (
              <>
                <h1 className="text-3xl font-bold tracking-tight">{block.text}</h1>
                <p className="mt-2 text-sm text-muted-foreground">Version {MANUFACTURER_TERMS_VERSION}</p>
              </>
            )}
            {block.kind === "h2" && <h2 className="mt-8 text-lg font-semibold">{block.text}</h2>}
            {block.kind === "p" && <p className="mt-3 leading-relaxed text-muted-foreground">{inline(block.text)}</p>}
            {block.kind === "ul" && (
              <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-muted-foreground">
                {block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
              </ul>
            )}
          </Fragment>
        ))}
      </main>
    </div>
  );
}
