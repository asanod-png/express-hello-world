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

// LINEクライアント
const client = new line.Client(config);

// Supabase設定
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ★ webhook は raw body（署名検証のため）
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
            const userId = event.source.userId;

            // ① paid_leaves から付与日数を取得
            const { data: leaveData, error: leaveError } = await supabase
              .from("paid_leaves")
              .select("granted_days")
              .eq("user_id", userId)
              .single();

            if (leaveError || !leaveData) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: "有給の付与データが見つかりませんでした。",
              });
              continue;
            }

            const grantedDays = leaveData.granted_days;

            // ② used_days から指定月の使用日数を集計
            const { data: usedRows, error: usedError } = await supabase
              .from("used_days")
              .select("amount, date")
              .eq("user_id", userId);

            if (usedError) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: "使用データの取得に失敗しました。",
              });
              continue;
            }

            // 指定月の使用日数を合計
            const usedSum = usedRows
              .filter((row) => {
                const d = new Date(row.date);
                return d.getMonth() + 1 === month;
              })
              .reduce((sum, row) => sum + Number(row.amount), 0);

            // ③ 残日数を計算
            const remaining = grantedDays - usedSum;

            // ④ LINE に返す
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

// サーバー起動
app.listen(3000, () => {
  console.log("LINE Bot is running!");
});
