let currentUserId = null;

document.addEventListener('DOMContentLoaded', () => {
    verifierSession();

    // Gestion Inscription
    const formRegister = document.getElementById('form-register');
    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(formRegister);

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (data.success) {
                    alert('Inscription réussie !');
                    window.location.reload(); // Force le rafraîchissement complet
                } else {
                    alert(data.message || 'Erreur lors de l\'inscription');
                }
            } catch (err) {
                alert('Erreur de connexion avec le serveur.');
            }
        });
    }

    // Gestion Connexion
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();

                if (data.success) {
                    window.location.reload();
                } else {
                    alert(data.message || 'Identifiants incorrects');
                }
            } catch (err) {
                alert('Erreur de connexion');
            }
        });
    }
});

async function verifierSession() {
    try {
        const res = await fetch('/api/me');
        const data = await res.json();

        const authSection = document.getElementById('auth-section');
        const navBar = document.getElementById('nav-bar');
        const userCoins = document.getElementById('user-coins');

        if (data.loggedIn && data.user) {
            currentUserId = data.user.id;
            if (userCoins) userCoins.innerText = data.user.nonvicoins || 0;
            if (authSection) authSection.style.display = 'none';
            if (navBar) navBar.style.display = 'flex';
            
            naviguerVers('decouverte');
        } else {
            if (authSection) authSection.style.display = 'block';
            if (navBar) navBar.style.display = 'none';
            cacherToutesSections();
        }
    } catch (err) {
        console.error("Erreur session:", err);
    }
}

function naviguerVers(sectionId) {
    cacherToutesSections();
    const target = document.getElementById(`${sectionId}-section`);
    if (target) target.style.display = 'block';

    if (sectionId === 'decouverte') chargerMembres();
    if (sectionId === 'chat') chargerChatPublic();
    if (sectionId === 'publicites') chargerPublicites();
    if (sectionId === 'ecoutes') chargerMesEcoutes();
}

function cacherToutesSections() {
    const sections = ['decouverte', 'messages', 'chat', 'ecoutes', 'publicites', 'recharge', 'admin'];
    sections.forEach(id => {
        const elem = document.getElementById(`${id}-section`);
        if (elem) elem.style.display = 'none';
    });
}

async function chargerMembres() {
    try {
        const res = await fetch('/api/users');
        if (!res.ok) return;
        const users = await res.json();
        const container = document.getElementById('membres-list');
        if (!container) return;

        container.innerHTML = users.map(u => `
            <div class="card">
                <img src="${u.photo}" alt="${u.nom}" style="width:100%; border-radius:8px;">
                <h3>${u.nom}, ${u.age} ans ${u.is_vip ? '⭐ VIP' : ''}</h3>
                <p>📍 ${u.ville}</p>
                <p>${u.is_online ? '🟢 En ligne' : '🔴 Hors ligne'}</p>
                <button onclick="ouvrirDiscussion(${u.id}, '${u.nom}')">💬 Discuter</button>
                <button onclick="likerUser(${u.id}, false)">❤️ Like</button>
                <button onclick="likerUser(${u.id}, true)">💘 Coup de Cœur (10 coins)</button>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function likerUser(receiverId, isCoupDeCoeur) {
    try {
        const res = await fetch('/api/like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiver_id: receiverId, is_coup_de_coeur: isCoupDeCoeur })
        });
        const data = await res.json();
        if (data.success) {
            alert(isCoupDeCoeur ? 'Coup de cœur envoyé !' : 'Like envoyé !');
            verifierSession();
        } else {
            alert(data.message || 'Erreur');
        }
    } catch (err) {
        alert('Erreur réseau');
    }
}

async function chargerChatPublic() {
    try {
        const res = await fetch('/api/chat');
        const messages = await res.json();
        const container = document.getElementById('chat-box');
        if (container) {
            container.innerHTML = messages.map(m => `<p><strong>${m.nom}:</strong> ${m.content}</p>`).join('');
        }
    } catch (err) {
        console.error(err);
    }
}

async function chargerPublicites() {
    try {
        const res = await fetch('/api/publicites');
        const pubs = await res.json();
        const container = document.getElementById('publicites-list');
        if (container) {
            container.innerHTML = pubs.map(p => `
                <div class="pub-card">
                    <h3>${p.titre}</h3>
                    <p>${p.description}</p>
                    ${p.image ? `<img src="${p.image}" style="max-width:100%;">` : ''}
                    <small>Publié par ${p.nom}</small>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error(err);
    }
}

async function chargerMesEcoutes() {
    try {
        const res = await fetch('/api/ecoutes/mes-demandes');
        const demandes = await res.json();
        const container = document.getElementById('ecoutes-liste');
        if (container) {
            container.innerHTML = demandes.map(d => `
                <div class="card">
                    <p><strong>Type:</strong> ${d.type_demande}</p>
                    <p><strong>Message:</strong> ${d.message}</p>
                    <p><strong>Statut:</strong> ${d.statut}</p>
                    ${d.reponse ? `<p><strong>Réponse admin:</strong> ${d.reponse}</p>` : ''}
                </div>
            `).join('');
        }
    } catch (err) {
        console.error(err);
    }
}

async function deconnexion() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
}
