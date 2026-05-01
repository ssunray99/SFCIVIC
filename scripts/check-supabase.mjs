// Quick sanity-check: verifies SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are correct.
// Run with: node --env-file=.env.local scripts/check-supabase.mjs
import { createClient } from "@supabase/supabase-js";

const c = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { error } = await c.from("_does_not_exist").select("*").limit(1);

if (error?.code === "PGRST205" || error?.message?.includes("does not exist")) {
  console.log("✅ Connected. (Expected error: table does not exist — schema not applied yet.)");
} else if (error) {
  console.log("❌", error.message);
} else {
  console.log("⚠️  Unexpected — did you create a table named _does_not_exist?");
}
