import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Search,
  Sparkles,
  X,
  RefreshCw,
} from "lucide-react";
import type { AiAnswer, AiProgress, AiSource, AiStatus } from "../shared/ai";
import { readAiResponse, sourceKey, uniqueSources } from "./ai-stream";
import { spaceColor, useLibrary, usePreferences } from "./library";
import { SpaceDot } from "./components";

type AnswerView =
  | { mode: "results" }
  | { mode: "loading"; progress: AiProgress }
  | { mode: "answer"; answer: AiAnswer }
  | { mode: "error"; message: string };

// Arrival order for the CSS stagger. Capped so later content is never held back.
const arrive = (index: number) =>
  ({ "--arrive": Math.min(index, 4) }) as CSSProperties;

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  // Sources already on screen while answering settle in place instead of
  // arriving a second time when the answer replaces the loading state.
  const shownSources = useRef(new Set<string>());
  const library = useLibrary();
  const { recent } = usePreferences();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<AnswerView>({ mode: "results" });
  const router = useRouter();
  const aiStatus = useQuery({
    queryKey: ["ai-status", library.revision],
    queryFn: async ({ signal }): Promise<AiStatus> => {
      const response = await fetch("/api/ai/status", { signal });
      if (!response.ok)
        throw new Error("AI search is temporarily unavailable.");
      return response.json();
    },
    retry: false,
    refetchInterval: (q) => (q.state.data?.state === "indexing" ? 2000 : 15000),
  });
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let results = library.documents.filter((doc) =>
    terms.every((word) =>
      `${doc.title} ${doc.description} ${doc.space} ${doc.tags.join(" ")} ${doc.text}`
        .toLowerCase()
        .includes(word),
    ),
  );
  if (terms.length)
    results.sort(
      (a, b) =>
        Number(terms.every((word) => b.title.toLowerCase().includes(word))) -
        Number(terms.every((word) => a.title.toLowerCase().includes(word))),
    );
  else if (recent.length)
    results = [...results].sort((a, b) => {
      const ai = recent.indexOf(a.id);
      const bi = recent.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  results = results.slice(0, 8);
  const hasQuestion = !!query.trim();
  const optionCount = results.length + Number(hasQuestion);
  const selectedOption = optionCount ? Math.min(selected, optionCount - 1) : 0;
  const stale =
    view.mode === "answer" &&
    view.answer.sources.some(
      (source) =>
        !library.documents.some(
          (doc) =>
            doc.id === source.documentId && doc.version === source.revision,
        ),
    );

  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
    return () => {
      requestId.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-search-index="${selectedOption}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedOption, view.mode]);

  const resetAnswer = () => {
    requestId.current++;
    controller.current?.abort();
    controller.current = null;
    shownSources.current = new Set();
    setView({ mode: "results" });
  };
  const open = (id: string, anchor = "") => {
    onClose();
    void router.navigate({
      to: "/documents/$documentId",
      params: { documentId: id },
      hash: anchor,
    });
  };
  const ask = async () => {
    if (!query.trim()) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    const started = performance.now();
    shownSources.current = new Set();
    setView({ mode: "loading", progress: { phase: "searching", sources: [] } });
    try {
      const requestSignal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(70_000),
      ]);
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ question: query.trim() }),
        signal: requestSignal,
      });
      const answer = await readAiResponse(
        response,
        (event) => {
          if (id !== requestId.current || event.type !== "progress") return;
          const sources = uniqueSources(event.progress.sources).slice(0, 3);
          for (const source of sources)
            shownSources.current.add(sourceKey(source));
          setView({
            mode: "loading",
            progress: { ...event.progress, sources },
          });
        },
        requestSignal,
      );
      if (id === requestId.current) {
        performance.measure("kmflow:ai-answer", {
          start: started,
          detail: answer.timing,
        });
        setView({ mode: "answer", answer });
      }
    } catch (error) {
      if (abort.signal.aborted || id !== requestId.current) return;
      setView({
        mode: "error",
        message:
          error instanceof Error && error.name !== "TimeoutError"
            ? error.message
            : "This answer took too long. Please try again.",
      });
    } finally {
      if (id === requestId.current) controller.current = null;
      void aiStatus.refetch();
    }
  };
  const sourceButton = (
    source: AiSource,
    inline = false,
    key: string | number = source.id,
    style?: CSSProperties,
    carried = false,
  ) => (
    <button
      key={key}
      className={inline ? "ai-citation" : "ai-source"}
      style={style}
      data-carried={carried || undefined}
      aria-label={
        inline
          ? `Source ${source.id}: ${source.title}, ${source.step || source.section}`
          : undefined
      }
      title={`${source.title}${source.step || source.section ? ` · ${source.step || source.section}` : ""}`}
      onClick={() => open(source.documentId, source.anchor)}
    >
      <span className="ai-source-number">{source.id}</span>
      {!inline && (
        <>
          <span>
            <strong>{source.title}</strong>
            <small>
              {[source.section, source.step].filter(Boolean).join(" → ") ||
                "Overview"}
            </small>
          </span>
          <ArrowRight size={14} />
        </>
      )}
    </button>
  );

  return (
    <dialog
      ref={dialog}
      className="search-dialog"
      aria-label="Search knowledge"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (
          event.target !== input.current ||
          view.mode !== "results" ||
          event.nativeEvent.isComposing
        )
          return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelected(Math.min(selectedOption + 1, optionCount - 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelected(Math.max(selectedOption - 1, 0));
        }
        if (event.key === "Enter" && optionCount) {
          event.preventDefault();
          if (selectedOption === results.length && hasQuestion) void ask();
          else if (results[selectedOption]) open(results[selectedOption].id);
        }
      }}
    >
      <div className="search-dialog-input">
        <Search size={20} />
        <input
          ref={input}
          value={query}
          maxLength={2000}
          onChange={(event) => {
            resetAnswer();
            setQuery(event.target.value);
            setSelected(0);
          }}
          placeholder="What would you like to know?"
          aria-label="Search documents"
          role="combobox"
          aria-expanded={view.mode === "results"}
          aria-autocomplete="list"
          aria-controls="knowledge-search-results"
          aria-activedescendant={
            view.mode === "results" && optionCount
              ? `knowledge-search-result-${selectedOption}`
              : undefined
          }
          autoComplete="off"
        />
        <button onClick={onClose} aria-label="Close search">
          <kbd>esc</kbd>
        </button>
      </div>
      {view.mode === "results" ? (
        <div
          className="search-results"
          id="knowledge-search-results"
          role="listbox"
          aria-label="Matching documents and Ask AI"
        >
          <span className="search-label" role="presentation">
            {hasQuestion
              ? `${results.length} RESULT${results.length === 1 ? "" : "S"}`
              : recent.length
                ? "RECENT & SUGGESTED"
                : "EXPLORE YOUR KNOWLEDGE"}
          </span>
          {results.map((doc, index) => (
            <button
              key={doc.id}
              id={`knowledge-search-result-${index}`}
              role="option"
              aria-selected={selectedOption === index}
              tabIndex={-1}
              data-search-index={index}
              className={`search-result ${selectedOption === index ? "selected" : ""}`}
              onMouseEnter={() => setSelected(index)}
              onFocus={() => setSelected(index)}
              onClick={() => open(doc.id)}
            >
              <span
                className={`search-result-icon tone-${spaceColor(doc.spaceId)}`}
              >
                <FileText size={19} strokeWidth={1.5} />
              </span>
              <span>
                <strong>{doc.title}</strong>
                <small>{doc.description}</small>
                <span className="result-space">
                  <SpaceDot id={doc.spaceId} />
                  {doc.space}
                </span>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
          {!results.length && (
            <div className="search-empty">
              <Search size={25} strokeWidth={1.4} />
              <strong>No matching documents for “{query}”</strong>
              <p>
                Try another phrase, or ask a question about your library below.
              </p>
            </div>
          )}
          {hasQuestion && (
            <button
              id={`knowledge-search-result-${results.length}`}
              role="option"
              aria-selected={selectedOption === results.length}
              tabIndex={-1}
              data-search-index={results.length}
              className={`search-result ask-ai-option ${selectedOption === results.length ? "selected" : ""}`}
              onMouseEnter={() => setSelected(results.length)}
              onFocus={() => setSelected(results.length)}
              onClick={() => void ask()}
            >
              <span className="search-result-icon ai-spark">
                <Sparkles size={19} strokeWidth={1.5} />
              </span>
              <span>
                <strong>Ask AI</strong>
                <small>
                  {aiStatus.data?.state === "disabled"
                    ? "AI search isn’t configured yet"
                    : aiStatus.data?.state === "indexing"
                      ? "Getting your knowledge library ready…"
                      : aiStatus.data?.state === "error" || aiStatus.isError
                        ? "AI search is temporarily unavailable"
                        : "Find an answer across your knowledge library"}
                </small>
              </span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      ) : (
        <div className="search-answer-scroll">
          <div className="ai-toolbar">
            <button
              onClick={() => {
                resetAnswer();
                input.current?.focus();
              }}
            >
              <ArrowLeft size={14} />
              Back to results
            </button>
            <span>
              <Sparkles size={12} />
              Ask AI
            </span>
          </div>
          {view.mode === "loading" && (
            <div
              className="ai-loading"
              role="status"
              data-phase={view.progress.phase}
            >
              <span className="ai-loading-icon" aria-hidden="true">
                <Sparkles size={24} strokeWidth={1.4} />
              </span>
              <span key={view.progress.phase} className="ai-phase">
                <strong>
                  {view.progress.phase === "answering"
                    ? "Writing your answer"
                    : "Looking through your knowledge"}
                </strong>
                <p>
                  {view.progress.phase === "answering"
                    ? "Using the relevant steps from your guides…"
                    : "Finding relevant steps…"}
                </p>
              </span>
              <button className="ai-secondary" onClick={resetAnswer}>
                <X size={13} />
                Cancel
              </button>
              {view.progress.sources.length > 0 && (
                <div className="ai-progress-sources">
                  <span className="search-label">CHECKING THESE SOURCES</span>
                  {view.progress.sources.map((source, i) =>
                    sourceButton(source, false, sourceKey(source), arrive(i)),
                  )}
                </div>
              )}
            </div>
          )}
          {(view.mode === "error" || stale) && (
            <div className="ai-error" role="alert">
              <strong>
                {stale
                  ? "Your knowledge library has changed"
                  : "We couldn’t answer just yet"}
              </strong>
              <p>
                {stale
                  ? "Ask again to use the latest version of your documents."
                  : view.mode === "error"
                    ? view.message
                    : ""}
              </p>
              <button className="ai-secondary" onClick={() => void ask()}>
                <RefreshCw size={13} />
                Try again
              </button>
            </div>
          )}
          {view.mode === "answer" && !stale && (
            <section
              className="ai-answer"
              aria-label="AI answer"
              aria-live="polite"
            >
              <span className="search-label" style={arrive(0)}>
                {view.answer.outcome === "answer"
                  ? "ANSWER FROM YOUR LIBRARY"
                  : "NO ANSWER IN YOUR LIBRARY"}
              </span>
              {view.answer.paragraphs.map((paragraph, i) => (
                <p key={i} style={arrive(i + 1)}>
                  {paragraph.text}
                  {paragraph.sources.length > 0 && (
                    <span className="ai-citations">
                      {[...new Set(paragraph.sources)].map((id) => {
                        const source = view.answer.sources.find(
                          (s) => s.id === id,
                        );
                        return source && sourceButton(source, true);
                      })}
                    </span>
                  )}
                </p>
              ))}
              {view.answer.sources.length > 0 && (
                <div className="ai-sources">
                  <span
                    className="search-label"
                    style={arrive(view.answer.paragraphs.length + 1)}
                    data-carried={
                      view.answer.sources.some((source) =>
                        shownSources.current.has(sourceKey(source)),
                      ) || undefined
                    }
                  >
                    SOURCES · {view.answer.sources.length}
                  </span>
                  {view.answer.sources.map((source) =>
                    sourceButton(
                      source,
                      false,
                      source.id,
                      arrive(view.answer.paragraphs.length + 1),
                      shownSources.current.has(sourceKey(source)),
                    ),
                  )}
                </div>
              )}
              <p
                className="ai-note"
                style={arrive(view.answer.paragraphs.length + 2)}
              >
                AI can make mistakes. Check the original guide before acting.
              </p>
            </section>
          )}
        </div>
      )}
      <div className="search-footer">
        {view.mode === "results" ? (
          <>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> to navigate
            </span>
            <span>
              <kbd>↵</kbd> to open
            </span>
            <span>Search your whole library</span>
          </>
        ) : (
          <>
            <span>
              <kbd>esc</kbd> to close
            </span>
            <span>Grounded in your team’s knowledge</span>
          </>
        )}
      </div>
    </dialog>
  );
}
