import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../use-session';

export default function RootLayout() {
  return <SafeAreaProvider><SessionProvider><Slot /></SessionProvider></SafeAreaProvider>;
}
