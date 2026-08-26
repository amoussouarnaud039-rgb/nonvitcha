const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nonvitcha';

// --- CONNEXION BASE DE DONNÉES MONGODB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connecté avec succès à MongoDB Atlas !'))
    .catch(err => console.error('❌ Erreur de connexion MongoDB :', err));

// --- MODÈLES MONGODB ---
const userSchema = new mongoose.Schema({
    nom: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    age: { type: Number, default: 18 },
    sexe: { type: String, default: 'M' },
    pays: { type: String, default: 'Bénin' },
    ville: { type: String, default: 'Cotonou' },
    interets: { type: String, default: '' },
    photo: { type: String, default: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300' },
    coins: { type: Number, default: 50 },
    isVip: { type: Boolean, default: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    hearts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    likesCount: { type: Number, default: 0 },
    heartsCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    online: { type: Boolean, default: false }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromUserName: { type: String },
    fromUserPhoto: { type: String },
    text: { type: String, required: true },
    read: { type: Boolean, default: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const ecouteSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, required: true },
    message: { type: String, required: true },
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Ecoute = mongoose.model('Ecoute', ecouteSchema);

// --- MIDDLEWARES & STATIQUES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- ROUTES API ---

// 1. Inscription
app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, sexe, pays, ville, interets } = req.body;

        if (!email || !nom || !password) {
            return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis.' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({ error: 'Un compte existe déjà avec cet e-mail.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const photoUrl = req.file ? `/uploads/${req.file.filename}` : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300';

        const newUser = new User({
            nom: nom.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            age: parseInt(age) || 18,
            sexe: sexe || 'M',
            pays: pays || 'Bénin',
            ville: ville || 'Cotonou',
            interets: interets || '',
            photo: photoUrl,
            coins: 50,
            online: true
        });

        await newUser.save();

        const userResponse = newUser.toObject();
        delete userResponse.password;
        userResponse.id = userResponse._id.toString();

        res.json({ user: userResponse });
    } catch (err) {
        console.error('Erreur Inscription :', err);
        res.status(500).json({ error: "Erreur lors de la création du compte." });
    }
});

// 2. Connexion
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }

        user.online = true;
        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;
        userResponse.id = userResponse._id.toString();

        res.json({ user: userResponse });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors de la connexion' });
    }
});

// 3. Liste des membres
app.get('/api/members', async (req, res) => {
    try {
        const currentUserId = req.query.userId;
        const members = await User.find().select('-password').lean();

        let currentUser = null;
        if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
            currentUser = await User.findById(currentUserId).lean();
        }

        const formattedMembers = members.map(m => {
            const memberId = m._id.toString();
            let isMatch = false;

            if (currentUser && currentUser.hearts) {
                const iHeart = currentUser.hearts.some(h => h.toString() === memberId);
                const heHeartsMe = m.hearts && m.hearts.some(h => h.toString() === currentUserId);
                isMatch = iHeart && heHeartsMe;
            }

            return {
                ...m,
                id: memberId,
                isMatch
            };
        });

        res.json(formattedMembers);
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors du chargement des membres' });
    }
});

// 4. Récupérer l'historique des messages privés entre deux utilisateurs
app.get('/api/messages/:userId/:targetId', async (req, res) => {
    try {
        const { userId, targetId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ error: 'IDs invalides' });
        }

        const messages = await Message.find({
            $or: [
                { fromUserId: userId, toUserId: targetId },
                { fromUserId: targetId, toUserId: userId }
            ]
        }).sort({ createdAt: 1 }).lean();

        // Marquer comme lus les messages reçus
        await Message.updateMany(
            { fromUserId: targetId, toUserId: userId, read: false },
            { $set: { read: true } }
        );

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Erreur chargement messages' });
    }
});

// 5. Envoyer un Like
app.post('/api/like', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
        if (!senderId || !targetId) return res.status(400).json({ error: 'IDs manquants' });

        const sender = await User.findById(senderId);
        const target = await User.findById(targetId);

        if (!sender || !target) return res.status(404).json({ error: 'Utilisateur introuvable' });

        const hasLiked = sender.likes.some(id => id.toString() === targetId);
        if (!hasLiked) {
            sender.likes.push(targetId);
            target.likesCount = (target.likesCount || 0) + 1;
            await sender.save();
            await target.save();
        }

        res.json({ success: true, likesCount: target.likesCount });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors de l’envoi du like' });
    }
});

// 6. Envoyer un Coup de Cœur / Match
app.post('/api/heart', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
        if (!senderId || !targetId) return res.status(400).json({ error: 'IDs manquants' });

        const sender = await User.findById(senderId);
        const target = await User.findById(targetId);

        if (!sender || !target) return res.status(404).json({ error: 'Utilisateur introuvable' });

        const hasHearted = sender.hearts.some(id => id.toString() === targetId);
        if (!hasHearted) {
            sender.hearts.push(targetId);
            target.heartsCount = (target.heartsCount || 0) + 1;
            await sender.save();
            await target.save();
        }

        const isMatch = target.hearts.some(id => id.toString() === senderId);

        res.json({ success: true, isMatch, heartsCount: target.heartsCount });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors de l’envoi du cœur' });
    }
});

// 7. Demande d'Écoute SOS / VBG
app.post('/api/ecoute', async (req, res) => {
    try {
        const { type, message, userId } = req.body;
        const newEcoute = new Ecoute({
            userId: userId && mongoose.Types.ObjectId.isValid(userId) ? userId : null,
            type,
            message
        });

        await newEcoute.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erreur envoi demande d’écoute' });
    }
});

// 8. Connexion Administration
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password === ADMIN_PASSWORD) {
        const users = await User.find().select('-password').lean();
        const ecoutes = await Ecoute.find().lean();
        res.json({ users, ecoutes });
    } else {
        res.status(401).json({ error: 'Mot de passe administrateur incorrect' });
    }
});

// --- WEBSOCKETS (SOCKET.IO) ---
const userSockets = new Map();

io.on('connection', (socket) => {
    // 1. Enregistrement de l'utilisateur
    socket.on('user_connected', async (userId) => {
        if (mongoose.Types.ObjectId.isValid(userId)) {
            socket.userId = userId;
            userSockets.set(userId, socket.id);
            socket.join(userId);

            await User.findByIdAndUpdate(userId, { online: true });
            io.emit('update_online_status', { userId, online: true });
        }
    });

    // 2. Chat Public
    socket.on('public_message', (data) => {
        io.emit('public_message', data);
    });

    // 3. Chat Privé (Sauvegarde MongoDB + Temps Réel / Hors-ligne)
    socket.on('private_message', async (data) => {
        try {
            const { fromUserId, toUserId, text, fromUserName, fromUserPhoto } = data;

            if (!fromUserId || !toUserId || !text) return;

            // Sauvegarde systématique dans MongoDB
            const newMessage = new Message({
                fromUserId,
                toUserId,
                fromUserName,
                fromUserPhoto,
                text
            });
            await newMessage.save();

            // Incrémentation du compteur de messages envoyés
            await User.findByIdAndUpdate(fromUserId, { $inc: { messageCount: 1 } });

            const payload = {
                _id: newMessage._id,
                fromUserId,
                toUserId,
                fromUserName,
                fromUserPhoto,
                text,
                createdAt: newMessage.createdAt
            };

            // Émission immédiate aux rooms (si en ligne, réception directe et ouverture)
            io.to(toUserId).to(fromUserId).emit('private_message', payload);
        } catch (err) {
            console.error('Erreur sauvegarde message privé :', err);
        }
    });

    // 4. Indicateur "En train d'écrire..."
    socket.on('typing', (data) => {
        socket.to(data.toUserId).emit('user_typing', { fromUserId: socket.userId });
    });

    socket.on('stop_typing', (data) => {
        socket.to(data.toUserId).emit('user_stop_typing', { fromUserId: socket.userId });
    });

    // 5. Déconnexion
    socket.on('disconnect', async () => {
        if (socket.userId) {
            userSockets.delete(socket.userId);
            await User.findByIdAndUpdate(socket.userId, { online: false });
            io.emit('update_online_status', { userId: socket.userId, online: false });
        }
    });
});

// --- DÉMARRAGE DU SERVEUR ---
server.listen(PORT, () => {
    console.log(`🚀 Serveur Nonvitcha démarré sur le port ${PORT}`);
});
