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

// ------------------------------
// 残日数を計算する API
// ------------------------------
app.get('/remaining-days/:lineUserId', async (req, res) => {
  const lineUserId = req.params.lineUserId;

  try {
    // ① users テーブルからユーザー情報を取得
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', lineUserId)
      .single();

    if (userError || !user) {
      return res.json({ error: 'User not found' });
    }

    // ② paid_leaves（付与された有給）を取得
    const { data: paidLeaves, error: paidError } = await supabase
      .from('paid_leaves')
      .select('*')
      .eq('user_id', lineUserId);

    if (paidError) {
      return res.json({ error: 'Failed to fetch paid leaves' });
    }

    // 付与された日数の合計
    const totalGranted = paidLeaves.reduce((sum, row) => sum + row.granted_days, 0);

    // ③ used_days（使った有給）を取得
    const { data: usedDays, error: usedError } = await supabase
      .from('used_days')
      .select('*')
      .eq('user_id', lineUserId);

    if (usedError) {
      return res.json({ error: 'Failed to fetch used days' });
    }

    // 使用した日数の合計
    const totalUsed = usedDays.reduce((sum, row) => sum + row.days, 0);

    // ④ 繰越日数（users.carr_over）
    const carryOver = user.carr_over || 0;

    // ⑤ 残日数を計算
    const remaining = totalGranted - totalUsed + carryOver;

    return res.json({
      user_id: lineUserId,
      totalGranted,
      totalUsed,
      carryOver,
      remaining
    });

  } catch (err) {
    return res.json({ error: 'Unexpected error', detail: err.message });
  }
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;

      // あなたの API を叩く
      const response = await fetch(
        `https://express-hello-world-bl3n.onrender.com/remaining-days/${userId}`
      );
      const data = await response.json();

      // LINE に返信
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `あなたの残り有給日数は ${data.remaining} 日です`
      });
    }
  }

  res.status(200).end();
});

// 残り有給日数を返すAPI
app.get("/remaining-days/:lineUserId", async (req, res) => {
  const lineUserId = req.params.lineUserId;

  // Supabaseクライアントを初期化
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // usersテーブルからユーザー情報を取得
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("id", lineUserId)
    .single();

  if (userError || !userData) {
    return res.json({ error: "User not found" });
  }

  // paid_leavesテーブルから付与日数を取得
  const { data: paidLeaves, error: paidError } = await supabase
    .from("paid_leaves")
    .select("*")
    .eq("user_id", lineUserId);

  if (paidError) {
    return res.json({ error: "Failed to fetch paid leaves" });
  }

  // used_daysテーブルから使用日数を取得
  const { data: usedDays, error: usedError } = await supabase
    .from("used_days")
    .select("*")
    .eq("user_id", lineUserId);

  if (usedError) {
    return res.json({ error: "Failed to fetch used days" });
  }

  // 合計計算
  const totalGranted = paidLeaves.reduce((sum, row) => sum + row.granted_days, 0);
  const totalUsed = usedDays.reduce((sum, row) => sum + row.amount, 0);
  const carryOver = userData.carr_over || 0;
  const remaining = totalGranted + carryOver - totalUsed;

  res.json({
    user_id: lineUserId,
    totalGranted,
    totalUsed,
    carryOver,
    remaining,
  });
});

// 残り有給日数を返すAPI
app.get("/remaining-days/:lineUserId", async (req, res) => {
  const lineUserId = req.params.lineUserId;

  const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", lineUserId)
    .single();

  const { data: paidLeaves } = await supabase
    .from("paid_leaves")
    .select("*")
    .eq("user_id", lineUserId);

  const { data: usedDays } = await supabase
    .from("used_days")
    .select("*")
    .eq("user_id", lineUserId);

  const totalGranted = paidLeaves.reduce((sum, row) => sum + row.granted_days, 0);
  const totalUsed = usedDays.reduce((sum, row) => sum + row.amount, 0);
  const carryOver = userData?.carr_over || 0;

  const remaining = totalGranted + carryOver - totalUsed;

  res.json({
    user_id: lineUserId,
    totalGranted,
    totalUsed,
    carryOver,
    remaining,
  });
});
