import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Save, Wifi, WifiOff } from 'lucide-react-native';
import { useDTLStore } from '@/lib/store';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function SettingsScreen() {
  const backendUrl = useDTLStore((s) => s.backendUrl);
  const apiKeys = useDTLStore((s) => s.apiKeys);
  const connected = useDTLStore((s) => s.connected);
  const setBackendUrl = useDTLStore((s) => s.setBackendUrl);
  const setApiKey = useDTLStore((s) => s.setApiKey);
  const setConnected = useDTLStore((s) => s.setConnected);
  const maigretStats = useDTLStore((s) => s.maigretStats);
  const setMaigretStats = useDTLStore((s) => s.setMaigretStats);

  const [url, setUrl] = useState(backendUrl);
  const [anthropic, setAnthropic] = useState(apiKeys.anthropic || '');
  const [hunter, setHunter] = useState(apiKeys.hunter || '');
  const [vt, setVt] = useState(apiKeys.virustotal || '');
  const [saving, setSaving] = useState(false);
  const [entityCount, setEntityCount] = useState<number | null>(null);

  useEffect(() => {
    setUrl(backendUrl);
    setAnthropic(apiKeys.anthropic || '');
    setHunter(apiKeys.hunter || '');
    setVt(apiKeys.virustotal || '');
  }, [backendUrl, apiKeys]);

  useEffect(() => {
    if (!connected) return;
    (async () => {
      try {
        const stats = await api.getStats();
        setEntityCount(stats.entities || 0);
      } catch {}
      try {
        const ms = await api.getMaigretStats();
        setMaigretStats(ms);
      } catch {}
    })();
  }, [connected]);

  const save = useCallback(async () => {
    setSaving(true);
    setBackendUrl(url.trim());
    if (anthropic) setApiKey('anthropic', anthropic.trim());
    if (hunter) setApiKey('hunter', hunter.trim());
    if (vt) setApiKey('virustotal', vt.trim());

    // Check connection
    try {
      const ok = await api.checkConnection();
      setConnected(ok);
      if (ok) {
        // Push keys to backend
        const keys = { anthropic, hunter, virustotal: vt };
        for (const [name, val] of Object.entries(keys)) {
          if (val.trim()) {
            try { await api.pushApiKey(name, val.trim()); } catch {}
          }
        }
        Alert.alert('Saved', 'Settings saved and synced with backend.');
      } else {
        Alert.alert('Saved Locally', 'Settings saved. Backend not reachable.');
      }
    } catch {
      Alert.alert('Saved Locally', 'Settings saved. Could not reach backend.');
    }
    setSaving(false);
  }, [url, anthropic, hunter, vt]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Connection status */}
      <View style={[styles.statusBar, { borderColor: connected ? colors.ac4 : colors.ac3 }]}>
        {connected ? <Wifi size={16} color={colors.ac4} /> : <WifiOff size={16} color={colors.ac3} />}
        <Text style={{ color: connected ? colors.ac4 : colors.ac3, fontSize: 13, fontWeight: '500' }}>
          {connected ? 'Backend Connected' : 'Backend Offline'}
        </Text>
      </View>

      {/* Backend URL */}
      <Text style={styles.sectionH}>Connection</Text>
      <View style={styles.group}>
        <Text style={styles.label}>Backend URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.1.x:8900"
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </View>

      {/* API Keys */}
      <Text style={styles.sectionH}>API Keys</Text>
      <View style={styles.group}>
        <Text style={styles.label}>Anthropic (AI Analysis)</Text>
        <TextInput
          style={styles.input}
          value={anthropic}
          onChangeText={setAnthropic}
          placeholder="sk-ant-..."
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          secureTextEntry
        />
      </View>
      <View style={styles.group}>
        <Text style={styles.label}>Hunter.io (Email)</Text>
        <TextInput
          style={styles.input}
          value={hunter}
          onChangeText={setHunter}
          placeholder="API key"
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          secureTextEntry
        />
      </View>
      <View style={styles.group}>
        <Text style={styles.label}>VirusTotal (Domain/IP)</Text>
        <TextInput
          style={styles.input}
          value={vt}
          onChangeText={setVt}
          placeholder="API key"
          placeholderTextColor={colors.tx2}
          autoCapitalize="none"
          secureTextEntry
        />
      </View>

      {/* Save button */}
      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
        {saving ? (
          <ActivityIndicator size="small" color={colors.bg0} />
        ) : (
          <>
            <Save size={16} color={colors.bg0} />
            <Text style={styles.saveBtnText}>Save Settings</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Platform info */}
      <Text style={[styles.sectionH, { marginTop: 24 }]}>Platform Info</Text>
      <InfoRow label="Engine" value={maigretStats ? `maigret v${maigretStats.version}` : '--'} />
      <InfoRow label="Total Sites" value={maigretStats?.total_sites?.toString() || '--'} />
      <InfoRow label="Default Scan" value={maigretStats?.default_scan_sites?.toString() || '--'} />
      <InfoRow label="Tags" value={maigretStats ? Object.keys(maigretStats.tags).length.toString() : '--'} />
      <InfoRow label="Entities" value={entityCount?.toString() || '--'} />
      <InfoRow label="App Version" value="Expo PWA 1.0" />
      <InfoRow label="Platform" value="Dark Trace Loom" />
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={{ fontSize: 14, color: colors.tx0 }}>{label}</Text>
      <Text style={{ fontSize: 12, color: colors.tx2 }}>{value}</Text>
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
  statusBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: colors.bg2,
    marginBottom: 20,
  },
  group: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    color: colors.tx2,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg3,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.tx0,
    fontSize: 14,
  },
  saveBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: colors.ac1,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  saveBtnText: {
    color: colors.bg0,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  infoRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
};
