import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mczecifjqmhbgjkxqsna.supabase.co/",
  "sb_publishable_SECzKp7tX5HyCEtUgCRzUA_LHOMDTP1"
);

const email = "test@tenderbot.app";
const password = "123456";

const run = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Login failed:", error.message);
    return;
  }

  console.log("ACCESS TOKEN (JWT):");
  console.log(data.session.access_token);
};

run();
