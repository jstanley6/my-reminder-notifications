// supabase/functions/check-reminders/index.ts
import { serve } from "@std/http"
import { createClient } from "@supabase/supabase-js"

serve(async () => {
  const supabase = createClient(Deno.env.get("PROJECT_URL")!, Deno.env.get("SERVICE_ROLE")!)
  const now = new Date().toISOString()

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, user_id")
    .eq("status", "pending")
    .is("delivered_at", null)
    .lte("scheduled_time", now)

  if (!reminders || reminders.length === 0) return new Response("No due reminders")

  for (const r of reminders) {
    await fetch(`${Deno.env.get("PROJECT_URL")}/functions/v1/send-web-reminder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SERVICE_ROLE")}`
      },
      body: JSON.stringify({ reminder_id: r.id, user_id: r.user_id })
    })
  }

  return new Response(`Triggered ${reminders.length} reminders`)
})