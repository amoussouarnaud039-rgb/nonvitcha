const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- ASSURER L'EXISTENCE DU DOSSIER UPLOADS SUR RENDER ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Storage Multer pour les photos de profil
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Base de données temporaire en mémoire
let users = [
    { id: '1', nom: 'Aïcha', email: 'aicha@test.com', password: '123', age: 24, sexe: 'F', pays: 'Bénin', ville: 'Cotonou', interets: 'Musique, Voyage', photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300', coins: 100, isVip: true, online: true },
    { id: '2', nom: 'Koffi', email: 'koffi@test.com', password: '123', age: 28, sexe: 'M', pays: 'Bénin', ville: 'Porto-Novo', interets: 'Sport, Tech', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300', coins: 50, isVip: false, online: true },
    { id: '3', nom: 'Sonia', email: 'sonia@test.com', password: '123', age: 22, sexe: 'F', pays: 'Togo', ville: 'Lomé', interets: 'Cuisine, Mode', photo: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300', coins: 80, isVip: false, online: false },
    { id: '4', nom: 'Yves', email: 'yves@test.com', password: '123', age: 30, sexe: 'M', pays: 'Bénin', ville: 'Parakou', interets: 'Art, Cinéma', photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300', coins: 150, isVip: true, online: false }
];

let ecoutes = []; // Messages Sensibilisation SOS / VBG
let hearts = [];  // Coups de cœur enregistrés
let likes = [];   // Likes enregistrés

// --- AUTHENTIFICATION ---
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password);
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
    
    user.online = true;
    res.json({ user });
});

app.post('/api/register', upload.single('photo'), (req, res) => {
    try {
        const { nom, email, password, age, sexe, pays, ville, interets } = req.body;

        if (!email || !nom || !password) {
            return res.status(400).json({ error: 'Veuillez remplir tous les champs obligatoires.' });
        }

        // 1. Contrôle d'existence de l'e-mail
        const existingUser = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase().trim());
        if (existingUser) {
            return res.status(400).json({ error: 'Cet e-mail est déjà utilisé. Veuillez vous connecter.' });
        }

        // 2. Création du nouvel utilisateur
        const newUser = {
            id: Date.now().toString(),
            nom: nom.trim(), 
            email: email.toLowerCase().trim(), 
            password, 
            age: parseInt(age) || 18, 
            sexe: sexe || 'M', 
            pays: pays || 'Bénin', 
            ville: ville || 'Cotonou', 
            interets: interets || '',
            photo: req.file ? `/uploads/${req.file.filename}` : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300',
            coins: 50, 
            isVip: false, 
            online: true
        };

        users.push(newUser);
        res.json({ user: newUser });
    } catch (error) {
        console.error("Erreur serveur inscription:", error);
        res.status(500).json({ error: "Erreur lors de la création du compte." });
    }
});

// --- MISE À JOUR DE LA PHOTO DE PROFIL ---
app.post('/api/update-photo', upload.single('photo'), (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId || !req.file) {
            return res.status(400).json({ error: 'Fichier ou identifiant manquant.' });
        }

        const user = users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }

        user.photo = `/uploads/${req.file.filename}`;
        res.json({ success: true, photoUrl: user.photo });
    } catch (error) {
        console.error("Erreur mise à jour photo:", error);
        res.status(500).json({ error: "Impossible d'enregistrer l'image." });
    }
});

// --- LISTE DES MEMBRES ET MATCHS ---
app.get('/api/members', (req, res) => {
    const userId = req.query.userId;
    
    const membersWithMatch = users.map(user => {
        let isMatch = false;
        if (userId) {
            const sentHeart = hearts.some(h => h.senderId === userId && h.targetId === user.id);
            const receivedHeart = hearts.some(h => h.senderId === user.id && h.targetId === userId);
            if (sentHeart && receivedHeart) isMatch = true;
        }
        
        // Sécurisation : Exclusion du mot de passe dans le retour
        const { password, ...safeUser } = user;
        return { ...safeUser, isMatch };
    });
    
    res.json(membersWithMatch);
});

// --- INTERACTIONS (LIKE & COUP DE CŒUR) ---
app.post('/api/like', (req, res) => {
    const { senderId, targetId } = req.body;
    if (!likes.some(l => l.senderId === senderId && l.targetId === targetId)) {
        likes.push({ senderId, targetId });
    }
    res.json({ success: true });
});

app.post('/api/heart', (req, res) => {
    const { senderId, targetId } = req.body;
    const existing = hearts.find(h => h.senderId === senderId && h.targetId === targetId);
    if (!existing) hearts.push({ senderId, targetId });

    // Vérification du Match réciproque
    const isMatch = hearts.some(h => h.senderId === targetId && h.targetId === senderId);
    res.json({ success: true, isMatch });
});

// --- ESPACE SENSIBILISATION (SSR / VBG / SOS) ---
app.post('/api/ecoute', (req, res) => {
    const { userId, type, message } = req.body;
    ecoutes.push({ id: Date.now(), userId, type, message, date: new Date() });
    res.json({ success: true });
});

// --- STATUT VIP ET MONÉTISATION ---
app.post('/api/buy-vip', (req, res) => {
    const { userId } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user || user.coins < 500) return res.status(400).json({ error: 'Coins insuffisants pour passer VIP' });
    user.coins -= 500;
    user.isVip = true;
    res.json({ success: true, user });
});

app.get('/api/kkiapay-callback', (req, res) => {
    res.redirect('/?payment=success');
});

// --- ESPACE ADMIN (Mot de passe: NONVITCHA2026) ---
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'NONVITCHA2026') {
        res.json({ success: true, users, ecoutes, hearts, likes });
    } else {
        res.status(401).json({ error: 'Mot de passe administrateur incorrect' });
    }
});

// --- TEMPS RÉEL (SOCKET.IO) ---
const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('user_connected', (userId) => {
        onlineUsers.set(userId, socket.id);
        const user = users.find(u => u.id === userId);
        if (user) user.online = true;
        io.emit('update_online_status', { userId, online: true });
    });

    socket.on('public_message', (data) => {
        io.emit('public_message', data);
    });

    socket.on('private_message', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('private_message', data);
        }
    });

    socket.on('typing', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('user_typing', data);
        }
    });

    socket.on('disconnect', () => {
        for (let [userId, socketId] of onlineUsers.entries()) {
            if (socketId === socket.id) {
                onlineUsers.delete(userId);
                const user = users.find(u => u.id === userId);
                if (user) user.online = false;
                io.emit('update_online_status', { userId, online: false });
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur Nonvitcha prêt sur le port ${PORT}`));
