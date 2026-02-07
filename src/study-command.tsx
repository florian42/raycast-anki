import { Action, ActionPanel, Detail, getPreferenceValues, Keyboard } from "@raycast/api";
import { MutatePromise, showFailureToast, usePromise } from "@raycast/utils";
import { useCallback, useState } from "react";
import { answerCard, CardInfo, Ease, getNextDueCard } from "./anki";
import { ankiHtmlToMarkdown } from "./markdown";

export default function StudyCommand() {
  const preferences = getPreferenceValues<Preferences.StudyCommand>();
  const deckName = preferences.deckName;
  const [showAnswer, setShowAnswer] = useState(false);
  const { isLoading, data, mutate, revalidate } = usePromise(getNextDueCardWithMarkdown, [deckName], {
    onData: () => setShowAnswer(false),
    onError: (error) => {
      void showFailureToast(error, { title: "Failed to load due card" });
    },
  });

  const markdown = data ? renderCardAsMarkdown(data, { showAnswer }) : "## No due cards\n\nYou're all caught up.";

  return (
    <Detail
      isLoading={isLoading}
      markdown={isLoading ? undefined : markdown}
      actions={
        <CardActionsPanel
          card={data}
          showAnswer={showAnswer}
          setShowAnswer={setShowAnswer}
          mutate={mutate}
          revalidate={revalidate}
        />
      }
    />
  );
}

type RevalidateCard = () => Promise<CardWithMarkdown | undefined>;

function CardActionsPanel({
  card,
  showAnswer,
  setShowAnswer,
  mutate,
  revalidate,
}: {
  card: CardInfo | undefined;
  showAnswer: boolean;
  setShowAnswer: (showAnswer: boolean) => void;
  mutate: MutateCard;
  revalidate: RevalidateCard;
}) {
  return (
    <ActionPanel>
      {card && !showAnswer ? (
        <Action title="Show Answer" onAction={() => setShowAnswer(true)} shortcut={{ modifiers: [], key: "space" }} />
      ) : null}
      {card && showAnswer && <CardActions card={card} mutate={mutate} />}
      <Action title="Reload Due Card" onAction={() => revalidate()} shortcut={Keyboard.Shortcut.Common.Refresh} />
    </ActionPanel>
  );
}

type MutateCard = MutatePromise<CardWithMarkdown | undefined>;

const ANSWER_ACTIONS = [
  { ease: 1 as const, label: "Again", key: "1" as Keyboard.KeyEquivalent },
  { ease: 2 as const, label: "Hard", key: "2" as Keyboard.KeyEquivalent },
  { ease: 3 as const, label: "Good", key: "3" as Keyboard.KeyEquivalent },
  { ease: 4 as const, label: "Easy", key: "4" as Keyboard.KeyEquivalent },
];

function CardActions({ card, mutate }: { card: CardInfo; mutate: MutateCard }) {
  const handleAnswer = useCallback(
    (ease: Ease) => {
      void mutate(answerCard(card.cardId, ease)).catch((error) =>
        showFailureToast(error, { title: "Failed to submit review" }),
      );
    },
    [card, mutate],
  );

  return (
    <>
      {ANSWER_ACTIONS.map((action, index) => (
        <Action
          key={action.ease}
          title={card.nextReviews[index] ? `${action.label} (${card.nextReviews[index]})` : action.label}
          onAction={() => handleAnswer(action.ease)}
          shortcut={{ modifiers: [], key: action.key }}
        />
      ))}
    </>
  );
}

type CardWithMarkdown = CardInfo & { questionMarkdown: string; answerMarkdown: string };

function renderCardAsMarkdown(card: CardWithMarkdown, { showAnswer = false } = {}): string {
  const questionMarkdown = `## Question\n\n${card.questionMarkdown}`;
  const answerMarkdown = showAnswer ? `## Answer\n\n${card.answerMarkdown}` : "";

  return [questionMarkdown, answerMarkdown].filter(Boolean).join("\n\n---\n\n");
}

/**
 * Fetches the next due card and precomputes markdown for both sides.
 *
 * Precomputing once avoids repeating HTML/media conversion every render and
 * keeps the component render path synchronous and cheap.
 */
async function getNextDueCardWithMarkdown(deckName: string): Promise<CardWithMarkdown | undefined> {
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
