import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { useDTLStore } from '@/lib/store';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

const TYPE_COLORS: Record<string, string> = {
  username: colors.ac1,
  email: colors.ac2,
  domain: colors.ac3,
  ip: '#ff9100',
  phone: colors.ac4,
  social: colors.ac1,
  crypto: '#ffd600',
};

export default function GraphScreen() {
  const graphData = useDTLStore((s) => s.graphData);
  const setGraphData = useDTLStore((s) => s.setGraphData);
  const connected = useDTLStore((s) => s.connected);
  const [loading, setLoading] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);

  const loadGraph = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const [g, a] = await Promise.all([api.getGraph(), api.getAnalytics()]);
      setGraphData(g);
      setAnalytics(a);
    } catch {}
    setLoading(false);
  }, [connected]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const nodes = graphData.nodes || [];
  const edges = graphData.edges || [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={styles.sectionH}>Entity Graph</Text>
        <TouchableOpacity onPress={loadGraph} style={styles.refreshBtn}>
          <RefreshCw size={16} color={colors.ac1} />
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={{ alignItems: 'center', padding: 40 }}>
          <ActivityIndicator size="large" color={colors.ac1} />
        </View>
      )}

      {!loading && nodes.length === 0 && (
        <View style={{ alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 40, color: colors.tx2 }}>0</Text>
          <Text style={{ color: colors.tx2, marginTop: 8 }}>No entities yet. Run a scan.</Text>
        </View>
      )}

      {/* Stats summary */}
      {nodes.length > 0 && (
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statVal, { color: colors.ac1 }]}>{nodes.length}</Text>
            <Text style={styles.statLabel}>Nodes</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statVal, { color: colors.ac2 }]}>{edges.length}</Text>
            <Text style={styles.statLabel}>Edges</Text>
          </View>
          {analytics?.communities && (
            <View style={styles.statBox}>
              <Text style={[styles.statVal, { color: colors.ac4 }]}>{analytics.communities.count}</Text>
              <Text style={styles.statLabel}>Clusters</Text>
            </View>
          )}
        </View>
      )}

      {/* Analytics: Top entities */}
      {analytics?.pagerank && (
        <>
          <Text style={[styles.sectionH, { marginTop: 16 }]}>Top Entities (PageRank)</Text>
          {analytics.pagerank.slice(0, 10).map((pr: any, i: number) => (
            <View key={i} style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{pr.label || pr.entity_id}</Text>
                <Text style={{ fontSize: 12, color: colors.ac1, fontWeight: '600' }}>
                  {(pr.score * 100).toFixed(1)}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}

      {/* Bridge entities */}
      {analytics?.bridges && analytics.bridges.length > 0 && (
        <>
          <Text style={[styles.sectionH, { marginTop: 16 }]}>Bridge Entities</Text>
          {analytics.bridges.map((b: any, i: number) => (
            <View key={i} style={[styles.card, { borderColor: colors.ac3 }]}>
              <Text style={styles.cardTitle}>{b.from_label} -- {b.to_label}</Text>
              <Text style={{ fontSize: 11, color: colors.tx2 }}>Removing this edge disconnects the graph</Text>
            </View>
          ))}
        </>
      )}

      {/* Node list by type */}
      {nodes.length > 0 && (
        <>
          <Text style={[styles.sectionH, { marginTop: 16 }]}>All Entities</Text>
          {nodes.map((n: any, i: number) => (
            <View key={i} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: TYPE_COLORS[n.type] || colors.tx2,
                  }}
                />
                <Text style={styles.cardTitle} numberOfLines={1}>{n.label || n.value}</Text>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{n.type}</Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}
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
    marginBottom: 12,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.bg3,
  },
  statsRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg3,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center' as const,
  },
  statVal: {
    fontSize: 22,
    fontWeight: '700' as const,
  },
  statLabel: {
    fontSize: 10,
    color: colors.tx2,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg3,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: {
    fontWeight: '600' as const,
    fontSize: 14,
    color: colors.tx0,
    flex: 1,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.acGlow,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '500' as const,
    color: colors.ac1,
  },
};
