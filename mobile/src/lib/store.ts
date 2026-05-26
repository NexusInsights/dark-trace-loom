import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ScanResult {
  username?: string;
  found_count?: number;
  total_checked?: number;
  error_count?: number;
  found?: any[];
  found_by_tag?: Record<string, any[]>;
  extracted_ids?: Record<string, any>;
  entity_id?: string;
  // General scan
  query?: string;
  type?: string;
  entity_type?: string;
  risk_score?: number;
  modules?: Record<string, any>;
  discovered_entities?: any[];
}

interface DTLStore {
  backendUrl: string;
  apiKeys: Record<string, string>;
  connected: boolean;
  scanning: boolean;
  scanType: string;
  lastResult: ScanResult | null;
  entities: any[];
  cases: any[];
  graphData: { nodes: any[]; edges: any[] };
  maigretStats: { total_sites: number; default_scan_sites: number; tags: Record<string, number>; version: string } | null;

  setBackendUrl: (url: string) => void;
  setApiKey: (name: string, value: string) => void;
  setConnected: (v: boolean) => void;
  setScanning: (v: boolean) => void;
  setScanType: (t: string) => void;
  setLastResult: (r: ScanResult | null) => void;
  setEntities: (e: any[]) => void;
  setCases: (c: any[]) => void;
  setGraphData: (g: { nodes: any[]; edges: any[] }) => void;
  setMaigretStats: (s: any) => void;
  loadPersistedState: () => Promise<void>;
  persistState: () => Promise<void>;
}

export const useDTLStore = create<DTLStore>((set, get) => ({
  backendUrl: '',
  apiKeys: {},
  connected: false,
  scanning: false,
  scanType: 'auto',
  lastResult: null,
  entities: [],
  cases: [],
  graphData: { nodes: [], edges: [] },
  maigretStats: null,

  setBackendUrl: (url) => { set({ backendUrl: url }); get().persistState(); },
  setApiKey: (name, value) => {
    const keys = { ...get().apiKeys, [name]: value };
    set({ apiKeys: keys });
    get().persistState();
  },
  setConnected: (v) => set({ connected: v }),
  setScanning: (v) => set({ scanning: v }),
  setScanType: (t) => set({ scanType: t }),
  setLastResult: (r) => set({ lastResult: r }),
  setEntities: (e) => set({ entities: e }),
  setCases: (c) => set({ cases: c }),
  setGraphData: (g) => set({ graphData: g }),
  setMaigretStats: (s) => set({ maigretStats: s }),

  loadPersistedState: async () => {
    try {
      const [url, keys] = await Promise.all([
        AsyncStorage.getItem('dtl_url'),
        AsyncStorage.getItem('dtl_keys'),
      ]);
      set({
        backendUrl: url || '',
        apiKeys: keys ? JSON.parse(keys) : {},
      });
    } catch {}
  },

  persistState: async () => {
    const { backendUrl, apiKeys } = get();
    try {
      await AsyncStorage.setItem('dtl_url', backendUrl);
      await AsyncStorage.setItem('dtl_keys', JSON.stringify(apiKeys));
    } catch {}
  },
}));
