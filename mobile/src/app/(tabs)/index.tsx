import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Linking, Alert,
} from 'react-native';
import { Search, ExternalLink, Fingerprint, Globe, Mail, Phone, Cpu } from 'lucide-react-native';
import { useDTLStore } from '@/lib/store';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

const SCAN_TYPES = [
  { key: 'auto', label: 'Auto', icon: Cpu },
  { key: 'username', label: 'Username', icon: Fingerprint },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'domain', label: 'Domain', icon: Globe },
  { key: 'ip', label: 'IP', icon: Globe },
  { key: 'phone', label: 'Phone', icon: Phone },
];

const PLACEHOLDERS: Record<string, string> = {
  auto: 'Enter target...',
  username: 'johndoe',
  email: 'john@example.com',
  domain: 'example.com',
  ip: '8.8.8.8',
  phone: '+15125551234',
};

export default function ScanScreen() {
  const [query, setQuery] = useState('');
  const [allSites, setAllSites] = useState(false);
  const scanType = useDTLStore((s) => s.scanType);
  const setScanType = useDTLStore((s) => s.setScanType);
  const scanning = useDTLStore((s) => s.scanning);
  const setScanning = useDTLStore((s) => s.setScanning);
  const lastResult = useDTLStore((s) => s.lastResult);
  const setLastResult = useDTLStore((s) => s.setLastResult);
  const backendUrl = useDTLStore((s) => s.backendUrl);

  const doScan = useCallback(async () => {
    const q = query.trim();
    if (!q) return Alert.alert('Enter a target');
    if (!backendUrl) return Alert.alert('Set backend URL in Settings');

    setScanning(true);
    setLastResult(null);
    try {
      let type = scanType;
      if (type === 'auto') {
        const det = await api.detectType(q);
        type = det.type || 'username';
      }

      if (type === 'username') {
        const result = await api.scanMaigret(q, allSites);
        setLastResult(result);
      } else {
        const result = await api.scanGeneral(q, type);
        setLastResult(result);
      }
    } catch (e: any) {
      Alert.alert('Scan Error', e.message);
    } finally {
      setScanning(false);
    }
  }, [query, scanType, allSites, backendUrl]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Section: Target Input */}
      <Text style={styles.sectionH}>Target Input</Text>

      {/* Scan type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        {SCAN_TYPES.map((t) => {
          const active = scanType === t.key;
          const Icon = t.icon;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setScanType(t.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Icon size={13} color={active ? colors.ac1 : colors.tx2} />
              <Text style={[styles.chipText, active && { color: colors.ac1 }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={PLACEHOLDERS[scanType] || 'Enter target...'}
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={doScan}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.scanBtn} onPress={doScan} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator size="small" color={colors.bg0} />
          ) : (
            <Search size={18} color={colors.bg0} />
          )}
        </TouchableOpacity>
      </View>

      {/* Username options */}
      {(scanType === 'username' || scanType === 'auto') && (
        <TouchableOpacity
          style={styles.optRow}
          onPress={() => setAllSites(!allSites)}
        >
          <View style={[styles.checkbox, allSites && styles.checkboxOn]} />
          <Text style={styles.optLabel}>Scan all 3000+ sites</Text>
        </TouchableOpacity>
      )}

      {/* Loading */}
      {scanning && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.ac1} />
          <Text style={{ color: colors.tx1, marginTop: 10, fontSize: 13 }}>
            Scanning {query}...
          </Text>
        </View>
      )}

      {/* Results */}
      {lastResult && !scanning && <ResultsView result={lastResult} />}
    </ScrollView>
  );
}

function ResultsView({ result }: { result: any }) {
  const isMaigret = result.engine === 'maigret' || result.found !== undefined;

  if (isMaigret) return <MaigretResults r={result} />;
  return <GeneralResults r={result} />;
}

function MaigretResults({ r }: { r: any }) {
  const ids = r.extracted_ids || {};
  const idKeys = Object.keys(ids);
  const byTag = r.found_by_tag || {};
  const tagOrder = Object.entries(byTag).sort((a: any, b: any) => b[1].length - a[1].length);

  return (
    <View style={{ marginTop: 16 }}>
      {/* Stats */}
      <View style={styles.statsRow}>
        <StatBox value={r.found_count} label="Found" color={colors.ac4} />
        <StatBox value={r.total_checked} label="Checked" color={colors.ac1} />
        <StatBox value={r.error_count} label="Errors" color={colors.ac3} />
      </View>

      {/* Extracted IDs */}
      {idKeys.length > 0 && (
        <View style={[styles.card, { borderColor: colors.ac2 }]}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Extracted Identities</Text>
            <View style={[styles.tag, { backgroundColor: 'rgba(124,77,255,0.2)' }]}>
              <Text style={[styles.tagText, { color: colors.ac2 }]}>{idKeys.length} types</Text>
            </View>
          </View>
          <View style={styles.idRow}>
            {Object.entries(ids).map(([k, v]: any) => {
              const vals = Array.isArray(v) ? v : [v];
              return vals.filter(Boolean).map((val: any, i: number) => (
                <View key={`${k}-${i}`} style={styles.idBadge}>
                  <Text style={styles.idText}>{k}: {String(val)}</Text>
                </View>
              ));
            })}
          </View>
        </View>
      )}

      {/* Found by tag */}
      {tagOrder.map(([tag, profiles]: any) => (
        <View key={tag}>
          <Text style={[styles.sectionH, { marginTop: 16 }]}>
            {tag} ({profiles.length})
          </Text>
          {profiles.map((p: any, i: number) => (
            <TouchableOpacity
              key={i}
              style={styles.card}
              onPress={() => p.url && Linking.openURL(p.url)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{p.site_name}</Text>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ExternalLink size={11} color={colors.ac1} />
                <Text style={styles.urlText} numberOfLines={1}>{p.url}</Text>
              </View>
              {p.ids && Object.keys(p.ids).length > 0 && (
                <View style={[styles.idRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.bg3 }]}>
                  {Object.entries(p.ids).map(([ik, iv]: any) => (
                    <View key={ik} style={styles.idBadge}>
                      <Text style={styles.idText}>{ik}: {iv}</Text>
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ))}

      {r.found_count === 0 && (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, color: colors.tx2 }}>0</Text>
          <Text style={{ color: colors.tx2, marginTop: 8 }}>No profiles found</Text>
        </View>
      )}
    </View>
  );
}

function GeneralResults({ r }: { r: any }) {
  const risk = r.risk_score || 0;
  const riskColor = risk > 60 ? colors.ac3 : risk > 30 ? colors.ac1 : colors.ac4;
  const ents = r.discovered_entities || [];

  return (
    <View style={{ marginTop: 16 }}>
      <View style={styles.statsRow}>
        <StatBox value={risk} label="Risk" color={riskColor} />
        <StatBox value={r.entity_type || r.type || '--'} label="Type" color={colors.ac1} />
        <StatBox value={ents.length} label="Entities" color={colors.ac4} />
      </View>

      {Object.entries(r.modules || {}).map(([modName, modData]: any) => (
        <View key={modName} style={styles.card}>
          <Text style={styles.cardTitle}>{modName}</Text>
          <Text style={styles.preText} numberOfLines={12}>
            {JSON.stringify(modData, null, 2)}
          </Text>
        </View>
      ))}

      {ents.length > 0 && (
        <>
          <Text style={[styles.sectionH, { marginTop: 16 }]}>Discovered Entities</Text>
          {ents.map((e: any, i: number) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle} numberOfLines={1}>{e.value}</Text>
                <View style={styles.tag}><Text style={styles.tagText}>{e.type}</Text></View>
              </View>
              <Text style={{ fontSize: 11, color: colors.tx2 }}>
                {e.relationship} | {((e.confidence || 0) * 100).toFixed(0)}%
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function StatBox({ value, label, color }: { value: any; label: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statVal, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.bg3,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: colors.acGlow,
    borderColor: colors.ac1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.tx1,
  },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.tx0,
    fontSize: 15,
  },
  scanBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.ac1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginLeft: 8,
  },
  optRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 16,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.bg4,
    backgroundColor: colors.bg2,
  },
  checkboxOn: {
    backgroundColor: colors.ac1,
    borderColor: colors.ac1,
  },
  optLabel: {
    fontSize: 13,
    color: colors.tx1,
  },
  loadingBox: {
    alignItems: 'center' as const,
    paddingVertical: 40,
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
  cardHead: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 6,
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
  urlText: {
    fontSize: 12,
    color: colors.ac1,
  },
  idRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  idBadge: {
    backgroundColor: colors.bg3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  idText: {
    fontSize: 11,
    color: colors.tx1,
  },
  preText: {
    fontSize: 11,
    color: colors.tx1,
    marginTop: 6,
  },
  empty: {
    alignItems: 'center' as const,
    paddingVertical: 40,
  },
};
