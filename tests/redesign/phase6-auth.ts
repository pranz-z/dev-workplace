import { useAuth as ownerAuth } from './fixtures';
export const useAuth = () => window.matrixConfiguration.contextOptions?.anonymous
  ? { status: 'unauthenticated' as const, user: null, configured: true }
  : ownerAuth();
