import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Plus, FolderOpen, RefreshCw } from 'lucide-react-native';
import { useDTLStore } from '@/lib/store';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function CasesScreen() {
  const cases = useDTLStore((s) => s.cases);
  const setCases = useDTLStore((s) => s.setCases);
  const connected = useDTLStore((s) => s.connected);
  const [loading, setLoading] = useState(false);

  const loadCases = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const c = await api.getCases();
      setCases(Array.isArray(c) ? c : []);
    } catch {}
    setLoading(false);
  }, [connected]);

  useEffect(() => { loadCases(); }, [loadCases]);

  const createCase = useCallback(() => {
    Alert.prompt(
      'New Case',
      'Enter case name:',
      async (name) => {
        if (!name?.trim()) return;
        try {
          await api.createCase(name.trim());
          loadCases();
        } catch (e: any) {
          Alert.alert('Error', e.message);
        }
      },
      'plain-text',
      '',
      'default'
    );
  }, []);

  // Fallback for Android/web where Alert.prompt doesn't exist
  const createCaseFallback = useCallback(async () => {
    const name = typeof window !== 'undefined'
      ? window.prompt('Case name:')
      : null;
    if (!name?.trim()) return;
    try {
      await api.createCase(name.trim());
      loadCases();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={styles.sectionH}>Cases</Text>
        <TouchableOpacity onPress={loadCases} style={styles.refreshBtn}>
          <RefreshCw size={16} color={colors.ac1} />
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={{ alignItems: 'center', padding: 40 }}>
          <ActivityIndicator size="large" color={colors.ac1} />
        </View>
      )}

      {!loading && cases.length === 0 && (
        <View style={{ alignItems: 'center', padding: 40 }}>
          <FolderOpen size={48} color={colors.tx2} style={{ opacity: 0.3 }} />
          <Text style={{ color: colors.tx2, marginTop: 12, fontSize: 14 }}>
            {connected ? 'No cases yet' : 'Connect to backend to view cases'}
          </Text>
        </View>
      )}

      {cases.map((c: any, i: number) => (
        <View key={c.id || i} style={styles.card}>
          <Text style={styles.caseName}>{c.name}</Text>
          <Text style={styles.caseMeta}>
            Created {new Date(c.created_at).toLocaleDateString()}
          </Text>
          {c.description ? (
            <Text style={{ fontSize: 12, color: colors.tx1, marginTop: 4 }}>{c.description}</Text>
          ) : null}
        </View>
      ))}

      <TouchableOpacity
        style={styles.addBtn}
        onPress={typeof Alert.prompt === 'function' ? createCase : createCaseFallback}
      >
        <Plus size={16} color={colors.tx2} />
        <Text style={{ color: colors.tx2, fontSize: 13, marginLeft: 6 }}>New Case</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = {
  sectionH: {
    fontSize: 12,
    color: colors.tx2,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
    marginBottom: 0,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.bg3,
  },
  card: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg3,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  caseName: {
    fontWeight: '600' as const,
    fontSize: 15,
    color: colors.tx0,
    marginBottom: 4,
  },
  caseMeta: {
    fontSize: 11,
    color: colors.tx2,
  },
  addBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: colors.bg4,
    marginTop: 8,
  },
};
