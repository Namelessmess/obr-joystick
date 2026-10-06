import { defineConfig } from "vite";
const headers = { "Access-Control-Allow-Origin": "*" }; // Owlbear lädt die Extension per iframe/fetch
export default defineConfig({
  server: { port: 5173, cors: true, headers },
  preview: { port: 4173, cors: true, headers },
});
