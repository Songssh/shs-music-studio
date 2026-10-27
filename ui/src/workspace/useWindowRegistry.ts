import { useAuth } from '../context/AuthContext';
import { useStudioAvailable } from '../components/sidebar/Sidebar';
import { WINDOWS } from './registry';
export function useWindowRegistry() {
  const {user}=useAuth();const available=useStudioAvailable();
  return WINDOWS.filter(w=>(w[0]!=='terminal'||user?.role==='admin')&&available(w[0]));
}
