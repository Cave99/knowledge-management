import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Library } from "../shared/library";

export const libraryOptions = queryOptions({
  queryKey: ["library"],
  queryFn: async ({ signal }): Promise<Library> => {
    const response = await fetch("/api/library", { signal });
    if (!response.ok)
      throw new Error(
        "We couldn’t load your knowledge library. Check that the server is running and try again.",
      );
    return response.json();
  },
});

export function useLibraryQuery() {
  const client = useQueryClient();
  const query = useQuery(libraryOptions);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.onmessage = (event) => {
      const current = client.getQueryData<Library>(libraryOptions.queryKey);
      if (current && current.revision !== event.data)
        void client.invalidateQueries({ queryKey: libraryOptions.queryKey });
    };
    return () => events.close();
  }, [client]);
  return { ...query, connected };
}

export const LibraryContext = createContext<Library | null>(null);
export function useLibrary() {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("Library has not loaded");
  return library;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(`kmflow:${key}`) || "null") ?? fallback
    );
  } catch {
    return fallback;
  }
}

export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key, initial);
    return typeof stored === typeof initial &&
      Array.isArray(stored) === Array.isArray(initial)
      ? stored
      : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(`kmflow:${key}`, JSON.stringify(value));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

type Preferences = {
  starred: string[];
  recent: string[];
  toggleStar: (id: string) => void;
  visit: (id: string) => void;
};
const PreferencesContext = createContext<Preferences | null>(null);
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [starred, setStarred] = useStored<string[]>("starred", []);
  const [recent, setRecent] = useStored<string[]>("recent", []);
  const toggleStar = (id: string) =>
    setStarred((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const visit = (id: string) =>
    setRecent((current) =>
      current[0] === id
        ? current
        : [id, ...current.filter((item) => item !== id)].slice(0, 30),
    );
  return (
    <PreferencesContext value={{ starred, recent, toggleStar, visit }}>
      {children}
    </PreferencesContext>
  );
}
export function usePreferences() {
  return useContext(PreferencesContext)!;
}

const palette = ["orange", "blue", "green", "purple", "rose"];
export function spaceColor(id: string) {
  const known: Record<string, string> = {
    "getting-started": "rose",
    "guides--playbooks": "orange",
    "tools--resources": "blue",
    projects: "green",
    "team-support": "purple",
  };
  return (
    known[id] ||
    palette[
      Array.from(id).reduce((sum, c) => sum + c.charCodeAt(0), 0) %
        palette.length
    ]
  );
}
export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}
export function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
