import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 30000, headers: { 'Content-Type': 'application/json' } });

export function fetcher<T>(url: string): Promise<T> { return api.get(url).then((r) => r.data); }

export function getWorkspaceId(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('endromede_workspace_id');
    if (stored) return stored;
  }
  return 'be210084-a293-4159-939e-a54f9e1ff031';
}

export const fetchAuthors = () => api.get(`/authors?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchAuthorBooks = (authorId: string) => api.get(`/authors/${authorId}/books?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
export const fetchBookDashboard = (bookId: string) => api.get(`/books/${bookId}/dashboard`).then((r) => r.data);
export const fetchBookDailyMetrics = (bookId: string, days = 30) => api.get(`/books/${bookId}/metrics/daily?days=${days}`).then((r) => r.data);
export const fetchRecommendations = (status = 'pending') => api.get(`/recommendations?workspaceId=${getWorkspaceId()}&status=${status}`).then((r) => r.data);
export const approveRecommendation = (id: string) => api.post(`/recommendations/${id}/approve`, { reviewedBy: 'user' }).then((r) => r.data);
export const rejectRecommendation = (id: string, reason = '') => api.post(`/recommendations/${id}/reject`, { reviewedBy: 'user', reason }).then((r) => r.data);
export const dryRunAction = (recommendationId: string) => api.post('/actions/dry-run', { recommendationId }).then((r) => r.data);
export const executeAction = (recommendationId: string) => api.post('/actions/execute', { recommendationId, executedBy: 'user' }).then((r) => r.data);
export const fetchKillSwitchStatus = () => api.get('/actions/kill-switch').then((r) => r.data);
export const fetchFeatureFlag = (name: string) => api.get(`/system/features/${name}`).then((r) => r.data);
export const fetchMetricsSummary = () => api.get(`/metrics/summary?workspaceId=${getWorkspaceId()}`).then((r) => r.data);
