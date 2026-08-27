const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'nonvitcha_profiles',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({ storage: storage });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/nonvitcha';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connecté à MongoDB avec succès'))
  .catch(err => console.error('Erreur de connexion MongoDB :', err));

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
    likesCount: { type: Number, default: 0 },
    messagesCount: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
    fromUserId: String,
    toUserId: String,
    fromUserName: String,
    text: String,
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const ecouteSchema = new mongoose.Schema({
    userId: String,
    type: String,
    message: String,
    createdAt: { type: Date, default: Date.now }
});
const Ecoute = mongoose.model('Ecoute', ecouteSchema);

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, email, password, age, pays, ville, sexe, interets } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Cet email est déjà utilisé.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const photoUrl = req.file ? req.file.path : '';

        const newUser = new User({
            nom,
            email,
            password: hashedPassword,
            age,
            pays,
            ville,
            sexe,
            interets,
            photo: photoUrl
        });

        await newUser.save();
        res.status(201).json({ 
            user: { 
                id: newUser._id, 
                nom: newUser.nom, 
                email: newUser.email, 
                photo: newUser.photo, 
                likesCount: 0, 
                messagesCount: 0 
            } 
        });
    } catch (err) {
        console.error("Erreur inscription:", err);
        res.status(500).json({ error: "Erreur lors de l'inscription" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'Utilisateur introuvable.' });

        let isMatch = false;
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            isMatch = (password === user.password);
            if (isMatch) {
                user.password = await bcrypt.hash(password, 10);
                await user.save();
            }
        }

        if (!isMatch) return res.status(400).json({ error: 'Mot de passe incorrect.' });

        res.json({ 
            user: { 
                id: user._id, 
                nom: user.nom, 
                email: user.email, 
                photo: user.photo, 
                likesCount: user.likesCount, 
                messagesCount: user.messagesCount 
            } 
        });
    } catch (err) {
        console.error("Erreur connexion:", err);
        res.status(500).json({ error: 'Erreur lors de la connexion' });
    }
});

// Nouvelle route pour mettre à jour la photo de profil
app.post('/api/update-photo', upload.single('photo'), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Aucune photo fournnie.' });

        const updatedUser = await User.findByIdAndUpdate(
            userId, 
            { photo: req.file.path }, 
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        res.json({
            success: true,
            photo: updatedUser.photo,
            user: {
                id: updatedUser._id,
                nom: updatedUser.nom,
                email: updatedUser.email,
                photo: updatedUser.photo,
                likesCount: updatedUser.likesCount,
                messagesCount: updatedUser.messagesCount
            }
        });
    } catch (err) {
        console.error("Erreur mise à jour photo:", err);
        res.status(500).json({ error: 'Erreur lors du changement de la photo' });
    }
});

app.get('/api/members', async (req, res) => {
    try {
        const members = await User.find({}, '-password');
        res.json(members.map(m => ({
            id: m._id,
            nom: m.nom,
            age: m.age,
            pays: m.pays,
            ville: m.ville,
            sexe: m.sexe,
            interets: m.interets,
            photo: m.photo,
            likesCount: m.likesCount,
            messagesCount: m.messagesCount
        })));
    } catch (err) {
        res.status(500).json({ error: 'Erreur chargement membres' });
    }
});

app.post('/api/ecoute', async (req, res) => {
    try {
        const { userId, type, message } = req.body;
        const newEcoute = new Ecoute({ userId, type, message });
        await newEcoute.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erreur enregistrement écoute SOS' });
    }
});

io.on('connection', (socket) => {
    socket.on('user_connected', (userId) => {
        socket.userId = userId;
    });

    socket.on('public_message', (data) => {
        io.emit('public_message', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
