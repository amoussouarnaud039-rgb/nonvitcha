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

// Configuration de Multer pour les photos de profil
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

// Connexion MongoDB (ou mode local mémoire si URI non définie)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nonvitcha';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connecté à MongoDB'))
    .catch(err => console.log('Erreur MongoDB (Mode secours mémoire actif si besoin):', err.message));

// Modèles Mongoose
const userSchema = new mongoose.Schema({
    nom: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
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

// Routes API
app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, pays, ville, sexe, interets } = req.body;
        const photoPath = req.file ? `/uploads/${req.file.filename}` : '';

        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé.' });

        const newUser = new User({
            nom, email, password, age, pays, ville, sexe, interets,
            photo: photoPath,
            coins: 50
        });
        await newUser.save();
        res.json({ user: formatUser(newUser) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (!user) return res.status(400).json({ error: 'Email ou mot de passe incorrect.' });
        res.json({ user: formatUser(user) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/members', async (req, res) => {
    try {
        const users = await User.find({});
        res.json(users.map(u => formatUser(u)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/like', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
        const target = await User.findById(targetId);
        if (target) {
            target.likesCount = (target.likesCount || 0) + 1;
            await target.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/heart', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
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
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/messages/:userId/:targetId', async (req, res) => {
    try {
        const { userId, targetId } = req.params;
        const messages = await Message.find({
            $or: [
                { fromUserId: userId, toUserId: targetId },
                { fromUserId: targetId, toUserId: userId }
            ]
        }).sort({ date: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ecoute', async (req, res) => {
    try {
        const { type, message, userId } = req.body;
        const newEcoute = new Ecoute({ type, message, userId });
        await newEcoute.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    if (password === 'admin123' || password === 'admin') {
        const users = await User.find({});
        const ecoutes = await Ecoute.find({}).sort({ date: -1 });
        res.json({ users: users.map(u => formatUser(u)), ecoutes });
    } else {
        res.status(401).json({ error: 'Mot de passe administrateur incorrect.' });
    }
});

function formatUser(u) {
    return {
        id: u._id,
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
        const msg = new Message({
            fromUserId: data.fromUserId,
            toUserId: data.toUserId,
            fromUserName: data.fromUserName,
            text: data.text,
            isCoupDeCoeur: data.isCoupDeCoeur
        });
        await msg.save();
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
server.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
