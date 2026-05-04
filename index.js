import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
import express from "express";
import line from "@line/bot-sdk";

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};
const client = new line.Client(config);
const app = express();

// ❌ express.json() をここに置くと署名検証が壊れる
// app.use(express.json());

app.get("/test-supabase", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .limit(1);

  res.json({ data, error });
});

app.post("/webhook", line.middleware(config), (req, res) => {
  console.log("=== WEBHOOK RECEIVED ===");
  console.log("body:", JSON.stringify(req.body, null, 2));

  Promise.all(req.body.events.map(async (event) => {
    console.log("=== EVENT RECEIVED ===");
    console.log("type:", event.type);

    if (event.type === "message" && event.message.type === "text") {
      console.log("message:", event.message.text);

      const client = new line.Client(config);

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `あなたは「${event.message.text}」と送りましたね。`
      })
      .then(() => {
        console.log("=== REPLY SENT ===");
      })
      .catch((err) => {
        console.error("=== REPLY ERROR ===", err);
      });
    }
  }))
  .then(() => res.sendStatus(200))
  .catch((err) => {
    console.error("=== WEBHOOK ERROR ===", err);
    res.status(500).end();
  });
});


// ⭕ webhook より後ろに置く
app.use(express.json());

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const client = new line.Client(config);

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: `あなたは「${event.message.text}」と送りましたね。`
  });
}

app.listen(10000, () => {
  console.log("LINE Bot is running!");
});
