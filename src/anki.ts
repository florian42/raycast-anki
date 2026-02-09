import { YankiConnect } from "yanki-connect";

const client = new YankiConnect({ autoLaunch: true });

export type CardInfo = NonNullable<Awaited<ReturnType<typeof getNextDueCard>>>;
export type Ease = 1 | 2 | 3 | 4;

/**
 * Fetches the next due card for a deck using Anki's GUI scheduler.
 *
 * We start (or reuse) the deck review session and read the current card from
 * Anki. This mirrors the GUI review ordering, including learning/review queues
 * and any deck-specific scheduling rules.
 */
export async function getNextDueCard(deckName: string) {
  await client.graphical.guiDeckReview({ name: deckName });

  const nextCard = await client.graphical.guiCurrentCard();
  if (!nextCard) {
    return undefined;
  }

  await client.graphical.guiStartCardTimer();

  return nextCard;
}

type CardId = CardInfo["cardId"];

export function answerCard(cardId: CardId, ease: Ease) {
  void cardId;
  return client.graphical.guiShowAnswer().then(() => client.graphical.guiAnswerCard({ ease }));
}

/**
 * Converts an image source into a Raycast-renderable URL when needed.
 *
 * Remote/data/file URLs are already renderable and are returned unchanged.
 * Relative Anki media names are loaded via AnkiConnect and converted to `data:`
 * URLs so they work inside markdown without filesystem assumptions.
 */
export async function resolveImageSource(source: string): Promise<string> {
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
