import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SchedulerInput { version: 1; scheduledSlot: string; issuedAt: number; nonce: string }
export class SchedulerRequestError extends Error {
  constructor(public readonly code: 'INVALID_REQUEST' | 'AUTHENTICATION_FAILED') { super(code); }
}
const invalid: () => never = () => { throw new SchedulerRequestError('INVALID_REQUEST'); };
const unauthenticated: () => never = () => { throw new SchedulerRequestError('AUTHENTICATION_FAILED'); };
const PATH = '/api/internal/agent/pulse', BODY_LIMIT = 1024, SLOT_MS = 14_400_000;

export function schedulerSigningText(input: SchedulerInput): string {
  return [input.version,'POST',PATH,input.scheduledSlot,input.issuedAt,input.nonce].join('\n');
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) invalid();
  const reader = request.body.getReader(), bytes = new Uint8Array(BODY_LIMIT);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > BODY_LIMIT - length) {
        void reader.cancel().catch(() => undefined);
        invalid();
      }
      bytes.set(value,length); length += value.byteLength;
    }
    if (length === 0) invalid();
    // Preserve any BOM so the strict JSON grammar rejects it rather than normalizing it away.
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,length));
  } catch { return invalid(); }
  finally { reader.releaseLock(); }
}

/** Fixed flat-object token reader. JSON.parse decodes primitive tokens only, never an object. */
function fields(body: string): Map<string, unknown> {
  let at = 0;
  const values = new Map<string, unknown>(), keys = ['version','scheduledSlot','issuedAt','nonce'];
  const whitespace = () => { while (at < body.length && /[ \t\r\n]/.test(body[at])) at++; };
  function take(character: string) { whitespace(); if (body[at++] !== character) invalid(); }
  function string(): string {
    whitespace();
    const token = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(body.slice(at));
    if (!token) invalid();
    at += token[0].length;
    return JSON.parse(token[0]) as string;
  }
  take('{'); whitespace();
  if (body[at] !== '}') for (;;) {
    const key = string();
    if (!keys.includes(key) || values.has(key)) invalid();
    take(':'); whitespace();
    let value: unknown;
    if (body[at] === '"') value = string();
    else {
      const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(body.slice(at));
      if (!token) invalid();
      at += token[0].length; value = JSON.parse(token[0]);
    }
    values.set(key,value); whitespace();
    if (body[at] !== ',') break;
    at++;
  }
  take('}'); whitespace();
  if (at !== body.length || values.size !== 4) invalid();
  return values;
}

export async function parseSchedulerRequest(request: Request, secret: string, now: number): Promise<SchedulerInput> {
  try {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== PATH || url.search || url.hash) invalid();
    const parsed = fields(await readBody(request));
    const version = parsed.get('version'), scheduledSlot = parsed.get('scheduledSlot'), issuedAt = parsed.get('issuedAt'), nonce = parsed.get('nonce');
    if (version !== 1 || typeof scheduledSlot !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(scheduledSlot) ||
      !Number.isFinite(Date.parse(scheduledSlot)) || new Date(scheduledSlot).toISOString() !== scheduledSlot ||
      typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) ||
      typeof nonce !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce)) invalid();
    const input: SchedulerInput = {version,scheduledSlot,issuedAt,nonce};
    // Bounded opaque server key: printable non-whitespace ASCII, at least 32 characters.
    if (typeof secret !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(secret)) unauthenticated();
    const signature = request.headers.get('X-Agent-Pulse-Signature');
    if (!signature || !/^[0-9a-f]{64}$/.test(signature)) unauthenticated();
    const supplied = Buffer.from(signature,'hex'), expected = createHmac('sha256',secret).update(schedulerSigningText(input),'utf8').digest();
    if (!timingSafeEqual(supplied,expected)) unauthenticated();
    if (!Number.isSafeInteger(now) || now < 0) invalid();
    const seconds = Math.floor(now / 1000);
    if (seconds - issuedAt > 600 || issuedAt - seconds > 60 || new Date(Math.floor(now / SLOT_MS) * SLOT_MS).toISOString() !== scheduledSlot) invalid();
    return input;
  } catch (error) {
    if (error instanceof SchedulerRequestError) throw error;
    return invalid();
  }
}
