const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const { Pool } = require('pg');
const { FedaPay, Transaction } = require('fedapay');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET_KEY = "admin2026";

// --- CONFIGURATION POSTGRESQL ---
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'nonvitcha_db',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

// --- INITIALISATION DES TABLES DE LA BASE DE DONNÉES ---
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        genre VARCHAR(50),
        recherche VARCHAR(50),
        bio TEXT,
        age INT,
        ville VARCHAR(100),
        ville_originale VARCHAR(100),
        photo TEXT,
        nonvicoins INT DEFAULT 100,
        likes TEXT[],
        super_likes TEXT[],
        visiteurs TEXT[],
        is_vip BOOLEAN DEFAULT FALSE,
        vip_expire TIMESTAMP,
        vip_last_bonus TIMESTAMP,
        is_boosted BOOLEAN DEFAULT FALSE,
        boost_expire TIMESTAMP,
        is_admin BOOLEAN DEFAULT FALSE,
        online BOOLEAN DEFAULT TRUE,
        last_seen TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ressources (
        id VARCHAR(50) PRIMARY KEY,
        titre VARCHAR(255) NOT NULL,
        categorie VARCHAR(50),
        contenu TEXT
      );

      CREATE TABLE IF NOT EXISTS ecoutes (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50),
        user_name VARCHAR(100),
        categorie VARCHAR(50),
        message TEXT,
        reponse TEXT,
        date VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS chat (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50),
        user_name VARCHAR(100),
        user_photo TEXT,
        user_vip BOOLEAN,
        message TEXT,
        time VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS publicites (
        id VARCHAR(50) PRIMARY KEY,
        titre VARCHAR(255),
        description TEXT,
        contact VARCHAR(100),
        annonceur VARCHAR(100),
        date VARCHAR(50)
      );
    `);

    // Insérer des ressources par défaut si la table est vide
    const resCount = await pool.query('SELECT COUNT(*) FROM ressources');
    if (parseInt(resCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO ressources (id, titre, categorie, contenu) VALUES
        ('1', 'Guide de santé sexuelle et reproductive (SSR)', 'SSR', 'Informations essentielles sur la prévention, la contraception et le bien-être.'),
        ('2', 'Lutte contre les violences basées sur le genre (VBG)', 'VBG', 'Ressources d''aide, signalement et accompagnement des victimes.'),
        ('3', 'Inclusion et respect des minorités', 'MINORITES', 'Promouvoir l''égalité, la tolérance et le soutien communautaire.');
      `);
    }
    console.log("Base de données PostgreSQL initialisée avec succès.");
  } catch (err) {
    console.error("Erreur lors de l'initialisation de la base de données :", err);
  }
}
initDb();

// --- CONFIGURATION CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nonvitcha_profiles',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});
const upload = multer({ storage: storage });

// --- CONFIGURATION FEDAPAY ---
if (process.env.FEDAPAY_SECRET_KEY) {
  FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
  FedaPay.setEnvironment(process.env.FEDAPAY_ENVIRONMENT || 'live');
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'nonvitcha_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

// --- FONCTIONS UTILITAIRES DE MAPPING ---
function mapUserFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    nom: row.nom,
    email: row.email,
    password: row.password,
    genre: row.genre,
    recherche: row.recherche,
    bio: row.bio,
    age: row.age,
    ville: row.ville,
    villeOriginale: row.ville_originale,
    photo: row.photo,
    nonvicoins: row.nonvicoins,
    likes: row.likes || [],
    superLikes: row.super_likes || [],
    visiteurs: row.visiteurs || [],
    isVip: row.is_vip,
    vipExpire: row.vip_expire,
    vipLastBonus: row.vip_last_bonus,
    isBoosted: row.is_boosted,
    boostExpire: row.boost_expire,
    isAdmin: row.is_admin,
    online: row.online,
    lastSeen: row.last_seen
  };
}

// Fonction utilitaire pour vérifier et appliquer les bonus mensuels VIP
async function checkAndApplyVipBonus(user) {
  if (!user.isVip) return user;
  
  const now = new Date();
  const lastBonusDate = user.vipLastBonus ? new Date(user.vipLastBonus) : null;
  
  // Si aucun bonus n'a encore été versé, ou si 30 jours se sont écoulés depuis le dernier bonus
  if (!lastBonusDate || (now - lastBonusDate >= 30 * 24 * 60 * 60 * 1000)) {
    const bonusCoins = 30; // 30 Nonvicoins offerts par mois
    user.nonvicoins += bonusCoins;
    user.vipLastBonus = now.toISOString();

    await pool.query('UPDATE users SET nonvicoins = $1, vip_last_bonus = $2 WHERE id = $3',
      [user.nonvicoins, user.vipLastBonus, user.id]);
  }
  return user;
}

// --- AUTHENTIFICATION & PROFIL ---

app.post('/api/register', upload.single('photo'), async (req, res) => {
  const { nom, email, password, genre, recherche, bio, age, ville, adminCode } = req.body;
  if (!nom || !email || !password) {
    return res.status(400).json({ success: false, message: 'Nom, email et mot de passe requis.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé.' });
    }

    const countRes = await pool.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(countRes.rows[0].count);
    const isAdmin = (adminCode === ADMIN_SECRET_KEY) || (userCount === 0);

    const newUser = {
      id: Date.now().toString(),
      nom,
      email,
      password,
      genre: genre || 'Non spécifié',
      recherche: recherche || 'Tous',
      bio: bio || '',
      age: age ? parseInt(age) : null,
      ville: ville ? ville.trim().toLowerCase() : '',
      villeOriginale: ville || '',
      photo: req.file ? req.file.path : 'https://res.cloudinary.com/scp7oawl/image/upload/v1/nonvitcha_profiles/default.png',
      nonvicoins: 100,
      likes: [],
      superLikes: [],
      visiteurs: [],
      isVip: false,
      vipExpire: null,
      vipLastBonus: null,
      isBoosted: false,
      boostExpire: null,
      isAdmin: isAdmin,
      online: true,
      lastSeen: new Date().toISOString()
    };

    await pool.query(
      `INSERT INTO users (id, nom, email, password, genre, recherche, bio, age, ville, ville_originale, photo, nonvicoins, likes, super_likes, visiteurs, is_vip, vip_expire, vip_last_bonus, is_boosted, boost_expire, is_admin, online, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [newUser.id, newUser.nom, newUser.email, newUser.password, newUser.genre, newUser.recherche, newUser.bio, newUser.age, newUser.ville, newUser.villeOriginale, newUser.photo, newUser.nonvicoins, newUser.likes, newUser.superLikes, newUser.visiteurs, newUser.isVip, newUser.vipExpire, newUser.vipLastBonus, newUser.isBoosted, newUser.boostExpire, newUser.isAdmin, newUser.online, newUser.lastSeen]
    );

    req.session.userId = newUser.id;
    const { password: _, ...safeUser } = newUser;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Erreur register:", err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });
    }

    let user = mapUserFromDb(result.rows[0]);
    const now = new Date();
    let needsUpdate = false;

    if (user.isVip && user.vipExpire && now > new Date(user.vipExpire)) {
      user.isVip = false;
      user.vipExpire = null;
      needsUpdate = true;
    }
    if (user.isBoosted && user.boostExpire && now > new Date(user.boostExpire)) {
      user.isBoosted = false;
      user.boostExpire = null;
      needsUpdate = true;
    }

    user.online = true;
    user.lastSeen = now.toISOString();

    if (needsUpdate) {
      await pool.query('UPDATE users SET is_vip = $1, vip_expire = $2, is_boosted = $3, boost_expire = $4, online = $5, last_seen = $6 WHERE id = $7',
        [user.isVip, user.vipExpire, user.isBoosted, user.boostExpire, user.online, user.lastSeen, user.id]);
    } else {
      await pool.query('UPDATE users SET online = $1, last_seen = $2 WHERE id = $3', [user.online, user.lastSeen, user.id]);
    }

    // Vérifier l'octroi du bonus mensuel VIP si applicable
    user = await checkAndApplyVipBonus(user);

    req.session.userId = user.id;
    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Erreur login:", err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.status(401).json({ success: false });

    let user = mapUserFromDb(result.rows[0]);
    const now = new Date();
    let needsUpdate = false;

    if (user.isVip && user.vipExpire && now > new Date(user.vipExpire)) {
      user.isVip = false;
      user.vipExpire = null;
      needsUpdate = true;
    }
    if (user.isBoosted && user.boostExpire && now > new Date(user.boostExpire)) {
      user.isBoosted = false;
      user.boostExpire = null;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await pool.query('UPDATE users SET is_vip = $1, vip_expire = $2, is_boosted = $3, boost_expire = $4 WHERE id = $5',
        [user.isVip, user.vipExpire, user.isBoosted, user.boostExpire, user.id]);
    }

    // Vérifier l'octroi du bonus mensuel VIP
    user = await checkAndApplyVipBonus(user);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Erreur /api/me:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/logout', async (req, res) => {
  if (req.session.userId) {
    try {
      await pool.query('UPDATE users SET online = FALSE, last_seen = $1 WHERE id = $2', [new Date().toISOString(), req.session.userId]);
    } catch (err) {
      console.error("Erreur logout:", err);
    }
  }
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/user/photo', upload.single('photo'), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  if (!req.file) return res.status(400).json({ success: false, message: 'Aucune image fournie.' });

  try {
    await pool.query('UPDATE users SET photo = $1 WHERE id = $2', [req.file.path, req.session.userId]);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    let user = mapUserFromDb(result.rows[0]);
    user = await checkAndApplyVipBonus(user);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("Erreur photo update:", err);
    res.status(500).json({ success: false });
  }
});

// --- INTERACTIONS RENCONTRES (LIKES, SUPER LIKES, VISITEURS) ---

app.post('/api/users/like', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const { targetUserId } = req.body;

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const targetRes = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);

    if (userRes.rows.length === 0 || targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    }

    let user = mapUserFromDb(userRes.rows[0]);
    user = await checkAndApplyVipBonus(user);
    if (!user.likes) user.likes = [];
    const index = user.likes.indexOf(targetUserId);

    if (index > -1) {
      user.likes.splice(index, 1);
    } else {
      user.likes.push(targetUserId);
    }

    await pool.query('UPDATE users SET likes = $1 WHERE id = $2', [user.likes, user.id]);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, liked: index === -1 });
  } catch (err) {
    console.error("Erreur like:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/super-like', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const { targetUserId } = req.body;

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const targetRes = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);

    if (userRes.rows.length === 0 || targetRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    }

    let user = mapUserFromDb(userRes.rows[0]);
    user = await checkAndApplyVipBonus(user);
    
    // Réduction de 50% pour les VIP sur les Super Likes (5 au lieu de 10)
    const coutSuperLike = user.isVip ? 5 : 10;

    if ((user.nonvicoins || 0) < coutSuperLike && !user.isAdmin) {
      return res.status(400).json({ success: false, message: `Solde insuffisant ! Un Super Like coûte ${coutSuperLike} Nonvicoins.` });
    }

    if (!user.isAdmin) user.nonvicoins -= coutSuperLike;
    if (!user.superLikes) user.superLikes = [];
    if (!user.superLikes.includes(targetUserId)) {
      user.superLikes.push(targetUserId);
    }

    await pool.query('UPDATE users SET nonvicoins = $1, super_likes = $2 WHERE id = $3', [user.nonvicoins, user.superLikes, user.id]);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, message: 'Super Like envoyé avec succès !' });
  } catch (err) {
    console.error("Erreur super-like:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/visiter', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const { targetUserId } = req.body;
  if (req.session.userId === targetUserId) return res.json({ success: true });

  try {
    const targetRes = await pool.query('SELECT visiteurs FROM users WHERE id = $1', [targetUserId]);
    if (targetRes.rows.length > 0) {
      let visiteurs = targetRes.rows[0].visiteurs || [];
      visiteurs = visiteurs.filter(id => id !== req.session.userId);
      visiteurs.unshift(req.session.userId);
      await pool.query('UPDATE users SET visiteurs = $1 WHERE id = $2', [visiteurs, targetUserId]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur visiter:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/users/voir-visiteurs', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false });

    let user = mapUserFromDb(userRes.rows[0]);
    user = await checkAndApplyVipBonus(user);

    // Les VIP et Administrateurs ont un accès direct et gratuit aux visiteurs
    if (!user.isVip && !user.isAdmin) {
      const coutVisiteurs = 30;
      if ((user.nonvicoins || 0) < coutVisiteurs) {
        return res.status(400).json({ success: false, message: `Solde insuffisant ! Révéler les visiteurs coûte ${coutVisiteurs} Nonvicoins (Gratuit pour les VIP).` });
      }
      user.nonvicoins -= coutVisiteurs;
      await pool.query('UPDATE users SET nonvicoins = $1 WHERE id = $2', [user.nonvicoins, user.id]);
    }

    const visiteursDetails = [];
    for (const id of (user.visiteurs || [])) {
      const vRes = await pool.query('SELECT id, nom, photo, age, ville_originale FROM users WHERE id = $1', [id]);
      if (vRes.rows.length > 0) {
        const v = vRes.rows[0];
        visiteursDetails.push({ id: v.id, nom: v.nom, photo: v.photo, age: v.age, ville: v.ville_originale });
      }
    }

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, visiteurs: visiteursDetails });
  } catch (err) {
    console.error("Erreur voir-visiteurs:", err);
    res.status(500).json({ success: false });
  }
});

// --- VIP, BOOST & ACHAT DE COINS FEDAPAY ---

app.post('/api/vip/upgrade', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Non connecté.' });

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    let user = mapUserFromDb(userRes.rows[0]);
    const coutVipCoins = 80;

    if ((user.nonvicoins || 0) < coutVipCoins) {
      return res.status(400).json({ success: false, message: `Solde insuffisant ! Le statut VIP coûte ${coutVipCoins} Nonvicoins.` });
    }

    user.nonvicoins -= coutVipCoins;
    user.isVip = true;
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 30);
    user.vipExpire = expireDate.toISOString();
    user.vipLastBonus = new Date().toISOString(); // Marque le début du cycle pour le bonus mensuel

    await pool.query('UPDATE users SET nonvicoins = $1, is_vip = $2, vip_expire = $3, vip_last_bonus = $4 WHERE id = $5',
      [user.nonvicoins, user.isVip, user.vipExpire, user.vipLastBonus, user.id]);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, message: 'Félicitations, vous êtes désormais membre VIP !' });
  } catch (err) {
    console.error("Erreur vip upgrade:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/boost/upgrade', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Non connecté.' });

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    let user = mapUserFromDb(userRes.rows[0]);
    user = await checkAndApplyVipBonus(user);
    const coutBoostCoins = 50;

    if ((user.nonvicoins || 0) < coutBoostCoins) {
      return res.status(400).json({ success: false, message: `Solde insuffisant ! Le boost de profil coûte ${coutBoostCoins} Nonvicoins.` });
    }

    user.nonvicoins -= coutBoostCoins;
    user.isBoosted = true;
    const expireDate = new Date();
    expireDate.setHours(expireDate.getHours() + 24);
    user.boostExpire = expireDate.toISOString();

    await pool.query('UPDATE users SET nonvicoins = $1, is_boosted = $2, boost_expire = $3 WHERE id = $4',
      [user.nonvicoins, user.isBoosted, user.boostExpire, user.id]);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, message: 'Votre profil est boosté en haut de la liste pour 24h !' });
  } catch (err) {
    console.error("Erreur boost upgrade:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/coins/acheter', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Non connecté.' });

  const { pack } = req.body;
  let montantFCFA = 0;
  let nombreCoins = 0;

  if (pack === 'petit') { montantFCFA = 500; nombreCoins = 100; }
  else if (pack === 'moyen') { montantFCFA = 2000; nombreCoins = 500; }
  else if (pack === 'grand') { montantFCFA = 5000; nombreCoins = 1500; }
  else { return res.status(400).json({ success: false, message: 'Pack invalide.' }); }

  try {
    const userRes = await pool.query('SELECT nom, email FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    const user = userRes.rows[0];

    const transaction = await Transaction.create({
      description: `Achat de ${nombreCoins} Nonvicoins sur Nonvitcha`,
      amount: montantFCFA,
      currency: { iso: 'XOF' },
      callback_url: `${req.protocol}://${req.get('host')}/?coins_added=${nombreCoins}`,
      customer: {
        firstname: user.nom,
        lastname: 'Membre',
        email: user.email,
        phone_number: { number: '97000000', country: 'bj' }
      }
    });

    const token = await transaction.generateToken();
    res.json({ success: true, url: token.url, nombreCoins });

  } catch (error) {
    console.error("Erreur FedaPay:", error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'initialisation du paiement FedaPay.' });
  }
});

// --- SENSIBILISATION & ÉCOUTE ---

app.get('/api/ressources', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ressources');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.get('/api/ecoutes', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });

  try {
    const userRes = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(401).json({ success: false });
    const isAdmin = userRes.rows[0].is_admin;

    let result;
    if (isAdmin) {
      result = await pool.query('SELECT * FROM ecoutes');
    } else {
      result = await pool.query('SELECT * FROM ecoutes WHERE user_id = $1', [req.session.userId]);
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.post('/api/ecoutes', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const { categorie, message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'Le message est requis.' });

  try {
    const userRes = await pool.query('SELECT nom, is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(401).json({ success: false });
    const user = userRes.rows[0];

    const nouvelleEcoute = {
      id: Date.now().toString(),
      userId: req.session.userId,
      userName: user.nom,
      categorie: categorie || 'SSR',
      message: message.trim(),
      reponse: '',
      date: new Date().toLocaleDateString('fr-FR')
    };

    await pool.query(
      'INSERT INTO ecoutes (id, user_id, user_name, categorie, message, reponse, date) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [nouvelleEcoute.id, nouvelleEcoute.userId, nouvelleEcoute.userName, nouvelleEcoute.categorie, nouvelleEcoute.message, nouvelleEcoute.reponse, nouvelleEcoute.date]
    );

    let result;
    if (user.is_admin) {
      result = await pool.query('SELECT * FROM ecoutes');
    } else {
      result = await pool.query('SELECT * FROM ecoutes WHERE user_id = $1', [req.session.userId]);
    }
    res.json({ success: true, ecoutes: result.rows });
  } catch (err) {
    console.error("Erreur post ecoutes:", err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/ecoutes/repondre', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });

  try {
    const userRes = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0 || !userRes.rows[0].is_admin) {
      return res.status(403).json({ success: false, message: 'Réservé aux administrateurs.' });
    }

    const { ecouteId, reponse } = req.body;
    await pool.query('UPDATE ecoutes SET reponse = $1 WHERE id = $2', [reponse, ecouteId]);

    const result = await pool.query('SELECT * FROM ecoutes');
    res.json({ success: true, ecoutes: result.rows });
  } catch (err) {
    console.error("Erreur repondre ecoute:", err);
    res.status(500).json({ success: false });
  }
});

// --- UTILISATEURS (AVEC TRI DE VISIBILITÉ PRIORITAIRE VIP & BOOST) ---

app.get('/api/users', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  try {
    // Les profils boostés et VIP remontent en priorité automatique dans la liste
    const result = await pool.query(`
      SELECT * FROM users 
      ORDER BY 
        is_boosted DESC, 
        is_vip DESC, 
        id DESC
    `);
    
    const safeUsers = result.rows.map(row => {
      const u = mapUserFromDb(row);
      const { password, ...safe } = u;
      return safe;
    });
    res.json(safeUsers);
  } catch (err) {
    res.status(500).json([]);
  }
});

// --- CHAT PUBLIC ---

app.get('/api/chat', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  try {
    const result = await pool.query('SELECT * FROM chat ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.post('/api/chat', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ success: false });

  try {
    const userRes = await pool.query('SELECT nom, photo, is_vip FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(401).json({ success: false });
    const user = userRes.rows[0];

    const newMessage = {
      id: Date.now().toString(),
      userId: req.session.userId,
      userName: user.nom,
      userPhoto: user.photo,
      userVip: user.is_vip,
      message: message.trim(),
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    };

    await pool.query(
      'INSERT INTO chat (id, user_id, user_name, user_photo, user_vip, message, time) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [newMessage.id, newMessage.userId, newMessage.userName, newMessage.userPhoto, newMessage.userVip, newMessage.message, newMessage.time]
    );

    // Garder seulement les 100 derniers messages
    await pool.query(`DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 100)`);

    res.json({ success: true, message: newMessage });
  } catch (err) {
    console.error("Erreur chat:", err);
    res.status(500).json({ success: false });
  }
});

// --- PUBLICITÉS SPONSORISÉES ---

app.get('/api/publicites', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM publicites');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.post('/api/publicites', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Non connecté.' });
  const { titre, description, contact } = req.body;
  
  if (!titre || !description) {
    return res.status(400).json({ success: false, message: 'Le titre et la description sont requis.' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    let user = mapUserFromDb(userRes.rows[0]);
    user = await checkAndApplyVipBonus(user);

    // Réduction de 50% pour les VIP sur la publication d'annonces (25 au lieu de 50)
    const coutPubCoins = user.isVip ? 25 : 50;

    if ((user.nonvicoins || 0) < coutPubCoins && !user.isAdmin) {
      return res.status(400).json({ success: false, message: `Solde insuffisant ! Une publication publicitaire coûte ${coutPubCoins} Nonvicoins.` });
    }

    if (!user.isAdmin) user.nonvicoins -= coutPubCoins;

    await pool.query('UPDATE users SET nonvicoins = $1 WHERE id = $2', [user.nonvicoins, user.id]);

    const nouvellePub = {
      id: Date.now().toString(),
      titre,
      description,
      contact: contact || user.email,
      annonceur: user.nom,
      date: new Date().toLocaleDateString('fr-FR')
    };

    await pool.query(
      'INSERT INTO publicites (id, titre, description, contact, annonceur, date) VALUES ($1, $2, $3, $4, $5, $6)',
      [nouvellePub.id, nouvellePub.titre, nouvellePub.description, nouvellePub.contact, nouvellePub.annonceur, nouvellePub.date]
    );

    const allPubs = await pool.query('SELECT * FROM publicites');
    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, publicites: allPubs.rows });
  } catch (err) {
    console.error("Erreur publicites:", err);
    res.status(500).json({ success: false });
  }
});

app.delete('/api/publicites/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false });

  try {
    const userRes = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (userRes.rows.length === 0 || !userRes.rows[0].is_admin) {
      return res.status(403).json({ success: false, message: 'Réservé aux administrateurs.' });
    }

    await pool.query('DELETE FROM publicites WHERE id = $1', [req.params.id]);
    const allPubs = await pool.query('SELECT * FROM publicites');
    res.json({ success: true, publicites: allPubs.rows });
  } catch (err) {
    console.error("Erreur delete pub:", err);
    res.status(500).json({ success: false });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur Nonvitcha lancé sur le port ${PORT}`);
});
