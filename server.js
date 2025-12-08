const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const { loadDB, saveDB } = require("./jsondb");

const app = express();
const PORT = 3000;
const JWT_SECRET = "json_secret_demo";

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Multer для аватара
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname || ".jpg"));
  }
});
const upload = multer({ storage });

// Middleware авторизации
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Регистрация
app.post("/api/register", async (req, res) => {
  const db = loadDB();
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.json({ error: "Email и пароль обязательны" });
  }

  if (db.users.find((u) => u.email === email)) {
    return res.json({ error: "Пользователь с таким email уже существует" });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: Date.now(),
    email,
    password: hash,
    name: name || "",
    avatar: null
  };
  db.users.push(user);
  saveDB(db);

  res.json({ status: "ok" });
});

// Логин
app.post("/api/login", async (req, res) => {
  const db = loadDB();
  const { email, password } = req.body;

  const user = db.users.find((u) => u.email === email);
  if (!user) return res.json({ error: "Пользователь не найден" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.json({ error: "Неверный пароль" });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, userId: user.id });
});

// Текущий пользователь
app.get("/api/me", auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar
  });
});

// Загрузка аватара
app.post("/api/upload-avatar", auth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.avatar = "/uploads/" + req.file.filename;
  saveDB(db);

  res.json({ avatar: user.avatar });
});

// Список других пользователей
app.get("/api/users", auth, (req, res) => {
  const db = loadDB();
  const list = db.users
    .filter((u) => u.id !== req.userId)
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatar: u.avatar
    }));
  res.json(list);
});

// Сохранение свайпа (лайк/дизлайк)
app.post("/api/swipe", auth, (req, res) => {
  const db = loadDB();
  const { fromUserId, toUserId, swipeType } = req.body;

  db.swipes.push({
    id: Date.now(),
    from: fromUserId,
    to: toUserId,
    type: swipeType
  });

  saveDB(db);
  res.json({ status: "ok" });
});

// Сообщения чата по matchId (для простоты один общий matchId=1)
app.get("/api/chat/:matchId", auth, (req, res) => {
  const db = loadDB();
  const matchId = req.params.matchId;
  const msgs = db.messages.filter((m) => String(m.matchId) === String(matchId));
  res.json(msgs);
});

app.post("/api/chat/:matchId", auth, (req, res) => {
  const db = loadDB();
  const matchId = req.params.matchId;
  const { text } = req.body;

  db.messages.push({
    id: Date.now(),
    matchId,
    sender: req.userId,
    text,
    createdAt: new Date().toISOString()
  });

  saveDB(db);
  res.json({ status: "sent" });
});

// Запуск
app.listen(PORT, () => {
  console.log(`JSON neutral Tinder running on http://localhost:${PORT}`);
});
