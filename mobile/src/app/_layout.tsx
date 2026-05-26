import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useDTLStore } from '@/lib/store';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  const loadPersistedState = useDTLStore((s) => s.loadPersistedState);
  const setConnected = useDTLStore((s) => s.setConnected);
  const setMaigretStats = useDTLStore((s) => s.setMaigretStats);
  const backendUrl = useDTLStore((s) => s.backendUrl);

  useEffect(() => {
    loadPersistedState();
  }, []);

  useEffect(() => {
    if (!backendUrl) return;
    const check = async () => {
      const ok = await api.checkConnection();
      setConnected(ok);
      if (ok) {
        try {
          const stats = await api.getMaigretStats();
          setMaigretStats(stats);
        } catch {}
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg0 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg0 },
          animation: 'fade',
        }}
      />
    </View>
  );
}
