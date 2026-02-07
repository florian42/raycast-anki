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

export default function Command() {
  const [showAnswer, setShowAnswer] = useState(false);
  const { isLoading, data, mutate, revalidate } = usePromise(getNextDueCard, [DEFAULT_DECK], {
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

function renderCardAsMarkdown(card: CardInfo, { showAnswer = false } = {}): string {
  const questionMarkdown = `## Question\n\n${ankiHtmlToMarkdown(card.question)}`;
  const answerMarkdown = showAnswer ? `## Answer\n\n${ankiHtmlToMarkdown(card.answer)}` : "";

  return [questionMarkdown, answerMarkdown].filter(Boolean).join("\n\n---\n\n");
}

/**
 * Converts Anki's HTML card output into Markdown that renders reliably in Raycast `Detail`.
 *
 * We intentionally clean a few Anki-specific/HTML-only parts before conversion:
 * - remove `<style>` and `<script>` blocks because Detail markdown doesn't apply card CSS/JS
 * - normalize `<hr id="answer">` into a Markdown divider so front/back boundaries stay visible
 * - rewrite `[sound:...]` tags into readable text since markdown cannot play Anki media syntax
 */
function ankiHtmlToMarkdown(html: string): string {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<hr id=["']?answer["']?\s*\/?>/gi, "\n---\n");

  return turndownService
    .turndown(cleaned)
    .replace(/\[sound:([^\]]+)\]/g, "Audio: `$1`")
    .trim();
}

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
