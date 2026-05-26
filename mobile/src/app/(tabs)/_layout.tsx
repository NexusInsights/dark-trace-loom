import { Tabs } from 'expo-router';
import React from 'react';
import { View, Text } from 'react-native';
import { Search, GitFork, FolderOpen, Settings } from 'lucide-react-native';
import { useDTLStore } from '@/lib/store';
import { colors } from '@/lib/theme';

function Header() {
  const connected = useDTLStore((s) => s.connected);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 56,
        paddingBottom: 10,
        backgroundColor: colors.bg1,
        borderBottomWidth: 1,
        borderBottomColor: colors.bg3,
      }}
    >
      <Text style={{ fontWeight: '700', fontSize: 18, color: colors.tx0, letterSpacing: 1 }}>
        DTL<Text style={{ color: colors.ac1 }}>.</Text>
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: connected ? colors.ac4 : colors.ac3,
          }}
        />
        <Text style={{ fontSize: 11, color: colors.tx2 }}>
          {connected ? 'connected' : 'offline'}
        </Text>
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg0 }}>
      <Header />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bg1,
            borderTopColor: colors.bg3,
            borderTopWidth: 1,
            height: 64,
            paddingBottom: 8,
            paddingTop: 6,
          },
          tabBarActiveTintColor: colors.ac1,
          tabBarInactiveTintColor: colors.tx2,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '500',
          },
          sceneStyle: { backgroundColor: colors.bg0 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="graph"
          options={{
            title: 'Graph',
            tabBarIcon: ({ color, size }) => <GitFork size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="cases"
          options={{
            title: 'Cases',
            tabBarIcon: ({ color, size }) => <FolderOpen size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}
