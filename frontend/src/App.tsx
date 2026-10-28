import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './layout/AppLayout'
import { CapturePage } from './pages/CapturePage'
import { CollectionPage, CollectionsPage } from './pages/CollectionsPage'
import { InboxPage } from './pages/InboxPage'
import { LoginPage } from './pages/LoginPage'
import { Placeholder } from './pages/Placeholder'

// The editor (CodeMirror) loads when a note is first opened, not with the inbox.
const NotePage = lazy(() =>
  import('./pages/NotePage').then((module) => ({ default: module.NotePage })),
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
          <Route path="capture" element={<CapturePage />} />
          <Route
            path="boards"
            element={<Placeholder title="Boards" description="The infinite canvas arrives in phase 2." />}
          />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:id" element={<CollectionPage />} />
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
