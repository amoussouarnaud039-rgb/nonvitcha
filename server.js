require('dotenv').config();
const express = require('express');
const http = http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// --- CONFIGURATION CLOUDINARY ---
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ connection_string: process.env.CLOUDINARY_URL });
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
});

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'votre_cle_secrete_par_defaut';
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ ERREUR FATALE : La variable d\'environnement MONGO_URI est manquante.');
  process.exit(1);
}

// --- CONNEXION MONGODB ATLAS ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connecté à MongoDB Atlas avec succès (Données persistantes)'))
  .catch(err => {
    console.error('❌ Erreur de connexion MongoDB :', err);
    process.exit(1);
  });

// --- SCHÉMAS & MODÈLES MONGOOSE ---
const userSchema = new mongoose.Schema({
  nom: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  age: { type: Number, min: 13, max: 120 },
  pays: { type: String, trim: true },
  ville: { type: String, trim: true },
  sexe: { type: String, enum: ['Homme', 'Femme', 'Autre', ''] },
  interets: { type: String, trim: true },
  photo: { type: String, default: '' },
  isVip: { type: Boolean, default: false },
  solde: { type: Number, default: 0, min: 0 },
  likesCount: { type: Number, default: 0 },
  messagesCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true, index: true },
  receiverId: { type: String, required: true, index: true },
  text: { type: String, required: true, trim: true },
  isRead: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now, index: true }
});

const likeSchema = new mongoose.Schema({
  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

const sosSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true },
  message: { type: String, required: true, trim: true },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const adSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  imageUrl: { type: String, default: '' },
  targetUrl: { type: String, default: '' },
  cost: { type: Number, required: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Like = mongoose.model('Like', likeSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const SOSRequest = mongoose.model('SOSRequest', sosSchema);
const Ad = mongoose.model('Ad', adSchema);

// --- MIDDLEWARES D'AUTHENTIFICATION ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accès refusé : Token manquant' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token invalide ou expiré' });
    req.user = user;
    next();
  });
};

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accès administrateur refusé : Token manquant' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err || !user.isAdmin) return res.status(403).json({ error: 'Accès non autorisé : Droits admin requis' });
    req.user = user;
    next();
  });
};

// --- ROUTES API UTILISATEURS ---
app.post('/api/register', async (req, res) => {
  try {
    let { nom, email, password, age, pays, ville, sexe, interets, photoBase64 } = req.body;
    if (!nom || !email || !password) {
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    }
    
    email = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Cet email est déjà utilisé' });

    let photoUrl = '';
    if (photoBase64) {
      try {
        const uploadResponse = await cloudinary.uploader.upload(photoBase64, {
          folder: 'nonvitcha_profiles',
          transformation: [{ width: 500, height: 500, crop: 'limit' }]
        });
        photoUrl = uploadResponse.secure_url;
      } catch (cloudErr) {
        console.error('Erreur upload Cloudinary:', cloudErr);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({
      nom: nom.trim(),
      email,
      password: hashedPassword,
      age: age ? Number(age) : null,
      pays: pays ? pays.trim() : '',
      ville: ville ? ville.trim() : '',
      sexe: sexe || '',
      interets: interets ? interets.trim() : '',
      photo: photoUrl
    });

    await user.save();
    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({ success: true, user: sanitizeUser(user), token });
  } catch (err) {
    console.error('Erreur inscription:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    email = email.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, user: sanitizeUser(user), token });
  } catch (err) {
    console.error('Erreur connexion:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.get('/api/members', authenticateToken, async (req, res) => {
  try {
    const users = await User.find().select('-password -__v').sort({ createdAt: -1 });
    const membersList = users.map(u => {
      const uObj = sanitizeUser(u);
      return {
        ...uObj,
        isOnline: activeUsers.has(u._id.toString())
      };
    });
    res.json(membersList);
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/update-photo', authenticateToken, async (req, res) => {
  try {
    const { photoBase64 } = req.body;
    if (!photoBase64) return res.status(400).json({ error: 'Photo requise' });

    const uploadResponse = await cloudinary.uploader.upload(photoBase64, {
      folder: 'nonvitcha_profiles',
      transformation: [{ width: 500, height: 500, crop: 'limit' }]
    });

    const user = await User.findByIdAndUpdate(
      req.user.userId, 
      { photo: uploadResponse.secure_url }, 
      { new: true }
    );

    res.json({ success: true, photo: user.photo, user: sanitizeUser(user), message: 'Photo de profil mise à jour avec succès !' });
  } catch (err) {
    console.error('Erreur Cloudinary photo:', err);
    res.status(500).json({ error: 'Erreur lors du téléversement de l\'image' });
  }
});

app.post('/api/like', authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const fromUserId = req.user.userId;
    if (!targetUserId || fromUserId === targetUserId) return res.status(400).json({ error: 'Action invalide' });

    const existingLike = await Like.findOne({ fromUserId, toUserId: targetUserId });
    if (existingLike) return res.status(400).json({ error: 'Vous avez déjà envoyé un coup de cœur à ce profil' });

    await new Like({ fromUserId, toUserId: targetUserId }).save();
    const targetUser = await User.findByIdAndUpdate(targetUserId, { $inc: { likesCount: 1 } }, { new: true });

    res.json({ success: true, likesCount: targetUser.likesCount, message: 'Coup de cœur (Like) envoyé avec succès !' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.get('/api/messages/:userId/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    if (req.user.userId !== userId) return res.status(403).json({ error: 'Accès non autorisé' });

    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId }
      ]
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/vip', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user.isVip) return res.status(400).json({ error: 'Vous êtes déjà VIP' });
    if (user.solde < 5000) return res.status(400).json({ error: 'Solde insuffisant (5000 FCFA requis)' });

    user.solde -= 5000;
    user.isVip = true;
    await user.save();
    await Transaction.create({ userId: user._id, type: 'vip', amount: 5000 });

    res.json({ success: true, user: sanitizeUser(user), message: 'Félicitations, vous êtes désormais membre VIP !' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/monetization', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });

    const user = await User.findByIdAndUpdate(req.user.userId, { $inc: { solde: amount } }, { new: true });
    await Transaction.create({ userId: req.user.userId, type: 'recharge', amount });

    res.json({ success: true, user: sanitizeUser(user), message: `Recharge de ${amount} FCFA réussie !` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.get('/api/ads', async (req, res) => {
  try {
    const ads = await Ad.find({ active: true }).sort({ createdAt: -1 });
    res.json({ success: true, ads });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/ads/create', authenticateToken, async (req, res) => {
  try {
    const { title, description, targetUrl, imageBase64, cost } = req.body;
    const adCost = Number(cost) || 1000;

    const user = await User.findById(req.user.userId);
    if (user.solde < adCost) {
      return res.status(400).json({ error: `Solde insuffisant. La diffusion publicitaire coûte ${adCost} FCFA.` });
    }

    let imageUrl = '';
    if (imageBase64) {
      try {
        const uploadRes = await cloudinary.uploader.upload(imageBase64, { folder: 'nonvitcha_ads' });
        imageUrl = uploadRes.secure_url;
      } catch (e) {
        console.error('Erreur image pub:', e);
      }
    }

    user.solde -= adCost;
    await user.save();

    const newAd = await Ad.create({
      userId: user._id,
      title: title.trim(),
      description: description.trim(),
      imageUrl,
      targetUrl: targetUrl ? targetUrl.trim() : '',
      cost: adCost
    });

    await Transaction.create({ userId: user._id, type: 'pub', amount: adCost });

    res.json({ success: true, ad: newAd, user: sanitizeUser(user), message: 'Publicité publiée avec succès !' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la création de la publicité' });
  }
});

app.post('/api/ecoute', authenticateToken, async (req, res) => {
  try {
    const { type, message } = req.body;
    if (!type || !message) return res.status(400).json({ error: 'Champs requis' });
    await SOSRequest.create({ userId: req.user.userId, type, message });
    res.json({ success: true, message: 'Votre demande SOS a été transmise en toute confidentialité.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === 'NONVITCHA 2026') {
    const adminToken = jwt.sign({ isAdmin: true, role: 'superadmin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token: adminToken, message: 'Connexion administrateur réussie' });
  }
  res.status(401).json({ error: 'Mot de passe administrateur incorrect' });
});

app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const totalSos = await SOSRequest.countDocuments();
    const vipUsers = await User.countDocuments({ isVip: true });
    const totalAds = await Ad.countDocuments();
    
    res.json({
      success: true,
      stats: { totalUsers, totalMessages, totalSos, vipUsers, totalAds }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des stats' });
  }
});

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Utilisateur supprimé avec succès par l\'administrateur' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

app.get('/api/admin/sos', authenticateAdmin, async (req, res) => {
  try {
    const sosList = await SOSRequest.find().sort({ createdAt: -1 });
    res.json({ success: true, sosList });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function sanitizeUser(u) {
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
    isVip: u.isVip,
    solde: u.solde,
    likesCount: u.likesCount,
    messagesCount: u.messagesCount
  };
}

// --- WEBSOCKETS ---
const activeUsers = new Map();

io.on('connection', (socket) => {
  socket.on('user_connected', (userId) => {
    if (userId) {
      activeUsers.set(userId, socket.id);
      io.emit('user_status_changed', { userId, isOnline: true });
    }
  });

  socket.on('public_message', async (data) => {
    if (data && data.text) {
      if (data.senderId) {
        await User.findByIdAndUpdate(data.senderId, { $inc: { messagesCount: 1 } });
      }
      io.emit('public_message', { 
        senderId: data.senderId,
        senderName: data.senderName, 
        text: data.text.trim(), 
        timestamp: new Date() 
      });
    }
  });

  socket.on('private_message', async (data) => {
    try {
      const { senderId, receiverId, text } = data;
      if (!senderId || !receiverId || !text) return;

      const message = new Message({ senderId, receiverId, text: text.trim() });
      await message.save();
      await User.findByIdAndUpdate(senderId, { $inc: { messagesCount: 1 } });

      const receiverSocketId = activeUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('private_message', message);
      }
      socket.emit('private_message', message);
    } catch (err) {
      console.error('Erreur WebSocket message privé:', err);
    }
  });

  socket.on('typing_public', (data) => socket.broadcast.emit('display_typing_public', data));
  socket.on('stop_typing_public', () => socket.broadcast.emit('hide_typing_public'));
  
  socket.on('typing_private', (data) => {
    const rSocketId = activeUsers.get(data.receiverId);
    if (rSocketId) io.to(rSocketId).emit('display_typing_private', data);
  });
  
  socket.on('stop_typing_private', (data) => {
    const rSocketId = activeUsers.get(data.receiverId);
    if (rSocketId) io.to(rSocketId).emit('hide_typing_private', data);
  });

  socket.on('disconnect', () => {
    let disconnectedUserId = null;
    for (const [userId, sId] of activeUsers.entries()) {
      if (sId === socket.id) {
        disconnectedUserId = userId;
        activeUsers.delete(userId);
        break;
      }
    }
    if (disconnectedUserId) {
      io.emit('user_status_changed', { userId: disconnectedUserId, isOnline: false });
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur Nonvitcha opérationnel sur le port ${PORT}`);
});
