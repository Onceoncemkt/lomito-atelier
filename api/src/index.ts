import "dotenv/config";
import { createApp } from "./app.js";
import { startReminderLoop } from "./lib/reminders.js";

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => {
  console.log(`Lomito Atelier API escuchando en :${port}`);
});
startReminderLoop();
