import { Action, ActionPanel, Detail, Keyboard } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useCallback, useState } from "react";
import TurndownService from "turndown";

import { YankiConnect } from "yanki-connect";

const client = new YankiConnect({ autoLaunch: true });
const turndownService = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
});

const DEFAULT_DECK = "My Deck";
type Ease = 1 | 2 | 3 | 4;
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g;

export default function Command() {
  const [showAnswer, setShowAnswer] = useState(false);
  const { isLoading, data, mutate, revalidate } = usePromise(getNextDueCardWithMarkdown, [DEFAULT_DECK], {
    onData: () => setShowAnswer(false),
    onError: (error) => {
      void showFailureToast(error, { title: "Failed to load due card" });
    },
  });

  const handleAnswer = useCallback(
    (ease: Ease) => {
      if (!data) {
        return;
      }

      void mutate(
        client.card.answerCards({
          answers: [{ cardId: data.cardId, ease }],
        }),
      ).catch((error) => showFailureToast(error, { title: "Failed to submit review" }));
    },
    [data, mutate],
  );

  const markdown = data ? renderCardAsMarkdown(data, { showAnswer }) : "## No due cards\n\nYou're all caught up.";

  return (
    <Detail
      navigationTitle="Study"
      isLoading={isLoading}
      markdown={isLoading ? undefined : markdown}
      actions={
        <ActionPanel>
          {data && !showAnswer ? (
            <Action
              title="Show Answer"
              onAction={() => setShowAnswer(true)}
              shortcut={{ modifiers: [], key: "space" }}
            />
          ) : null}
          {data && showAnswer && (
            <>
              <Action
                key={4}
                title={data.nextReviews[3] ? `Easy (${data.nextReviews[3]})` : "Easy"}
                onAction={() => handleAnswer(4)}
                shortcut={{ modifiers: [], key: "4" }}
              />
              <Action
                key={1}
                title={data.nextReviews[0] ? `Again (${data.nextReviews[0]})` : "Again"}
                onAction={() => handleAnswer(1)}
                shortcut={{ modifiers: [], key: "1" }}
              />
              <Action
                key={2}
                title={data.nextReviews[1] ? `Hard (${data.nextReviews[1]})` : "Hard"}
                onAction={() => handleAnswer(2)}
                shortcut={{ modifiers: [], key: "2" }}
              />
              <Action
                key={3}
                title={data.nextReviews[2] ? `GOOD (${data.nextReviews[2]})` : "GOOD"}
                onAction={() => handleAnswer(3)}
                shortcut={{ modifiers: [], key: "3" }}
              />
            </>
          )}
          <Action title="Reload Due Card" onAction={() => revalidate()} shortcut={Keyboard.Shortcut.Common.Refresh} />
        </ActionPanel>
      }
    />
  );
}

type CardInfo = NonNullable<Awaited<ReturnType<typeof getNextDueCard>>>;
type CardWithMarkdown = CardInfo & { questionMarkdown: string; answerMarkdown: string };

function renderCardAsMarkdown(card: CardWithMarkdown, { showAnswer = false } = {}): string {
  const questionMarkdown = `## Question\n\n${card.questionMarkdown}`;
  const answerMarkdown = showAnswer ? `## Answer\n\n${card.answerMarkdown}` : "";

  return [questionMarkdown, answerMarkdown].filter(Boolean).join("\n\n---\n\n");
}

/**
 * Converts Anki's HTML card output into Markdown that renders reliably in Raycast `Detail`.
 *
 * We intentionally clean a few Anki-specific/HTML-only parts before conversion:
 * - remove `<style>` and `<script>` blocks because Detail markdown doesn't apply card CSS/JS
 * - normalize `<hr id="answer">` into a Markdown divider so front/back boundaries stay visible
 * - inline Anki media image sources as `data:` URLs so Raycast can render them
 * - rewrite `[sound:...]` tags into readable text since markdown cannot play Anki media syntax
 */
async function ankiHtmlToMarkdown(html: string): Promise<string> {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<hr id=["']?answer["']?\s*\/?>/gi, "\n---\n");

  const markdown = turndownService
    .turndown(cleaned)
    .replace(/\[sound:([^\]]+)\]/g, "Audio: `$1`")
    .trim();

  return inlineMarkdownImages(markdown);
}

/**
 * Fetches the next due card for a deck from Anki.
 *
 * This intentionally returns only one card because the command is a
 * single-card review flow (show question, reveal answer, submit ease, repeat).
 */
async function getNextDueCard(deckName = DEFAULT_DECK) {
  const dueCardIds = await client.card.findCards({
    query: `deck:"${deckName}" is:due`,
  });

  const nextCardId = dueCardIds[0];
  if (!nextCardId) {
    return undefined;
  }

  const [nextCard] = await client.card.cardsInfo({
    cards: [nextCardId],
  });

  return nextCard;
}

/**
 * Fetches the next due card and precomputes markdown for both sides.
 *
 * Precomputing once avoids repeating HTML/media conversion every render and
 * keeps the component render path synchronous and cheap.
 */
async function getNextDueCardWithMarkdown(deckName = DEFAULT_DECK): Promise<CardWithMarkdown | undefined> {
  const card = await getNextDueCard(deckName);
  if (!card) {
    return undefined;
  }

  const [questionMarkdown, answerMarkdown] = await Promise.all([
    ankiHtmlToMarkdown(card.question),
    ankiHtmlToMarkdown(card.answer),
  ]);

  return {
    ...card,
    answerMarkdown,
    questionMarkdown,
  };
}

/**
 * Rewrites markdown image URLs so local Anki media can render in Raycast.
 *
 * We resolve each unique source once to avoid duplicate Anki API calls when the
 * same image appears multiple times.
 */
async function inlineMarkdownImages(markdown: string): Promise<string> {
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

/**
 * Converts an image source into a Raycast-renderable URL when needed.
 *
 * Remote/data/file URLs are already renderable and are returned unchanged.
 * Relative Anki media names are loaded via AnkiConnect and converted to `data:`
 * URLs so they work inside markdown without filesystem assumptions.
 */
async function resolveImageSource(source: string): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed || /^(https?:|data:|file:)/i.test(trimmed)) {
    return source;
  }

  const withoutQueryOrHash = trimmed.replace(/[?#].*$/, "");
  let filename = withoutQueryOrHash;

  try {
    filename = decodeURIComponent(withoutQueryOrHash);
  } catch {
    // Keep original value if URL decoding fails.
  }

  if (!filename) {
    return source;
  }

  try {
    const encodedFile = await client.media.retrieveMediaFile({ filename });
    if (!encodedFile) {
      return source;
    }

    return `data:${guessImageMimeType(filename)};base64,${encodedFile}`;
  } catch {
    return source;
  }
}

/**
 * Chooses a MIME type from a filename extension for `data:` image URLs.
 *
 * A specific MIME improves renderer compatibility; unknown extensions fall back
 * to `application/octet-stream`.
 */
function guessImageMimeType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "apng":
      return "image/apng";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "svg":
    case "svgz":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
