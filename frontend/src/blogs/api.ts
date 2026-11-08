import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type DnsRecord = { type: 'CNAME' | 'A' | 'TXT'; name: string; value: string }

/**
 * A blog on the user's own domain: the published notes of `collection`, at
 * `url`. It serves nothing until its TXT record proves the domain is theirs.
 */
export type Blog = {
  id: string
  hostname: string
  collection: string | null
  title: string
  description: string
  /** Shown under the description on its index, up to 10. */
  links: { name: string; url: string }[]
  /** A small "Powered by BrainBro" line at the end of its pages. */
  powered_by: boolean
  status: 'unverified' | 'checking' | 'failed' | 'verified'
  checked_at: string | null
  verified_at: string | null
  url: string
  /** What to add at the domain's DNS: where it points, and the TXT proof. */
  records: DnsRecord[]
  created_at: string
}

export type BlogChanges = Partial<
  Pick<Blog, 'hostname' | 'collection' | 'title' | 'description' | 'links' | 'powered_by'>
>

const blogsKey = ['blogs'] as const
const POLL_MS = 2000

/** The user's blogs; polled while one is being checked. */
export function useBlogs() {
  return useQuery({
    queryKey: blogsKey,
    queryFn: () => api<Blog[]>('/sites/'),
    refetchInterval: (query) =>
      query.state.data?.some((blog) => blog.status === 'checking') ? POLL_MS : false,
  })
}

export function useCreateBlog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (blog: BlogChanges) =>
      api<Blog>('/sites/', { method: 'POST', body: JSON.stringify(blog) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: blogsKey }),
  })
}

export function useUpdateBlog(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: BlogChanges) =>
      api<Blog>(`/sites/${id}/`, { method: 'PATCH', body: JSON.stringify(changes) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: blogsKey }),
  })
}

export function useDeleteBlog(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/sites/${id}/`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: blogsKey }),
  })
}

/** Looks the TXT record up; the blog's status says how it went. */
export function useVerifyBlog(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<Blog>(`/sites/${id}/verify/`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: blogsKey }),
  })
}
