// Fonts are bundled so the app works offline. Each design uses a display, a text and a UI face.
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/500-italic.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/600.css";
import "@fontsource/crimson-pro/400.css";
import "@fontsource/crimson-pro/600.css";
import "@fontsource/crimson-pro/600-italic.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/500.css";
import "@fontsource/spectral/500-italic.css";
import "@fontsource/karla/400.css";
import "@fontsource/karla/600.css";
import "@fontsource/gentium-book-plus/400.css";
import "@fontsource/gentium-book-plus/700.css";
import "@fontsource/noto-serif-hebrew/400.css";
import "./styles.css";
import "./layout.css";
import "./settings.css";
import "./timeline.css";
import "./story.css";
import "./ask.css";
import "./study.css";
import "./reading.css";
import "./words.css";
import "./manuscripts.css";
import "./geo.css";
import "./rulers.css";
import "./mobile.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lastReadingPath } from "./lib";
import { AskDrawer } from "./components/AskDrawer";
import { TopBar } from "./components/TopBar";
import { TabBar } from "./components/TabBar";
import { TimelineLab } from "./pages/TimelineLab";
import { AskPage } from "./pages/AskPage";
import { BookPage } from "./pages/BookPage";
import { DomainPage } from "./pages/DomainPage";
import { NotesPage } from "./pages/NotesPage";
import { PassagePage } from "./pages/PassagePage";
import { LibraryPage } from "./pages/LibraryPage";
import { ManuscriptPage } from "./pages/ManuscriptPage";
import { ManuscriptsPage } from "./pages/ManuscriptsPage";
import { ReadPage } from "./pages/ReadPage";
import { SearchPage } from "./pages/SearchPage";
import { WorkPage } from "./pages/WorkPage";
import { TopicsPage } from "./pages/TopicsPage";
import { TopicPage } from "./pages/TopicPage";
import { PlanPage, PlansPage } from "./pages/PlansPage";
import { ParallelPage, ParallelsPage } from "./pages/ParallelsPage";
import { RulersPage } from "./pages/RulersPage";
import { NotesProvider } from "./notes";
import { SettingsProvider } from "./settings";

// the atlas brings Leaflet with it, so it and the place/person/event pages load only when opened
const AtlasPage = lazy(() => import("./pages/AtlasPage"));
const PlacePage = lazy(() => import("./pages/EntityPages").then((m) => ({ default: m.PlacePage })));
const PersonPage = lazy(() => import("./pages/EntityPages").then((m) => ({ default: m.PersonPage })));
const EventPage = lazy(() => import("./pages/EntityPages").then((m) => ({ default: m.EventPage })));
const loading = <div className="loading">Loading…</div>;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function App() {
  const location = useLocation();
  return (
    <div className="app">
      <TopBar />
      <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<Navigate to={lastReadingPath()} replace />} />
          <Route path="/read/:book/:chapter" element={<ReadPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:edition/:ord" element={<WorkPage />} />
          <Route path="/book/:book" element={<BookPage />} />
          <Route path="/passage/:ref" element={<PassagePage />} />
          <Route path="/domains/:id" element={<DomainPage />} />
          <Route path="/manuscripts" element={<ManuscriptsPage />} />
          <Route path="/manuscript/:id" element={<ManuscriptPage />} />
          <Route path="/rulers" element={<RulersPage />} />
          <Route path="/lab/timeline" element={<TimelineLab />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/topic/:id" element={<TopicPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plans/:id" element={<PlanPage />} />
          <Route path="/parallels" element={<ParallelsPage />} />
          <Route path="/parallels/:id" element={<ParallelPage />} />
          <Route path="/atlas" element={<Suspense fallback={loading}><AtlasPage /></Suspense>} />
          <Route path="/place/:id" element={<Suspense fallback={loading}><PlacePage /></Suspense>} />
          <Route path="/person/:id" element={<Suspense fallback={loading}><PersonPage /></Suspense>} />
          <Route path="/event/:id" element={<Suspense fallback={loading}><EventPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
      <ErrorBoundary resetKey={location.pathname}>
        <AskDrawer />
      </ErrorBoundary>
      <TabBar />
    </div>
  );
}

// installable as an app (Chrome, Edge, Android, iOS "Add to Home Screen"); not in development, where it would cache stale code
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* the site works without it */
    });
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <BrowserRouter>
          <NotesProvider>
            <App />
          </NotesProvider>
        </BrowserRouter>
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
