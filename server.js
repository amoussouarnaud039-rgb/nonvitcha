const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Clé secrète JWT
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise_changez_moi';

// --- CONNEXION MONGODB (Corrigée) ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nonvitcha')
.then(() => console.log('✅ Connecté à MongoDB (nonvitcha)'))
.catch(err => console.error('❌ Erreur de connexion MongoDB :', err));

// --- SCHÉMAS & MODÈLES ---
const userSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  age: Number,
  pays: String,
  ville: String,
  sexe: String,
  interets: String,
  photo: { type: String, default: '' },
  isVip: { type: Boolean, default: false },
  solde: { type: Number, default: 0 },
  likesCount: { type: Number, default: 0 },
  messagesCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  receiverId: { type: String, required: true },
  text: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const likeSchema = new mongoose.Schema({
  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
  userId: String,
  type: String,
  amount: Number,
  status: { type: String, default: 'completed' },
  reference: String,
  createdAt: { type: Date, default: Date.now }
});

const sosSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Like = mongoose.model('Like', likeSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const SOSRequest = mongoose.model('SOSRequest', sosSchema);

// --- MIDDLEWARE D'AUTHENTIFICATION ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// --- ROUTES API ---

// 1. INSCRIPTION
app.post('/api/register', async (req, res) => {
  try {
    const { nom, email, password, age, pays, ville, sexe, interets, photoBase64 } = req.body;
    
    if (!nom || !email || !password) {
      return res.status(400).json({ error: 'Nom, email et mot de passe sont requis' });
    }
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      nom,
      email,
      password: hashedPassword,
      age: age || null,
      pays: pays || '',
      ville: ville || '',
      sexe: sexe || '',
      interets: interets || '',
      photo: photoBase64 || ''
    });
    
    await user.save();
    
    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    
    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        nom: user.nom,
        email: user.email,
        age: user.age,
        pays: user.pays,
        ville: user.ville,
        sexe: user.sexe,
        interets: user.interets,
        photo: user.photo,
        isVip: user.isVip,
        solde: user.solde,
        likesCount: user.likesCount,
        messagesCount: user.messagesCount
      },
      token
    });
  } catch (err) {
    console.error('Erreur inscription:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. CONNEXION
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    
    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({
      success: true,
      user: {
        id: user._id,
        nom: user.nom,
        email: user.email,
        age: user.age,
        pays: user.pays,
        ville: user.ville,
        sexe: user.sexe,
        interets: user.interets,
        photo: user.photo,
        isVip: user.isVip,
        solde: user.solde,
        likesCount: user.likesCount,
        messagesCount: user.messagesCount
      },
      token
    });
  } catch (err) {
    console.error('Erreur connexion:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. RÉCUPÉRER TOUS LES MEMBRES
app.get('/api/members', authenticateToken, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -__v')
      .sort({ createdAt: -1 });
    
    const members = users.map(u => ({
      id: u._id,
      nom: u.nom,
      age: u.age,
      pays: u.pays,
      ville: u.ville,
      sexe: u.sexe,
      interets: u.interets,
      photo: u.photo,
      isVip: u.isVip,
      likesCount: u.likesCount,
      messagesCount: u.messagesCount,
      createdAt: u.createdAt
    }));
    
    res.json(members);
  } catch (err) {
    console.error('Erreur récupération membres:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. ENVOYER UN LIKE (COUP DE CŒUR)
app.post('/api/like', authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const fromUserId = req.user.userId;
    
    if (!targetUserId) {
      return res.status(400).json({ error: 'ID utilisateur cible requis' });
    }
    
    if (fromUserId === targetUserId) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous liker vous-même' });
    }
    
    const existingLike = await Like.findOne({ fromUserId, toUserId: targetUserId });
    if (existingLike) {
      return res.status(400).json({ error: 'Vous avez déjà envoyé un coup de cœur à cette personne' });
    }
    
    const like = new Like({ fromUserId, toUserId: targetUserId });
    await like.save();
    
    const targetUser = await User.findByIdAndUpdate(
      targetUserId,
      { $inc: { likesCount: 1 } },
      { new: true }
    );
    
    res.json({
      success: true,
      likesCount: targetUser.likesCount,
      message: 'Coup de cœur envoyé avec succès !'
    });
  } catch (err) {
    console.error('Erreur like:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. RÉCUPÉRER L'HISTORIQUE DES MESSAGES
app.get('/api/messages/:userId/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    
    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId }
      ]
    }).sort({ timestamp: 1 });
    
    await Message.updateMany(
      { senderId: otherUserId, receiverId: userId, isRead: false },
      { isRead: true }
    );
    
    res.json(messages);
  } catch (err) {
    console.error('Erreur récupération messages:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. PASSER VIP
app.post('/api/vip', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    if (user.isVip) {
      return res.status(400).json({ error: 'Vous êtes déjà VIP' });
    }
    
    if (user.solde < 5000) {
      return res.status(400).json({ error: 'Solde insuffisant. Rechargez votre compte d\'abord.' });
    }
    
    user.solde -= 5000;
    user.isVip = true;
    await user.save();
    
    await Transaction.create({
      userId,
      type: 'vip',
      amount: 5000,
      status: 'completed'
    });
    
    res.json({
      success: true,
      user: {
        id: user._id,
        nom: user.nom,
        email: user.email,
        isVip: user.isVip,
        solde: user.solde,
        likesCount: user.likesCount,
        messagesCount: user.messagesCount
      }
    });
  } catch (err) {
    console.error('Erreur VIP:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. RECHARGER LE SOLDE
app.post('/api/monetization', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.userId;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { solde: amount } },
      { new: true }
    );
    
    await Transaction.create({
      userId,
      type: 'recharge',
      amount,
      status: 'completed'
    });
    
    res.json({
      success: true,
      user: {
        id: user._id,
        solde: user.solde
      },
      message: `Rechargement de ${amount} FCFA réussi !`
    });
  } catch (err) {
    console.error('Erreur rechargement:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. METTRE À JOUR LA PHOTO
app.post('/api/update-photo', authenticateToken, async (req, res) => {
  try {
    const { photoBase64 } = req.body;
    const userId = req.user.userId;
    
    if (!photoBase64) {
      return res.status(400).json({ error: 'Photo requise' });
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      { photo: photoBase64 },
      { new: true }
    );
    
    res.json({
      success: true,
      photo: user.photo,
      message: 'Photo mise à jour avec succès !'
    });
  } catch (err) {
    console.error('Erreur mise à jour photo:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. ENVOYER UNE DEMANDE SOS
app.post('/api/ecoute', authenticateToken, async (req, res) => {
  try {
    const { type, message } = req.body;
    const userId = req.user.userId;
    
    if (!type || !message) {
      return res.status(400).json({ error: 'Type et message sont requis' });
    }
    
    const sosRequest = new SOSRequest({
      userId,
      type,
      message
    });
    
    await sosRequest.save();
    
    res.json({
      success: true,
      message: 'Votre demande a bien été transmise. Notre équipe vous contactera.'
    });
  } catch (err) {
    console.error('Erreur SOS:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- GESTION WEBSOCKET (SOCKET.IO) ---
const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Nouvelle connexion:', socket.id);
  
  socket.on('user_connected', (userId) => {
    activeUsers.set(userId, socket.id);
    console.log(`✅ Utilisateur ${userId} connecté (${socket.id})`);
  });
  
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
  });
  
  socket.on('public_message', (data) => {
    io.emit('public_message', {
      ...data,
      timestamp: new Date()
    });
  });
  
  socket.on('typing_public', (data) => {
    socket.broadcast.emit('display_typing_public', data);
  });
  
  socket.on('stop_typing_public', () => {
    socket.broadcast.emit('hide_typing_public');
  });
  
  socket.on('private_message', async (data) => {
    try {
      const { senderId, receiverId, text } = data;
      
      const message = new Message({
        senderId,
        receiverId,
        text
      });
      await message.save();
      
      await User.findByIdAndUpdate(senderId, { $inc: { messagesCount: 1 } });
      
      const receiverSocketId = activeUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('private_message', message);
      }
      
      socket.emit('private_message', message);
    } catch (err) {
      console.error('Erreur message privé:', err);
    }
  });
  
  socket.on('typing_private', (data) => {
    const receiverSocketId = activeUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('display_typing_private', {
        senderId: data.senderId,
        senderName: data.senderName
      });
    }
  });
  
  socket.on('stop_typing_private', (data) => {
    const receiverSocketId = activeUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('hide_typing_private', {
        senderId: data.senderId
      });
    }
  });
  
  socket.on('disconnect', () => {
    for (const [userId, socketId] of activeUsers.entries()) {
      if (socketId === socket.id) {
        activeUsers.delete(userId);
        console.log(`👋 Utilisateur ${userId} déconnecté`);
        break;
      }
    }
  });
});

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Nonvitcha démarré sur http://localhost:${PORT}`);
});
