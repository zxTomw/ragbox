# RAGbox: Chatting with Documents

RAGbox supports keyword search with an optional local answer model. A collection must be ready before you can submit a message. See [installation](installation.md) for a first-time setup.

## Start with a collection

The dark chat workspace shows NFCorpus and MS MARCO collection cards, a message composer, and starter questions. Choose a collection, then prepare its index from the setup action or the **Collections** view:

- **NFCorpus:** click **Prepare NFCorpus** to import the prepared dataset and build its index.
- **MS MARCO:** explicitly download its prebuilt index, about 3.35 GB.

Wait for the selected collection to become ready. The three starter questions are picked at random each time the page loads, from a list in [src/example-queries.ts](../src/example-queries.ts) whose questions were checked so that the top-ranked documents state the answer. A starter question submits immediately when its collection is ready; otherwise it fills the search box for later submission. After a chat starts, use the collection menu to change collections.

**Workspace setup** opens collection, model, and storage controls without leaving the current conversation. Recent chats remain available in the sidebar. Interface transitions respect the browser’s reduced-motion preference.

## Search without the answer model

Submit a query such as `breast cancer` in NFCorpus. Without a ready model, RAGbox performs keyword search using the literal message and shows up to ten retrieved documents in **Sources**.

This is useful for inspecting retrieval before installing the model. Contextual follow-ups require the model: a message such as `What did that study measure?` otherwise searches those literal words.

Open **Workspace setup** and download the optional model, about 1.84 GB, to enable answers on a supported GPU. If the latest active turn is awaiting an answer, model loading completes that turn. When context is needed, RAGbox first resolves the query and searches again. It does not generate answers for all older saved searches.

## Ask a question and a follow-up

With NFCorpus and the model ready, try:

1. Start a new chat and ask `Does soy increase breast cancer risk?`.
2. Wait for the answer and open its **Sources**.
3. Read the cited articles and compare the claims with the text.
4. Ask `Is it safe for breast cancer survivors?`.
5. Inspect the follow-up's resolved search query and its newly retrieved sources.

The first message searches directly. Later messages are rewritten into standalone queries by the local model, then retrieve fresh evidence. Previous answers help interpret references; factual support must come from the current turn's retrieved documents. A failed rewrite exposes **Retry** rather than using a guessed query.

Answers vary across runs. A linked citation confirms that its ID belongs to the evidence supplied to the model; you still need to check whether the source supports the claim. Recorded limitations and earlier browser observations are in [chat validation](chat-validation.md).

## Read sources and citations

Expand **Sources** below a reply to see the resolved query, retrieved document IDs and titles, BM25 scores, and full document text. Each turn stores its own source snapshot, so a later query does not change the sources of an earlier answer.

Clicking a citation opens Sources and focuses the cited document. Only IDs from that turn's fitted model evidence become links. Unknown IDs remain text. The model may receive fewer than ten documents, or a truncated final document, because the prompt has a [token budget](local-model.md#context-and-output-limits).

Replies that include reasoning show it folded separately from the answer. The final answer is separate. The copy button copies only the final answer, and reasoning is excluded from follow-up history and citation linking.

If retrieval returns no documents, RAGbox gives an insufficient-evidence response without running answer generation. When retrieved documents are unrelated, the model is instructed to say so. The model can still misinterpret relevant material or abstain unnecessarily.

## Composer and reply controls

| Control | Behavior |
| --- | --- |
| **Enter** | Submit a message. |
| **Shift+Enter** | Insert a newline. |
| **Stop** | Stop the active turn while retaining partial answer text, reasoning, sources, and valid citations. |
| **Retry** | Retry the latest failed or stopped turn without adding a duplicate message. |
| **New conversation** | Stop current work and open an empty chat in the selected collection. |
| **Workspace setup** | Open collection, model, and storage controls while ongoing work continues. |
| **Collections** | Inspect each index and prepare, download, or open a saved collection. |

Messages are limited to 500 characters. Longer drafts show a length warning and disable Send until shortened. The draft remains editable while a reply is processing. See [the model guide](local-model.md#thinking-effort) for the cost and limits of reasoning.

Retries keep the thinking setting the message was sent with. A generation retry reuses its captured question, history, and retrieval results; failed query-resolution or retrieval stages run again. Changing the thinking setting during a reply applies to future submissions.

Sending a question scrolls it to the top of the screen, with the reply appearing below it. The page does not move while the reply streams, so you can scroll up to earlier turns or down through a long answer freely; streaming never moves keyboard focus.

## Return to a conversation

Switching collections during a chat stops current work and restores the selected collection's active chat. Switching on the start page, before asking anything, stays on the start page with an empty chat in the new collection; earlier chats remain saved. Reloading restores saved conversations, including separate reasoning, answers, and source snapshots. An interrupted turn reopens as **Stopped** and requires an explicit retry.

Recent conversations appear in the sidebar. Select one to reopen its saved messages and sources; this also restores its collection. The React interface exposes saved conversations directly, without a separate History page or feature flag. Open workspace setup for storage and conversation cleanup controls.

See [browser storage](storage.md) for retention, storage failures, and deletion behavior.

[Documentation](README.md)
