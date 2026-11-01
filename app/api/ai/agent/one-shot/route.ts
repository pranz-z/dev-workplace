import {handleOneShot} from '@/lib/ai/agent/pulse/one-shot-routes';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=handleOneShot;
export const POST=handleOneShot;
