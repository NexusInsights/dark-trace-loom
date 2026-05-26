import { useDTLStore } from './store';

class DTLApi {
  private getBase(): string {
    const url = useDTLStore.getState().backendUrl.replace(/\/+$/, '');
    if (!url) throw new Error('Backend URL not configured');
    return url;
  }

  async request(path: string, opts: {
    method?: string;
    params?: Record<string, string | boolean | number>;
    body?: any;
  } = {}): Promise<any> {
    const base = this.getBase();
    const url = new URL(path, base);
    if (opts.params) {
      Object.entries(opts.params).forEach(([k, v]) =>
        url.searchParams.set(k, String(v))
      );
    }
    const resp = await fetch(url.toString(), {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // Connection
  async checkConnection(): Promise<boolean> {
    try {
      await this.request('/api/stats');
      return true;
    } catch {
      return false;
    }
  }

  // Scan
  async detectType(query: string) {
    return this.request('/api/scan/detect', { params: { q: query } });
  }

  async scanMaigret(username: string, allSites = false) {
    return this.request('/api/maigret/scan', {
      method: 'POST',
      params: { username, all_sites: allSites },
    });
  }

  async scanGeneral(query: string, scanType?: string) {
    return this.request('/api/scan', {
      method: 'POST',
      body: { query, scan_type: scanType || null },
    });
  }

  // Maigret stats
  async getMaigretStats() {
    return this.request('/api/maigret/stats');
  }

  // Entities
  async getEntities(limit = 200) {
    return this.request('/api/entities', { params: { limit } });
  }

  async deleteEntity(eid: string) {
    return this.request(`/api/entities/${eid}`, { method: 'DELETE' });
  }

  // Graph
  async getGraph() {
    return this.request('/api/graph');
  }

  // Analytics
  async getAnalytics() {
    return this.request('/api/analytics');
  }

  // Cases
  async getCases() {
    return this.request('/api/cases');
  }

  async createCase(name: string, description = '') {
    return this.request('/api/cases', {
      method: 'POST',
      body: { name, description },
    });
  }

  // Keys
  async pushApiKey(name: string, value: string) {
    return this.request('/api/keys', {
      method: 'POST',
      body: { name, value },
    });
  }

  // Platform stats
  async getStats() {
    return this.request('/api/stats');
  }

  // AI
  async aiAnalyze(entityId: string) {
    return this.request(`/api/ai/analyze/${entityId}`, { method: 'POST' });
  }

  // Auto-pivot
  async autoPivot(seed: string, maxDepth = 2) {
    return this.request('/api/autopivot', {
      method: 'POST',
      body: { seed, max_depth: maxDepth },
    });
  }

  // STIX export
  async exportStix() {
    return this.request('/api/export/stix');
  }
}

export const api = new DTLApi();
