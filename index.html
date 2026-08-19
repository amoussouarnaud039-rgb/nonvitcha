const express = require('express');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const defaultData = {
            users: [
                { id: "1", email: "alice@test.com", password: "123", nom: "Alice", age: 24, ville: "Cotonou", photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150", likes: 5, nonvicoins: 100, isVip: true },
                { id: "2", email: "kokou@test.com", password: "123", nom: "Kokou", age: 28, ville: "Porto-Novo", photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150", likes: 2, nonvicoins: 0, isVip: false },
                { id: "3", email: "assiba@test.com", password: "123", nom: "Assiba", age: 22, ville: "Parakou", photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150", likes: 8, nonvicoins: 50, isVip: false }
            ],
            chat: [
                { id: "c1", sender: "Alice", text: "Bienvenue sur Nonvitcha tout le monde ! 💕", date: "12:00" }
            ],
            privateMessages: [],
            ressources: [
                { id: "r1", titre: "Qu'est-ce que le Planning Familial ?", categorie: "SSR", contenu: "Le planning familial est un droit...", date_publication: new Date().toISOString() },
                { id: "r2", titre: "Que faire en cas de violence ?", categorie: "VBG", contenu: "Si vous êtes victime...", date_publication: new Date().toISOString() },
                { id: "r3", titre: "Comprendre et soutenir les minorités", categorie: "MINORITES", contenu: "Le respect des minorités est essentiel...", date_publication: new Date().toISOString() }
            ],
            demandes_ecoute: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        return {
            users: data.users || [],
            chat: data.chat || [],
            privateMessages: data.privateMessages || [],
            ressources: data.ressources || [],
            demandes_ecoute: data.demandes_ecoute || []
        };
    } catch (e) {
        return { users: [], chat: [], privateMessages: [], ressources: [], demandes_ecoute: [] };
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let activeSessions = {};

app.get('/api/auth/me', (req, res) => {
    res.json({ loggedIn: !!activeSessions.user, user: activeSessions.user });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const db = readDB();
    const user = db.users.find(u => u.email.toLowerCase() === cleanEmail && u.password === password);
    if (user) {
        activeSessions.user = user;
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Email ou mot de passe incorrect' });
    }
});

app.post('/api/auth/register', (req, res) => {
    const { email, password, nom, age, ville } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const db = readDB();
    
    if (db.users.find(u => u.email.toLowerCase() === cleanEmail)) {
        return res.json({ success: false, message: 'Email déjà utilisé' });
    }
    
    const newUser = { 
        id: Date.now().toString(), 
        email: cleanEmail, 
        password, 
        nom, 
        age, 
        ville, 
        photo: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=150', 
        likes: 0, 
        nonvicoins: 0, 
        isVip: false 
    };
    
    db.users.push(newUser);
    writeDB(db);
    activeSessions.user = newUser;
    
    io.emit('update-users', newUser); 
    
    res.json({ success: true, user: newUser });
});

app.post('/api/auth/logout', (req, res) => {
    activeSessions = {};
    res.json({ success: true });
});

app.get('/api/users/search', (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    const db = readDB();
    if (!query) return res.json(db.users);
    const filteredUsers = db.users.filter(user => 
        (user.nom && user.nom.toLowerCase().includes(query)) ||
        (user.ville && user.ville.toLowerCase().includes(query))
    );
    res.json(filteredUsers);
});

app.get('/api/users', (req, res) => {
    const db = readDB();
    res.json(db.users);
});

app.post('/api/users/upload-photo', upload.single('photo'), (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    const db = readDB();
    const user = db.users.find(u => u.id === activeSessions.user.id);
    if (user && req.file) {
        user.photo = '/uploads/' + req.file.filename;
        writeDB(db);
        activeSessions.user = user;
        res.json({ success: true, user });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/chat', (req, res) => {
    const db = readDB();
    res.json((db.chat || []).slice(-50));
});

app.get('/api/online-users', (req, res) => {
    res.json(Object.keys(activeSessions).length ? [activeSessions.user.id] : []);
});

app.post('/api/users/:id/like', (req, res) => {
    const db = readDB();
    const target = db.users.find(u => u.id === req.params.id);
    if (target) {
        target.likes = (target.likes || 0) + 1;
        writeDB(db);
        io.emit('update-users');
    }
    res.json({ success: true });
});

app.post('/api/users/:id/buy-coins', (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    const db = readDB();
    const user = db.users.find(u => u.id === activeSessions.user.id);
    if (user) {
        user.nonvicoins = (user.nonvicoins || 0) + 50;
        writeDB(db);
        activeSessions.user = user;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/users/:id/become-vip', (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    const db = readDB();
    const user = db.users.find(u => u.id === activeSessions.user.id);
    if (user && user.nonvicoins >= 100) {
        user.nonvicoins -= 100;
        user.isVip = true;
        writeDB(db);
        activeSessions.user = user;
        io.emit('update-users');
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Solde insuffisant' });
    }
});

app.get('/api/private-messages/:targetId', (req, res) => {
    if (!activeSessions.user) return res.json([]);
    const db = readDB();
    const messages = db.privateMessages || [];
    
    let updated = false;
    messages.forEach(m => {
        if (m.senderId === req.params.targetId && m.targetId === activeSessions.user.id && !m.read) {
            m.read = true;
            updated = true;
        }
    });
    if (updated) writeDB(db);

    res.json(messages.filter(m => 
        (m.senderId === activeSessions.user.id && m.targetId === req.params.targetId) ||
        (m.senderId === req.params.targetId && m.targetId === activeSessions.user.id)
    ));
});

app.get('/api/unread-messages', (req, res) => {
    if (!activeSessions.user) return res.json({});
    const db = readDB();
    const unreadCounts = {};
    (db.privateMessages || []).forEach(m => {
        if (m.targetId === activeSessions.user.id && !m.read) {
            unreadCounts[m.senderId] = (unreadCounts[m.senderId] || 0) + 1;
        }
    });
    res.json(unreadCounts);
});

app.get('/api/ressources', (req, res) => {
    const { categorie } = req.query;
    const db = readDB();
    let results = db.ressources || [];
    
    if (categorie) {
        results = results.filter(r => r.categorie.toUpperCase() === categorie.toUpperCase());
    }
    res.json(results);
});

app.post('/api/ecoute', (req, res) => {
    if (!activeSessions.user) {
        return res.status(401).json({ success: false, error: "Vous devez être connecté pour envoyer une demande." });
    }

    const { sujet, message } = req.body;
    if (!message) {
        return res.status(400).json({ success: false, error: "Le message ne peut pas être vide." });
    }

    const db = readDB();
    if (!db.demandes_ecoute) db.demandes_ecoute = [];

    const nouvelleDemande = {
        id: 'ecoute_' + Date.now(),
        utilisateur_id: activeSessions.user.id,
        nom_utilisateur: activeSessions.user.nom,
        sujet: sujet || 'Demande générale',
        message: message,
        statut: 'en_attente',
        date_creation: new Date().toISOString()
    };

    db.demandes_ecoute.push(nouvelleDemande);
    writeDB(db);

    res.status(201).json({ 
        success: true, 
        message: "Votre demande a été transmise en toute confidentialité à notre équipe." 
    });
});

// Routes Administrateur pour gérer les demandes d'écoute
app.get('/api/admin/ecoutes', (req, res) => {
    const db = readDB();
    res.json(db.demandes_ecoute || []);
});

app.delete('/api/admin/ecoutes/:id', (req, res) => {
    const db = readDB();
    db.demandes_ecoute = (db.demandes_ecoute || []).filter(d => d.id !== req.params.id);
    writeDB(db);
    res.json({ success: true });
});

app.delete('/api/chat/:id', (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    const db = readDB();
    db.chat = (db.chat || []).filter(m => m.id !== req.params.id);
    writeDB(db);
    io.emit('delete-public-message', req.params.id);
    res.json({ success: true });
});

app.delete('/api/private-messages/:id', (req, res) => {
    if (!activeSessions.user) return res.status(401).send();
    const db = readDB();
    db.privateMessages = (db.privateMessages || []).filter(m => m.id !== req.params.id);
    writeDB(db);
    io.emit(`delete-private-message-${req.params.id}`);
    res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.on('send-public-message', (data) => {
        const db = readDB();
        if (!db.chat) db.chat = [];
        const newMessage = { id: 'msg_' + Date.now(), sender: data.sender, text: data.text, date: new Date().toLocaleTimeString() };
        db.chat.push(newMessage);
        writeDB(db);
        io.emit('new-public-message', newMessage);
    });

    socket.on('send-private-message', (data) => {
        const db = readDB();
        if (!db.privateMessages) db.privateMessages = [];
        const newMessage = { 
            id: 'pmsg_' + Date.now(),
            senderId: data.senderId, 
            senderName: data.senderName, 
            targetId: data.targetId, 
            text: data.text, 
            date: new Date().toLocaleTimeString(),
            read: false 
        };
        db.privateMessages.push(newMessage);
        writeDB(db);
        io.emit(`private-message-${data.targetId}`, newMessage);
        io.emit(`private-message-${data.senderId}`, newMessage);
        io.emit(`unread-update-${data.targetId}`);
    });

    socket.on('typing', (data) => {
        io.emit(`typing-${data.targetId}`, { senderName: data.senderName });
    });

    socket.on('stop-typing', (data) => {
        io.emit(`stop-typing-${data.targetId}`);
    });
});

server.listen(PORT, () => {
    console.log(`Serveur Nonvitcha lancé sur le port ${PORT}`);
});
