import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/gentium-book-plus/400.css";
import "@fontsource/gentium-book-plus/700.css";
import "@fontsource/noto-serif-hebrew/400.css";
import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar";
import { LibraryPage } from "./pages/LibraryPage";
import { ReadPage } from "./pages/ReadPage";
import { SearchPage } from "./pages/SearchPage";
import { WorkPage } from "./pages/WorkPage";
import { SettingsProvider } from "./settings";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function App() {
  return (
    <div className="app">
      <TopBar />
      <Routes>
        <Route path="/" element={<Navigate to="/read/John/1" replace />} />
        <Route path="/read/:book/:chapter" element={<ReadPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/library/:edition/:ord" element={<WorkPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
          <App />
        </BrowserRouter>
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
