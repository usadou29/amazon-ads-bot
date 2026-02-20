import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 30000 });

export function fetcher<T>(url: string): Promise<T> { return api.get(url).then((r) => r.data); }

export function getWorkspaceId(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('endromede_workspace_id');
    if (stored) return stored;
  }
  return 'be210084-a293-4159-939e-a54f9e1ff031';
}

// ─── Authors & Books ───────────────────────────
export const fetchAuthors = () => api.get(`/authors?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchAuthorBooks = (authorId: string) => api.get(`/authors/${authorId}/books?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchBookDashboard = (bookId: string) => api.get(`/books/${bookId}/dashboard`).then((r) => r.data);
export const fetchBookDailyMetrics = (bookId: string, days = 30) => api.get(`/books/${bookId}/metrics/daily?days=${days}`).then((r) => r.data);
export const fetchBooks = () => api.get(`/books?workspaceId=${getWorkspaceId()}`).then((r) => r.data);

export interface CreateBookDto {
  asin: string;
  marketplace: string;
  title?: string;
  author?: string;
  kdpId?: string;
  publicationDate?: string;
  acosTarget?: number;
}
export const createBook = (dto: CreateBookDto) => api.post('/books', { workspaceId: getWorkspaceId(), ...dto }).then((r) => r.data);

// ─── Campaigns ─────────────────────────────────
export const fetchCampaigns = () => api.get(`/campaigns?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchCampaignCount = () => api.get(`/campaigns/count?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchAvailableCampaigns = (bookId?: string) => {
  const params = new URLSearchParams({ workspaceId: getWorkspaceId() });
  if (bookId) params.set('bookId', bookId);
  return api.get(`/books/available-campaigns?${params}`).then((r) => r.data);
};
export const linkCampaignToBook = (bookId: string, campaignId: string, isPrimary = false) =>
  api.post(`/books/${bookId}/campaigns`, { campaignId, isPrimary }).then((r) => r.data);
export const unlinkCampaignFromBook = (bookId: string, campaignId: string) =>
  api.delete(`/books/${bookId}/campaigns/${campaignId}`).then((r) => r.data);

// ─── Metrics ───────────────────────────────────
export const fetchMetricsSummary = () => api.get(`/metrics/summary?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchTopPerformers = (entityType = 'campaign', sortBy = 'sales', limit = 5) =>
  api.get(`/metrics/top-performers?workspaceId=${getWorkspaceId()}&entityType=${entityType}&sortBy=${sortBy}&limit=${limit}`).then((r) => r.data);
export const fetchMarketplaceBreakdown = () => api.get(`/metrics/by-marketplace?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchTrends = () => api.get(`/metrics/trends?workspaceId=${getWorkspaceId()}`).then((r) => r.data);

// ─── Recommendations ───────────────────────────
export const fetchRecommendations = (status = 'pending') => api.get(`/recommendations?workspaceId=${getWorkspaceId()}&status=${status}`).then((r) => r.data);
export const fetchRecommendationsPending = (limit = 5) => api.get(`/recommendations/pending?workspaceId=${getWorkspaceId()}&limit=${limit}`).then((r) => r.data);
export const fetchRecommendationStats = () => api.get(`/recommendations/stats?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const approveRecommendation = (id: string) => api.post(`/recommendations/${id}/approve`, { reviewedBy: 'user' }).then((r) => r.data);
export const rejectRecommendation = (id: string, reason = '') => api.post(`/recommendations/${id}/reject`, { reviewedBy: 'user', reason }).then((r) => r.data);

// ─── Actions ───────────────────────────────────
export const dryRunAction = (recommendationId: string) => api.post('/actions/dry-run', { recommendationId }).then((r) => r.data);
export const executeAction = (recommendationId: string) => api.post('/actions/execute', { recommendationId, executedBy: 'user' }).then((r) => r.data);
export const fetchKillSwitchStatus = () => api.get('/actions/kill-switch').then((r) => r.data);

// ─── System ────────────────────────────────────
export const fetchFeatureFlag = (name: string) => api.get(`/system/features/${name}`).then((r) => r.data);

// ─── Scheduler / Sync ─────────────────────────
export const triggerSync = () => api.post(`/scheduler/sync?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchSyncStatus = () => api.get(`/scheduler/status?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
