const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Base de données SQLite
const db = new sqlite3.Database('./nonvitcha.db', (err) => {
  if (err) console.error("Erreur ouverture DB", err.message);
  else console.log("Connecté à la base de données SQLite.");
});

// Création des tables si elles n'existent pas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prenom TEXT UNIQUE,
    password TEXT,
    age INTEGER,
    ville TEXT,
    credits INTEGER DEFAULT 10,
    estVip INTEGER DEFAULT 0,
    avatar TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER,
    receiverId INTEGER,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'nonvitcha_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Route principale : sert le fichier index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// API Session
app.get('/api/me', (req, res) => {
  if (req.session.user) {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id], (err, row) => {
      if (row) res.json({ loggedIn: true, user: row });
      else res.json({ loggedIn: false });
    });
  } else {
    res.json({ loggedIn: false });
  }
});

// API Inscription
app.post('/api/register', async (req, res) => {
  const { prenom, password, age, ville } = req.body;
  if (!prenom || !password) return res.json({ success: false, message: 'Champs requis' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(prenom)}`;

  db.run(`INSERT INTO users (prenom, password, age, ville, avatar) VALUES (?, ?, ?, ?, ?)`,
    [prenom, hashedPassword, age || 25, ville || 'Cotonou', avatar],
    function(err) {
      if (err) return res.json({ success: false, message: 'Ce prénom existe déjà.' });
      req.session.user = { id: this.lastID, prenom };
      res.json({ success: true });
    }
  );
});

// API Connexion
app.post('/api/login', (req, res) => {
  const { prenom, password } = req.body;
  db.get(`SELECT * FROM users WHERE prenom = ?`, [prenom], async (err, user) => {
    if (err || !user) return res.json({ success: false, message: 'Utilisateur introuvable.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: 'Mot de passe incorrect.' });

    req.session.user = { id: user.id, prenom: user.prenom };
    res.json({ success: true });
  });
});

// API Déconnexion
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API Liste des profils
app.get('/api/profils', (req, res) => {
  db.all(`SELECT id, prenom, age, ville, credits, estVip, avatar FROM users`, [], (err, rows) => {
    if (err) return res.json({ success: false, data: [] });
    res.json({ success: true, data: rows });
  });
});

// API Récupérer l'historique des messages entre deux utilisateurs
app.get('/api/messages/:destId', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const myId = req.session.user.id;
  const destId = req.params.destId;

  db.all(
    `SELECT * FROM messages WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?) ORDER BY timestamp ASC`,
    [myId, destId, destId, myId],
    (err, rows) => {
      if (err) return res.json({ success: false, messages: [] });
      res.json({ success: true, messages: rows });
    }
  );
});

// Gestion du Temps Réel avec Socket.IO
io.on('connection', (socket) => {
  socket.on('private message', (data) => {
    const { senderId, receiverId, text } = data;
    // Enregistrement du message dans la base de données
    db.run(
      `INSERT INTO messages (senderId, receiverId, text) VALUES (?, ?, ?)`,
      [senderId, receiverId, text],
      (err) => {
        if (!err) {
          // Diffusion du message aux clients connectés
          io.emit('private message', { senderId, receiverId, text });
        }
      }
    );
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
