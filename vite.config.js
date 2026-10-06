import { defineConfig } from "vite";
export default defineConfig({
  base: "/obr-joystick/", 
  server: {
    cors: true,
    headers: { 
      "Access-Control-Allow-Origin": "*" 
    },
  },
});
