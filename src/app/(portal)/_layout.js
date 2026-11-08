import { Redirect, Slot } from 'expo-router';
import { useSession } from '../../use-session';
import PortalShell from '../../components/PortalShell';

export default function PortalLayout() {
  const { empleado, checking, session_error } = useSession();
  if (checking || session_error || !empleado) return <Redirect href="/" />;
  return <PortalShell><Slot /></PortalShell>;
}
