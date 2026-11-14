
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN
    ? process.env.FRONTEND_ORIGIN.split(",")
    : false,
  allowedHeaders: ["Content-Type", "X-Telegram-Init-Data"],
  methods: ["GET", "POST", "OPTIONS"]
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: false }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || "Mifado_Mining_Bot";
const PORT = process.env.PORT || 3000;

function verifyTelegram(initData) {
  if (!BOT_TOKEN || !initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const authDate = Number(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);

    if (!authDate || now - authDate > 3600 || authDate > now + 30) {
      return null;
    }

    const data = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secret = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculated = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("hex");

    const a = Buffer.from(calculated, "hex");
    const b = Buffer.from(hash, "hex");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const user = JSON.parse(params.get("user") || "{}");
    return user.id ? user : null;
  } catch {
    return null;
  }
}

async function auth(req, res, next) {
  const user = verifyTelegram(req.get("X-Telegram-Init-Data"));

  if (!user) {
    return res.status(401).json({
      error: "لطفاً بازی را از داخل تلگرام باز کن."
    });
  }

  try {
    await pool.query(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id)
       DO UPDATE SET last_seen = NOW(),
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name`,
      [String(user.id), user.username || null, user.first_name || null]
    );

    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database error" });
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "MIFADO COIN" });
});

app.get("/api/me", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE",
      [String(req.user.id)]
    );

    const user = result.rows[0];
    const elapsed = Math.max(
      0,
      (Date.now() - new Date(user.energy_updated_at).getTime()) / 1000
    );

    const gain = Number(user.hourly_rate) * elapsed / 3600;
    const energy = Math.min(
      Number(user.max_energy),
      Number(user.energy) + elapsed / 3
    );

    const updated = await client.query(
      `UPDATE users
       SET balance=balance+$1,
           energy=$2,
           energy_updated_at=NOW()
       WHERE telegram_id=$3
       RETURNING balance,energy,max_energy,hourly_rate`,
      [gain, energy, String(req.user.id)]
    );

    await client.query("COMMIT");

    const row = updated.rows[0];

    res.json({
      balance: Number(row.balance),
      energy: Number(row.energy),
      maxEnergy: Number(row.max_energy),
      hourlyRate: Number(row.hourly_rate),
      referralLink: `https://t.me/${BOT_USERNAME}?start=${req.user.id}`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Profile error" });
  } finally {
    client.release();
  }
});

app.post("/api/tap", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM users WHERE telegram_id=$1 FOR UPDATE",
      [String(req.user.id)]
    );

    const user = result.rows[0];

    const elapsed = Math.max(
      0,
      (Date.now() - new Date(user.energy_updated_at).getTime()) / 1000
    );

    const passive = Number(user.hourly_rate) * elapsed / 3600;

    const energy = Math.min(
      Number(user.max_energy),
      Number(user.energy) + elapsed / 3
    );

    if (energy < 1) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "انرژی کافی نداری." });
    }

    const reward = 0.001;

    const updated = await client.query(
      `UPDATE users
       SET balance=balance+$1+$2,
           energy=$3,
           energy_updated_at=NOW()
       WHERE telegram_id=$4
       RETURNING balance,energy,max_energy,hourly_rate`,
      [passive, reward, energy - 1, String(req.user.id)]
    );

    await client.query(
      `INSERT INTO transactions (telegram_id,type,amount)
       VALUES ($1,'tap',$2)`,
      [String(req.user.id), reward]
    );

    await client.query("COMMIT");

    const row = updated.rows[0];

    res.json({
      balance: Number(row.balance),
      energy: Number(row.energy),
      maxEnergy: Number(row.max_energy),
      hourlyRate: Number(row.hourly_rate)
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Tap error" });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log("MIFADO COIN server running on port " + PORT);
});
