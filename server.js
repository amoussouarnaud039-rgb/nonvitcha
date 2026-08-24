const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// OBLIGATOIRE POUR RENDER (Gestion des sessions sous HTTPS)
app.set('trust proxy', 1);

// Création automatique du dossier public/uploads
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuration PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middlewares de base
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuration de la Session corrigée
app.use(session({
    secret: 'nonvitcha_secret_key_2026',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false, // Fonctionne derrière le proxy Render
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'Non autorisé' });
};

const isAdminAuthenticated = (req, res, next) => {
    if (req.session && req.session.isAdmin) return next();
    res.status(403).json({ error: 'Accès administrateur refusé' });
};

/* --- ROUTES AUTHENTIFICATION --- */

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

        // Sauvegarde explicite de la session avant d'envoyer la réponse
        req.session.user = result.rows[0];
        req.session.save((err) => {
            if (err) {
                console.error("Erreur sauvegarde session:", err);
                return res.status(500).json({ success: false, message: 'Erreur lors de la création de la session.' });
            }
            res.json({ success: true, user: result.rows[0] });
        });

    } catch (err) {
        console.error("Erreur inscription:", err.message);
        if (err.code === '23505') {
            res.status(400).json({ success: false, message: 'Cette adresse email est déjà enregistrée.' });
        } else {
            res.status(500).json({ success: false, message: 'Erreur serveur: ' + err.message });
        }
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ success: false, message: 'Identifiants incorrects' });

        const user = result.rows[0];
        if (user.is_suspended) return res.status(403).json({ success: false, message: 'Compte suspendu' });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
            
            req.session.user = { id: user.id, nom: user.nom, email: user.email, nonvicoins: user.nonvicoins, is_vip: user.is_vip };
            req.session.save((err) => {
                if (err) return res.status(500).json({ success: false, message: 'Erreur session' });
                res.json({ success: true, user: req.session.user });
            });
        } else {
            res.status(400).json({ success: false, message: 'Identifiants incorrects' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

/* --- ROUTES MEMBRES & RECHERCHE --- */

app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
        const { search } = req.query;
        let query = `SELECT id, nom, age, sexe, ville, photo, is_vip, 
                            (last_seen > NOW() - INTERVAL '5 minutes') as is_online 
                     FROM users WHERE id != $1 AND is_suspended = FALSE`;
        let params = [req.session.user.id];

        if (search && search.trim() !== '') {
            query += ` AND (LOWER(nom) LIKE LOWER($2) OR LOWER(ville) LIKE LOWER($2))`;
            params.push(`%${search.trim()}%`);
        }

        query += ` ORDER BY last_seen DESC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* --- INTERACTIONS --- */

app.post('/api/like', isAuthenticated, async (req, res) => {
    try {
        const { receiver_id, is_coup_de_coeur } = req.body;
        const sender_id = req.session.user.id;

        if (is_coup_de_coeur) {
            const userRes = await pool.query('SELECT nonvicoins FROM users WHERE id = $1', [sender_id]);
            if (userRes.rows[0].nonvicoins < 10) {
                return res.status(400).json({ success: false, message: 'Nonvicoins insuffisants' });
            }
            await pool.query('UPDATE users SET nonvicoins = nonvicoins - 10 WHERE id = $1', [sender_id]);
        }

        await pool.query(
            `INSERT INTO likes (sender_id, receiver_id, is_coup_de_coeur) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [sender_id, receiver_id, is_coup_de_coeur]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/messages/:receiver_id', isAuthenticated, async (req, res) => {
    try {
        const sender_id = req.session.user.id;
        const { receiver_id } = req.params;
        const result = await pool.query(
            `SELECT * FROM messages 
             WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
             ORDER BY created_at ASC`,
            [sender_id, receiver_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages', isAuthenticated, async (req, res) => {
    try {
        const { receiver_id, content } = req.body;
        const sender_id = req.session.user.id;
        const result = await pool.query(
            `INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *`,
            [sender_id, receiver_id, content]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.nom FROM public_chat p JOIN users u ON p.user_id = u.id ORDER BY p.created_at ASC LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const { content } = req.body;
        const user_id = req.session.user.id;
        const result = await pool.query(
            `INSERT INTO public_chat (user_id, content) VALUES ($1, $2) RETURNING *`,
            [user_id, content]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const { type_demande, message } = req.body;
        const user_id = req.session.user.id;
        await pool.query(
            `INSERT INTO ecoutes (user_id, type_demande, message) VALUES ($1, $2, $3)`,
            [user_id, type_demande, message]
        );
        res.json({ success: true, message: 'Votre demande d’écoute a été envoyée.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ecoutes/mes-demandes', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM ecoutes WHERE user_id = $1 ORDER BY created_at DESC`, [req.session.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/publicites', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`SELECT p.*, u.nom FROM publicites p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publicites', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        const { titre, description } = req.body;
        const user_id = req.session.user.id;
        const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

        const userRes = await pool.query('SELECT nonvicoins FROM users WHERE id = $1', [user_id]);
        if (userRes.rows[0].nonvicoins < 50) {
            return res.status(400).json({ success: false, message: 'Frais de publication : 50 Nonvicoins requis.' });
        }

        await pool.query('UPDATE users SET nonvicoins = nonvicoins - 50 WHERE id = $1', [user_id]);
        await pool.query(`INSERT INTO publicites (user_id, titre, description, image) VALUES ($1, $2, $3, $4)`, [user_id, titre, description, imagePath]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/kkiapay/verify', isAuthenticated, async (req, res) => {
    try {
        const { amount } = req.body;
        const user_id = req.session.user.id;

        let coinsToAdd = 0;
        if (amount >= 5000) coinsToAdd = 600;
        else if (amount >= 2000) coinsToAdd = 220;
        else if (amount >= 1000) coinsToAdd = 100;

        await pool.query('UPDATE users SET nonvicoins = nonvicoins + $1 WHERE id = $2', [coinsToAdd, user_id]);
        req.session.user.nonvicoins += coinsToAdd;

        res.json({ success: true, newBalance: req.session.user.nonvicoins });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* --- ADMIN --- */

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'NONVITCHA2026') {
        req.session.isAdmin = true;
        req.session.save(() => res.json({ success: true }));
    } else {
        res.status(401).json({ success: false, message: 'Mot de passe incorrect' });
    }
});

app.get('/api/admin/users', isAdminAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nom, email, age, ville, is_vip, is_suspended, nonvicoins FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/action', isAdminAuthenticated, async (req, res) => {
    try {
        const { userId, action, value } = req.body;
        if (action === 'toggle_vip') {
            await pool.query('UPDATE users SET is_vip = $1 WHERE id = $2', [value, userId]);
        } else if (action === 'toggle_suspend') {
            await pool.query('UPDATE users SET is_suspended = $1 WHERE id = $2', [value, userId]);
        } else if (action === 'add_coins') {
            await pool.query('UPDATE users SET nonvicoins = nonvicoins + $1 WHERE id = $2', [value, userId]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', isAdminAuthenticated, async (req, res) => {
    try {
        const userId = req.params.id;
        await pool.query('DELETE FROM likes WHERE sender_id = $1 OR receiver_id = $1', [userId]);
        await pool.query('DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1', [userId]);
        await pool.query('DELETE FROM public_chat WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM ecoutes WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM publicites WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/ecoutes', isAdminAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`SELECT e.*, u.nom, u.email FROM ecoutes e JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ecoutes/repondre', isAdminAuthenticated, async (req, res) => {
    try {
        const { ecouteId, reponse } = req.body;
        await pool.query('UPDATE ecoutes SET reponse = $1, statut = $2 WHERE id = $3', [reponse, 'Traité', ecouteId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
