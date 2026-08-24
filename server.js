let currentUserId = null;
let activeChatReceiverId = null;

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    verifierSession();
    configurerFormulaires();
});

async function verifierSession() {
    const res = await fetch('/api/me');
    const data = await res.json();

    if (data.loggedIn) {
        currentUserId = data.user.id;
        document.getElementById('user-coins').innerText = data.user.nonvicoins;
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('nav-bar').style.display = 'flex';
        naviguerVers('decouverte');
    } else {
        document.getElementById('auth-section').style.display = 'block';
        document.getElementById('nav-bar').style.display = 'none';
        cacherToutesSections();
    }
}

function cacherToutesSections() {
    const sections = ['decouverte-section', 'messages-section', 'chat-section', 'ecoutes-section', 'publicites-section', 'recharge-section', 'admin-section'];
    sections.forEach(id => document.getElementById(id).style.display = 'none');
}

function naviguerVers(section) {
    cacherToutesSections();
    if (section === 'decouverte') {
        document.getElementById('decouverte-section').style.display = 'block';
        chargerUtilisateurs();
    } else if (section === 'messages') {
        document.getElementById('messages-section').style.display = 'block';
    } else if (section === 'chat') {
        document.getElementById('chat-section').style.display = 'block';
        chargerChatPublic();
    } else if (section === 'ecoutes') {
        document.getElementById('ecoutes-section').style.display = 'block';
        chargerMesEcoutes();
    } else if (section === 'publicites') {
        document.getElementById('publicites-section').style.display = 'block';
        chargerPublicites();
    } else if (section === 'recharge') {
        document.getElementById('recharge-section').style.display = 'block';
    }
}

function configurerFormulaires() {
    // Inscription avec protection contre la double soumission
    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        try {
            const formData = new FormData(e.target);
            const res = await fetch('/api/register', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.success) {
                alert('Inscription réussie !');
                verifierSession();
            } else {
                alert(data.message || 'Erreur lors de l\'inscription');
            }
        } catch (err) {
            alert('Erreur de connexion au serveur.');
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // Connexion
    document.getElementById('form-login')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);

        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();

        if (result.success) {
            verifierSession();
        } else {
            alert(result.message);
        }
    });

    // Formulaire d'écoute
    document.getElementById('form-ecoute')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData);

        const res = await fetch('/api/ecoutes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        alert(result.message || 'Demande envoyée');
        e.target.reset();
        chargerMesEcoutes();
    });

    // Publicité
    document.getElementById('form-publicite')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await fetch('/api/publicites', { method: 'POST', body: formData });
        const result = await res.json();

        if (result.success) {
            alert('Annonce publiée !');
            e.target.reset();
            chargerPublicites();
            verifierSession();
        } else {
            alert(result.message);
        }
    });

    // Chat Privé
    document.getElementById('form-private-chat')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeChatReceiverId) return;
        const input = document.getElementById('private-message-input');
        const content = input.value;

        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiver_id: activeChatReceiverId, content })
        });
        input.value = '';
        chargerDiscussion(activeChatReceiverId);
    });

    // Chat Public
    document.getElementById('form-public-chat')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('public-message-input');
        const content = input.value;

        await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        input.value = '';
        chargerChatPublic();
    });
}

// Recherche & Découverte
async function chargerUtilisateurs(query = '') {
    try {
        const url = query ? `/api/users?search=${encodeURIComponent(query)}` : '/api/users';
        const res = await fetch(url);
        
        if (!res.ok) return;

        const users = await res.json();
        const grid = document.getElementById('users-grid');
        if (!grid) return;
        grid.innerHTML = '';

        if (users.length === 0) {
            grid.innerHTML = '<p style="text-align:center; padding:20px;">Aucun autre membre trouvé.</p>';
            return;
        }

        users.forEach(u => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <img src="${u.photo || 'https://via.placeholder.com/150'}" alt="${u.nom}" class="profile-img">
                <h3>${u.nom}, ${u.age} ans ${u.is_vip ? '⭐ VIP' : ''}</h3>
                <p>📍 ${u.ville || 'Non renseignée'} ${u.is_online ? '🟢 En ligne' : '🔴 Hors ligne'}</p>
                <div class="actions" style="margin-top:10px; display:flex; gap:5px; justify-content:center;">
                    <button onclick="envoyerLike(${u.id}, false)">❤️</button>
                    <button onclick="envoyerLike(${u.id}, true)">💘 Coup de Cœur</button>
                    <button onclick="ouvrirDiscussion(${u.id}, '${u.nom}')">💬 Message</button>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        console.error("Erreur chargement utilisateurs:", err);
    }
}

function rechercherMembres() {
    const q = document.getElementById('search-input').value;
    chargerUtilisateurs(q);
}

function reinitialiserRecherche() {
    document.getElementById('search-input').value = '';
    chargerUtilisateurs();
}

async function envoyerLike(receiverId, isCoupDeCoeur) {
    const res = await fetch('/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_id: receiverId, is_coup_de_coeur: isCoupDeCoeur })
    });
    const data = await res.json();
    if (data.success) {
        alert(isCoupDeCoeur ? 'Coup de Cœur envoyé !' : 'Like envoyé !');
        verifierSession();
    } else {
        alert(data.message);
    }
}

// Chat Privé
function ouvrirDiscussion(userId, userNom) {
    activeChatReceiverId = userId;
    document.getElementById('chat-with-title').innerText = `Discussion avec ${userNom}`;
    naviguerVers('messages');
    chargerDiscussion(userId);
}

async function chargerDiscussion(userId) {
    const res = await fetch(`/api/messages/${userId}`);
    const messages = await res.json();
    const chatWindow = document.getElementById('private-chat-messages');
    chatWindow.innerHTML = '';

    messages.forEach(m => {
        const div = document.createElement('div');
        div.className = `message-bubble ${m.sender_id === currentUserId ? 'message-self' : 'message-other'}`;
        div.innerText = m.content;
        chatWindow.appendChild(div);
    });
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Chat Public
async function chargerChatPublic() {
    const res = await fetch('/api/chat');
    const messages = await res.json();
    const chatWindow = document.getElementById('public-chat-messages');
    chatWindow.innerHTML = '';

    messages.forEach(m => {
        const div = document.createElement('div');
        div.className = `message-bubble ${m.user_id === currentUserId ? 'message-self' : 'message-other'}`;
        div.innerHTML = `<strong>${m.nom}:</strong> ${m.content}`;
        chatWindow.appendChild(div);
    });
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Écoutes
async function chargerMesEcoutes() {
    const res = await fetch('/api/ecoutes/mes-demandes');
    const demandes = await res.json();
    const list = document.getElementById('ecoutes-list');
    list.innerHTML = '';

    demandes.forEach(d => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.textAlign = 'left';
        div.style.marginBottom = '10px';
        div.innerHTML = `
            <strong>Type:</strong> ${d.type_demande} | <strong>Statut:</strong> ${d.statut}<br>
            <strong>Message:</strong> ${d.message}<br>
            ${d.reponse ? `<div style="background:#e8f8f5; padding:8px; margin-top:5px; border-radius:5px;"><strong>Réponse Admin:</strong> ${d.reponse}</div>` : ''}
        `;
        list.appendChild(div);
    });
}

// Publicités
async function chargerPublicites() {
    const res = await fetch('/api/publicites');
    const pubs = await res.json();
    const list = document.getElementById('publicites-list');
    list.innerHTML = '';

    pubs.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            ${p.image ? `<img src="${p.image}" style="width:100%; max-height:150px; object-fit:cover; border-radius:5px;">` : ''}
            <h3>${p.titre}</h3>
            <p>${p.description}</p>
            <small>Par : ${p.nom}</small>
        `;
        list.appendChild(card);
    });
}

// Paiement Kkiapay
function payerKkiapay(montant) {
    openKkiapayWidget({
        amount: montant,
        position: "center",
        callback: "reponseKkiapay",
        theme: "#e74c3c",
        key: "VOTRE_CLE_PUBLIQUE_KKIAPAY"
    });
}

function reponseKkiapay(response) {
    fetch('/api/kkiapay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: response.transactionId, amount: response.amount })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('Recharge effectuée avec succès !');
            verifierSession();
        }
    });
}

// Administration
function ouvrirAdminModal() {
    cacherToutesSections();
    document.getElementById('admin-section').style.display = 'block';
}

async function connexionAdmin() {
    const pass = document.getElementById('admin-pass-input').value;
    const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
    });
    const data = await res.json();

    if (data.success) {
        document.getElementById('admin-login-box').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'block';
        chargerAdminDashboard();
    } else {
        alert(data.message);
    }
}

async function chargerAdminDashboard() {
    // Charger la liste des utilisateurs
    const resUsers = await fetch('/api/admin/users');
    const users = await resUsers.json();
    const usersDiv = document.getElementById('admin-users-list');
    usersDiv.innerHTML = '';

    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '10px';
        div.style.textAlign = 'left';
        div.innerHTML = `
            <strong>${u.nom}</strong> (${u.email}) - Coins: ${u.nonvicoins}<br>
            VIP: ${u.is_vip ? 'Oui' : 'Non'} | Suspendu: ${u.is_suspended ? 'Oui' : 'Non'}
            <div style="margin-top:5px; display:flex; gap:5px; flex-wrap:wrap;">
                <button onclick="actionAdmin(${u.id}, 'toggle_vip', ${!u.is_vip})">${u.is_vip ? 'Retirer VIP' : 'Rendre VIP'}</button>
                <button onclick="actionAdmin(${u.id}, 'toggle_suspend', ${!u.is_suspended})">${u.is_suspended ? 'Débloquer' : 'Suspendre'}</button>
                <button onclick="actionAdmin(${u.id}, 'add_coins', 100)">+100 Coins</button>
                <button onclick="supprimerCompteAdmin(${u.id})" style="background:#c0392b;">Supprimer le compte</button>
            </div>
        `;
        usersDiv.appendChild(div);
    });

    // Charger les demandes d'écoute
    const resEcoutes = await fetch('/api/admin/ecoutes');
    const ecoutes = await resEcoutes.json();
    const ecoutesDiv = document.getElementById('admin-ecoutes-list');
    ecoutesDiv.innerHTML = '';

    ecoutes.forEach(e => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '10px';
        div.style.textAlign = 'left';
        div.innerHTML = `
            <strong>Utilisateur:</strong> ${e.nom} (${e.email})<br>
            <strong>Type:</strong> ${e.type_demande} | <strong>Statut:</strong> ${e.statut}<br>
            <strong>Message:</strong> ${e.message}<br>
            <textarea id="reponse-ecoute-${e.id}" placeholder="Réponse de l'administration..."></textarea>
            <button onclick="repondreEcouteAdmin(${e.id})" style="margin-top:5px;">Envoyer la réponse</button>
        `;
        ecoutesDiv.appendChild(div);
    });
}

async function actionAdmin(userId, action, value) {
    await fetch('/api/admin/users/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, value })
    });
    chargerAdminDashboard();
}

async function supprimerCompteAdmin(userId) {
    if (!confirm("Voulez-vous supprimer définitivement ce compte ? Cela libérera son adresse email.")) return;
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
        alert(data.message);
        chargerAdminDashboard();
    }
}

async function repondreEcouteAdmin(ecouteId) {
    const reponse = document.getElementById(`reponse-ecoute-${ecouteId}`).value;
    await fetch('/api/admin/ecoutes/repondre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ecouteId, reponse })
    });
    alert('Réponse transmise');
    chargerAdminDashboard();
}

function deconnexion() {
    fetch('/api/logout', { method: 'POST' }).then(() => location.reload());
}
