import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  FileText,
  Star,
  Clock3,
  ArrowRight,
  FolderOpen,
} from "lucide-react";
import type { KnowledgeDocument } from "../shared/library";
import {
  dateLabel,
  initials,
  shortDate,
  spaceColor,
  usePreferences,
} from "./library";

export function SpaceDot({ id }: { id: string }) {
  return (
    <span className={`space-dot tone-${spaceColor(id)}`} aria-hidden="true" />
  );
}
export function DocumentCard({ doc }: { doc: KnowledgeDocument }) {
  const { starred, toggleStar } = usePreferences();
  return (
    <div className="document-card">
      <div className="card-top">
        <span className="space-label">
          <SpaceDot id={doc.spaceId} />
          {doc.space}
        </span>
        <button
          className={`star-button bookmark-button ${starred.includes(doc.id) ? "is-starred" : ""}`}
          aria-label={`${starred.includes(doc.id) ? "Unstar" : "Star"} ${doc.title}`}
          aria-pressed={starred.includes(doc.id)}
          onClick={() => toggleStar(doc.id)}
        >
          <Star size={15} />
        </button>
      </div>
      <Link
        to="/documents/$documentId"
        params={{ documentId: doc.id }}
        className="card-link"
      >
        <span className="card-document-icon">
          <FileText size={20} strokeWidth={1.5} />
        </span>
        <h3>{doc.title}</h3>
        <p>{doc.description}</p>
        <span className="card-footer">
          <span>
            <Clock3 size={12} />
            {doc.readMinutes} min read
          </span>
          <ArrowUpRight size={16} />
        </span>
      </Link>
    </div>
  );
}
export function DocumentRows({
  documents,
}: {
  documents: KnowledgeDocument[];
}) {
  const { starred, toggleStar } = usePreferences();
  return (
    <div className="document-list">
      {documents.map((doc) => (
        <div className="document-row" key={doc.id}>
          <Link
            to="/documents/$documentId"
            params={{ documentId: doc.id }}
            className="row-link"
          >
            <span className={`row-icon tone-${spaceColor(doc.spaceId)}`}>
              <FileText size={18} strokeWidth={1.5} />
            </span>
            <span className="row-title">
              <strong>{doc.title}</strong>
              <span>
                <SpaceDot id={doc.spaceId} />
                {doc.space}
                <span className="row-dot">·</span>
                {doc.readMinutes} min read
              </span>
            </span>
            <span className="row-author">
              <span className="small-avatar">{initials(doc.author)}</span>
              {doc.author}
            </span>
            <time dateTime={doc.updatedAt} title={dateLabel(doc.updatedAt)}>
              {shortDate(doc.updatedAt)}
            </time>
          </Link>
          <button
            className={`star-button bookmark-button ${starred.includes(doc.id) ? "is-starred" : ""}`}
            aria-label={`${starred.includes(doc.id) ? "Unstar" : "Star"} ${doc.title}`}
            aria-pressed={starred.includes(doc.id)}
            onClick={() => toggleStar(doc.id)}
          >
            <Star size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  icon = "folder",
}: {
  title: string;
  description: string;
  icon?: "star" | "clock" | "folder";
}) {
  const Icon = icon === "star" ? Star : icon === "clock" ? Clock3 : FolderOpen;
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={27} strokeWidth={1.4} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <Link to="/documents" className="text-link">
        Browse all documents
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
