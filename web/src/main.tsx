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
import "./mobile.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lastReadingPath } from "./lib";
import { AskDrawer } from "./components/AskDrawer";
import { TopBar } from "./components/TopBar";
import { AskPage } from "./pages/AskPage";
import { BookPage } from "./pages/BookPage";
import { NotesPage } from "./pages/NotesPage";
import { PassagePage } from "./pages/PassagePage";
import { LibraryPage } from "./pages/LibraryPage";
import { ReadPage } from "./pages/ReadPage";
import { SearchPage } from "./pages/SearchPage";
import { WorkPage } from "./pages/WorkPage";
import { NotesProvider } from "./notes";
import { SettingsProvider } from "./settings";

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
          <Route path="/ask" element={<AskPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
      <ErrorBoundary resetKey={location.pathname}>
        <AskDrawer />
      </ErrorBoundary>
    </div>
  );
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
