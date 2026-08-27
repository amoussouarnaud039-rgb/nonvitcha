const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// --- CONNEXION MONGODB CORRIGÉE ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nonvitcha')
.then(() => console.log('Connecté à MongoDB (nonvitcha)'))
.catch(err => console.error('Erreur de connexion MongoDB :', err));

// --- SCHÉMAS & MODÈLES ---
const userSchema = new mongoose.Schema({
  pseudo: { type: String, required: true, unique: true },
  genre: String,
  ville: String,
  interets: String,
  bio: String,
  photo: String, // Stocké en Base64
  isPremium: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const privateMessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  message: { type: String, required: true },
  isCoupDeCoeur: { type: Boolean, default: false },
  isLike: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
  transactionId: String,
  pseudo: String,
  amount: Number,
  status: { type: String, default: 'pending' },
  reference: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// --- CONFIGURATION FEDAPAY ---
const FEDAPAY_SECRET_KEY = process.FEDA_SECRET_KEY || 'sk_sandbox_xxxxxxxxxxxxxxxxxxxx';
const FEDAPAY_PUBLIC_KEY = process.FEDA_PUBLIC_KEY || 'pk_sandbox_xxxxxxxxxxxxxxxxxxxx';
const FEDAPAY_MODE = process.FEDA_MODE || 'sandbox';

// --- ROUTES API REST ---

// 1. Inscription / Enregistrement profil
app.post('/api/users', async (req, res) => {
  try {
    const { pseudo, genre, ville, interets, bio, photo } = req.body;
    let user = await User.findOne({ pseudo });
    if (user) {
      user.genre = genre || user.genre;
      user.ville = ville || user.ville;
      user.interets = interets || user.interets;
      user.bio = bio || user.bio;
      if (photo) user.photo = photo;
      await user.save();
    } else {
      user = new User({ pseudo, genre, ville, interets, bio, photo });
      await user.save();
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Recherche de profils (par ville ou centre d'intérêt)
app.get('/api/users', async (req, res) => {
  try {
    const { ville, interet, exclude } = req.query;
    let query = {};
    if (ville) query.ville = new RegExp(ville, 'i');
    if (interet) query.interets = new RegExp(interet, 'i');
    if (exclude) query.pseudo = { $ne: exclude };

    const users = await User.find(query).select('-__v');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Récupération de l'historique des messages privés et comptage des interactions
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await PrivateMessage.find({
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 }
      ]
    }).sort({ timestamp: 1 });

    const stats = {
      totalMessages: messages.length,
      likesCount: messages.filter(m => m.isLike && m.recipient === user1).length,
      coupDeCoeurCount: messages.filter(m => m.isCoupDeCoeur && m.recipient === user1).length
    };

    res.json({ success: true, messages, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Statistiques globales d'interactions (Likes et Coups de cœur) pour un utilisateur
app.get('/api/stats/:pseudo', async (req, res) => {
  try {
    const { pseudo } = req.params;
    const totalLikesReceived = await PrivateMessage.countDocuments({ recipient: pseudo, isLike: true });
    const totalCoupDeCoeurReceived = await PrivateMessage.countDocuments({ recipient: pseudo, isCoupDeCoeur: true });
    const totalMessagesReceived = await PrivateMessage.countDocuments({ recipient: pseudo });

    res.json({
      success: true,
      stats: {
        likes: totalLikesReceived,
        coupDeCoeur: totalCoupDeCoeurReceived,
        messages: totalMessagesReceived
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Initialisation du paiement FedaPay (Monétisation / Pass Premium)
app.post('/api/payment/init', async (req, res) => {
  try {
    const { pseudo, email, amount, description } = req.body;
    
    const response = await axios.post(
      'https://api.fedapay.com/v1/transactions',
      {
        description: description || 'Abonnement Premium Nonvitcha',
        amount: amount || 1000,
        currency: { iso: 'XOF' },
        customer: {
          email: email || `${pseudo}@nonvitcha.bj`,
          firstname: pseudo,
          lastname: 'Membre'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${FEDAPAY_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const transactionData = response.data;
    
    const tokenResponse = await axios.post(
      `https://api.fedapay.com/v1/transactions/${transactionData.v1.id}/token`,
      {},
      {
        headers: { 'Authorization': `Bearer ${FEDAPAY_SECRET_KEY}` }
      }
    );

    await Transaction.create({
      transactionId: transactionData.v1.id,
      pseudo,
      amount: amount || 1000,
      status: 'pending',
      reference: tokenResponse.data.token
    });

    res.json({
      success: true,
      url: tokenResponse.data.url,
      transactionId: transactionData.v1.id
    });

  } catch (err) {
    console.error('Erreur FedaPay :', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// 6. Webhook / Vérification du statut de paiement FedaPay
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (event.name === 'transaction.approved') {
      const transactionObj = event.entity;
      const transactionId = transactionObj.id;
      
      const localTx = await Transaction.findOne({ transactionId });
      if (localTx) {
        localTx.status = 'approved';
        await localTx.save();

        await User.findOneAndUpdate({ pseudo: localTx.pseudo }, { isPremium: true });
      }
    }
    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GESTION WEBSOCKET (SOCKET.IO) ---
const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log('Un utilisateur s\'est connecté :', socket.id);

  socket.on('register', (pseudo) => {
    activeUsers.set(pseudo, socket.id);
    console.log(`Utilisateur enregistré : ${pseudo} (${socket.id})`);
  });

  socket.on('public_message', (data) => {
    io.emit('public_message', data);
  });

  socket.on('typing_public', (data) => {
    socket.broadcast.emit('typing_public', data);
  });

  socket.on('private_message', async (data) => {
    try {
      const { sender, recipient, message, isCoupDeCoeur, isLike } = data;
      
      const newMessage = new PrivateMessage({
        sender,
        recipient,
        message,
        isCoupDeCoeur: !!isCoupDeCoeur,
        isLike: !!isLike
      });
      await newMessage.save();

      const recipientSocketId = activeUsers.get(recipient);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private_message', newMessage);
      }
      
      socket.emit('message_sent', newMessage);
    } catch (err) {
      console.error('Erreur message privé :', err);
    }
  });

  socket.on('typing_private', (data) => {
    const { sender, recipient } = data;
    const recipientSocketId = activeUsers.get(recipient);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('typing_private', { sender });
    }
  });

  socket.on('disconnect', () => {
    for (let [pseudo, id] of activeUsers.entries()) {
      if (id === socket.id) {
        activeUsers.delete(pseudo);
        console.log(`Utilisateur déconnecté : ${pseudo}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Nonvitcha démarré sur le port ${PORT}`);
});
