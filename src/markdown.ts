import TurndownService from "turndown";
import { inlineMarkdownImages } from "./media-resolver";

const turndownService = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
});

turndownService.remove(["script", "style"]);

turndownService.addRule("anki-answer-divider", {
  filter: (node) => node.nodeName === "HR" && node.getAttribute("id")?.toLowerCase() === "answer",
  replacement: () => "\n---\n",
});

/**
 * Converts Anki's HTML card output into Markdown that renders reliably in Raycast `Detail`.
 *
 * We intentionally clean a few Anki-specific/HTML-only parts before conversion:
 * - remove `<style>` and `<script>` nodes because Detail markdown doesn't apply card CSS/JS
 * - normalize `<hr id="answer">` into a Markdown divider so front/back boundaries stay visible
 * - inline Anki media image sources as `data:` URLs so Raycast can render them
 * - rewrite `[sound:...]` tags into readable text since markdown cannot play Anki media syntax
 */
export async function ankiHtmlToMarkdown(html: string): Promise<string> {
  const markdown = turndownService
    .turndown(html)
    .replace(/\[sound:([^\]]+)\]/g, "Audio: `$1`")
    .trim();

  return inlineMarkdownImages(markdown);
}
