const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

// Configuration de la Session
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'nonvitcha_secret_key_2026',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false, // Fonctionne derrière le proxy Render avec trust proxy
        maxAge: 24 * 60 * 60 * 1000 
    }
});

app.use(sessionMiddleware);

// Partage de session avec Socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// Configuration Multer pour les images
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Middlewares d'Authentification
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'Non autorisé' });
};

const isAdminAuthenticated = (req, res, next) => {
    if (req.session && req.session.isAdmin) return next();
    res.status(403).json({ error: 'Accès administrateur refusé' });
};

/* ==========================================================================
   SOCKET.IO - TCHAT PRIVE EN TEMPS REEL & STATUT EN LIGNE
   ========================================================================== */

const onlineUsers = new Map(); // userId -> socketId

io.on('connection', async (socket) => {
    const user = socket.request.session?.user;

    if (user) {
        onlineUsers.set(user.id, socket.id);
        await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
        io.emit('user_status_change', { userId: user.id, isOnline: true });
    }

    // Gestion de la messagerie privée en temps réel
    socket.on('send_private_message', async ({ receiver_id, content }) => {
        if (!user) return;

        const MESSAGE_COST = 5;

        try {
            // Récupérer le statut actuel de l'utilisateur
            const userRes = await pool.query('SELECT nonvicoins, is_vip FROM users WHERE id = $1', [user.id]);
            const currentUser = userRes.rows[0];

            // Déduction de Nonvicoins pour les non-VIP
            if (!currentUser.is_vip) {
                if (currentUser.nonvicoins < MESSAGE_COST) {
                    return socket.emit('error_message', { message: 'Nonvicoins insuffisants pour envoyer un message.' });
                }
                await pool.query('UPDATE users SET nonvicoins = nonvicoins - $1 WHERE id = $2', [MESSAGE_COST, user.id]);
                socket.request.session.user.nonvicoins -= MESSAGE_COST;
                socket.request.session.save();
            }

            // Insertion en BDD
            const msgRes = await pool.query(
                `INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *`,
                [user.id, receiver_id, content]
            );

            const msgData = msgRes.rows[0];

            // Transmission au destinataire s'il est connecté
            const receiverSocketId = onlineUsers.get(Number(receiver_id));
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('receive_private_message', msgData);
            }

            // Confirmation à l'expéditeur avec le nouveau solde
            socket.emit('message_sent', { 
                msgData, 
                newBalance: currentUser.is_vip ? currentUser.nonvicoins : currentUser.nonvicoins - MESSAGE_COST 
            });

        } catch (err) {
            console.error("Erreur socket message:", err);
            socket.emit('error_message', { message: 'Erreur lors de l’envoi du message.' });
        }
    });

    socket.on('disconnect', async () => {
        if (user) {
            onlineUsers.delete(user.id);
            await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
            io.emit('user_status_change', { userId: user.id, isOnline: false });
        }
    });
});

/* ==========================================================================
   ROUTES AUTHENTIFICATION
   ========================================================================== */

app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, sexe, ville } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const photoPath = req.file ? `/uploads/${req.file.filename}` : '/uploads/default.png';

        const result = await pool.query(
            `INSERT INTO users (nom, email, password, age, sexe, ville, photo, nonvicoins, is_vip) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 50, FALSE) RETURNING id, nom, email, nonvicoins, is_vip`,
            [nom, email, hashedPassword, age, sexe, ville, photoPath]
        );

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

app.get('/api/me', async (req, res) => {
    if (req.session && req.session.user) {
        try {
            const userRes = await pool.query(
                `SELECT id, nom, email, nonvicoins, is_vip, photo, ville, age, sexe,
                 (last_seen > NOW() - INTERVAL '5 minutes') as is_online 
                 FROM users WHERE id = $1`, 
                [req.session.user.id]
            );
            if (userRes.rows.length > 0) {
                req.session.user = userRes.rows[0];
                return res.json({ loggedIn: true, user: req.session.user });
            }
        } catch (err) {
            console.error("Erreur /api/me:", err);
        }
    }
    res.json({ loggedIn: false });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

/* ==========================================================================
   ROUTES MEMBRES & RECHERCHE
   ========================================================================== */

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

/* ==========================================================================
   INTERACTIONS & MONETISATION (Likes, Private Chat, VIP)
   ========================================================================== */

app.post('/api/like', isAuthenticated, async (req, res) => {
    try {
        const { receiver_id, is_coup_de_coeur } = req.body;
        const sender_id = req.session.user.id;

        if (is_coup_de_coeur) {
            const userRes = await pool.query('SELECT nonvicoins, is_vip FROM users WHERE id = $1', [sender_id]);
            const user = userRes.rows[0];

            if (!user.is_vip && user.nonvicoins < 10) {
                return res.status(400).json({ success: false, message: 'Nonvicoins insuffisants (10 requis)' });
            }

            if (!user.is_vip) {
                await pool.query('UPDATE users SET nonvicoins = nonvicoins - 10 WHERE id = $1', [sender_id]);
                req.session.user.nonvicoins -= 10;
            }
        }

        await pool.query(
            `INSERT INTO likes (sender_id, receiver_id, is_coup_de_coeur) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [sender_id, receiver_id, is_coup_de_coeur]
        );

        res.json({ success: true, newBalance: req.session.user.nonvicoins });
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
        const MESSAGE_COST = 5;

        const userRes = await pool.query('SELECT nonvicoins, is_vip FROM users WHERE id = $1', [sender_id]);
        const user = userRes.rows[0];

        if (!user.is_vip) {
            if (user.nonvicoins < MESSAGE_COST) {
                return res.status(400).json({ success: false, message: 'Nonvicoins insuffisants pour envoyer un message.' });
            }
            await pool.query('UPDATE users SET nonvicoins = nonvicoins - $1 WHERE id = $2', [MESSAGE_COST, sender_id]);
            req.session.user.nonvicoins -= MESSAGE_COST;
        }

        const result = await pool.query(
            `INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *`,
            [sender_id, receiver_id, content]
        );

        res.json({ success: true, message: result.rows[0], newBalance: req.session.user.nonvicoins });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vip/buy', isAuthenticated, async (req, res) => {
    try {
        const sender_id = req.session.user.id;
        const VIP_COST = 500;

        const userRes = await pool.query('SELECT nonvicoins, is_vip FROM users WHERE id = $1', [sender_id]);
        const user = userRes.rows[0];

        if (user.is_vip) {
            return res.status(400).json({ success: false, message: 'Vous êtes déjà membre VIP.' });
        }

        if (user.nonvicoins < VIP_COST) {
            return res.status(400).json({ success: false, message: 'Nonvicoins insuffisants (500 requis).' });
        }

        await pool.query('UPDATE users SET nonvicoins = nonvicoins - $1, is_vip = TRUE WHERE id = $2', [VIP_COST, sender_id]);
        req.session.user.nonvicoins -= VIP_COST;
        req.session.user.is_vip = true;

        res.json({ success: true, message: 'Félicitations, vous êtes désormais VIP !', newBalance: req.session.user.nonvicoins });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ==========================================================================
   TCHAT PUBLIC
   ========================================================================== */

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

/* ==========================================================================
   SALLE D'ECOUTE SOS ET SSR (SANTE SEXUELLE ET REPRODUCTIVE)
   ========================================================================== */

app.post('/api/ecoutes', isAuthenticated, async (req, res) => {
    try {
        const { type_demande, message } = req.body;
        const user_id = req.session.user.id;
        await pool.query(
            `INSERT INTO ecoutes (user_id, type_demande, message) VALUES ($1, $2, $3)`,
            [user_id, type_demande, message]
        );
        res.json({ success: true, message: 'Votre demande d’écoute a été transmise en toute confidentialité.' });
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

/* ==========================================================================
   PUBLICITES ET ANNONCES
   ========================================================================== */

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
        req.session.user.nonvicoins -= 50;

        await pool.query(`INSERT INTO publicites (user_id, titre, description, image) VALUES ($1, $2, $3, $4)`, [user_id, titre, description, imagePath]);
        res.json({ success: true, newBalance: req.session.user.nonvicoins });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ==========================================================================
   PAIEMENTS KKIAPAY
   ========================================================================== */

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

/* ==========================================================================
   E-SPACE ADMINISTRATION
   ========================================================================== */

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

// Lancement du serveur HTTP avec Socket.IO
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Nonvitcha opérationnel sur le port ${PORT}`);
});
