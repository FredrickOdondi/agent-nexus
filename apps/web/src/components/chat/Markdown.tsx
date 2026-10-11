import { memo, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/platform";

function CodeBlock({ className, children, ...props }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const code = extractText(children);
  const lang = /language-([\w-]+)/.exec(String((children as { props?: { className?: string } })?.props?.className ?? ""))?.[1];
  return (
    <div className="group/code relative my-3">
      <div className="flex items-center justify-between rounded-t-[calc(var(--radius)*0.9)] border border-b-0 bg-muted/60 px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>{lang ?? "code"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 normal-case tracking-normal transition-colors hover:bg-background hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={cn("!mt-0 !rounded-t-none", className)} {...props}>
        {children}
      </pre>
    </div>
  );
}

function extractText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as object)) return extractText((node as { props: { children?: unknown } }).props.children);
  return "";
}

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("prose-chat text-[15px]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: CodeBlock,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                if (!href) return;
                e.preventDefault();
                openExternal(href);
              }}
              rel="noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
