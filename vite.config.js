import { defineConfig } from "vite";

export default defineConfig({
  base: "/obr-joystick/", // = Name deines GitHub-Repos
  server: {
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  }, 
});