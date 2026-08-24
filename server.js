const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Code secret pour devenir admin
const SECRET_ADMIN_CODE = "NONVITCHA2026";

// Configuration de la base de données JSON locale
const DB_FILE = path.join(__dirname, 'database.json');

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      users: [],
      ressources: [
        { id: "1", titre: "Guide de santé sexuelle et reproductive (SSR)", categorie: "SSR", contenu: "Informations essentielles sur la prévention, la contraception et le bien-être." },
        { id: "2", titre: "Lutte contre les violences basées sur le genre (VBG)", categorie: "VBG", contenu: "Ressources d'aide, signalement et accompagnement des victimes." },
        { id: "3", titre: "Inclusion et respect des minorités", categorie: "MINORITES", contenu: "Promouvoir l'égalité, la tolérance et le soutien communautaire." }
      ],
      ecoutes: [],
      chat: [],
      privateMessages: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Configuration Multer pour les images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'nonvitcha-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Stockage des sockets connectés
const onlineUsers = new Map();

// --- ROUTES AUTHENTIFICATION ---

app.post('/api/auth/register', (req, res) => {
  const { email, password, nom, age, ville, adminCode } = req.body;
  const db = readDb();

  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé.' });
  }

  // Vérification du code secret admin
  let isAdmin = false;
  if (adminCode && adminCode === SECRET_ADMIN_CODE) {
    isAdmin = true;
  }

  const newUser = {
    id: Date.now().toString(),
    email,
    password,
    nom,
    age: parseInt(age) || 18,
    ville: ville || 'Inconnue',
    photo: '/uploads/default.png',
    nonvicoins: 10,
    isVip: false,
    likes: 0,
    isAdmin: isAdmin
  };

  db.users.push(newUser);
  writeDb(db);

  req.session.userId = newUser.id;
  res.json({ success: true });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDb();
  const user = db.users.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(400).json({ success: false, message: 'Email ou mot de passe incorrect.' });
  }

  req.session.userId = user.id;
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ loggedIn: false });
  }
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.json({ loggedIn: false });
  }
  const { password, ...safeUser } = user;
  res.json({ loggedIn: true, user: safeUser });
});

// --- ROUTES UTILISATEURS & PROFIL ---

app.get('/api/users', (req, res) => {
  const db = readDb();
  const users = db.users.map(({ password, ...u }) => u);
  res.json(users);
});

app.get('/api/online-users', (req, res) => {
  res.json(Array.from(onlineUsers.keys()));
});

app.post('/api/users/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.session.userId || !req.file) {
    return res.status(400).json({ success: false });
  }
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ success: false });

  user.photo = `/uploads/${req.file.filename}`;
  writeDb(db);

  const { password, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.post('/api/users/:id/like', (req, res) => {
  const db = readDb();
  const user = db.users.find(u => u.id === req.params.id);
  if (user) {
    user.likes = (user.likes || 0) + 1;
    writeDb(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false });
  }
});

// --- ESPACE ADMIN & ÉCOUTES ---

app.get('/api/admin/ecoutes', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, error: "Non connecté" });
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  
  if (!user || !user.isAdmin) {
    return res.status(403).json({ success: false, error: "Accès refusé. Réservé aux administrateurs." });
  }

  res.json({ success: true, ecoutes: db.ecoutes || [] });
});

app.post('/api/ecoute', (req, res) => {
  const { sujet, message } = req.body;
  if (!sujet || !message) {
    return res.status(400).json({ success: false, message: 'Le sujet et le message sont requis.' });
  }

  const db = readDb();
  if (!db.ecoutes) db.ecoutes = [];

  const nouvelleDemande = {
    id: Date.now().toString(),
    sujet,
    message,
    date: new Date().toLocaleDateString('fr-FR')
  };

  db.ecoutes.unshift(nouvelleDemande);
  writeDb(db);

  res.json({ success: true, message: 'Votre demande d\'écoute confidentielle a bien été transmise à l\'équipe.' });
});

// --- RESSOURCES & TCHAT ---

app.get('/api/ressources', (req, res) => {
  const db = readDb();
  const { categorie } = req.query;
  if (categorie) {
    return res.json(db.ressources.filter(r => r.categorie === categorie));
  }
  res.json(db.ressources);
});

app.get('/api/chat', (req, res) => {
  const db = readDb();
  res.json(db.chat || []);
});

app.delete('/api/chat/:id', (req, res) => {
  const db = readDb();
  db.chat = (db.chat || []).filter(m => m.id !== req.params.id);
  writeDb(db);
  io.emit('delete-public-message', req.params.id);
  res.json({ success: true });
});

app.get('/api/private-messages/:targetId', (req, res) => {
  if (!req.session.userId) return res.json([]);
  const db = readDb();
  const currentId = req.session.userId;
  const targetId = req.params.id || req.params.targetId;

  const messages = (db.privateMessages || []).filter(m => 
    (m.senderId === currentId && m.targetId === targetId) ||
    (m.senderId === targetId && m.targetId === currentId)
  );
  res.json(messages);
});

app.get('/api/unread-messages', (req, res) => {
  if (!req.session.userId) return res.json({});
  const db = readDb();
  const unreadCounts = {};
  res.json(unreadCounts);
});

// --- WEBSOCKETS (SOCKET.IO) ---

io.on('connection', (socket) => {
  console.log('Un utilisateur s\'est connecté sur le socket');

  socket.on('join', (userId) => {
    onlineUsers.set(userId, socket.id);
    io.emit('update-users');
  });

  socket.on('send-public-message', (data) => {
    const db = readDb();
    if (!db.chat) db.chat = [];
    const newMessage = {
      id: Date.now().toString(),
      sender: data.sender,
      text: data.text,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    db.chat.push(newMessage);
    writeDb(db);
    io.emit('new-public-message', newMessage);
  });

  socket.on('send-private-message', (data) => {
    const db = readDb();
    if (!db.privateMessages) db.privateMessages = [];
    const newMessage = {
      id: Date.now().toString(),
      senderId: data.senderId,
      senderName: data.senderName,
      targetId: data.targetId,
      text: data.text,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    db.privateMessages.push(newMessage);
    writeDb(db);

    io.emit(`private-message-${data.targetId}`, newMessage);
    io.emit(`private-message-${data.senderId}`, newMessage);
  });

  socket.on('typing', (data) => {
    io.emit(`typing-${data.targetId}`, { senderName: data.senderName });
  });

  socket.on('stop-typing', (data) => {
    io.emit(`stop-typing-${data.targetId}`);
  });

  socket.on('update-users', () => {
    io.emit('update-users');
  });

  socket.on('disconnect', () => {
    for (let [userId, sockId] of onlineUsers.entries()) {
      if (sockId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
    io.emit('update-users');
    console.log('Un utilisateur s\'est déconnecté');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Nonvitcha démarré sur le port ${PORT}`);
});
