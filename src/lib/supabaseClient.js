import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mjjxqhgxoafgjhyukvpm.supabase.co";
const supabaseAnonKey = "sb_publishable_1X5_siKrWjAwu-hxI_T8rw_Cmgbsm9q";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);