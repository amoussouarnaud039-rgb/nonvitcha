const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nonvitcha';

// --- CONNEXION MONGO DB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Base de données MongoDB connectée.'))
    .catch(err => console.error('❌ Erreur MongoDB :', err));

// --- SCHÉMAS & MODÈLES MONGODB ---
const userSchema = new mongoose.Schema({
    nom: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    age: { type: Number, default: 18 },
    sexe: { type: String, default: 'H' },
    pays: { type: String, default: 'Bénin' },
    ville: { type: String, default: 'Cotonou' },
    interets: { type: String, default: '' },
    photo: { type: String, default: '' },
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
    isCoupDeCoeur: { type: Boolean, default: false },
    read: { type: Boolean, default: false }
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

// --- CONFIGURATION CLOUDINARY & MULTER ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'scp7oawl',
    api_key: process.env.CLOUDINARY_API_KEY || '186831271449591',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'hlUjoEm52hsL5Eh4FkjYNVk0k7M'
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'nonvitcha_uploads',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
    }
});

const upload = multer({ storage: storage });

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- API ROUTES ---

// Inscription
app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, sexe, pays, ville, interets } = req.body;

        if (!email || !nom || !password) {
            return res.status(400).json({ error: 'Tous les champs requis doivent être renseignés.' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({ error: 'Un compte associé à cet e-mail existe déjà.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        // Stockage direct de l'URL HTTPS retournée par Cloudinary
        const photoUrl = req.file ? req.file.path : '';

        const newUser = new User({
            nom: nom.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            age: parseInt(age) || 18,
            sexe: sexe || 'H',
            pays: pays || 'Bénin',
            ville: ville || 'Cotonou',
            interets: interets || '',
            photo: photoUrl,
            coins: 50,
            online: true
        });

        await newUser.save();
        const userObj = newUser.toObject();
        delete userObj.password;
        userObj.id = userObj._id.toString();

        res.json({ user: userObj });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de l’inscription.' });
    }
});

// Connexion
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) return res.status(401).json({ error: 'Identifiants invalides.' });

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ error: 'Identifiants invalides.' });

        user.online = true;
        await user.save();

        const userObj = user.toObject();
        delete userObj.password;
        userObj.id = userObj._id.toString();

        res.json({ user: userObj });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors de la connexion.' });
    }
});

// Récupération des membres
app.get('/api/members', async (req, res) => {
    try {
        const currentUserId = req.query.userId;
        const members = await User.find().select('-password').lean();

        let currentUser = null;
        if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
            currentUser = await User.findById(currentUserId).lean();
        }

        const formatted = members.map(m => {
            const memberId = m._id.toString();
            let isMatch = false;

            if (currentUser && currentUser.hearts) {
                const iHeart = currentUser.hearts.some(h => h.toString() === memberId);
                const heHeartsMe = m.hearts && m.hearts.some(h => h.toString() === currentUserId);
                isMatch = iHeart && heHeartsMe;
            }

            return { ...m, id: memberId, isMatch };
        });

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: 'Erreur de récupération des membres.' });
    }
});

// Historique des messages
app.get('/api/messages/:userId/:targetId', async (req, res) => {
    try {
        const { userId, targetId } = req.params;
        const messages = await Message.find({
            $or: [
                { fromUserId: userId, toUserId: targetId },
                { fromUserId: targetId, toUserId: userId }
            ]
        }).sort({ createdAt: 1 }).lean();

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Erreur d’historique.' });
    }
});

// Like
app.post('/api/like', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
        const sender = await User.findById(senderId);
        const target = await User.findById(targetId);

        if (!sender || !target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        const hasLiked = sender.likes.some(id => id.toString() === targetId);
        if (!hasLiked) {
            sender.likes.push(targetId);
            target.likesCount = (target.likesCount || 0) + 1;
            await sender.save();
            await target.save();
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors du like.' });
    }
});

// Coup de Cœur
app.post('/api/heart', async (req, res) => {
    try {
        const { senderId, targetId } = req.body;
        const sender = await User.findById(senderId);
        const target = await User.findById(targetId);

        if (!sender || !target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (!sender.isVip) {
            if (sender.coins < 10) return res.status(400).json({ error: 'Coins insuffisants (10 Coins requis).' });
            sender.coins -= 10;
        }

        const hasHearted = sender.hearts.some(id => id.toString() === targetId);
        if (!hasHearted) {
            sender.hearts.push(targetId);
            target.heartsCount = (target.heartsCount || 0) + 1;
        }

        await sender.save();
        await target.save();

        const isMatch = target.hearts.some(id => id.toString() === senderId);
        const userObj = sender.toObject();
        delete userObj.password;
        userObj.id = userObj._id.toString();

        res.json({ success: true, isMatch, user: userObj });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors de l’envoi du Coup de Cœur.' });
    }
});

// Achat VIP
app.post('/api/buy-vip', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
        if (user.coins < 500) return res.status(400).json({ error: 'Coins insuffisants (500 requises).' });

        user.coins -= 500;
        user.isVip = true;
        await user.save();

        const userObj = user.toObject();
        delete userObj.password;
        userObj.id = userObj._id.toString();

        res.json({ success: true, user: userObj });
    } catch (err) {
        res.status(500).json({ error: 'Erreur lors de l’activation VIP.' });
    }
});

// Soumission Espace d'Écoute (SSR / VBG)
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
        res.status(500).json({ error: 'Erreur d’envoi.' });
    }
});

// Admin Login & Dashboard
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === ADMIN_PASSWORD) {
        const users = await User.find().select('-password').lean();
        const ecoutes = await Ecoute.find().lean();
        res.json({ users, ecoutes });
    } else {
        res.status(401).json({ error: 'Mot de passe Administrateur incorrect.' });
    }
});

// --- WEBSOCKETS ---
io.on('connection', (socket) => {
    socket.on('user_connected', async (userId) => {
        if (mongoose.Types.ObjectId.isValid(userId)) {
            socket.userId = userId;
            socket.join(userId);
            await User.findByIdAndUpdate(userId, { online: true });
            io.emit('update_online_status', { userId, online: true });
        }
    });

    socket.on('public_message', (data) => {
        io.emit('public_message', data);
    });

    socket.on('private_message', async (data) => {
        try {
            const { fromUserId, toUserId, text, fromUserName, fromUserPhoto, isCoupDeCoeur } = data;
            if (!fromUserId || !toUserId || !text) return;

            const msg = new Message({
                fromUserId,
                toUserId,
                fromUserName,
                fromUserPhoto,
                text,
                isCoupDeCoeur: !!isCoupDeCoeur
            });
            await msg.save();

            const payload = {
                _id: msg._id,
                fromUserId,
                toUserId,
                fromUserName,
                fromUserPhoto,
                text,
                isCoupDeCoeur: msg.isCoupDeCoeur,
                createdAt: msg.createdAt
            };

            io.to(toUserId).to(fromUserId).emit('private_message', payload);
        } catch (err) {
            console.error('Erreur Websocket private_message:', err);
        }
    });

    socket.on('typing', (data) => {
        socket.to(data.toUserId).emit('user_typing', { fromUserId: socket.userId });
    });

    socket.on('stop_typing', (data) => {
        socket.to(data.toUserId).emit('user_stop_typing', { fromUserId: socket.userId });
    });

    socket.on('disconnect', async () => {
        if (socket.userId) {
            await User.findByIdAndUpdate(socket.userId, { online: false });
            io.emit('update_online_status', { userId: socket.userId, online: false });
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
