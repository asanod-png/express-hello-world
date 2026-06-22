import express from "express";
import line from "@line/bot-sdk";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

const app = express();

// LINE設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// Supabase設定
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ★ webhook だけ raw body を受け取る（これが超重要）
app.post(
  "/webhook",
  bodyParser.raw({ type: "*/*" }),
  line.middleware(config),
  async (req, res) => {
    try {
      const events = req.body.events;

      for (const event of events) {
        if (event.type === "message" && event.message.type === "text") {
          const userMessage = event.message.text;

          // 「◯月の有給」パターン
          const match = userMessage.match(/(\d+)月の有給/);
          if (match) {
            const month = parseInt(match[1], 10);

            // Supabaseからデータ取得
            const { data, error } = await supabase
              .from("paid_holidays")
              .select("*")
              .eq("month", month)
              .single();

            if (error || !data) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: `${month}月のデータが見つかりませんでした。`,
              });
              continue;
            }

            const remaining = data.total - data.used;

            await client.replyMessage(event.replyToken, {
              type: "text",
              text: `${month}月の有給残りは ${remaining} 日です。`,
            });
          }
        }
      }

      res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook Error:", err);
      res.status(500).send("Internal Server Error");
    }
  }
);

// LINEクライアント
const client = new line.Client(config);

// サーバー起動
app.listen(3000, () => {
  console.log("LINE Bot is running!");
});
