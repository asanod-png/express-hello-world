import { createClient } from '@supabase/supabase-js';
import express from "express";
import line from "@line/bot-sdk";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

const client = new line.Client(config);
const app = express();

// webhook より前に置かない
// app.use(express.json());

app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;

      const response = await fetch(
        `https://express-hello-world-bl3n.onrender.com/remaining-days/${userId}`
      );
      const data = await response.json();

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `あなたの残り有給日数は ${data.remaining} 日です`
      });
    }
  }

  res.status(200).end();
});

// webhook より後に置く
app.use(express.json());

// ------------------------------
// 残日数を計算する API（唯一の正しいバージョン）
// ------------------------------
app.get("/remaining-days/:lineUserId", async (req, res) => {
  const lineUserId = req.params.lineUserId;

  try {
    // users
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", lineUserId)
      .single();

    if (userError || !user) {
      return res.json({ error: "User not found" });
    }

    // paid_leaves
    const { data: paidLeaves } = await supabase
      .from("paid_leaves")
      .select("*")
      .eq("user_id", lineUserId);

    const totalGranted = (paidLeaves ?? []).reduce(
      (sum, row) => sum + Number(row.granted_days || 0),
      0
    );

    // used_days
    const { data: usedDays } = await supabase
      .from("used_days")
      .select("*")
      .eq("user_id", lineUserId);

    const totalUsed = (usedDays ?? []).reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    );

    const carryOver = Number(user.carr_over || 0);

    const remaining = totalGranted + carryOver - totalUsed;

    return res.json({
      user_id: lineUserId,
      totalGranted,
      totalUsed,
      carryOver,
      remaining
    });

  } catch (err) {
    return res.json({ error: "Unexpected error", detail: err.message });
  }
});

app.listen(10000, () => {
  console.log("LINE Bot is running!");
});
// ------------------------------
// 有給を登録する API
// ------------------------------
app.post("/use-day", async (req, res) => {
  const { user_id, date, amount } = req.body;

  if (!user_id || !date || !amount) {
    return res.json({ error: "Missing parameters" });
  }

  try {
    const { data, error } = await supabase
      .from("used_days")
      .insert([
        {
          user_id,
          date,
          amount
        }
      ]);

    if (error) {
      return res.json({ error: "Failed to insert used day", detail: error });
    }

    return res.json({ success: true, inserted: data });

  } catch (err) {
    return res.json({ error: "Unexpected error", detail: err.message });
  }
});
