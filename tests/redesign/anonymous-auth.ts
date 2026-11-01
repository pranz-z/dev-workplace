// Addendum-only auth boundary. Never imported by shipped code.
const identity = { status: 'unauthenticated' as const, user: null, configured: true };
declare global { interface Window { addendumAuth: typeof identity } }
window.addendumAuth = identity;
export const useAuth = () => identity;
