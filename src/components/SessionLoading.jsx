import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function SessionLoading() {
  return (
    <View style={styles.page} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color="#2563eb" />
      <Text style={styles.label}>Comprobando sesión…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#f5f8ff' },
  label: { color: '#64748b', fontSize: 14 },
});
