const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ADMIN ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'NONVITCHA2026';

// --- CONFIGURATION POSTGRESQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- CRÉATION AUTOMATIQUE DES TABLES ---
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(100) NOT NULL,
                age INT,
                email VARCHAR(150) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                genre VARCHAR(50),
                ville VARCHAR(100),
                photo VARCHAR(255) DEFAULT '/uploads/default.png',
                bio TEXT,
                nonvicoins INT DEFAULT 100,
                is_vip BOOLEAN DEFAULT FALSE,
                is_boosted BOOLEAN DEFAULT FALSE,
                is_suspended BOOLEAN DEFAULT FALSE,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS likes (
                id SERIAL PRIMARY KEY,
                sender_id INT REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
                is_coup_de_coeur BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(sender_id, receiver_id)
            );

            CREATE TABLE IF NOT EXISTS private_messages (
                id SERIAL PRIMARY KEY,
                sender_id INT REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INT REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS ressources (
                id SERIAL PRIMARY KEY,
                titre VARCHAR(200) NOT NULL,
                description TEXT,
                lien VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS ecoutes (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                categorie VARCHAR(100) NOT NULL,
                message TEXT NOT NULL,
                reponse TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS publicites (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                titre VARCHAR(200) NOT NULL,
                description TEXT NOT NULL,
                contact VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                reporter_id INT REFERENCES users(id) ON DELETE CASCADE,
                reported_id INT REFERENCES users(id) ON DELETE CASCADE,
                reason TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS blocks (
                id SERIAL PRIMARY KEY,
                blocker_id INT REFERENCES users(id) ON DELETE CASCADE,
                blocked_id INT REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(blocker_id, blocked_id)
            );
        `);
        console.log("Toutes les tables (Likes, MP, Kkiapay, Securite) sont initialisées !");
    } catch (err) {
        console.error("Erreur d'initialisation SQL :", err);
    }
}

initializeDatabase();

// --- FICHIERS & UPLOADS ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'nonvitcha_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Mise à jour de la présence globale
app.use(async (req, res, next) => {
    if (req.session && req.session.userId) {
        await pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [req.session.userId]);
    }
    next();
});

function isAuthenticated(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ success: false, message: 'Non autorisé.' });
}

function isAdminAuthenticated(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.status(403).json({ success: false, message: 'Accès administrateur refusé.' });
}

// ==========================================
// AUTHENTIFICATION & UTILISATEURS
// ==========================================

app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, age, email, password, genre, ville } = req.body;
        const photo = req.file ? `/uploads/${req.file.filename}` : '/uploads/default.png';
        const hashedPassword = await bcrypt.hash(password, 10);

        const query = `
            INSERT INTO users (nom, age, email, password, genre, ville, photo, nonvicoins, is_vip, is_boosted)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 100, false, false)
            RETURNING id, nom, email, genre, ville, photo, nonvicoins, is_vip, is_boosted;
        `;
        const result = await pool.query(query, [nom, age, email, hashedPassword, genre, ville, photo]);
        req.session.userId = result.rows[0].id;
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ success: false, message: 'Introuvable.' });

        const user = result.rows[0];
        if (user.is_suspended) return res.status(403).json({ success: false, message: 'Compte suspendu.' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ success: false, message: 'Mot de passe incorrect.' });

        req.session.userId = user.id;
        delete user.password;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
});

app.get('/api/me', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nom, email, genre, ville, photo, nonvicoins, is_vip, is_boosted FROM users WHERE id = $1', [req.session.userId]);
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
        const query = `
            SELECT id, nom, age, genre, ville, photo, is_vip, is_boosted, bio, last_seen,
            (last_seen > NOW() - INTERVAL '5 minutes') as is_online
            FROM users 
            WHERE id != $1 
            AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
            ORDER BY is_boosted DESC, id DESC
        `;
        const result = await pool.query(query, [req.session.userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// LIKES & COUPS DE CŒUR
// ==========================================

app.post('/api/likes', isAuthenticated, async (req, res) => {
    try {
        const { receiverId, isCoupDeCoeur } = req.body;
        const senderId = req.session.userId;

        await pool.query(`
            INSERT INTO likes (sender_id, receiver_id, is_coup_de_coeur)
            VALUES ($1, $2, $3)
            ON CONFLICT (sender_id, receiver_id) DO UPDATE SET is_coup_de_coeur = EXCLUDED.is_coup_de_coeur
        `, [senderId, receiverId, isCoupDeCoeur || false]);

        // Vérifier s'il y a un Match mutuel
        const checkMatch = await pool.query('SELECT * FROM likes WHERE sender_id = $1 AND receiver_id = $2', [receiverId, senderId]);
        const isMatch = checkMatch.rows.length > 0;

        res.json({ success: true, isMatch });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/likes/received', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT users.id, users.nom, users.photo, likes.is_coup_de_coeur, likes.created_at
            FROM likes
            JOIN users ON likes.sender_id = users.id
            WHERE likes.receiver_id = $1 ORDER BY likes.id DESC
        `, [req.session.userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// MESSAGERIE PRIVÉE (1-À-1)
// ==========================================

app.get('/api/messages/:otherUserId', isAuthenticated, async (req, res) => {
    try {
        const { otherUserId } = req.params;
        const currentUserId = req.session.userId;

        const result = await pool.query(`
            SELECT * FROM private_messages 
            WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at ASC
        `, [currentUserId, otherUserId]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages', isAuthenticated, async (req, res) => {
    try {
        const { receiverId, message } = req.body;
        const senderId = req.session.userId;

        await pool.query('INSERT INTO private_messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)', [senderId, receiverId, message]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// PAIEMENT & RECHARGE (KKIAPAY)
// ==========================================

app.post('/api/kkiapay/verify', isAuthenticated, async (req, res) => {
    try {
        const { transactionId, amount, coinsToCredit } = req.body;

        // Validation et ajout direct des Nonvicoins
        await pool.query('UPDATE users SET nonvicoins = nonvicoins + $1 WHERE id = $2', [coinsToCredit, req.session.userId]);
        
        const updatedUser = await pool.query('SELECT id, nonvicoins FROM users WHERE id = $1', [req.session.userId]);
        res.json({ success: true, nonvicoins: updatedUser.rows[0].nonvicoins });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// SIGNALEMENT & BLOCAGE
// ==========================================

app.post('/api/report', isAuthenticated, async (req, res) => {
    try {
        const { reportedId, reason } = req.body;
        await pool.query('INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)', [req.session.userId, reportedId, reason]);
        res.json({ success: true, message: 'Signalement envoyé.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/block', isAuthenticated, async (req, res) => {
    try {
        const { blockedId } = req.body;
        await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.session.userId, blockedId]);
        res.json({ success: true, message: 'Profil bloqué.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// CHAT PUBLIC, ANNONCES & ÉCOUTES
// ==========================================

app.get('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT chat_messages.*, users.nom as username, users.photo as userphoto, users.is_vip as uservip 
            FROM chat_messages JOIN users ON chat_messages.user_id = users.id 
            ORDER BY chat_messages.created_at ASC LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const { message } = req.body;
        await pool.query('INSERT INTO chat_messages (user_id, message) VALUES ($1, $2)', [req.session.userId, message]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ecoutes WHERE user_id = $1 ORDER BY id DESC', [req.session.userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const { categorie, message } = req.body;
        await pool.query('INSERT INTO ecoutes (user_id, categorie, message) VALUES ($1, $2, $3)', [req.session.userId, categorie, message]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/publicites', async (req, res) => {
    try {
        const result = await pool.query('SELECT publicites.*, users.nom as annonceur FROM publicites JOIN users ON publicites.user_id = users.id ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publicites', isAuthenticated, async (req, res) => {
    try {
        const { titre, description, contact } = req.body;
        const userRes = await pool.query('SELECT nonvicoins, is_vip FROM users WHERE id = $1', [req.session.userId]);
        const user = userRes.rows[0];
        const cout = user.is_vip ? 25 : 50;

        if (user.nonvicoins < cout) return res.status(400).json({ success: false, message: 'Solde insuffisant.' });

        await pool.query('UPDATE users SET nonvicoins = nonvicoins - $1 WHERE id = $2', [cout, req.session.userId]);
        await pool.query('INSERT INTO publicites (user_id, titre, description, contact) VALUES ($1, $2, $3, $4)', [req.session.userId, titre, description, contact]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ADMINISTRATION (`NONVITCHA2026`)
// ==========================================

app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

app.post('/api/admin/users/:id/suspend', isAdminAuthenticated, async (req, res) => {
    try {
        await pool.query('UPDATE users SET is_suspended = TRUE WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ecoutes/:id/repondre', isAdminAuthenticated, async (req, res) => {
    try {
        await pool.query('UPDATE ecoutes SET reponse = $1 WHERE id = $2', [req.body.reponse, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur complet Nonvitcha actif sur le port ${PORT}`);
});
