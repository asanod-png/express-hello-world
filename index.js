import express from "express";
import line from "@line/bot-sdk";

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

const app = express();

// ❌ express.json() をここに置くと署名検証が壊れる
// app.use(express.json());

app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
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
