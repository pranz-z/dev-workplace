import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AiError } from "@/lib/ai/errors";

export async function requireAuthenticatedAiUser(supabase: SupabaseClient | null): Promise<User> {
  if (!supabase) throw new AiError("AI_NOT_CONFIGURED");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AiError("UNAUTHENTICATED");
  return user;
}
