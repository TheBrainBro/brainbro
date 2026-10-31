import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './layout/AppLayout'
import { BoardsPage } from './pages/BoardsPage'
import { CapturePage } from './pages/CapturePage'
import { CollectionPage, CollectionsPage } from './pages/CollectionsPage'
import { InboxPage } from './pages/InboxPage'
import { LoginPage } from './pages/LoginPage'
import { SharePage } from './pages/SharePage'

// The editor (CodeMirror) loads when a note is first opened, not with the inbox.
const NotePage = lazy(() =>
  import('./pages/NotePage').then((module) => ({ default: module.NotePage })),
)

// The force layout loads with the graph.
const GraphPage = lazy(() =>
  import('./pages/GraphPage').then((module) => ({ default: module.GraphPage })),
)

// The mind map brings React Flow too.
const MindMapPage = lazy(() =>
  import('./pages/MindMapPage').then((module) => ({ default: module.MindMapPage })),
)

// React Flow loads with the first board opened.
const BoardPage = lazy(() =>
  import('./pages/BoardPage').then((module) => ({ default: module.BoardPage })),
)

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<InboxPage />} />
          <Route path="archive" element={<InboxPage archived />} />
          <Route path="capture" element={<CapturePage />} />
          <Route path="share" element={<SharePage />} />
          <Route path="boards" element={<BoardsPage />} />
          <Route
            path="boards/:id"
            element={
              <Suspense>
                <BoardPage />
              </Suspense>
            }
          />
          <Route path="collections" element={<CollectionsPage />} />
          <Route
            path="graph"
            element={
              <Suspense>
                <GraphPage />
              </Suspense>
            }
          />
          <Route path="collections/:id" element={<CollectionPage />} />
          <Route
            path="collections/:id/mindmap"
            element={
              <Suspense>
                <MindMapPage />
              </Suspense>
            }
          />
          <Route
            path="notes/:id"
            element={
              <Suspense>
                <NotePage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
