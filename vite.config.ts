import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY");
    }
    if (new URL(env.VITE_SUPABASE_URL).protocol !== "https:") {
      throw new Error("Supabase URL must use HTTPS");
    }
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!key.startsWith("sb_publishable_")) {
      let role: string;
      try {
        role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role;
      } catch {
        throw new Error("Supabase frontend key must be a publishable key or anon JWT");
      }
      if (role !== "anon") throw new Error("Refusing to include a privileged Supabase key in the frontend");
    }
  }
  return ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  });
});
