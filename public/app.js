Const socket = io();

Let currentUser = JSON.parse(localStorage.getItem('nonvitcha_user')) || null;
Let allMembers = [];
Let activeChatTargetId = null;
Let typingTimeout = null;

Document.addEventListener('DOMContentLoaded', () => {
    InitApp();
    SetupEventListeners();
    SetupSocketListeners();
});

Function initApp() {
    RenderNavigation();
    UpdateCoinsDisplay();
    If (currentUser) {
        Socket.emit('user_connected', currentUser.id || currentUser._id);
        LoadMembers();
        ShowSection('members-section');
    } else {
        ShowSection('auth-section');
    }
}

Function showSection(sectionId) {
    Document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    Const target = document.getElementById(sectionId);
    If (target) target.style.display = 'block';

    If (sectionId === 'members-section') loadMembers();
}

Function renderNavigation() {
    Const nav = document.getElementById('nav-menu');
    If (!currentUser) {
        Nav.innerHTML = `
            <button class="nav-btn nav-btn-members" onclick="showSection('auth-section')"><i class="fa-solid fa-right-to-bracket"></i> Connexion / Inscription</button>
            <button class="nav-btn nav-btn-ecoute" onclick="showSection('ecoutes-section')"><i class="fa-solid fa-hand-holding-heart"></i> Écoute SOS / SSR</button>
            <button class="nav-btn nav-btn-admin" onclick="showSection('admin-section')"><i class="fa-solid fa-shield-halved"></i> Admin</button>
        `;
    } else {
        Nav.innerHTML = `
            <button class="nav-btn nav-btn-members" onclick="showSection('members-section')"><i class="fa-solid fa-users"></i> Membres</button>
            <button class="nav-btn nav-btn-public" onclick="showSection('public-chat-section')"><i class="fa-solid fa-comments"></i> Chat Public</button>
            <button class="nav-btn nav-btn-coins" onclick="showSection('recharge-section')"><i class="fa-solid fa-coins"></i> ${currentUser.coins || 0} Coins ${currentUser.isVip ? '👑 VIP' : ''}</button>
            <button class="nav-btn nav-btn-ecoute" onclick="showSection('ecoutes-section')"><i class="fa-solid fa-hand-holding-heart"></i> Écoute SOS</button>
            <button class="nav-btn nav-btn-admin" onclick="showSection('admin-section')"><i class="fa-solid fa-shield-halved"></i> Admin</button>
            <button class="nav-btn nav-btn-logout" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>
        `;
    }
}

Function updateCoinsDisplay() {
    Const coinsEl = document.getElementById('current-coins-display');
    If (coinsEl && currentUser) {
        CoinsEl.innerText = currentUser.coins || 0;
    }
}

Function setupEventListeners() {
    Document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        E.preventDefault();
        Const email = document.getElementById('login-email').value;
        Const password = document.getElementById('login-password').value;

        Try {
            Const res = await fetch('/api/login', {
                Method: 'POST',
                Headers: { 'Content-Type': 'application/json' },
                Body: JSON.stringify({ email, password })
            });
            Const data = await res.json();
            If (res.ok) {
                CurrentUser = data.user;
                LocalStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
                InitApp();
            } else {
                Alert(data.error);
            }
        } catch (err) {
            Alert('Erreur serveur lors de la connexion.');
        }
    });

    Document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        E.preventDefault();
        Const formData = new FormData(e.target);

        Try {
            Const res = await fetch('/api/register', {
                Method: 'POST',
                Body: formData
            });
            Const data = await res.json();
            If (res.ok) {
                CurrentUser = data.user;
                LocalStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
                InitApp();
            } else {
                Alert(data.error);
            }
        } catch (err) {
            Alert('Erreur réseau lors de l’inscription.');
        }
    });

    Document.getElementById('private-chat-form')?.addEventListener('submit', (e) => {
        E.preventDefault();
        Const input = document.getElementById('private-message-input');
        Const text = input.value.trim();
        If (!text || !activeChatTargetId) return;

        Socket.emit('private_message', {
            FromUserId: currentUser.id || currentUser._id,
            ToUserId: activeChatTargetId,
            FromUserName: currentUser.nom,
            FromUserPhoto: currentUser.photo,
            Text,
            IsCoupDeCoeur: false
        });

        Socket.emit('stop_typing', { toUserId: activeChatTargetId });
        Input.value = '';
    });

    Document.getElementById('private-message-input')?.addEventListener('input', () => {
        If (!activeChatTargetId) return;
        Socket.emit('typing', { toUserId: activeChatTargetId });

        ClearTimeout(typingTimeout);
        TypingTimeout = setTimeout(() => {
            Socket.emit('stop_typing', { toUserId: activeChatTargetId });
        }, 2000);
    });

    Document.getElementById('public-chat-form')?.addEventListener('submit', (e) => {
        E.preventDefault();
        Const input = document.getElementById('public-message-input');
        Const text = input.value.trim();
        If (!text) return;

        Socket.emit('public_message', {
            FromUserName: currentUser ? currentUser.nom : 'Anonyme',
            Text
        });
        Input.value = '';
    });

    Document.getElementById('ecoute-form')?.addEventListener('submit', async (e) => {
        E.preventDefault();
        Const type = document.getElementById('ecoute-type').value;
        Const message = document.getElementById('ecoute-message').value;

        Try {
            Const res = await fetch('/api/ecoute', {
                Method: 'POST',
                Headers: { 'Content-Type': 'application/json' },
                Body: JSON.stringify({
                    Type,
                    Message,
                    UserId: currentUser ? (currentUser.id || currentUser._id) : null
                })
            });
            If (res.ok) {
                Alert('Votre message a été transmis avec succès et en toute confidentialité.');
                Document.getElementById('ecoute-message').value = '';
                ShowSection('members-section');
            }
        } catch (err) {
            Alert('Erreur d’envoi.');
        }
    });

    Document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
        E.preventDefault();
        Const password = document.getElementById('admin-password').value;

        Try {
            Const res = await fetch('/api/admin/login', {
                Method: 'POST',
                Headers: { 'Content-Type': 'application/json' },
                Body: JSON.stringify({ password })
            });
            Const data = await res.json();
            If (res.ok) {
                Document.getElementById('admin-login-box').style.display = 'none';
                Document.getElementById('admin-dashboard').style.display = 'block';
                RenderAdminData(data.users, data.ecoutes);
            } else {
                Alert(data.error);
            }
        } catch (err) {
            Alert('Erreur lors de la connexion admin.');
        }
    });
}

Async function loadMembers() {
    Try {
        Const userId = currentUser ? (currentUser.id || currentUser._id) : '';
        Const res = await fetch(`/api/members?userId=${userId}`);
        AllMembers = await res.json();
        RenderMembers(allMembers);
    } catch (err) {
        Console.error('Erreur membres:', err);
    }
}

Function renderMembers(members) {
    Const container = document.getElementById('members-container');
    If (!container) return;

    Const currentId = currentUser ? (currentUser.id || currentUser._id) : null;

    Container.innerHTML = members
        .filter(m => m.id !== currentId && m._id !== currentId)
        .map(m => {
            Const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.nom)}&background=e11d48&color=fff&size=200`;
            Const photoSrc = m.photo ? m.photo : defaultAvatar;

            Return `
            <div class="member-card">
                <span class="status-badge ${m.online ? 'online' : ''}">${m.online ? 'En ligne' : 'Hors ligne'}</span>
                <img src="${photoSrc}" alt="${m.nom}" onerror="this.onerror=null; this.src='${defaultAvatar}';">
                <div class="card-body">
                    <h4>
                        ${m.nom}, ${m.age}
                        ${m.isVip ? '<span class="vip-badge">👑 VIP</span>' : ''}
                        ${m.isMatch ? '<span class="badge-match">MATCH !</span>' : ''}
                    </h4>
                    <p><i class="fa-solid fa-location-dot"></i> ${m.ville}, ${m.pays}</p>
                    <p><strong>Intérêts:</strong> ${m.interets || 'Aucun'}</p>
                    <div class="card-stats">
                        <span class="stat-item likes"><i class="fa-solid fa-thumbs-up"></i> ${m.likesCount || 0}</span>
                        <span class="stat-item hearts"><i class="fa-solid fa-heart"></i> ${m.heartsCount || 0}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm" onclick="sendLike('${m.id}')"><i class="fa-solid fa-thumbs-up"></i> Like</button>
                    <button class="btn btn-warning btn-sm" onclick="sendHeartAction('${m.id}')"><i class="fa-solid fa-heart"></i> Cœur</button>
                    <button class="btn btn-primary btn-sm" onclick="openPrivateChat('${m.id}', '${m.nom}')"><i class="fa-solid fa-envelope"></i> Message</button>
                </div>
            </div>
        `}).join('');
}

Async function sendLike(targetId) {
    If (!currentUser) return alert('Veuillez vous connecter.');
    Try {
        Const res = await fetch('/api/like', {
            Method: 'POST',
            Headers: { 'Content-Type': 'application/json' },
            Body: JSON.stringify({ senderId: currentUser.id || currentUser._id, targetId })
        });
        If (res.ok) loadMembers();
    } catch (err) {
        Console.error(err);
    }
}

Async function sendHeartAction(targetId) {
    If (!currentUser) return alert('Veuillez vous connecter.');
    Try {
        Const res = await fetch('/api/heart', {
            Method: 'POST',
            Headers: { 'Content-Type': 'application/json' },
            Body: JSON.stringify({ senderId: currentUser.id || currentUser._id, targetId })
        });
        Const data = await res.json();
        If (res.ok) {
            If (data.user) {
                CurrentUser = data.user;
                LocalStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
                RenderNavigation();
                UpdateCoinsDisplay();
            }
            If (data.isMatch) alert('🎉 C\'est un MATCH ! Vous vous plaisez mutuellement.');
            LoadMembers();
        } else {
            Alert(data.error);
        }
    } catch (err) {
        Console.error(err);
    }
}

Function sendCoupDeCoeur() {
    If (!activeChatTargetId) return;
    SendHeartAction(activeChatTargetId);
}

Async function openPrivateChat(targetId, targetName) {
    If (!currentUser) return alert('Veuillez vous connecter.');
    ActiveChatTargetId = targetId;
    Document.getElementById('chat-target-name').innerHTML = `<i class="fa-solid fa-user-lock"></i> Discussion avec ${targetName}`;
    ShowSection('private-chat-section');

    Const viewport = document.getElementById('private-messages-viewport');
    Viewport.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Chargement de la conversation...</p>';

    Try {
        Const userId = currentUser.id || currentUser._id;
        Const res = await fetch(`/api/messages/${userId}/${targetId}`);
        Const messages = await res.json();

        Viewport.innerHTML = '';
        Messages.forEach(msg => appendPrivateMessage(msg));
        Viewport.scrollTop = viewport.scrollHeight;
    } catch (err) {
        Viewport.innerHTML = '<p style="color:red; text-align:center;">Erreur lors du chargement des messages.</p>';
    }
}

Function appendPrivateMessage(msg) {
    Const viewport = document.getElementById('private-messages-viewport');
    If (!viewport) return;

    Const currentId = currentUser ? (currentUser.id || currentUser._id) : '';
    Const isOwn = msg.fromUserId === currentId;

    Const div = document.createElement('div');
    Div.className = `chat-msg ${isOwn ? 'own-msg' : ''}`;
    Div.innerHTML = `
        <strong>${isOwn ? 'Vous' : (msg.fromUserName || 'Membre')} ${msg.isCoupDeCoeur ? '💖 (Coup de Cœur)' : ''}</strong>
        <div>${msg.text}</div>
    `;
    Viewport.appendChild(div);
    Viewport.scrollTop = viewport.scrollHeight;
}

Function setupSocketListeners() {
    Socket.on('private_message', (data) => {
        Const currentId = currentUser ? (currentUser.id || currentUser._id) : '';
        If (
            (data.fromUserId === activeChatTargetId && data.toUserId === currentId) ||
            (data.fromUserId === currentId && data.toUserId === activeChatTargetId)
        ) {
            AppendPrivateMessage(data);
        }
    });

    Socket.on('public_message', (data) => {
        Const viewport = document.getElementById('public-messages-viewport');
        If (!viewport) return;

        Const div = document.createElement('div');
        Div.className = 'chat-msg';
        Div.innerHTML = `<strong>${data.fromUserName}</strong><div>${data.text}</div>`;
        Viewport.appendChild(div);
        Viewport.scrollTop = viewport.scrollHeight;
    });

    Socket.on('user_typing', (data) => {
        If (data.fromUserId === activeChatTargetId) {
            Document.getElementById('typing-indicator').innerText = 'En train d\'écrire...';
        }
    });

    Socket.on('stop_typing', (data) => {
        If (data.fromUserId === activeChatTargetId) {
            Document.getElementById('typing-indicator').innerText = '';
        }
    });

    Socket.on('update_online_status', () => {
        If (document.getElementById('members-section').style.display !== 'none') {
            LoadMembers();
        }
    });
}

Async function buyVIP() {
    If (!currentUser) return;
    Try {
        Const res = await fetch('/api/buy-vip', {
            Method: 'POST',
            Headers: { 'Content-Type': 'application/json' },
            Body: JSON.stringify({ userId: currentUser.id || currentUser._id })
        });
        Const data = await res.json();
        If (res.ok) {
            CurrentUser = data.user;
            LocalStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
            RenderNavigation();
            UpdateCoinsDisplay();
            Alert('👑 Votre statut VIP est maintenant activé !');
        } else {
            Alert(data.error);
        }
    } catch (err) {
        Alert('Erreur d’activation VIP.');
    }
}

Function filterUsers() {
    Const name = document.getElementById('search-name').value.toLowerCase();
    Const country = document.getElementById('search-country').value.toLowerCase();
    Const city = document.getElementById('search-city').value.toLowerCase();
    Const maxAge = parseInt(document.getElementById('search-age').value) || 100;
    Const sex = document.getElementById('search-sex').value;
    Const interest = document.getElementById('search-interest').value.toLowerCase();

    Const filtered = allMembers.filter(m => {
        Const matchesName = m.nom.toLowerCase().includes(name);
        Const matchesCountry = m.pays.toLowerCase().includes(country);
        Const matchesCity = m.ville.toLowerCase().includes(city);
        Const matchesAge = m.age <= maxAge;
        Const matchesSex = !sex || m.sexe === sex;
        Const matchesInterest = !interest || (m.interets && m.interets.toLowerCase().includes(interest));

        Return matchesName && matchesCountry && matchesCity && matchesAge && matchesSex && matchesInterest;
    });

    RenderMembers(filtered);
}

Function resetFilters() {
    Document.getElementById('search-name').value = '';
    Document.getElementById('search-country').value = '';
    Document.getElementById('search-city').value = '';
    Document.getElementById('search-age').value = '';
    Document.getElementById('search-sex').value = '';
    Document.getElementById('search-interest').value = '';
    RenderMembers(allMembers);
}

Function renderAdminData(users, ecoutes) {
    Const usersTable = document.getElementById('admin-users-list');
    Const ecoutesTable = document.getElementById('admin-ecoutes-list');

    UsersTable.innerHTML = users.map(u => `
        <tr>
            <td>${u.nom}</td>
            <td>${u.email}</td>
            <td>${u.coins || 0}</td>
            <td>${u.isVip ? '👑 Oui' : 'Non'}</td>
            <td>${u.likesCount || 0}</td>
            <td>${u.heartsCount || 0}</td>
        </tr>
    `).join('');

    EcoutesTable.innerHTML = ecoutes.map(e => `
        <tr>
            <td><strong>${e.type}</strong></td>
            <td>${e.message}</td>
            <td>${new Date(e.date).toLocaleString()}</td>
        </tr>
    `).join('');
}

Function logout() {
    LocalStorage.removeItem('nonvitcha_user');
    CurrentUser = null;
    Socket.disconnect();
    Location.reload();
}
