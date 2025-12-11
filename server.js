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
  const { email, password, name, age, gender, faculty, course, interests, about } = req.body;

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
    name,
    avatar: null,
    age,
    gender,
    faculty,
    course,
    interests: interests || [],
    about: about || ""
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
  const user = db.users.find((u) => Number(u.id) === Number(req.userId));

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    age: user.age,
    gender: user.gender,
    faculty: user.faculty,
    course: user.course,
    interests: user.interests,
    about: user.about
  });
});

app.post("/api/update-profile", auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => Number(u.id) === Number(req.userId));

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { age, gender, faculty, course, interests, about } = req.body;

  user.age = age ?? user.age;
  user.gender = gender ?? user.gender;
  user.faculty = faculty ?? user.faculty;
  user.course = course ?? user.course;
  user.interests = Array.isArray(interests) ? interests : user.interests;
  user.about = about ?? user.about;

  saveDB(db);

  res.json({ status: "ok" });
});

// Загрузка аватара
app.post("/api/upload-avatar", auth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find((u) => Number(u.id) === Number(req.userId));
  if (!user) return res.status(404).json({ error: "User not found" });

  user.avatar = "/uploads/" + req.file.filename;
  saveDB(db);

  res.json({ avatar: user.avatar });
});

// Список других пользователей
app.get("/api/users", auth, (req, res) => {
  const db = loadDB();
  const myId = Number(req.userId);

  const ratedIds = db.swipes
    .filter(s => Number(s.from) === myId)
    .map(s => Number(s.to));

  const list = db.users
    .filter(u => Number(u.id) !== myId)
    .filter(u => !ratedIds.includes(Number(u.id)))
    .map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatar: u.avatar,
      age: u.age,
      gender: u.gender,
      faculty: u.faculty
    }));

  res.json(list);
});

// Сохранение свайпа (лайк/дизлайк) + создание матча/чата
app.post("/api/swipe", auth, (req, res) => {
  const db = loadDB();
  const fromUserId = Number(req.body.fromUserId);
  const toUserId   = Number(req.body.toUserId);
  const swipeType = req.body.swipeType;

  // Сохраняем свайп

  db.swipes.push({
    id: Date.now(),
    from: fromUserId,
    to: toUserId,
    type: swipeType
  });
  saveDB(db);

  // Проверяем: если лайк — ищем обратный лайк
  if (swipeType === "like") {
    let reverseLike = db.swipes.find(
      (s) =>
        s.from === toUserId &&
        s.to === fromUserId &&
        s.type === "like"
    );

    if (reverseLike) {
      // Проверяем — не создан ли матч раньше
      let match = db.matches.find(
        (m) =>
          (m.user1 === fromUserId && m.user2 === toUserId) ||
          (m.user1 === toUserId && m.user2 === fromUserId)
      );

      if (!match) {
        // Создаем НОВЫЙ MATCH + чат
        match = {
          id: Date.now(),
          user1: fromUserId,
          user2: toUserId,
          createdAt: new Date().toISOString()
        };

        db.matches.push(match);
        saveDB(db);

        return res.json({
          status: "match",
          matchId: match.id
        });
      }

      // Если матч уже существовал — просто вернуть matchId
      saveDB(db);
      return res.json({
        status: "already_matched",
        matchId: match.id
      });
    }
  }

  res.json({ status: "ok" });
});



// Сообщения чата по matchId (для простоты один общий matchId=1)
app.get("/api/chat/:matchId", auth, (req, res) => {
  const db = loadDB();
  const matchId = Number(req.params.matchId);

  // 1. Check match exists
  const match = db.matches.find(m => m.id === matchId);
  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }

  // 2. Check user is part of the match
  if (match.user1 !== req.userId && match.user2 !== req.userId) {
    return res.status(403).json({ error: "Access denied" });
  }

  // 3. Return messages for this match
  const msgs = db.messages.filter(m => m.matchId === matchId);
  res.json(msgs);
});

app.post("/api/chat/:matchId", auth, (req, res) => {
  const db = loadDB();
  const matchId = Number(req.params.matchId);
  const { text } = req.body;

  // 1. Validate match exists
  const match = db.matches.find(m => m.id === matchId);
  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }

  // 2. Validate user belongs to match
  if (match.user1 !== req.userId && match.user2 !== req.userId) {
    return res.status(403).json({ error: "Access denied" });
  }

  // 3. Store the message
  db.messages.push({
    id: Date.now(),
    matchId: matchId,
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
