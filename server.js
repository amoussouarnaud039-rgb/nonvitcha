const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION POSTGRESQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- CRÉATION AUTOMATIQUE DU DOSSIER UPLOADS ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --- CONFIGURATION UPLOAD FICHIERS (Multer) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
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
    cookie: { secure: false } // Mettre à true si HTTPS strict avec proxy
}));

// Middleware de vérification d'authentification
function isAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ success: false, message: 'Non autorisé. Veuillez vous connecter.' });
}

// ==========================================
// ROUTES AUTHENTIFICATION & UTILISATEURS
// ==========================================

// Inscription
app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, age, email, password, genre, ville } = req.body;
        const photo = req.file ? `/uploads/${req.file.filename}` : '/uploads/default.png';
        
        // Hash du mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        const query = `
            INSERT INTO users (nom, age, email, password, genre, ville, photo, nonvicoins, is_vip, is_boosted)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 100, false, false)
            RETURNING id, nom, email, genre, ville, photo, nonvicoins, is_vip, is_boosted;
        `;
        const values = [nom, age, email, hashedPassword, genre, ville, photo];
        const result = await pool.query(query, values);
        
        const user = result.rows[0];
        req.session.userId = user.id;

        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription (email peut-être déjà utilisé).' });
    }
});

// Connexion
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Utilisateur introuvable.' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(400).json({ success: false, message: 'Mot de passe incorrect.' });
        }

        req.session.userId = user.id;
        delete user.password;

        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la connexion.' });
    }
});

// Récupérer la session courante
app.get('/api/me', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nom, email, genre, ville, photo, nonvicoins, is_vip, is_boosted FROM users WHERE id = $1', [req.session.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé.' });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
});

// Déconnexion
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Liste des utilisateurs (Découverte)
app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nom, age, genre, ville, photo, is_vip, is_boosted, bio FROM users ORDER BY is_boosted DESC, id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTES CHAT PUBLIC
// ==========================================
app.get('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT chat_messages.*, users.nom as username, users.photo as userphoto, users.is_vip as uservip 
            FROM chat_messages 
            JOIN users ON chat_messages.user_id = users.id 
            ORDER BY chat_messages.created_at ASC LIMIT 100
        `);
        const messages = result.rows.map(m => ({
            id: m.id,
            userId: m.user_id,
            userName: m.username,
            userPhoto: m.userphoto,
            userVip: m.is_vip,
            message: m.message,
            time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
        res.json(messages);
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

// ==========================================
// ROUTES RESSOURCES & SSR / VBG (ÉCOUTE)
// ==========================================
app.get('/api/ressources', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ressources ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ecoutes.*, users.nom as username 
            FROM ecoutes 
            JOIN users ON ecoutes.user_id = users.id 
            WHERE user_id = $1 ORDER BY ecoutes.id DESC
        `, [req.session.userId]);
        
        const ecoutes = result.rows.map(e => ({
            id: e.id,
            userName: e.username,
            categorie: e.categorie,
            message: e.message,
            reponse: e.reponse,
            date: new Date(e.created_at).toLocaleDateString()
        }));
        res.json(ecoutes);
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

// ==========================================
// ROUTES ANNONCES & PUBLICITÉS
// ==========================================
app.get('/api/publicites', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT publicites.*, users.nom as annonceur 
            FROM publicites 
            JOIN users ON publicites.user_id = users.id 
            ORDER BY publicites.id DESC
        `);
        const pubs = result.rows.map(p => ({
            id: p.id,
            titre: p.titre,
            description: p.description,
            contact: p.contact,
            annonceur: p.annonceur,
            date: new Date(p.created_at).toLocaleDateString()
        }));
        res.json(pubs);
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

        if (user.nonvicoins < cout) {
            return res.status(400).json({ success: false, message: `Solde insuffisant. Il vous faut ${cout} Nonvicoins.` });
        }

        await pool.query('UPDATE users SET nonvicoins = nonvicoins - $1 WHERE id = $2', [cout, req.session.userId]);
        await pool.query('INSERT INTO publicites (user_id, titre, description, contact) VALUES ($1, $2, $3, $4)', [req.session.userId, titre, description, contact]);

        const updatedUser = await pool.query('SELECT id, nom, email, genre, ville, photo, nonvicoins, is_vip, is_boosted FROM users WHERE id = $1', [req.session.userId]);
        res.json({ success: true, user: updatedUser.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// LANCEMENT DU SERVEUR
// ==========================================
app.listen(PORT, () => {
    console.log(`Serveur Nonvitcha démarré sur le port ${PORT}`);
});
