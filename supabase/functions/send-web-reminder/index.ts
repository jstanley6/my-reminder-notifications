import { serve } from "@std/http"
import { createClient } from "@supabase/supabase-js"
import webpush from "web-push"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
}

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}
function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders })
}

webpush.setVapidDetails(
  "mailto:jasonstanl3y@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const requestId = crypto.randomUUID()
  console.log(`[send-web-reminder] requestId=${requestId} method=${req.method}`)

  try {
    const supabase = createClient(Deno.env.get("PROJECT_URL")!, Deno.env.get("SERVICE_ROLE")!)
    const { reminder_id, user_id } = await req.json()

    if (!reminder_id || !user_id) {
      console.warn(`[send-web-reminder:${requestId}] Missing fields`, { reminder_id, user_id })
      return fail("Missing reminder_id or user_id", 400)
    }

    const { data: reminder, error: reminderError } = await supabase
      .from("reminders")
      .select("*")
      .eq("id", reminder_id)
      .eq("user_id", user_id)
      .single()

    if (reminderError || !reminder) {
      console.warn(`[send-web-reminder:${requestId}] Reminder fetch failed`, reminderError)
      return fail(reminderError?.message ?? "Reminder not found", 404)
    }

    const { data: subs, error: subError } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("user_id", user_id)

    if (subError) {
      console.error(`[send-web-reminder:${requestId}] Subscription query error`, subError)
      return fail(subError.message, 400)
    }

    if (!subs || subs.length === 0) {
      console.log(`[send-web-reminder:${requestId}] No subscriptions for user=${user_id}`)
      return ok({ reminder, pushSent: false, message: "No subscriptions found" }, 200)
    }

    let sentCount = 0
    for (const s of subs) {
      try {
        const subscription =
          typeof s.subscription === "string" ? JSON.parse(s.subscription) : s.subscription

        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: reminder.title ?? "Reminder",
            body: reminder.content ?? "You have a scheduled reminder."
          })
        )
        sentCount++
      } catch (err: any) {
        console.error(`[send-web-reminder:${requestId}] Push send error`, err)
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("user_id", user_id)
            .eq("subscription->>endpoint", s.subscription.endpoint)
        }
      }
    }

    await supabase
      .from("reminders")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", reminder_id)

    console.log(`[send-web-reminder:${requestId}] pushSent=${sentCount} subscriptions=${subs.length}`)
    return ok({ reminder, pushSent: sentCount > 0, sentCount }, 200)
  } catch (err) {
    console.error(`[send-web-reminder:${requestId}] Unexpected error`, err)
    return fail(err instanceof Error ? err.message : "Unknown error", 500)
  }
})