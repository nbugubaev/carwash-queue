import { createClient } from '@supabase/supabase-js';

// Get credentials from environment variables or localStorage
export const getSupabaseConfig = () => {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  
  const localUrl = localStorage.getItem('supabase_url');
  const localKey = localStorage.getItem('supabase_anon_key');
  
  return {
    supabaseUrl: envUrl || localUrl || '',
    supabaseAnonKey: envKey || localKey || '',
    isConfigured: !!(envUrl || localUrl) && !!(envKey || localKey)
  };
};

let supabaseInstance = null;

export const getSupabase = () => {
  const { supabaseUrl, supabaseAnonKey, isConfigured } = getSupabaseConfig();
  
  if (!isConfigured) {
    return null;
  }
  
  // Re-create instance if credentials changed or if it doesn't exist
  if (!supabaseInstance || 
      supabaseInstance.supabaseUrl !== supabaseUrl || 
      supabaseInstance.supabaseKey !== supabaseAnonKey) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
    // Attach properties for comparison later
    supabaseInstance.supabaseUrl = supabaseUrl;
    supabaseInstance.supabaseKey = supabaseAnonKey;
  }
  
  return supabaseInstance;
};

export const saveSupabaseConfig = (url, key) => {
  if (url) localStorage.setItem('supabase_url', url);
  else localStorage.removeItem('supabase_url');
  
  if (key) localStorage.setItem('supabase_anon_key', key);
  else localStorage.removeItem('supabase_anon_key');
  
  // Reset instance to force recreation with new credentials
  supabaseInstance = null;
};
