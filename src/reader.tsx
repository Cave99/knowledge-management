import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  FileText,
  Link2,
  Star,
  Text,
} from "lucide-react";
import { documentRoute } from "./router";
import { dateLabel, initials, useLibrary, usePreferences } from "./library";
import { EmptyState, SpaceDot } from "./components";

export function DocumentPage() {
  const { documentId } = documentRoute.useParams();
  const library = useLibrary();
  const { starred, toggleStar, visit } = usePreferences();
  const doc = library.documents.find((item) => item.id === documentId);
  const router = useRouter();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [source, setSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeHeading, setActiveHeading] = useState("");
  const article = useRef<HTMLElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    if (doc) visit(doc.id);
    setSource(false);
    setCopied(false);
    setActiveHeading("");
  }, [doc?.id]); // Only record actual document navigation.
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (hash && !source)
      requestAnimationFrame(() =>
        document.getElementById(hash)?.scrollIntoView({ block: "start" }),
      );
  }, [hash, doc?.id, source, doc?.version]);
  useEffect(() => {
    if (!article.current || source) return;
    const headings = Array.from(
      article.current.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      {
        root: document.querySelector(".scroll-body"),
        rootMargin: "0px 0px -65% 0px",
        threshold: 0,
      },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [doc?.id, doc?.version, source]);
  if (!doc)
    return (
      <EmptyState
        title="This document couldn’t be found"
        description="It may have been moved or removed from the knowledge folder. Browse the library to find what you need."
      />
    );
  const related = library.documents
    .filter((item) => item.spaceId === doc.spaceId && item.id !== doc.id)
    .slice(0, 3);
  const index = library.documents.findIndex((item) => item.id === doc.id);
  const next = library.documents[(index + 1) % library.documents.length];
  const isStarred = starred.includes(doc.id);
  function handleLinks(event: MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    if (
      !anchor ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith("/documents/")) {
      event.preventDefault();
      void router.navigate({
        to: "/documents/$documentId",
        params: {
          documentId: decodeURIComponent(
            url.pathname.slice("/documents/".length),
          ),
        },
        hash: decodeURIComponent(url.hash.slice(1)),
      });
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="reader-page">
      <div className="reader-toolbar">
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId: doc.spaceId }}
          className="back-link"
        >
          <ArrowLeft size={15} />
          {doc.space}
        </Link>
        <div className="reader-actions">
          <button
            className={`bookmark-button ${isStarred ? "is-starred" : ""}`}
            aria-label={isStarred ? "Unstar document" : "Star document"}
            aria-pressed={isStarred}
            onClick={() => toggleStar(doc.id)}
          >
            <Star size={17} />
          </button>
          <button
            className="copy-link-button"
            data-copied={copied}
            aria-label={copied ? "Link copied" : "Copy document link"}
            title={copied ? "Link copied" : "Copy link"}
            onClick={() => void copyLink()}
          >
            <span className="copy-icons" aria-hidden="true">
              <Link2 className="copy-original" size={17} />
              <Check className="copy-confirmation" size={17} />
            </span>
          </button>
          <a
            href={`/api/documents/${encodeURIComponent(doc.id)}/raw`}
            aria-label="Download Markdown"
            title="Download Markdown"
          >
            <Download size={17} />
          </a>
          <span className="action-divider" />
          <button
            className={`source-toggle ${source ? "selected" : ""}`}
            onClick={() => setSource(!source)}
            aria-pressed={source}
          >
            {source ? <Text size={15} /> : <Code2 size={15} />}
            {source ? "Read document" : "View source"}
          </button>
        </div>
      </div>
      <div className="reader-columns">
        <div className="reader-main">
          <header className="document-header">
            <span className="space-label">
              <SpaceDot id={doc.spaceId} />
              {doc.space}
            </span>
            <h1>{doc.title}</h1>
            {doc.description && (
              <p className="document-description">{doc.description}</p>
            )}
            <div className="document-byline">
              <span className="author-avatar">{initials(doc.author)}</span>
              <span>
                <strong>{doc.author}</strong>
                <span>Updated {dateLabel(doc.updatedAt)}</span>
              </span>
              <span className="reading-time">
                <Clock3 size={14} />
                {doc.readMinutes} min read
              </span>
            </div>
          </header>
          {source ? (
            <div className="source-panel">
              <div>
                <Code2 size={14} />
                <span>{doc.path}</span>
                <span>Markdown</span>
              </div>
              <pre tabIndex={0}>
                <code>{doc.markdown}</code>
              </pre>
            </div>
          ) : (
            <article
              ref={article}
              className="markdown-body"
              onClick={handleLinks}
              dangerouslySetInnerHTML={{ __html: doc.html }}
            />
          )}
          <div className="document-end">
            <span className="end-mark">✦</span>
            <span>You’re all caught up.</span>
          </div>
          {next && next.id !== doc.id && (
            <Link
              to="/documents/$documentId"
              params={{ documentId: next.id }}
              className="next-document"
            >
              <span className="next-doc-icon">
                <FileText size={21} strokeWidth={1.4} />
              </span>
              <span>
                <small>KEEP EXPLORING</small>
                <strong>{next.title}</strong>
              </span>
              <ArrowRight size={18} />
            </Link>
          )}
          <div className="file-note">
            <Code2 size={13} />
            <span>{doc.path}</span>
            <span>Plain Markdown. Always yours.</span>
          </div>
        </div>
        <aside className="document-outline" aria-label="Document contents">
          <div className="outline-inner">
            <span className="outline-title">ON THIS PAGE</span>
            {doc.headings.length ? (
              <nav>
                {doc.headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`${heading.level >= 3 ? "subheading" : ""} ${activeHeading === heading.id ? "active" : ""}`}
                    aria-current={
                      activeHeading === heading.id ? "location" : undefined
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      setSource(false);
                      void router.navigate({
                        to: "/documents/$documentId",
                        params: { documentId: doc.id },
                        hash: heading.id,
                      });
                      setActiveHeading(heading.id);
                      requestAnimationFrame(() =>
                        document
                          .getElementById(heading.id)
                          ?.scrollIntoView({ block: "start" }),
                      );
                    }}
                  >
                    {heading.text}
                  </a>
                ))}
              </nav>
            ) : (
              <p className="outline-empty">This document has no headings.</p>
            )}
            {related.length > 0 && (
              <div className="related-documents">
                <span className="outline-title">IN THIS SPACE</span>
                {related.map((item) => (
                  <Link
                    to="/documents/$documentId"
                    key={item.id}
                    params={{ documentId: item.id }}
                  >
                    <FileText size={13} />
                    <span>{item.title}</span>
                    <ChevronRight size={12} />
                  </Link>
                ))}
              </div>
            )}
            <div className="outline-note">
              <span>
                Good knowledge
                <br />
                keeps things moving.
              </span>
              <span>✦</span>
            </div>
          </div>
        </aside>
      </div>
      <span className="sr-only" role="status">
        {copied ? "Document link copied" : ""}
      </span>
    </div>
  );
}
