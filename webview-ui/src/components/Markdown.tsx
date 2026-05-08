import React, { useMemo } from "react";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/ on[a-z]+="[^"]*"/gi, "")
    .replace(/ on[a-z]+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return sanitize(marked.parse(text) as string);
    } catch {
      return `<p>${escape(text)}</p>`;
    }
  }, [text]);
  return <span className="body" dangerouslySetInnerHTML={{ __html: html }} />;
}
