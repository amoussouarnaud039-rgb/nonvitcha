const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Configuration de multer pour l'upload de photos de profil
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Gestion de la base de données JSON
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
      privateMessages: [],
      publicites: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!data.publicites) data.publicites = [];
  return data;
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'nonvitcha_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 heures
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES AUTHENTIFICATION ---

app.post('/api/register', upload.single('photo'), (req, res) => {
  const { nom, email, password, genre, recherche, bio, age, ville } = req.body;
  if (!nom || !email || !password) {
    return res.status(400).json({ success: false, message: 'Nom, email et mot de passe requis.' });
  }

  const db = readDb();
  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé.' });
  }

  const newUser = {
    id: Date.now().toString(),
    nom,
    email,
    password,
    genre: genre || 'Non spécifié',
    recherche: recherche || 'Tous',
    bio: bio || '',
    age: age || '',
    ville: ville || '',
    photo: req.file ? `/uploads/${req.file.filename}` : '/uploads/default.png',
    nonvicoins: 100, // Bonus de départ
    isVip: false,
    vipExpire: null,
    isAdmin: db.users.length === 0, // Le premier inscrit est admin
    online: true,
    lastSeen: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDb(db);

  req.session.userId = newUser.id;
  const { password: _, ...safeUser } = newUser;
  res.json({ success: true, user: safeUser });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDb();
  const user = db.users.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });
  }

  // Vérifier si le statut VIP a expiré
  if (user.isVip && user.vipExpire && new Date() > new Date(user.vipExpire)) {
    user.isVip = false;
    user.vipExpire = null;
  }

  user.online = true;
  user.lastSeen = new Date().toISOString();
  writeDb(db);

  req.session.userId = user.id;
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ success: false });

  if (user.isVip && user.vipExpire && new Date() > new Date(user.vipExpire)) {
    user.isVip = false;
    user.vipExpire = null;
    writeDb(db);
  }

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.post('/api/logout', (req, res) => {
  if (req.session.userId) {
    const db = readDb();
    const user = db.users.find(u => u.id === req.session.userId);
    if (user) {
      user.online = false;
      user.lastSeen = new Date().toISOString();
      writeDb(db);
    }
  }
  req.session.destroy();
  res.json({ success: true });
});

// --- ROUTE ACHAT VIP ---

app.post('/api/vip/upgrade', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Non connecté.' });
  
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

  const coutVipCoins = 80; // Coût de l'abonnement VIP en Nonvicoins
  if ((user.nonvicoins || 0) < coutVipCoins) {
    return res.status(400).json({ success: false, message: `Solde insuffisant ! Le statut VIP coûte ${coutVipCoins} Nonvicoins.` });
  }

  user.nonvicoins -= coutVipCoins;
  user.isVip = true;
  
  // Expiration dans 30 jours
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + 30);
  user.vipExpire = expireDate.toISOString();

  writeDb(db);

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, message: 'Félicitations, vous êtes désormais membre VIP !' });
});

// --- ROUTES UTILISATEURS & MATCHING ---

app.get('/api/users', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const db = readDb();
  const safeUsers = db.users.map(({ password, ...u }) => u);
  res.json(safeUsers);
});

// --- ROUTES CHAT PUBLIC ---

app.get('/api/chat', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const db = readDb();
  res.json(db.chat || []);
});

app.post('/api/chat', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ success: false });

  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ success: false });

  const newMessage = {
    id: Date.now().toString(),
    userId: user.id,
    userName: user.nom,
    userPhoto: user.photo,
    userVip: user.isVip,
    message: message.trim(),
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  };

  db.chat.push(newMessage);
  if (db.chat.length > 100) db.chat.shift();
  writeDb(db);

  res.json({ success: true, message: newMessage });
});

// --- ROUTES PUBLICITÉS SPONSORISÉES ---

app.get('/api/publicites', (req, res) => {
  const db = readDb();
  res.json(db.publicites || []);
});

app.post('/api/publicites', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Non connecté.' });
  const { titre, description, contact } = req.body;
  
  if (!titre || !description) {
    return res.status(400).json({ success: false, message: 'Le titre et la description sont requis.' });
  }

  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

  const coutPubCoins = 50;
  if ((user.nonvicoins || 0) < coutPubCoins && !user.isAdmin) {
    return res.status(400).json({ success: false, message: `Solde insuffisant ! Une publication publicitaire coûte ${coutPubCoins} Nonvicoins.` });
  }

  if (!user.isAdmin) {
    user.nonvicoins -= coutPubCoins;
  }

  if (!db.publicites) db.publicites = [];

  const nouvellePub = {
    id: Date.now().toString(),
    titre,
    description,
    contact: contact || user.email,
    annonceur: user.nom,
    date: new Date().toLocaleDateString('fr-FR')
  };

  db.publicites.unshift(nouvellePub);
  writeDb(db);

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, publicites: db.publicites });
});

app.delete('/api/publicites/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId);
  
  if (!user || !user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé aux administrateurs.' });
  }

  db.publicites = (db.publicites || []).filter(p => p.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, publicites: db.publicites });
});

app.listen(PORT, () => {
  console.log(`Serveur Nonvitcha lancé sur le port ${PORT}`);
});
