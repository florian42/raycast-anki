import { YankiConnect } from "yanki-connect";

const client = new YankiConnect({ autoLaunch: true });

export type CardInfo = NonNullable<Awaited<ReturnType<typeof getNextDueCard>>>;
export type Ease = 1 | 2 | 3 | 4;

/**
 * Fetches the next due card for a deck from Anki.
 *
 * This intentionally returns only one card because the command is a
 * single-card review flow (show question, reveal answer, submit ease, repeat).
 */
export async function getNextDueCard(deckName: string) {
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

type CardId = CardInfo["cardId"];

export function answerCard(cardId: CardId, ease: Ease) {
  return client.card.answerCards({
    answers: [{ cardId, ease }],
  });
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
