const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialisation des tables PostgreSQL
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            nom VARCHAR(100),
            age INT,
            ville VARCHAR(100),
            photo TEXT,
            likes INT DEFAULT 0,
            nonvicoins INT DEFAULT 0,
            isVip BOOLEAN DEFAULT FALSE
        );
        CREATE TABLE IF NOT EXISTS chat (
            id VARCHAR(50) PRIMARY KEY,
            sender VARCHAR(100),
            text TEXT,
            date VARCHAR(50)
        );
        CREATE TABLE IF NOT EXISTS private_messages (
            id VARCHAR(50) PRIMARY KEY,
            sender_id VARCHAR(50),
            sender_name VARCHAR(100),
            target_id VARCHAR(50),
            text TEXT,
            date VARCHAR(50),
            is_read BOOLEAN DEFAULT FALSE
        );
        CREATE TABLE IF NOT EXISTS ressources (
            id VARCHAR(50) PRIMARY KEY,
            titre VARCHAR(255),
            categorie VARCHAR(50),
            contenu TEXT,
            date_publication TEXT
        );
        CREATE TABLE IF NOT EXISTS demandes_ecoute (
            id VARCHAR(50) PRIMARY KEY,
            utilisateur_id VARCHAR(50),
            sujet VARCHAR(255),
            message TEXT,
            statut VARCHAR(50),
            date_creation TEXT
        );
    `);
    
    // Insérer des ressources par défaut si la table est vide
    const resCount = await pool.query('SELECT COUNT(*) FROM ressources');
    if (parseInt(resCount.rows[0].count) === 0) {
        await pool.query(`
            INSERT INTO ressources (id, titre, categorie, contenu, date_publication) VALUES
            ('r1', 'Qu est-ce que le Planning Familial ?', 'SSR', 'Le planning familial est un droit fondamental...', NOW()),
            ('r2', 'Que faire en cas de violence ?', 'VBG', 'Si vous êtes victime ou témoin de violences...', NOW())
        `);
    }
}
initDB().catch(err => console.error("Erreur init DB:", err));

const fs = require('fs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

let activeSessions = {};

app.get('/api/auth/me', (req, res) => {
    res.json({ loggedIn: !!activeSessions.user, user: activeSessions.user });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
        const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 AND password = $2', [cleanEmail, password]);
        if (result.rows.length > 0) {
            activeSessions.user = result.rows[0];
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Email ou mot de passe incorrect' });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password, nom, age, ville } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    try {
        const check = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        if (check.rows.length > 0) {
            return res.json({ success: false, message: 'Email déjà utilisé' });
        }
        
        const id = Date.now().toString();
        const photo = 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=150';
        
        await pool.query(
            'INSERT INTO users (id, email, password, nom, age, ville, photo, likes, nonvicoins, isVip) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, FALSE)',
            [id, cleanEmail, password, nom, parseInt(age) || 18, ville, photo]
        );
        
        const newUser = (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
        activeSessions.user = newUser;
        io.emit('update-users', newUser);
        
        res.json({ success: true, user: newUser });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Erreur lors de l inscription' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    activeSessions = {};
    res.json({ success: true });
});

app.get('/api/users', async (req, res) => {
    try {
        const users = await pool.query('SELECT id, email, nom, age, ville, photo, likes, nonvicoins, isVip FROM users');
        res.json(users.rows);
    } catch (e) {
        res.json([]);
    }
});

app.get('/api/users/search', async (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    try {
        const users = await pool.query('SELECT id, email, nom, age, ville, photo, likes, nonvicoins, isVip FROM users');
        if (!query) return res.json(users.rows);
        const filtered = users.rows.filter(u => (u.nom && u.nom.toLowerCase().includes(query)) || (u.ville && u.ville.toLowerCase().includes(query)));
        res.json(filtered);
    } catch (e) {
        res.json([]);
    }
});

app.post('/api/users/upload-photo', upload.single('photo'), async (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    try {
        const photoPath = '/uploads/' + req.file.filename;
        await pool.query('UPDATE users SET photo = $1 WHERE id = $2', [photoPath, activeSessions.user.id]);
        activeSessions.user.photo = photoPath;
        res.json({ success: true, user: activeSessions.user });
    } catch (e) {
        res.json({ success: false });
    }
});

app.get('/api/chat', async (req, res) => {
    try {
        const chat = await pool.query('SELECT * FROM chat ORDER BY date ASC LIMIT 50');
        res.json(chat.rows);
    } catch (e) {
        res.json([]);
    }
});

app.get('/api/online-users', (req, res) => {
    res.json(activeSessions.user ? [activeSessions.user.id] : []);
});

app.post('/api/users/:id/like', async (req, res) => {
    try {
        await pool.query('UPDATE users SET likes = likes + 1 WHERE id = $1', [req.params.id]);
        io.emit('update-users');
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

app.post('/api/users/:id/buy-coins', async (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    try {
        await pool.query('UPDATE users SET nonvicoins = nonvicoins + 50 WHERE id = $1', [activeSessions.user.id]);
        const updated = await pool.query('SELECT * FROM users WHERE id = $1', [activeSessions.user.id]);
        activeSessions.user = updated.rows[0];
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

app.post('/api/users/:id/become-vip', async (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    try {
        if (activeSessions.user.nonvicoins >= 100) {
            await pool.query('UPDATE users SET nonvicoins = nonvicoins - 100, isVip = TRUE WHERE id = $1', [activeSessions.user.id]);
            const updated = await pool.query('SELECT * FROM users WHERE id = $1', [activeSessions.user.id]);
            activeSessions.user = updated.rows[0];
            io.emit('update-users');
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Solde insuffisant' });
        }
    } catch (e) {
        res.json({ success: false });
    }
});

app.get('/api/private-messages/:targetId', async (req, res) => {
    if (!activeSessions.user) return res.json([]);
    try {
        await pool.query('UPDATE private_messages SET is_read = TRUE WHERE sender_id = $1 AND target_id = $2', [req.params.targetId, activeSessions.user.id]);
        const msgs = await pool.query(
            'SELECT * FROM private_messages WHERE (sender_id = $1 AND target_id = $2) OR (sender_id = $2 AND target_id = $1) ORDER BY date ASC',
            [activeSessions.user.id, req.params.targetId]
        );
        res.json(msgs.rows.map(m => ({ id: m.id, senderId: m.sender_id, senderName: m.sender_name, targetId: m.target_id, text: m.text, date: m.date })));
    } catch (e) {
        res.json([]);
    }
});

app.get('/api/unread-messages', async (req, res) => {
    if (!activeSessions.user) return res.json({});
    try {
        const unread = await pool.query('SELECT sender_id, COUNT(*) as count FROM private_messages WHERE target_id = $1 AND is_read = FALSE GROUP BY sender_id', [activeSessions.user.id]);
        const counts = {};
        unread.rows.forEach(r => { counts[r.sender_id] = parseInt(r.count); });
        res.json(counts);
    } catch (e) {
        res.json({});
    }
});

app.get('/api/ressources', async (req, res) => {
    const { categorie } = req.query;
    try {
        let query = 'SELECT * FROM ressources';
        let params = [];
        if (categorie) {
            query += ' WHERE UPPER(categorie) = UPPER($1)';
            params.push(categorie);
        }
        const results = await pool.query(query, params);
        res.json(results.rows);
    } catch (e) {
        res.json([]);
    }
});

app.post('/api/ecoute', async (req, res) => {
    if (!activeSessions.user) return res.status(401).json({ success: false, error: "Non connecté" });
    const { sujet, message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "Message vide" });
    try {
        const id = 'ecoute_' + Date.now();
        await pool.query(
            'INSERT INTO demandes_ecoute (id, utilisateur_id, sujet, message, statut, date_creation) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, activeSessions.user.id, sujet || 'Général', message, 'en_attente', new Date().toISOString()]
        );
        res.status(201).json({ success: true, message: "Votre demande a été transmise en toute confidentialité." });
    } catch (e) {
        res.status(500).json({ success: false, error: "Erreur serveur" });
    }
});

// Routes Admin API
app.get('/api/admin/ecoutes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d.*, u.nom as nom_utilisateur 
            FROM demandes_ecoute d 
            LEFT JOIN users u ON d.utilisateur_id = u.id
        `);
        res.json(result.rows);
    } catch (e) {
        res.json([]);
    }
});

app.delete('/api/admin/ecoutes/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM demandes_ecoute WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/chat/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM chat WHERE id = $1', [req.params.id]);
        io.emit('delete-public-message', req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

io.on('connection', (socket) => {
    socket.on('send-public-message', async (data) => {
        const id = 'msg_' + Date.now();
        const date = new Date().toLocaleTimeString();
        try {
            await pool.query('INSERT INTO chat (id, sender, text, date) VALUES ($1, $2, $3, $4)', [id, data.sender, data.text, date]);
            io.emit('new-public-message', { id, sender: data.sender, text: data.text, date });
        } catch (e) {}
    });

    socket.on('send-private-message', async (data) => {
        const id = 'pmsg_' + Date.now();
        const date = new Date().toLocaleTimeString();
        try {
            await pool.query(
                'INSERT INTO private_messages (id, sender_id, sender_name, target_id, text, date, is_read) VALUES ($1, $2, $3, $4, $5, $6, FALSE)',
                [id, data.senderId, data.senderName, data.targetId, data.text, date]
            );
            io.emit(`private-message-${data.targetId}`, { id, senderId: data.senderId, senderName: data.senderName, targetId: data.targetId, text: data.text, date });
            io.emit(`private-message-${data.senderId}`, { id, senderId: data.senderId, senderName: data.senderName, targetId: data.targetId, text: data.text, date });
            io.emit(`unread-update-${data.targetId}`);
        } catch (e) {}
    });

    socket.on('typing', (data) => io.emit(`typing-${data.targetId}`, { senderName: data.senderName }));
    socket.on('stop-typing', (data) => io.emit(`stop-typing-${data.targetId}`));
});

server.listen(PORT, () => console.log(`Serveur lancé sur port ${PORT}`));
