// supabase/functions/complete-reminder/index.ts
import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";
import { GoogleAuth } from "google-auth-library";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  console.log(`[complete-reminder] requestId=${requestId} method=${req.method}`);

  try {
    const supabase = createClient(Deno.env.get("PROJECT_URL")!, Deno.env.get("SERVICE_ROLE")!);
    const { reminder_id, user_id } = await req.json();

    if (!reminder_id || !user_id) {
      console.warn(`[complete-reminder:${requestId}] Missing fields`, { reminder_id, user_id });
      return fail("Missing reminder_id or user_id", 400);
    }

    const { data: updated, error } = await supabase
      .from("reminders")
      .update({ is_completed: true, completed_at: new Date().toISOString() })
      .eq("id", reminder_id)
      .eq("user_id", user_id)
      .select()
      .single();

    if (error || !updated) {
      console.warn(`[complete-reminder:${requestId}] Update failed`, error);
      return fail(error?.message ?? "Reminder not found", 400);
    }
    console.log(`[complete-reminder:${requestId}] Reminder completed id=${updated.id}`);

    const { data: tokens, error: tokenError } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", user_id);

    if (tokenError) {
      console.error(`[complete-reminder:${requestId}] Token query error`, tokenError);
      return fail(tokenError.message, 400);
    }

    if (!tokens || tokens.length === 0) {
      console.log(`[complete-reminder:${requestId}] No FCM tokens for user=${user_id}`);
      return ok({ updated, mobilePushSent: false, message: "No push tokens found" }, 200);
    }

    const serviceAccountRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!serviceAccountRaw) {
      console.error(`[complete-reminder:${requestId}] Missing FIREBASE_SERVICE_ACCOUNT env`);
      return fail("Server missing FIREBASE_SERVICE_ACCOUNT", 500);
    }
    const serviceAccount = JSON.parse(serviceAccountRaw);

    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    let sentCount = 0;
    for (const t of tokens) {
      try {
        console.log(`[complete-reminder:${requestId}] Sending FCM to token=${t.token?.slice(0, 12)}...`);
        await client.request({
          url,
          method: "POST",
          data: {
            message: {
              token: t.token,
              notification: {
                title: "Reminder Completed",
                body: `Your reminder "${updated.title}" has been marked complete.`,
              },
              data: { reminder_id: String(updated.id), status: "completed" },
            },
          },
        });
        sentCount++;
      } catch (pushErr) {
        console.error(`[complete-reminder:${requestId}] FCM send error`, pushErr);
      }
    }

    console.log(`[complete-reminder:${requestId}] mobilePushSent=${sentCount} tokens=${tokens.length}`);
    return ok({ success: true, updated, mobilePushSent: sentCount > 0, sentCount }, 200);
  } catch (err) {
    console.error(`[complete-reminder:${requestId}] Unexpected error`, err);
    return fail(err instanceof Error ? err.message : "Unknown error", 500);
  }
});