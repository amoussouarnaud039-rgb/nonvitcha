const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.PORT || 3000;

// Configuration PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'nonvitcha_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Upload de photos
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, 'photo-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Middlewares d'authentification
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ success: false, message: 'Non autorisé' });
}

function isAdminAuthenticated(req, res, next) {
    if (req.session.isAdmin) return next();
    res.status(403).json({ success: false, message: 'Accès administrateur requis' });
}

// Middelware mise à jour de présence
app.use(async (req, res, next) => {
    if (req.session.user) {
        try {
            await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [req.session.user.id]);
        } catch (err) {
            console.error('Erreur last_seen:', err);
        }
    }
    next();
});

// ==========================================
// INITIALISATION DE LA BASE DE DONNÉES
// ==========================================
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(100),
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            age INT,
            sexe VARCHAR(10),
            ville VARCHAR(100),
            photo VARCHAR(255) DEFAULT '/uploads/default.png',
            nonvicoins INT DEFAULT 50,
            is_vip BOOLEAN DEFAULT FALSE,
            is_suspended BOOLEAN DEFAULT FALSE,
            last_seen TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS likes (
            id SERIAL PRIMARY KEY,
            sender_id INT REFERENCES users(id),
            receiver_id INT REFERENCES users(id),
            is_coup_de_coeur BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender_id INT REFERENCES users(id),
            receiver_id INT REFERENCES users(id),
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS public_chat (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id),
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ecoutes (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id),
            categorie VARCHAR(100),
            message TEXT,
            reponse TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS publicites (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id),
            titre VARCHAR(150),
            description TEXT,
            contact VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
}
initDB().catch(console.error);

// ==========================================
// AUTHENTIFICATION & UTILISATEURS
// ==========================================

app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, sexe, ville } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const photoPath = req.file ? `/uploads/${req.file.filename}` : '/uploads/default.png';

        const result = await pool.query(
            `INSERT INTO users (nom, email, password, age, sexe, ville, photo) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nom, email, nonvicoins, is_vip`,
            [nom, email, hashedPassword, age, sexe, ville, photoPath]
        );
        req.session.user = result.rows[0];
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Email déjà utilisé ou erreur serveur' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.json({ success: false, message: 'Identifiants incorrects' });

        const user = result.rows[0];
        if (user.is_suspended) return res.json({ success: false, message: 'Compte suspendu' });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.user = { id: user.id, nom: user.nom, email: user.email, nonvicoins: user.nonvicoins, is_vip: user.is_vip };
            res.json({ success: true, user: req.session.user });
        } else {
            res.json({ success: false, message: 'Identifiants incorrects' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.user) return res.json({ success: false });
    const result = await pool.query('SELECT id, nom, email, nonvicoins, is_vip, photo FROM users WHERE id = $1', [req.session.user.id]);
    res.json({ success: true, user: result.rows[0] });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, nom, age, sexe, ville, photo, is_vip, 
                    (last_seen > NOW() - INTERVAL '5 minutes') as is_online 
             FROM users WHERE id != $1 AND is_suspended = FALSE ORDER BY last_seen DESC`,
            [req.session.user.id]
        );
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
        const senderId = req.session.user.id;

        await pool.query(
            'INSERT INTO likes (sender_id, receiver_id, is_coup_de_coeur) VALUES ($1, $2, $3)',
            [senderId, receiverId, isCoupDeCoeur || false]
        );

        // Vérification de match
        const checkMatch = await pool.query(
            'SELECT * FROM likes WHERE sender_id = $1 AND receiver_id = $2',
            [receiverId, senderId]
        );

        res.json({ success: true, isMatch: checkMatch.rows.length > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// MESSAGERIE PRIVÉE (1-à-1)
// ==========================================

app.get('/api/messages/:otherUserId', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { otherUserId } = req.params;

        const result = await pool.query(
            `SELECT * FROM messages 
             WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
             ORDER BY created_at ASC`,
            [userId, otherUserId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages', isAuthenticated, async (req, res) => {
    try {
        const senderId = req.session.user.id;
        const { receiverId, message } = req.body;

        await pool.query(
            'INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)',
            [senderId, receiverId, message]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// CHAT PUBLIC
// ==========================================

app.get('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT pc.id, pc.message, pc.created_at, u.nom as username, u.is_vip as uservip 
             FROM public_chat pc JOIN users u ON pc.user_id = u.id 
             ORDER BY pc.created_at DESC LIMIT 50`
        );
        res.json(result.rows.reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const { message } = req.body;
        await pool.query('INSERT INTO public_chat (user_id, message) VALUES ($1, $2)', [req.session.user.id, message]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ÉCOUTE ET SOUTIEN (SOS / VBG)
// ==========================================

app.get('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ecoutes WHERE user_id = $1 ORDER BY created_at DESC', [req.session.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const { categorie, message } = req.body;
        await pool.query('INSERT INTO ecoutes (user_id, categorie, message) VALUES ($1, $2, $3)', [req.session.user.id, categorie, message]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ANNONCES & PUBLICITÉS
// ==========================================

app.get('/api/publicites', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.nom as annonceur FROM publicites p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publicites', isAuthenticated, async (req, res) => {
    try {
        const { titre, description, contact } = req.body;
        const userId = req.session.user.id;

        const userRes = await pool.query('SELECT nonvicoins, is_vip FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];
        const cost = user.is_vip ? 25 : 50;

        if (user.nonvicoins < cost) {
            return res.json({ success: false, message: `Solde insuffisant (${cost} Nonvicoins requis)` });
        }

        await pool.query('UPDATE users SET nonvicoins = nonvicoins - $1 WHERE id = $2', [cost, userId]);
        await pool.query('INSERT INTO publicites (user_id, titre, description, contact) VALUES ($1, $2, $3, $4)', [userId, titre, description, contact]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// RECHARGES & PAIEMENT KKIAPAY
// ==========================================

app.post('/api/kkiapay/verify', isAuthenticated, async (req, res) => {
    try {
        const { transactionId, coinsToCredit } = req.body;
        const userId = req.session.user.id;

        if (!transactionId) return res.status(400).json({ success: false, message: 'ID de transaction manquant' });

        await pool.query('UPDATE users SET nonvicoins = nonvicoins + $1 WHERE id = $2', [coinsToCredit, userId]);
        res.json({ success: true, message: 'Recharge effectuée avec succès' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ADMINISTRATION (LOGIN, VIP, COINS, MODÉRATION)
// ==========================================

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'NONVITCHA2026') {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Mot de passe administrateur incorrect' });
    }
});

app.get('/api/admin/users', isAdminAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nom, email, nonvicoins, is_vip, is_suspended FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/:id/vip', isAdminAuthenticated, async (req, res) => {
    try {
        const { isVip } = req.body;
        await pool.query('UPDATE users SET is_vip = $1 WHERE id = $2', [isVip, req.params.id]);
        res.json({ success: true, message: `Statut VIP mis à jour : ${isVip ? 'Activé' : 'Désactivé'}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/:id/coins', isAdminAuthenticated, async (req, res) => {
    try {
        const { amount } = req.body;
        await pool.query('UPDATE users SET nonvicoins = nonvicoins + $1 WHERE id = $2', [amount, req.params.id]);
        res.json({ success: true, message: 'Solde ajusté avec succès' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/:id/suspend', isAdminAuthenticated, async (req, res) => {
    try {
        await pool.query('UPDATE users SET is_suspended = TRUE WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'Compte suspendu' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/ecoutes', isAdminAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.*, u.nom, u.email FROM ecoutes e JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ecoutes/:id/repondre', isAdminAuthenticated, async (req, res) => {
    try {
        const { reponse } = req.body;
        await pool.query('UPDATE ecoutes SET reponse = $1 WHERE id = $2', [reponse, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Serveur Nonvitcha démarré sur le port ${port}`);
});
