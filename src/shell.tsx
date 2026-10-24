import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Clock3,
  FileText,
  Home,
  Menu,
  Moon,
  Play,
  Search,
  Star,
  Sun,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type { Library } from "../shared/library";
import {
  LibraryContext,
  PreferencesProvider,
  spaceColor,
  useLibrary,
  useLibraryQuery,
  usePreferences,
  useStored,
} from "./library";
import { SpaceDot } from "./components";
import { settlePage, useInputModality } from "./motion";
import { useDrawerMotion } from "./use-drawer-motion";

export function AppShell() {
  return (
    <PreferencesProvider>
      <Workspace />
    </PreferencesProvider>
  );
}

function Workspace() {
  useInputModality();
  const query = useLibraryQuery();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [theme, setTheme] = useStored<"system" | "light" | "dark">(
    "theme",
    "system",
  );
  const [isDark, setIsDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  const scroll = useRef<HTMLElement>(null);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const pendingIntro = useRef(false);
  useDrawerMotion(mobileDialog, mobileOpen, () => {
    if (pendingIntro.current) {
      pendingIntro.current = false;
      setIntroOpen(true);
    }
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (query.data) setSearchOpen((current) => !current);
      }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [query.data]);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useLayoutEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
    let cancelMotion: (() => void) | undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      // Router location can commit before Outlet replaces its old child. Start
      // at the next paint opportunity so motion belongs to the destination.
      if (query.data)
        cancelMotion = settlePage(scroll.current?.firstElementChild ?? null);
      second = requestAnimationFrame(() => {
        const starts = performance.getEntriesByName("kmflow:navigation-start");
        if (starts.length && query.data) {
          performance.measure("kmflow:navigation", {
            start: starts[starts.length - 1].startTime,
            detail: { pathname },
          });
          performance.clearMarks("kmflow:navigation-start");
        }
      });
    });
    return () => {
      cancelMotion?.();
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pathname, !!query.data]);
  const doc = query.data?.documents.find(
    (item) =>
      pathname === `/documents/${encodeURIComponent(item.id)}` ||
      pathname === `/documents/${item.id}`,
  );
  const space = query.data?.spaces.find(
    (item) => pathname === `/spaces/${item.id}`,
  );
  const currentTitle =
    doc?.title ||
    space?.name ||
    (pathname === "/documents"
      ? "All documents"
      : pathname === "/recent"
        ? "Recently viewed"
        : pathname === "/starred"
          ? "Starred"
          : "Home");
  useEffect(() => {
    document.title = `${currentTitle} · KM flow`;
  }, [currentTitle]);
  const sidebar = (
    <Sidebar
      library={query.data}
      connected={query.connected}
      refreshing={query.isFetching}
      onReplay={() => {
        if (mobileDialog.current?.open) {
          pendingIntro.current = true;
          setMobileOpen(false);
        } else setIntroOpen(true);
      }}
      onNavigate={() => setMobileOpen(false)}
    />
  );
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="desktop-sidebar">{sidebar}</aside>
      <dialog
        className="mobile-navigation"
        ref={mobileDialog}
        aria-label="Navigation"
        onCancel={(event) => {
          event.preventDefault();
          setMobileOpen(false);
        }}
        onClick={(event) => {
          if (
            event.target === event.currentTarget ||
            (event.target as HTMLElement).classList.contains("mobile-scrim")
          )
            setMobileOpen(false);
        }}
      >
        <div className="mobile-scrim" aria-hidden="true" />
        <div className="mobile-sidebar-content">
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
          {sidebar}
        </div>
      </dialog>
      <div className="workspace-panel">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
          <img
            className="mobile-brand brand-image"
            src="/logo.svg"
            alt="KM flow"
          />
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <span className="workspace-crumb">Team workspace</span>
            <ChevronRight size={12} />
            {doc ? (
              <>
                <Link to="/spaces/$spaceId" params={{ spaceId: doc.spaceId }}>
                  {doc.space}
                </Link>
                <ChevronRight size={12} />
                <span className="breadcrumb-current">{doc.title}</span>
              </>
            ) : (
              <span className="breadcrumb-current">{currentTitle}</span>
            )}
          </nav>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              onClick={() => setSearchOpen(true)}
              disabled={!query.data}
            >
              <Search size={16} />
              <span>Search knowledge…</span>
              <kbd>
                {navigator.platform.toUpperCase().includes("MAC")
                  ? "⌘"
                  : "Ctrl"}{" "}
                K
              </kbd>
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button theme-button"
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
              title={`Switch to ${isDark ? "light" : "dark"} theme`}
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="workspace-avatar" title="Team workspace">
              <BookOpen size={17} strokeWidth={1.6} />
            </span>
          </div>
        </header>
        {query.data && query.data.diagnostics.length > 0 && (
          <details className="diagnostics">
            <summary>
              <AlertCircle size={15} />
              {query.data.diagnostics.length} file
              {query.data.diagnostics.length === 1 ? "" : "s"} need attention
              <span>View details</span>
            </summary>
            <ul>
              {query.data.diagnostics.map((diagnostic) => (
                <li key={diagnostic.path}>
                  <code>{diagnostic.path}</code> — {diagnostic.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {query.data && query.isError && (
          <div className="refresh-error" role="status">
            Your loaded documents are still available. We couldn’t refresh the
            library.{" "}
            <button onClick={() => void query.refetch()}>Try again</button>
          </div>
        )}
        <main
          className="scroll-body"
          id="main-content"
          ref={scroll}
          tabIndex={-1}
        >
          {query.data ? (
            <LibraryContext value={query.data}>
              <Outlet />
            </LibraryContext>
          ) : query.isError ? (
            <div className="load-state">
              <span className="empty-icon">
                <AlertCircle size={28} />
              </span>
              <h1>Let’s get your library connected</h1>
              <p>{query.error.message}</p>
              <button
                className="primary-button"
                onClick={() => void query.refetch()}
              >
                <RefreshCw size={15} />
                Try again
              </button>
            </div>
          ) : (
            <div className="loading-library" role="status">
              <img src="/logo.svg" alt="" />
              <span>Gathering your team’s knowledge…</span>
              <span className="loading-line" />
            </div>
          )}
        </main>
      </div>
      {searchOpen && query.data && (
        <LibraryContext value={query.data}>
          <SearchDialog onClose={() => setSearchOpen(false)} />
        </LibraryContext>
      )}
      {introOpen && <IntroReplay onClose={() => setIntroOpen(false)} />}
    </div>
  );
}

function Sidebar({
  library,
  connected,
  refreshing,
  onReplay,
  onNavigate,
}: {
  library?: Library;
  connected: boolean;
  refreshing: boolean;
  onReplay: () => void;
  onNavigate: () => void;
}) {
  const navItems = [
    { to: "/" as const, label: "Home", icon: Home },
    { to: "/documents" as const, label: "Library", icon: BookOpen },
    { to: "/recent" as const, label: "Recent", icon: Clock3 },
    { to: "/starred" as const, label: "Starred", icon: Star },
  ];
  return (
    <div className="sidebar-inner">
      <Link
        to="/"
        className="brand"
        onClick={onNavigate}
        aria-label="KM flow home"
      >
        <img className="brand-image" src="/logo.svg" alt="KM flow" />
        <span>Team knowledge</span>
      </Link>
      <nav className="sidebar-navigation" aria-label="Main navigation">
        <div className="main-nav">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              to={to}
              key={to}
              activeOptions={{ exact: true }}
              className="nav-link"
              activeProps={{
                className: "nav-link active",
                "aria-current": "page",
              }}
              onClick={onNavigate}
            >
              <Icon size={17} strokeWidth={1.65} />
              {label}
            </Link>
          ))}
        </div>
        <div className="spaces-label">
          <span>Spaces</span>
        </div>
        <div className="space-nav">
          {library?.spaces.map((space) => (
            <Link
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              key={space.id}
              className="nav-link"
              activeProps={{
                className: "nav-link space-active",
                "aria-current": "page",
              }}
              onClick={onNavigate}
            >
              <SpaceDot id={space.id} />
              <span>{space.name}</span>
            </Link>
          ))}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <div className="library-status">
          <span className={`status-dot ${!connected ? "offline" : ""}`} />
          <span>
            {refreshing
              ? "Refreshing…"
              : connected
                ? "Up to date"
                : "Connecting…"}
          </span>
          <button
            onClick={onReplay}
            aria-label="Replay brand animation"
            title="Replay brand animation"
          >
            <Play size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const library = useLibrary();
  const { recent } = usePreferences();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const router = useRouter();
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
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  useEffect(() => {
    setSelected(0);
  }, [query]);
  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-search-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const open = (id: string) => {
    onClose();
    void router.navigate({
      to: "/documents/$documentId",
      params: { documentId: id },
    });
  };
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
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelected((value) => Math.min(value + 1, results.length - 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelected((value) => Math.max(value - 1, 0));
        }
        if (event.key === "Enter" && results[selected]) {
          event.preventDefault();
          open(results[selected].id);
        }
      }}
    >
      <div className="search-dialog-input">
        <Search size={20} />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What would you like to know?"
          aria-label="Search documents"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="knowledge-search-results"
          aria-activedescendant={
            results[selected]
              ? `knowledge-search-result-${selected}`
              : undefined
          }
          autoComplete="off"
        />
        <button onClick={onClose} aria-label="Close search">
          <kbd>esc</kbd>
        </button>
      </div>
      <div
        className="search-results"
        id="knowledge-search-results"
        role="listbox"
        aria-label="Matching documents"
      >
        <span className="search-label" role="presentation">
          {query.trim()
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
            aria-selected={selected === index}
            tabIndex={-1}
            data-search-index={index}
            className={`search-result ${selected === index ? "selected" : ""}`}
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
            <strong>No answers for “{query}” yet</strong>
            <p>Try a different word, a tool name, or a shorter phrase.</p>
          </div>
        )}
      </div>
      <div className="search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate
        </span>
        <span>
          <kbd>↵</kbd> to open
        </span>
        <span>Search your whole library</span>
      </div>
    </dialog>
  );
}

function IntroReplay({ onClose }: { onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const logo = Array.from(
      document.querySelectorAll<HTMLElement>(".brand-image"),
    ).find(
      (element) =>
        !element.closest("dialog") && element.getBoundingClientRect().width > 0,
    );
    if (!logo || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    void import("./brand-intro.js")
      .then(({ playIntro }) => {
        if (!cancelled && canvas.current && backdrop.current)
          cleanup = playIntro(canvas.current, logo, backdrop.current, onClose);
      })
      .catch(onClose);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    addEventListener("keydown", escape);
    return () => {
      cancelled = true;
      cleanup?.();
      removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <>
      <div className="intro-backdrop" ref={backdrop} aria-hidden="true" />
      <canvas className="intro-canvas" ref={canvas} aria-hidden="true" />
      <button className="skip-intro" onClick={onClose}>
        Skip animation
        <X size={14} />
      </button>
    </>
  );
}

export function RouteNotFound() {
  return (
    <div className="load-state">
      <span className="empty-icon">
        <FileText size={28} />
      </span>
      <h1>There’s no page here</h1>
      <p>Let’s get you back to something useful.</p>
      <Link to="/" className="primary-button">
        Back to home
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
