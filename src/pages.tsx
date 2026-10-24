import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  FileText,
  LayoutGrid,
  List,
  Search,
  Sparkles,
} from "lucide-react";
import { DocumentCard, DocumentRows, EmptyState, SpaceDot } from "./components";
import { spaceColor, useLibrary, usePreferences, useStored } from "./library";
import { spaceRoute } from "./router";

export function HomePage() {
  const library = useLibrary();
  const pinned = library.documents.filter((doc) => doc.pinned);
  const featured = (pinned.length ? pinned : library.documents).slice(0, 3);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  if (!library.documents.length)
    return (
      <EmptyState
        title="A home for your team's knowledge"
        description="Add Markdown files to your knowledge folder. They’ll appear here automatically, ready to read."
      />
    );
  return (
    <div className="home-page page-width">
      <div className="welcome-panel">
        <div className="welcome-copy">
          <span className="eyebrow">
            <span className="tiny-spark">✦</span> A LITTLE KNOWLEDGE GOES A LONG
            WAY
          </span>
          <h1>
            {greeting}, team<span className="orange-text">.</span>
          </h1>
          <p>
            The answers you need. The know-how you share.
            <br />
            All in one calm corner of your workday.
          </p>
          <Link to="/documents" className="welcome-link">
            Explore your knowledge
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <span className="art-ring art-ring-one" />
          <span className="art-ring art-ring-two" />
          <div className="art-tile tile-one">
            <BookOpen size={28} strokeWidth={1.3} />
          </div>
          <div className="art-tile tile-two">
            <FileText size={21} strokeWidth={1.4} />
          </div>
          <span className="art-star star-one">✦</span>
          <span className="art-star star-two">✦</span>
          <span className="art-dot" />
        </div>
      </div>
      <section className="content-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">A GOOD PLACE TO BEGIN</span>
            <h2>Start with the essentials</h2>
          </div>
          <Link to="/documents" className="subtle-link">
            View all documents
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="document-grid">
          {featured.map((doc) => (
            <DocumentCard doc={doc} key={doc.id} />
          ))}
        </div>
      </section>
      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Find your space</h2>
            <p>A place for every part of the work.</p>
          </div>
          <span className="quiet-count">{library.spaces.length} spaces</span>
        </div>
        <div className="spaces-grid">
          {library.spaces.map((space) => (
            <Link
              key={space.id}
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              className="space-card"
            >
              <span className={`space-icon tone-${spaceColor(space.id)}`}>
                <BookOpen size={20} strokeWidth={1.5} />
              </span>
              <span>
                <strong>{space.name}</strong>
                <small>
                  {space.count} document{space.count === 1 ? "" : "s"}
                </small>
              </span>
              <ArrowUpRightIcon />
            </Link>
          ))}
        </div>
      </section>
      <section className="content-section recent-section">
        <div className="section-heading">
          <div>
            <h2>Recently updated</h2>
            <p>The latest additions and fresh perspectives.</p>
          </div>
          <span className="quiet-count">Across your workspace</span>
        </div>
        <DocumentRows documents={library.documents.slice(0, 5)} />
      </section>
      <footer className="page-footer">
        <span>
          <Sparkles size={13} /> Shared knowledge. Better workdays.
        </span>
        <span>
          {library.documents.length} documents, one place to find them.
        </span>
      </footer>
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight className="space-arrow" size={15} />;
}

type CollectionKind = "all" | "recent" | "starred" | "space";
export function CollectionPage({ kind }: { kind: CollectionKind }) {
  const library = useLibrary();
  const { recent, starred } = usePreferences();
  const params = spaceRoute.useParams({ shouldThrow: false });
  const space = library.spaces.find((item) => item.id === params?.spaceId);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("updated");
  const [view, setView] = useStored<"grid" | "list">("view", "grid");
  let documents = library.documents.filter((doc) =>
    kind === "space"
      ? doc.spaceId === space?.id
      : kind === "starred"
        ? starred.includes(doc.id)
        : kind === "recent"
          ? recent.includes(doc.id)
          : true,
  );
  const total = documents.length;
  const words = filter.toLowerCase().trim().split(/\s+/);
  documents = documents.filter((doc) =>
    words.every((word) =>
      `${doc.title} ${doc.description} ${doc.tags.join(" ")} ${doc.text}`
        .toLowerCase()
        .includes(word),
    ),
  );
  documents.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : kind === "recent" && sort === "updated"
        ? recent.indexOf(a.id) - recent.indexOf(b.id)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
  const title =
    kind === "space"
      ? space?.name || "Space not found"
      : kind === "all"
        ? "All documents"
        : kind === "recent"
          ? "Recently viewed"
          : "Starred";
  const description =
    kind === "space"
      ? "The guides, answers, and practical know-how in this space."
      : kind === "all"
        ? "Your team’s knowledge, ready when you need it."
        : kind === "recent"
          ? "Pick up where you left off. Your reading history on this device."
          : "The knowledge you keep close. Saved on this device.";
  return (
    <div className="collection-page page-width" key={kind + params?.spaceId}>
      <div className="collection-heading">
        <span
          className={`collection-symbol ${kind === "space" ? "tone-" + spaceColor(space?.id || "") : ""}`}
        >
          <BookOpen size={26} strokeWidth={1.4} />
        </span>
        <span className="eyebrow">
          {kind === "space" ? "YOUR SPACES" : "YOUR KNOWLEDGE"}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="collection-toolbar">
        <span className="document-total">
          {total} document{total === 1 ? "" : "s"}
        </span>
        <div className="collection-controls">
          <label className="filter-input">
            <Search size={15} />
            <input
              aria-label="Filter documents"
              placeholder="Filter documents…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <label className="sort-select">
            <select
              aria-label="Sort documents"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="updated">
                {kind === "recent" ? "Last viewed" : "Last updated"}
              </option>
              <option value="title">Alphabetical</option>
            </select>
            <ChevronDown size={13} />
          </label>
          <div className="view-switch" aria-label="Document view">
            <button
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              className={view === "grid" ? "selected" : ""}
              onClick={() => setView("grid")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              aria-label="List view"
              aria-pressed={view === "list"}
              className={view === "list" ? "selected" : ""}
              onClick={() => setView("list")}
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>
      {documents.length ? (
        view === "grid" ? (
          <div className="document-grid collection-grid">
            {documents.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </div>
        ) : (
          <DocumentRows documents={documents} />
        )
      ) : (
        <EmptyState
          icon={
            kind === "starred" ? "star" : kind === "recent" ? "clock" : "folder"
          }
          title={
            filter
              ? "No matching documents"
              : kind === "starred"
                ? "Keep the useful things close"
                : kind === "recent"
                  ? "Your next good read starts here"
                  : kind === "space" && !space
                    ? "This space couldn’t be found"
                    : "Nothing here just yet"
          }
          description={
            filter
              ? "Try another word or clear the filter to see everything."
              : kind === "starred"
                ? "Select the star on any document to find it here next time."
                : kind === "recent"
                  ? "Open a document and it will appear here, ready to return to."
                  : "Documents appear here when Markdown files are added to the knowledge folder."
          }
        />
      )}
      {kind === "space" && space && (
        <p className="collection-footnote">
          <SpaceDot id={space.id} />A little shared knowledge makes the next
          step easier.
        </p>
      )}
    </div>
  );
}
