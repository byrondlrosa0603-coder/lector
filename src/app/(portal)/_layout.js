import { Redirect, Slot } from 'expo-router';
import { Platform } from 'react-native';
import { useSession } from '../../use-session';
import PortalShell from '../../components/PortalShell';
import SessionLoading from '../../components/SessionLoading';

export default function PortalLayout() {
  const { empleado, checking, session_error } = useSession();
  if (Platform.OS === 'web' && checking) return <SessionLoading />;
  if (checking || session_error || !empleado) return <Redirect href="/" />;
  return <PortalShell><Slot /></PortalShell>;
}
