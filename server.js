const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuration de Multer pour les photos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- MODE MÉMOIRE DE SECOURS (Si MongoDB ne répond pas) ---
let memoryUsers = [];
let memoryMessages = [];
let memoryEcoutes = [];
let useMemoryMode = false;

const MONGO_URI = process.env.MONGO_URI || '';

if (MONGO_URI && !MONGO_URI.includes('127.0.0.1')) {
    mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
        .then(() => console.log('Connecté avec succès à MongoDB Atlas'))
        .catch(err => {
            console.log('⚠️ Échec connexion MongoDB, passage en Mode Mémoire local:', err.message);
            useMemoryMode = true;
        });
} else {
    console.log('ℹ️ Aucune URI MongoDB valide détectée, utilisation du Mode Mémoire local.');
    useMemoryMode = true;
}

// Modèles Mongoose (utilisés si MongoDB est actif)
const userSchema = new mongoose.Schema({
    nom: String,
    email: { type: String, unique: true },
    password: String,
    age: Number,
    pays: String,
    ville: String,
    sexe: String,
    interets: String,
    photo: String,
    coins: { type: Number, default: 50 },
    isVip: { type: Boolean, default: false },
    likesCount: { type: Number, default: 0 },
    heartsCount: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
    fromUserId: String,
    toUserId: String,
    fromUserName: String,
    text: String,
    isCoupDeCoeur: { type: Boolean, default: false },
    date: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const ecouteSchema = new mongoose.Schema({
    type: String,
    message: String,
    userId: String,
    date: { type: Date, default: Date.now }
});
const Ecoute = mongoose.model('Ecoute', ecouteSchema);

// --- ROUTES API UNIFIÉES (MongoDB ou Mémoire) ---

app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, pays, ville, sexe, interets } = req.body;
        const photoPath = req.file ? `/uploads/${req.file.filename}` : '';

        if (useMemoryMode) {
            const existing = memoryUsers.find(u => u.email === email);
            if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé.' });

            const newUser = {
                _id: 'mem_' + Date.now(),
                nom, email, password, age, pays, ville, sexe, interets,
                photo: photoPath,
                coins: 50,
                isVip: false,
                likesCount: 0,
                heartsCount: 0
            };
            memoryUsers.push(newUser);
            return res.json({ user: formatUser(newUser) });
        } else {
            const existing = await User.findOne({ email });
            if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé.' });

            const newUser = new User({
                nom, email, password, age, pays, ville, sexe, interets,
                photo: photoPath,
                coins: 50
            });
            await newUser.save();
            res.json({ user: formatUser(newUser) });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (useMemoryMode) {
            const user = memoryUsers.find(u => u.email === email && u.password === password);
            if (!user) return res.status(400).json({ error: 'Email ou mot de passe incorrect.' });
            res.json({ user: formatUser(user) });
        } else {
            const user = await User.findOne({ email, password });
            if (!user) return res.status(400).json({ error: 'Email ou mot de passe incorrect.' });
            res.json({ user: formatUser(user) });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/members', async (req, res) => {
    try {
        if (useMemoryMode) {
            res.json(memoryUsers.map(u => formatUser(u)));
        } else {
            const users = await User.find({});
            res.json(users.map(u => formatUser(u)));
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/like', async (req, res) => {
    try {
        const { targetId } = req.body;
        if (useMemoryMode) {
            const target = memoryUsers.find(u => u._id === targetId || u.id === targetId);
            if (target) target.likesCount = (target.likesCount || 0) + 1;
        } else {
            const target = await User.findById(targetId);
            if (target) {
                target.likesCount = (target.likesCount || 0) + 1;
                await target.save();
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/heart', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
        if (useMemoryMode) {
            const sender = memoryUsers.find(u => u._id === senderId || u.id === senderId);
            const target = memoryUsers.find(u => u._id === targetId || u.id === targetId);

            if (!sender || sender.coins < 10) {
                return res.status(400).json({ error: 'Coins insuffisants (10 coins requis).' });
            }

            sender.coins -= 10;
            if (target) target.heartsCount = (target.heartsCount || 0) + 1;

            res.json({ success: true, user: formatUser(sender), isMatch: Math.random() > 0.5 });
        } else {
            const sender = await User.findById(senderId);
            const target = await User.findById(targetId);

            if (!sender || sender.coins < 10) {
                return res.status(400).json({ error: 'Coins insuffisants (10 coins requis).' });
            }

            sender.coins -= 10;
            await sender.save();

            if (target) {
                target.heartsCount = (target.heartsCount || 0) + 1;
                await target.save();
            }
            res.json({ success: true, user: formatUser(sender), isMatch: Math.random() > 0.5 });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/messages/:userId/:targetId', async (req, res) => {
    try {
        const { userId, targetId } = req.params;
        if (useMemoryMode) {
            const msgs = memoryMessages.filter(m => 
                (m.fromUserId === userId && m.toUserId === targetId) ||
                (m.fromUserId === targetId && m.toUserId === userId)
            );
            res.json(msgs);
        } else {
            const messages = await Message.find({
                $or: [
                    { fromUserId: userId, toUserId: targetId },
                    { fromUserId: targetId, toUserId: userId }
                ]
            }).sort({ date: 1 });
            res.json(messages);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ecoute', async (req, res) => {
    try {
        const { type, message, userId } = req.body;
        if (useMemoryMode) {
            memoryEcoutes.push({ type, message, userId, date: new Date() });
        } else {
            const newEcoute = new Ecoute({ type, message, userId });
            await newEcoute.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    if (password === 'admin123' || password === 'admin') {
        if (useMemoryMode) {
            res.json({ users: memoryUsers.map(u => formatUser(u)), ecoutes: memoryEcoutes });
        } else {
            const users = await User.find({});
            const ecoutes = await Ecoute.find({}).sort({ date: -1 });
            res.json({ users: users.map(u => formatUser(u)), ecoutes });
        }
    } else {
        res.status(401).json({ error: 'Mot de passe administrateur incorrect.' });
    }
});

function formatUser(u) {
    return {
        id: u._id || u.id,
        nom: u.nom,
        email: u.email,
        age: u.age,
        pays: u.pays,
        ville: u.ville,
        sexe: u.sexe,
        interets: u.interets,
        photo: u.photo,
        coins: u.coins,
        isVip: u.isVip,
        likesCount: u.likesCount || 0,
        heartsCount: u.heartsCount || 0
    };
}

// Socket.io
io.on('connection', (socket) => {
    socket.on('user_connected', (userId) => {
        socket.userId = userId;
        io.emit('update_online_status');
    });

    socket.on('private_message', async (data) => {
        const msg = {
            fromUserId: data.fromUserId,
            toUserId: data.toUserId,
            fromUserName: data.fromUserName,
            text: data.text,
            isCoupDeCoeur: data.isCoupDeCoeur,
            date: new Date()
        };
        if (useMemoryMode) {
            memoryMessages.push(msg);
        } else {
            const dbMsg = new Message(msg);
            await dbMsg.save();
        }
        io.emit('private_message', msg);
    });

    socket.on('public_message', (data) => {
        io.emit('public_message', data);
    });

    socket.on('disconnect', () => {
        io.emit('update_online_status');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur démarré et opérationnel sur le port ${PORT}`));
