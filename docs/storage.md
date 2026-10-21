# RAGbox: Browser Storage

RAGbox keeps collection indexes, model files, and conversations in the browser. This guide explains their lifetime and the Workspace setup controls that manage them.

## Storage locations

| Data | Location | Saved content |
| --- | --- | --- |
| NFCorpus | OPFS `analytics.duckdb` and its WAL/helper files | Document table and FTS index. |
| MS MARCO | OPFS `msmarco-prebuilt.duckdb` | Downloaded document table and FTS index, opened read-only. |
| Answer model | Browser Cache Storage | Pinned MiniCPM configuration, tokenizer, ONNX model, and weight files. |
| Conversations | IndexedDB database `ragbox-conversations`, version 1 | Turns, answers, reasoning, retrieved source snapshots, citation metadata, and navigation preferences. |
| Legacy history | localStorage | Earlier search history awaiting migration. |

OPFS files are private browser-managed files. They do not appear in the Downloads folder or in the repository. `public/data/nfcorpus.jsonl` is a separate static input file used to prepare the browser database.

## Use the same origin

Browser storage belongs to an origin: the combination of scheme, host, and port. It also belongs to a browser profile.

- `http://127.0.0.1:5173/` and `http://localhost:5173/` have separate storage.
- A development server on port `5173` and a preview server on port `4173` have separate storage.
- A published HTTPS site has separate storage from local development.
- URL paths on the same origin do not provide separate storage namespaces. Hosting multiple RAGbox copies under different paths on one origin can make them share the same database names and cache.

Keep one RAGbox tab open per origin because the DuckDB OPFS handles are exclusive. Close other instances before reopening or deleting databases.

Saved data can be cleared or evicted by the browser. Private browsing and restrictive storage settings can also prevent durable storage. Conversations and cached assets are not an independent backup.

## Conversation persistence

Submitted turns, retrieval snapshots, settled answers, reasoning, and valid citation metadata are saved asynchronously. Streaming text is checkpointed at most once per second. Writes are serialized so a delayed earlier save cannot overwrite a later answer. The newest 50 nonempty conversations are retained and titled from their first question.

Reload restores the selected collection and its active chat, or the start page if that was showing. In-progress turns become **Stopped** and require an explicit Retry; saved transcripts never restart inference automatically. Drafts and transient operation identities are not persisted. If storage fails, the current chat remains usable in memory and the interface displays an unsaved notice.

Earlier `ragbox-search-history` localStorage entries import as one-turn conversations with deterministic IDs. The migration preserves timestamps, retrieved sources, answers, and stopped status. An import marker commits with the conversations to prevent duplicates. Deleting **Conversations** also clears the legacy data.

Recent conversations are available directly in the sidebar. Select a title to restore its saved transcript and sources. The React interface does not use the legacy History feature flag.

## Inspect saved files

Open **Workspace setup → Storage** to inspect estimated browser usage and quota, request persistent storage, or remove saved resources. The **Collections** and **Answer model** tabs show their current readiness and recovery actions.

The simplified interface manages complete collection indexes and the model cache rather than exposing individual browser files.

The displayed storage estimate comes from the browser and can include other data owned by the same origin. The application does not load weight bodies just to compute their sizes.

Collection deletion is limited to the selected database and its owned WAL/helper files. Model deletion matches files belonging to the configured MiniCPM model rather than clearing unrelated browser caches.

## Remove saved data

| Action | Removed | Retained |
| --- | --- | --- |
| Delete **NFCorpus index** | NFCorpus database and its owned helper files. | MS MARCO, model cache, conversations, and source snapshots. |
| Delete **MS MARCO index** | Saved MS MARCO database and its owned helper files. | NFCorpus, model cache, conversations, and source snapshots. |
| Delete **Answer model** | Cached MiniCPM model files. | Collection indexes, conversations, and source snapshots. |
| Delete **Conversations** | Saved conversations and legacy search history. | Collection indexes and model files. |

Select a resource's trash button, then confirm **Delete**. Resource deletion closes the appropriate runtime and updates the workspace in place. Controls are disabled during active resource work. If deletion fails, the panel reports failure and the relevant resource retains its error status. Close other RAGbox tabs before retrying.

Deleting an index or model leaves stored conversations and their source text readable. New retrieval requires a ready collection; new answers also require a ready model. Deleting **Conversations** starts an empty chat.

The application's deletion controls do not remove downloaded files on your computer or generated files in the checkout. Browser-level clearing of all site data is broader than these controls and can remove conversations and preferences too.

[Documentation](README.md)
