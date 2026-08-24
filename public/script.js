let currentUser = null;
let activeChatUserId = null;
let selectedRechargeAmount = 1000;
let selectedCoinsToCredit = 100;

// ==========================================
// NAVIGATION ET ÉTATS DU SITE
// ==========================================

function afficherSection(sectionId) {
    const sections = [
        'auth-section', 
        'decouverte-section', 
        'messages-section', 
        'chat-section', 
        'ecoutes-section', 
        'publicites-section', 
        'recharge-section',
        'admin-section'
    ];
    
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === sectionId + '-section') ? 'block' : 'none';
    });

    if (sectionId === 'decouverte') chargerUtilisateurs();
    if (sectionId === 'chat') chargerChatPublic();
    if (sectionId === 'ecoutes') chargerEcoutes();
    if (sectionId === 'publicites') chargerPublicites();
}

async function verifierSession() {
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            const nav = document.getElementById('user-nav');
            if (nav) nav.style.display = 'flex';
            const coinsEl = document.getElementById('nav-coins');
            if (coinsEl) coinsEl.innerText = `🪙 ${currentUser.nonvicoins} Nonvicoins`;
            afficherSection('decouverte');
        } else {
            afficherSection('auth');
        }
    } catch (err) {
        afficherSection('auth');
    }
}

// ==========================================
// AUTHENTIFICATION
// ==========================================

document.getElementById('form-register')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const res = await fetch('/api/register', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
        alert('Inscription réussie !');
        verifierSession();
    } else {
        alert(data.message || 'Erreur lors de l\'inscription');
    }
});

document.getElementById('form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success) {
        verifierSession();
    } else {
        alert(data.message || 'Identifiants incorrects');
    }
});

async function deconnexion() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
}

// ==========================================
// DÉCOUVERTE, LIKES & COUPS DE CŒUR
// ==========================================

async function chargerUtilisateurs() {
    const res = await fetch('/api/users');
    const users = await res.json();
    const grid = document.getElementById('users-grid');
    if (!grid) return;
    grid.innerHTML = '';

    users.forEach(u => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${u.photo}" alt="${u.nom}" class="profile-img">
            <h3>${u.nom}, ${u.age} ans ${u.is_vip ? '⭐ VIP' : ''}</h3>
            <p>📍 ${u.ville} ${u.is_online ? '🟢 En ligne' : '🔴 Hors ligne'}</p>
            <div class="actions">
                <button onclick="envoyerLike(${u.id}, false)">❤️ Like</button>
                <button onclick="envoyerLike(${u.id}, true)">💘 Coup de Cœur</button>
                <button onclick="ouvrirDiscussion(${u.id}, '${u.nom}')">💬 Message</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

async function envoyerLike(receiverId, isCoupDeCoeur) {
    const res = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId, isCoupDeCoeur })
    });
    const data = await res.json();
    if (data.isMatch) {
        alert('🎉 C\'est un MATCH ! Vous vous plaisez mutuellement !');
    } else {
        alert(isCoupDeCoeur ? '💘 Coup de cœur envoyé !' : '❤️ Like envoyé !');
    }
}

// ==========================================
// RECHARGING & PAIEMENT KKIAPAY
// ==========================================

function lancerPaiementKkiapay(amount, coins) {
    selectedRechargeAmount = amount;
    selectedCoinsToCredit = coins;

    if (typeof openKkiapayWidget === 'function') {
        openKkiapayWidget({
            amount: amount,
            key: 'VOTRE_CLE_PUBLIQUE_KKIAPAY', // Remplacez avec votre vraie clé Kkiapay
            sandbox: true,
            email: currentUser ? currentUser.email : ''
        });
    } else {
        alert('Module Kkiapay indisponible pour le moment.');
    }
}

window.addEventListener('kkiapay:success', async (response) => {
    try {
        const res = await fetch('/api/kkiapay/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transactionId: response.transactionId,
                coinsToCredit: selectedCoinsToCredit
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(`🪙 Bravo ! Votre compte a été crédité de ${selectedCoinsToCredit} Nonvicoins !`);
            verifierSession();
        }
    } catch (err) {
        alert('Erreur lors de la validation du paiement.');
    }
});

// ==========================================
// MESSAGERIE PRIVÉE (1-À-1)
// ==========================================

async function ouvrirDiscussion(userId, userName) {
    activeChatUserId = userId;
    afficherSection('messages');
    const header = document.getElementById('private-chat-header');
    if (header) header.innerText = `Discussion avec ${userName}`;
    chargerMessagesPrives();
}

async function chargerMessagesPrives() {
    if (!activeChatUserId) return;
    const res = await fetch(`/api/messages/${activeChatUserId}`);
    const msgs = await res.json();
    const box = document.getElementById('private-chat-messages');
    if (!box) return;
    box.innerHTML = msgs.map(m => `
        <div class="msg ${m.sender_id === currentUser.id ? 'sent' : 'received'}">
            <p>${m.message}</p>
        </div>
    `).join('');
}

document.getElementById('form-private-chat')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('private-message-input');
    await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId: activeChatUserId, message: input.value })
    });
    input.value = '';
    chargerMessagesPrives();
});

// ==========================================
// CHAT PUBLIC
// ==========================================

async function chargerChatPublic() {
    const res = await fetch('/api/chat');
    const msgs = await res.json();
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = msgs.map(m => `
        <div class="msg">
            <strong>${m.username || 'Membre'} ${m.uservip ? '⭐ VIP' : ''} :</strong> ${m.message}
        </div>
    `).join('');
}

document.getElementById('form-chat')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input.value })
    });
    input.value = '';
    chargerChatPublic();
});

// ==========================================
// ÉCOUTE ET SOUTIEN (SOS / VBG)
// ==========================================

async function chargerEcoutes() {
    const res = await fetch('/api/ecoutes');
    const list = await res.json();
    const container = document.getElementById('ecoutes-list');
    if (!container) return;
    container.innerHTML = list.map(e => `
        <div class="card" style="text-align:left;">
            <h4>${e.categorie}</h4>
            <p><strong>Message envoyé :</strong> ${e.message}</p>
            <p><strong>Réponse :</strong> ${e.reponse || '<em>En attente d\'une réponse...</em>'}</p>
        </div>
    `).join('');
}

document.getElementById('form-ecoute')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const categorie = document.getElementById('ecoute-categorie').value;
    const message = document.getElementById('ecoute-message').value;

    const res = await fetch('/api/ecoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categorie, message })
    });
    const data = await res.json();
    if (data.success) {
        alert('Transmis confidentiellement.');
        document.getElementById('ecoute-message').value = '';
        chargerEcoutes();
    }
});

// ==========================================
// PUBLICITÉS & ANNONCES
// ==========================================

async function chargerPublicites() {
    const res = await fetch('/api/publicites');
    const pubs = await res.json();
    const grid = document.getElementById('publicites-list');
    if (!grid) return;
    grid.innerHTML = pubs.map(p => `
        <div class="card">
            <h3>${p.titre}</h3>
            <p>${p.description}</p>
            <p><strong>Contact :</strong> ${p.contact}</p>
            <small>Auteur : ${p.annonceur}</small>
        </div>
    `).join('');
}

document.getElementById('form-publicite')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = document.getElementById('pub-titre').value;
    const description = document.getElementById('pub-description').value;
    const contact = document.getElementById('pub-contact').value;

    const res = await fetch('/api/publicites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre, description, contact })
    });
    const data = await res.json();
    if (data.success) {
        alert('Annonce publiée !');
        document.getElementById('pub-titre').value = '';
        document.getElementById('pub-description').value = '';
        document.getElementById('pub-contact').value = '';
        verifierSession();
        chargerPublicites();
    } else {
        alert(data.message || 'Erreur lors de la publication.');
    }
});

// ==========================================
// ADMINISTRATION (GESTION VIP, SOLDE ET MODÉRATION)
// ==========================================

async function connexionAdmin() {
    const password = document.getElementById('admin-password-input').value;
    const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.success) {
        document.getElementById('admin-login-box').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'block';
        chargerGestionUtilisateursAdmin();
        chargerEcoutesAdmin();
    } else {
        alert(data.message);
    }
}

async function chargerGestionUtilisateursAdmin() {
    const res = await fetch('/api/admin/users');
    const users = await res.json();
    const container = document.getElementById('admin-users-list');
    if (!container) return;

    container.innerHTML = users.map(u => `
        <div class="card" style="text-align:left;">
            <p><strong>${u.nom}</strong> (${u.email}) ${u.is_suspended ? '🔴 [SUSPENDU]' : ''}</p>
            <p>Solde : 🪙 ${u.nonvicoins} Nonvicoins | Statut VIP : ${u.is_vip ? '⭐ OUI' : 'NON'}</p>
            <div class="actions" style="justify-content:flex-start;">
                <button onclick="changerStatutVIP(${u.id}, ${!u.is_vip})">
                    ${u.is_vip ? 'Retirer VIP' : 'Promouvoir ⭐ VIP'}
                </button>
                <button onclick="ajouterCoinsAdmin(${u.id})">➕ Créditer Nonvicoins</button>
                <button onclick="suspendreCompteAdmin(${u.id})" style="background:#c0392b;">🚫 Suspendre</button>
            </div>
        </div>
    `).join('');
}

async function changerStatutVIP(userId, targetStatus) {
    const res = await fetch(`/api/admin/users/${userId}/vip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVip: targetStatus })
    });
    const data = await res.json();
    if (data.success) {
        alert(data.message);
        chargerGestionUtilisateursAdmin();
    }
}

async function ajouterCoinsAdmin(userId) {
    const amount = prompt("Entrez le nombre de Nonvicoins à ajouter :");
    if (!amount || isNaN(amount)) return;

    const res = await fetch(`/api/admin/users/${userId}/coins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseInt(amount) })
    });
    const data = await res.json();
    if (data.success) {
        alert(data.message);
        chargerGestionUtilisateursAdmin();
    }
}

async function suspendreCompteAdmin(userId) {
    if (!confirm("Confirmer la suspension de ce membre ?")) return;
    const res = await fetch(`/api/admin/users/${userId}/suspend`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
        alert(data.message);
        chargerGestionUtilisateursAdmin();
    }
}

async function chargerEcoutesAdmin() {
    const res = await fetch('/api/admin/ecoutes');
    const ecoutes = await res.json();
    const container = document.getElementById('admin-ecoutes-list');
    if (!container) return;

    container.innerHTML = ecoutes.map(e => `
        <div class="card" style="text-align:left;">
            <p><strong>Sujet :</strong> ${e.categorie} (Par ${e.nom} - ${e.email})</p>
            <p><strong>Message :</strong> ${e.message}</p>
            <p><strong>Réponse actuelle :</strong> ${e.reponse || '<em>Aucune</em>'}</p>
            <button onclick="repondreEcouteAdmin(${e.id})">✉️ Répondre</button>
        </div>
    `).join('');
}

async function repondreEcouteAdmin(ecouteId) {
    const reponse = prompt("Saisissez la réponse confidentielle de l'administration :");
    if (!reponse) return;

    const res = await fetch(`/api/admin/ecoutes/${ecouteId}/repondre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reponse })
    });
    const data = await res.json();
    if (data.success) {
        alert("Réponse enregistrée.");
        chargerEcoutesAdmin();
    }
}

// Lancement automatique
verifierSession();
