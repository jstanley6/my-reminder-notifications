import { serve } from "@std/http";
import { createClient } from "@supabase/supabase-js";
import { GoogleAuth } from "google-auth-library";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }



  try {
    const supabase = createClient(
      Deno.env.get("PROJECT_URL")!,
      Deno.env.get("SERVICE_ROLE")!
    );

    const { reminder_id, user_id } = await req.json();

    if (!reminder_id || !user_id) {
      return new Response(JSON.stringify({ error: "Missing reminder_id or user_id" }), { status: 400 });
    }

    // 1. Fetch reminder details
    const { data: reminder, error: reminderError } = await supabase
      .from("reminders")
      .select("*")
      .eq("id", reminder_id)
      .eq("user_id", user_id)
      .single();

    if (reminderError || !reminder) {
      return new Response(JSON.stringify({ error: reminderError?.message ?? "Reminder not found" }), { status: 404 });
    }

    // 2. Fetch user’s push tokens
    const { data: tokens, error: tokenError } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", user_id);

    if (tokenError) {
      return new Response(JSON.stringify({ error: tokenError.message }), { status: 400 });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ reminder, message: "No push tokens found" }), { status: 200 });
    }

    // 3. Prepare FCM client (HTTP v1 API)
    const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    const client = await auth.getClient();
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    // 4. Send push notification
    for (const t of tokens) {
      await client.request({
        url,
        method: "POST",
        data: {
          message: {
            token: t.token,
            notification: {
              title: reminder.title ?? "Reminder",
              body: reminder.content ?? "You have a scheduled reminder.",
            },
            data: {
              reminder_id: reminder.id,
              status: "delivered",
            },
          },
        },
      });
    }

    // 5. Update reminder with delivered_at timestamp
    await supabase
      .from("reminders")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", reminder_id);

    return new Response(JSON.stringify({ reminder, pushSent: true }), { status: 200 });
  } catch (err) {
    console.error("Unexpected error:", err);
 
  }
     return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    })
});

