import { resolveImageSource } from "./anki";

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g;

/**
 * Rewrites markdown image URLs so local Anki media can render in Raycast.
 *
 * We resolve each unique source once to avoid duplicate Anki API calls when the
 * same image appears multiple times.
 */
export async function inlineMarkdownImages(markdown: string): Promise<string> {
  const sources = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_REGEX)) {
    const source = match[2];
    if (source) {
      sources.add(source);
    }
  }

  if (sources.size === 0) {
    return markdown;
  }

  const resolvedSources = new Map<string, string>();
  await Promise.all(
    [...sources].map(async (source) => {
      resolvedSources.set(source, await resolveImageSource(source));
    }),
  );

  return markdown.replace(MARKDOWN_IMAGE_REGEX, (fullMatch, altText: string, source: string, title?: string) => {
    const resolved = resolvedSources.get(source);
    if (!resolved || resolved === source) {
      return fullMatch;
    }

    const titleSuffix = title ? ` "${title}"` : "";
    return `![${altText}](${resolved}${titleSuffix})`;
  });
}
