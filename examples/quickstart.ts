/**
 * End-to-end smoke run of the v1 core surface.
 * Run with: CURVET_APP_KEY=cvt_app_xxx npx tsx examples/quickstart.ts
 */
import { Curvet } from "../src";

async function main() {
  const curvet = new Curvet({ appKey: process.env.CURVET_APP_KEY });

  const chatModels = await curvet.models.list({ type: "chat" });
  console.log("Chat models:", chatModels.map((m) => m.id).join(", "));

  console.log("Balance:", await curvet.balance.get());

  const chat = await curvet.chat.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
    maxTokens: 20,
  });
  console.log("Chat:", chat.response);

  const image = await curvet.image.generate({
    model: "flux-2-klein-4b",
    prompt: "a red cube on a white background, product photo",
    size: "1024x1024",
  });
  console.log("Image:", image.imageUrl);

  const video = await curvet.video.generate(
    { model: "wan-2.2", prompt: "a calm ocean wave at sunset, cinematic" },
    { onProgress: (p) => console.log(`  video progress: ${p}%`) },
  );
  console.log("Video:", video.mediaUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
