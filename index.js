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
app.use(express.json());

// ------------------------------
// LINE Webhook
// ------------------------------
app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      // ------------------------------
      // 「取り消し 5/22」形式の解析
      // ------------------------------
      const undoMatch = text.match(/取り消し\s*(\d{1,2})[\/\-](\d{1,2})/);

      if (undoMatch) {
        const month = undoMatch[1].padStart(2, "0");
        const day = undoMatch[2].padStart(2, "0");
        const dateStr = `${new Date().getFullYear()}-${month}-${day}`;

        await supabase
          .from("used_days")
          .delete()
          .eq("user_id", userId)
          .eq("date", dateStr);

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${month}/${day} の有給を取り消しました。`
        });

        continue;
      }

      // ------------------------------
      // 「5月の有給」形式の解析
      // ------------------------------
      const monthListMatch = text.match(/(\d{1,2})月の有給/);

      if (monthListMatch) {
        const month = monthListMatch[1];
        const year = new Date().getFullYear();
        const monthStr = month.padStart(2, "0");

        const response = await fetch(
          `https://express-hello-world-bl3n.onrender.com/month-list/${userId}/${year}-${monthStr}`
        );
        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `${month}月の有給はありません。`
          });
          continue;
        }

        const total = data.reduce((sum, row) => sum + row.amount, 0);

        const list = data
          .map((row) => {
            const d = new Date(row.date);
            const day = d.getDate();
            const type = row.amount === 1 ? "有給 1日" : "半休 0.5日";
            return `- ${month}/${day} ${type}`;
          })
          .join("\n");

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${month}月の有給は ${total} 日です\n${list}`
        });

        continue;
      }

      // ------------------------------
      // 「半休 5/22」形式の解析
      // ------------------------------
      const halfMatch = text.match(/半休\s*(\d{1,2})[\/\-](\d{1,2})/);

      if (halfMatch) {
        const month = halfMatch[1].padStart(2, "0");
        const day = halfMatch[2].padStart(2, "0");
        const dateStr = `${new Date().getFullYear()}-${month}-${day}`;

        await supabase.from("used_days").insert({
          user_id: userId,
          date: dateStr,
          amount: 0.5
        });

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${month}/${day} に半休を登録しました。`
        });

        continue;
      }

      // ------------------------------
      // 「5/22」形式の解析（1日有給）
      // ------------------------------
      const fullMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})/);

      if (fullMatch) {
        const month = fullMatch[1].padStart(2, "0");
        const day = fullMatch[2].padStart(2, "0");
        const dateStr = `${new Date().getFullYear()}-${month}-${day}`;

        await supabase.from("used_days").insert({
          user_id: userId,
          date: dateStr,
          amount: 1
        });

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${month}/${day} に有給 1日を登録しました。`
        });

        continue;
      }

      // ------------------------------
      // どれにも当てはまらない場合
      // ------------------------------
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `あなたは「${text}」と送りましたね。`
      });
    }
  }

  res.status(200).end();
});

// ------------------------------
// 残日数を計算する API
// ------------------------------
app.get("/remaining-days/:lineUserId", async (req, res) => {
  const lineUserId = req.params.lineUserId;

  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", lineUserId)
      .single();

    const { data: paidLeaves } = await supabase
      .from("paid_leaves")
      .select("*")
      .eq("user_id", lineUserId);

    const totalGranted = (paidLeaves ?? []).reduce(
      (sum, row) => sum + Number(row.granted_days || 0),
      0
    );

    const { data: usedDays } = await supabase
      .from("used_days")
      .select("*")
      .eq("user_id", lineUserId);

    const totalUsed = (usedDays ?? []).reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    );

    const carryOver = Number(user?.carr_over || 0);

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

// ------------------------------
// 月ごとの有給一覧を返す API
// ------------------------------
app.get("/month-list/:user_id/:yearMonth", async (req, res) => {
  const { user_id, yearMonth } = req.params;

  try {
    const { data, error } = await supabase
      .from("used_days")
      .select("*")
      .eq("user_id", user_id)
      .like("date", `${yearMonth}-%`)
      .order("date", { ascending: true });

    if (error) {
      return res.json({ error: "Failed to fetch month list", detail: error });
    }

    return res.json(data);

  } catch (err) {
    return res.json({ error: "Unexpected error", detail: err.message });
  }
});

// ------------------------------
// 有給を登録する API
// ------------------------------
app.post("/use-day", async (req, res) => {
  const { user_id, date, amount } = req.body;

  if (!user_id || !date || !amount) {
    return res.json({ error: "Missing parameters" });
  }

  const { error } = await supabase.from("used_days").insert({
    user_id,
    date,
    amount
  });

  if (error) {
    return res.json({ error: "Failed to insert", detail: error });
  }

  return res.json({ message: "Inserted successfully" });
});

// ------------------------------
// 有給を取り消す API
// ------------------------------
app.delete("/use-day", async (req, res) => {
  const { user_id, date } = req.body;

  const { error } = await supabase
    .from("used_days")
    .delete()
    .eq("user_id", user_id)
    .eq("date", date);

  if (error) {
    return res.json({ error: "Failed to delete", detail: error });
  }

  return res.json({ message: "Deleted successfully" });
});

app.listen(10000, () => {
  console.log("LINE Bot is running!");
});
