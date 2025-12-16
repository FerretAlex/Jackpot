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


const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname || ".jpg"));
  }
});
const upload = multer({ storage });

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


app.post("/api/register", async (req, res) => {
  const db = loadDB();
  const { email, password, name, age, gender, faculty, course, interests, about } = req.body;

  if (!email || !password) {
    return res.json({ error: "Email and password needed" });
  }

  if (db.users.find((u) => u.email === email)) {
    return res.json({ error: "User with such email already exists" });
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


app.post("/api/login", async (req, res) => {
  const db = loadDB();
  const { email, password } = req.body;

  const user = db.users.find((u) => u.email === email);
  if (!user) return res.json({ error: "User not found" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.json({ error: "Incorrect password" });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, userId: user.id });
});


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


app.post("/api/upload-avatar", auth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find((u) => Number(u.id) === Number(req.userId));
  if (!user) return res.status(404).json({ error: "User not found" });

  user.avatar = "/uploads/" + req.file.filename;
  saveDB(db);

  res.json({ avatar: user.avatar });
});


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

app.post("/api/swipe", auth, (req, res) => {
  const db = loadDB();
  const fromUserId = Number(req.body.fromUserId);
  const toUserId   = Number(req.body.toUserId);
  const swipeType = req.body.swipeType;


  db.swipes.push({
    id: Date.now(),
    from: fromUserId,
    to: toUserId,
    type: swipeType
  });
  saveDB(db);

  if (swipeType === "like") {
    let reverseLike = db.swipes.find(
      (s) =>
        s.from === toUserId &&
        s.to === fromUserId &&
        s.type === "like"
    );

    if (reverseLike) {
      let match = db.matches.find(
        (m) =>
          (m.user1 === fromUserId && m.user2 === toUserId) ||
          (m.user1 === toUserId && m.user2 === fromUserId)
      );

      if (!match) {
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

      saveDB(db);
      return res.json({
        status: "already_matched",
        matchId: match.id
      });
    }
  }

  res.json({ status: "ok" });
});

app.get("/api/match/:id", auth, (req, res) => {
  const db = loadDB();
  const matchId = Number(req.params.id);
  const userId = Number(req.userId);

  console.log('MATCH route requested:', matchId);
  console.log('MATCH route existing:', db.matches.map(m => m.id));

  const match = db.matches.find(
    m => Number(m.id) === matchId
  );

  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }

  if (
    Number(match.user1) !== userId &&
    Number(match.user2) !== userId
  ) {
    return res.status(403).json({ error: "Access denied" });
  }

  const user1info = db.users.find(u => Number(u.id) === Number(match.user1));
  const user2info = db.users.find(u => Number(u.id) === Number(match.user2));

  res.json({ ...match, user1info, user2info });
});

app.get("/api/chat/:matchId", auth, (req, res) => {
  const db = loadDB();
  const matchId = Number(req.params.matchId);
  const userId = Number(req.userId);

  const match = db.matches.find(
    m => Number(m.id) === matchId
  );

  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }

  if (
    Number(match.user1) !== userId &&
    Number(match.user2) !== userId
  ) {
    return res.status(403).json({ error: "Access denied" });
  }

  const msgs = db.messages
    .filter(m => Number(m.matchId) === matchId)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)); // optional: chronological order

  res.json(msgs);
});

app.post("/api/chat/:matchId", auth, (req, res) => {
  const db = loadDB();
  const matchId = Number(req.params.matchId); // ensure number
  const { text } = req.body;

  const match = db.matches.find(m => Number(m.id) === matchId);
  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }

  const userId = Number(req.userId);
  if (Number(match.user1) !== userId && Number(match.user2) !== userId) {
    return res.status(403).json({ error: "Access denied" });
  }

  if (!text || !text.trim()) {
  return res.status(400).json({ error: "Empty message" });
}
  db.messages.push({
    id: Date.now(),      // message ID as number
    matchId: matchId,    // number
    sender: userId,
    text,
    createdAt: new Date().toISOString()
  });

  saveDB(db);
  res.json({ status: "sent" });
});

app.get("/api/matches", auth, (req, res) => {
  const db = loadDB();
  const userId = Number(req.userId);

  const userMatches = db.matches
    .filter(m =>
      Number(m.user1) === userId || Number(m.user2) === userId
    )
    .map(m => {
      const user1info = db.users.find(u => Number(u.id) === Number(m.user1));
      const user2info = db.users.find(u => Number(u.id) === Number(m.user2));

      const lastMessage = db.messages
        .filter(msg => Number(msg.matchId) === Number(m.id))
        .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0]?.text || '';

      return { ...m, user1info, user2info, lastMessage };
    });

  res.json(userMatches);
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
