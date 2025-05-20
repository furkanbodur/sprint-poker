// ===== SPRINT POKER LOGIC =====
let socket, username;
let myScore = null;
let myHost = false;
let userList = [];
let hostName = '';
let revealedScores = null;
let currentTaskIdx = 0;
let taskListCache = [];
let taskAvgCache = [];
let scoringStarted = false;
let myFunEmoji = null;
const FIBONACCI = [1,2,3,5,8,13,21,34,55,89];

window.onload = function() {
    let savedUsername = localStorage.getItem('username');
    if (savedUsername) {
        document.getElementById('username').value = savedUsername;
    }
};

function join() {
    username = document.getElementById('username').value.trim();
    if (!username) {
        document.getElementById('login-error').innerText = "Please enter a username.";
        return;
    }
    document.getElementById('login-error').innerText = '';
    socket = io();
    socket.emit('join', {username});

    socket.on('username_taken', () => {
        document.getElementById('login-error').innerText = "Username already taken. Please choose another.";
        socket.disconnect();
    });

    socket.on('joined', data => {
        if (typeof data.scoring_started !== "undefined") {
            scoringStarted = !!data.scoring_started;
        }
        if (!data.tasks || data.tasks.length === 0) {
            scoringStarted = false;
        }
        currentTaskIdx = data.current || 0;
        if (data.username) {
            document.getElementById('login-card').style.display='none';
            document.getElementById('main-layout').style.display='';
            localStorage.setItem('username', username);
            updateUsersTable(data.users, data.host, data.username, revealedScores);
            setupTaskInputListener();
        } else {
            const currentUser = localStorage.getItem('username');
            updateUsersTable(data.users, data.host, currentUser, revealedScores);
        }
        clearAllFunEmojis();
    });

    socket.on('task_list', data => {
        taskListCache = data.tasks || [];
        taskAvgCache = data.avg || [];
        currentTaskIdx = data.current || 0;
        renderTaskList();
    });

    socket.on('score_task', data => {
        revealedScores = null;
        myScore = null;
        currentTaskIdx = data.current || 0;
        document.getElementById('scoring').style.display = '';
        document.getElementById('score-buttons').innerHTML = getScoreButtonsHTML();
        document.getElementById('wait-msg').innerText = '';
        document.getElementById('next-btn').style.display = 'none';
        document.getElementById('countdown').innerText = '';
        updateUsersTable(userList, hostName, username, null);
        clearAllFunEmojis();
        renderTaskList();
        if (myHost || hostName === username) {
            document.getElementById('start-scoring-btn').disabled = true;
        }
    });

    socket.on('wait', () => {
        document.getElementById('wait-msg').innerText = 'Waiting for others...';
    });

    socket.on('countdown', data => {
        document.getElementById('countdown').innerText = '⏳ Reveal in: ' + data.count + '...';
        document.getElementById('wait-msg').innerText = '';
    });

    socket.on('reveal_scores', data => {
        document.getElementById('countdown').innerText = '';
        revealedScores = data.scores;
        updateUsersTable(userList, hostName, username, data.scores);
        document.getElementById('wait-msg').innerText = '';
        renderTaskList();
        if (hostName === username) {
            document.getElementById('next-btn').style.display = '';
        } else {
            document.getElementById('next-btn').style.display = 'none';
        }
        // Play sound
        playRandomEmojiSound(); 
        // Play confetti!
        fireConfettiBurst();
        
    });

    socket.on('done', () => {
        document.getElementById('scoring').innerHTML = '<b>All tasks done!</b>';
        document.getElementById('next-btn').style.display = 'none';
        scoringStarted = false;
        if (myHost || hostName === username) {
            document.getElementById('start-scoring-btn').disabled = false;
        }
    });

    socket.on('scoring_started', () => {
        scoringStarted = true;
        let btn = document.getElementById('start-scoring-btn');
        if (btn) btn.disabled = true;
    });

    socket.on('scoring_stopped', () => {
        scoringStarted = false;
        if (myHost || hostName === username) {
            document.getElementById('start-scoring-btn').disabled = false;
        }
    });

    socket.on('task_error', data => {
        alert(data.error);
    });

    // Fun emoji handlers for coffee/question under user card
    socket.on('show_fun_emoji', data => {
        let user = data.username;
        let type = data.type;
        let userCards = document.getElementsByClassName('user-card');
        for (let card of userCards) {
            let nameDiv = card.querySelector('.user-name');
            if (nameDiv && nameDiv.textContent === user) {
                let old = card.querySelector('.fun-emoji');
                if (old) card.removeChild(old);
                let em = document.createElement('div');
                em.className = 'fun-emoji';
                em.style.fontSize = '2.2em';
                em.style.marginTop = '5px';
                em.style.transition = 'opacity 0.2s';
                if (type === 'coffee') em.textContent = '☕️';
                else if (type === 'question') em.textContent = '❓';
                else if (type === 'wc') em.textContent = '🚾';
                else if (type === 'afk') em.textContent = '💤';
                card.appendChild(em);
            }
        }
        if (data.username === username) {
            myFunEmoji = type;
        }
    });

    socket.on('remove_fun_emoji', data => {
        let user = data.username;
        let userCards = document.getElementsByClassName('user-card');
        for (let card of userCards) {
            let nameDiv = card.querySelector('.user-name');
            if (nameDiv && nameDiv.textContent === user) {
                let old = card.querySelector('.fun-emoji');
                if (old) card.removeChild(old);
            }
        }
        if (data.username === username) {
            myFunEmoji = null;
        }
    });

    // ===== REACTIONS: FLYING EMOJIS FOR ALL USERS =====
    socket.on('reaction_fly', data => {
        let targetCards = document.getElementsByClassName('user-card');
        let targetCard = null;
        for (let card of targetCards) {
            let nameDiv = card.querySelector('.user-name');
            if (nameDiv && nameDiv.textContent === data.to) {
                targetCard = card;
                break;
            }
        }
        if (targetCard) {
            flyReactionEmoji(data.emoji, targetCard);
        }
    });
}

function setupTaskInputListener() {
    let input = document.getElementById('new-task');
    if (input) {
        input.onkeydown = function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addTask();
            }
        };
    }
}

function getScoreButtonsHTML() {
    let btns = '';
    FIBONACCI.forEach(v => {
        btns += `<button onclick="submitScore(${v})" id="score-btn-${v}">${v}</button>`;
    });
    return btns;
}

function toggleFunEmoji(type) {
    if (myFunEmoji === type) {
        socket.emit('remove_fun_emoji', {type});
        myFunEmoji = null;
    } else {
        socket.emit('fun_emoji', {type});
        myFunEmoji = type;
    }
}

function clearAllFunEmojis() {
    let oldEmojis = document.querySelectorAll('.fun-emoji');
    for (let em of oldEmojis) {
        em.parentNode.removeChild(em);
    }
    myFunEmoji = null;
}

function addTask() {
    let t = document.getElementById('new-task').value.trim();
    if (!t) return;
    socket.emit('add_task', {task: t});
    document.getElementById('new-task').value = '';
    document.getElementById('new-task').focus();
}

function deleteTask(idx) {
    if (hostName !== username) return;
    if (confirm('Are you sure you want to delete this task?')) {
        socket.emit('delete_task', {index: idx});
    }
}

function startScoring() {
    if (myHost) {
        socket.emit('start_scoring', {});
        document.getElementById('start-scoring-btn').disabled = true;
    }
}

function submitScore(score) {
    myScore = score;
    socket.emit('submit_score', {score});
    highlightScoreButton(score);
}

function nextTask() {
    socket.emit('next_task', {});
}

function highlightScoreButton(score) {
    FIBONACCI.forEach(v => {
        let btn = document.getElementById(`score-btn-${v}`);
        if (btn) {
            if (v == score) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        }
    });
}

function renderTaskList() {
    let div = document.getElementById('task-list');
    if (!taskListCache || taskListCache.length === 0) {
        div.innerHTML = "<em>No tasks yet</em>";
        updateUsersTable(userList, hostName, username, revealedScores);
        return;
    }
    let ul = `<ul class="task-list-ul">`;
    for (let i = 0; i < taskListCache.length; ++i) {
        let avg = taskAvgCache[i];
        let trash = '';
        if (hostName === username) {
            trash = `<span class="task-delete" title="Delete task" onclick="deleteTask(${i})">&#128465;</span>`;
        }
        ul += `<li class="task-list-li${i === currentTaskIdx ? ' current' : ''}">
            <span>${taskListCache[i]}</span>
            <span>
                ${avg !== null && avg !== undefined ? `<span class="task-avg" title="Average">${avg.toFixed(2)}</span>` : ''}
                ${trash}
            </span>
            </li>`;
    }
    ul += `</ul>`;
    div.innerHTML = ul;
    updateUsersTable(userList, hostName, username, revealedScores);
}

function updateUsersTable(users, host, me, scores=null) {
    userList = users;
    hostName = host;
    let container = document.getElementById('users-table');
    container.innerHTML = "";
    // Own card always first for flex-row (center visually)
    let sorted = [...users];
    if (me && sorted.indexOf(me) > -1) {
        sorted.splice(sorted.indexOf(me), 1);
        sorted.unshift(me);
    }
    sorted.forEach((u, i) => {
        let card = document.createElement('div');
        card.className = "user-card";
        if (u === host) card.classList.add("host");
        if (u === me) card.classList.add("me");

        let name = document.createElement('div');
        name.className = "user-name";
        name.innerText = u;
        card.appendChild(name);

        let status = document.createElement('div');
        status.className = "user-status";
        if (u === host) status.innerHTML += "Host";
        if (u === me && u === host) status.innerHTML += " / ";
        if (u === me) status.innerHTML += "You";
        if (status.innerHTML !== "") card.appendChild(status);

        let scoreDiv = document.createElement('div');
        scoreDiv.className = "user-score";
        if (scores && scores[u] !== undefined) {
            if (u === me) {
                scoreDiv.classList.add("me-score");
            }
            scoreDiv.innerText = scores[u];
        }
        card.appendChild(scoreDiv);

        container.appendChild(card);
    });

    if (host && host === me) {
        document.getElementById('host-controls').style.display = '';

        // DISABLE Add Task UI while scoring is in progress
        const addTaskBtn = document.getElementById('add-task-btn');
        const newTaskInput = document.getElementById('new-task');
        if (scoringStarted) {
            addTaskBtn.disabled = true;
            newTaskInput.disabled = true;
            newTaskInput.placeholder = "Can't add tasks during scoring";
        } else {
            addTaskBtn.disabled = false;
            newTaskInput.disabled = false;
            newTaskInput.placeholder = "Task name";
        }

        // Start Scoring logic...
        if (!scoringStarted && taskListCache && taskListCache.length > 0) {
            document.getElementById('start-scoring-btn').disabled = false;
        } else {
            document.getElementById('start-scoring-btn').disabled = true;
        }
        myHost = true;
    } else {
        document.getElementById('host-controls').style.display = 'none';
        myHost = false;
    }
    const startBtn = document.getElementById('start-scoring-btn');
    const startBtnContainer = startBtn ? startBtn.parentElement : null;
    const resetBtn = document.getElementById('reset-btn');
    if (host && host === me) {
        if (startBtnContainer) startBtnContainer.style.display = 'flex';
        if (resetBtn) resetBtn.style.display = '';
        // ... enable/disable logic ...
    } else {
        if (startBtnContainer) startBtnContainer.style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'none';
    }


}

// ===== FLYING FUN EMOJI REACTIONS (MERGED FROM reactions.js) =====
const REACTION_EMOJIS = [
    { emoji: "❤️", name: "heart" },
    { emoji: "💯", name: "hundred" },
    { emoji: "😂", name: "laugh" },
    { emoji: "🤣", name: "rofl" },
    { emoji: "🎉", name: "party" },
    { emoji: "🤩", name: "star eyes" },
    { emoji: "😎", name: "cool" },
    { emoji: "🔥", name: "fire" },
    { emoji: "🥳", name: "celebration" },
    { emoji: "✈️", name: "plane" },
    { emoji: "💥", name: "boom" },
    { emoji: "🧊", name: "ice" },
    { emoji: "🦄", name: "unicorn" },
    { emoji: "🚀", name: "rocket" },
    { emoji: "🫶", name: "heart hands" },
    { emoji: "👻", name: "ghost" },
    { emoji: "🧠", name: "brain" },
    { emoji: "🕺", name: "dance" },
    { emoji: "🗑️", name: "trash" }
];

// Delegated click handler for all .user-card (except self)
document.addEventListener("click", function(e) {
    if (e.target.closest("#emoji-bar") || e.target.closest(".reaction-tooltip")) return;
    let card = e.target.closest(".user-card");
    if (card && !card.classList.contains("me")) {
        removeReactionTooltip();
        let tooltip = document.createElement("div");
        tooltip.className = "reaction-tooltip";
        REACTION_EMOJIS.forEach(item => {
            let btn = document.createElement("button");
            btn.className = "reaction-emoji-btn";
            btn.textContent = item.emoji;
            btn.title = item.name;
            btn.onclick = (ev) => {
                ev.stopPropagation();
                sendFlyReaction(item.emoji, card);
                removeReactionTooltip();
            };
            tooltip.appendChild(btn);
        });
        document.body.appendChild(tooltip);
        setTimeout(() => {
            let rect = card.getBoundingClientRect();
            let left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2;
            let maxLeft = window.innerWidth - tooltip.offsetWidth - 8;
            if (left < 8) left = 8; // avoid left overflow
            if (left > maxLeft) left = maxLeft; // avoid right overflow
            tooltip.style.left = left + "px";
            tooltip.style.top = (rect.top - tooltip.offsetHeight - 12 + window.scrollY) + "px";
        }, 10);

        return;
    }
    removeReactionTooltip();
});

function removeReactionTooltip() {
    let old = document.querySelector(".reaction-tooltip");
    if (old) old.parentNode.removeChild(old);
}
function flyReactionEmoji(emoji, targetCard) {
    let fly = document.createElement("div");
    fly.className = "reaction-fly-emoji";
    fly.textContent = emoji;
    document.body.appendChild(fly);

    let startY = Math.random() * (window.innerHeight - 80) + 40;
    fly.style.left = (window.innerWidth - 60) + "px";
    fly.style.top = startY + "px";

    let rect = targetCard.getBoundingClientRect();
    let endX = rect.left + rect.width / 2 - 18;
    let endY = rect.top + rect.height / 2 - 18 + window.scrollY;

    const flyDuration = 1500; // 1.5s for the animation

    const anim = fly.animate([
        { left: fly.style.left, top: fly.style.top, opacity: 1, transform: "scale(1)" },
        { left: endX + "px", top: endY + "px", opacity: 1, transform: "scale(1.6)" }
    ], {
        duration: flyDuration,
        easing: "cubic-bezier(.51,1.54,.46,.96)"
    });

    // Play sound a bit before end (see earlier answer)
    setTimeout(() => {
        playRandomEmojiSound();
    }, flyDuration * 0.8);

    anim.onfinish = function() {
        // Add wobble/glow class to the user card!
        targetCard.classList.add('wobble-glow');
        setTimeout(() => {
            targetCard.classList.remove('wobble-glow');
        }, 700); // Remove after animation ends (0.65s + a bit of buffer)

        fly.style.left = endX + "px";
        fly.style.top = endY + "px";
        fly.style.opacity = 0;
        fly.style.transform = "scale(1.9)";
        setTimeout(() => { fly.remove(); }, 500);
    };
}

function sendFlyReaction(emoji, targetCard) {
    let nameDiv = targetCard.querySelector('.user-name');
    if (!nameDiv) return;
    let targetUsername = nameDiv.textContent;
    socket.emit('reaction_fly', {emoji, to: targetUsername});
}

// Load all 6 wavs into an array:
const emojiSounds = [
    new Audio("/static/sounds/fun1.wav"),
    new Audio("/static/sounds/fun2.wav"),
    new Audio("/static/sounds/fun3.wav"),
    new Audio("/static/sounds/fun4.wav"),
    new Audio("/static/sounds/fun5.wav"),
    new Audio("/static/sounds/fun6.wav")
];

function playRandomEmojiSound() {
    const ix = Math.floor(Math.random() * emojiSounds.length);
    // Always clone so you can overlap sounds if spammed
    let s = emojiSounds[ix].cloneNode();
    s.volume = 0.5; // Adjust volume as you like
    s.play();
}

function fireConfettiBurst() {
    if (typeof confetti !== "undefined") {
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                confetti({
                    particleCount: 35,
                    spread: 70 + Math.random() * 50,
                    startVelocity: 30 + Math.random() * 20,
                    origin: { y: Math.random() * 0.6 + 0.1 }
                });
            }, i * 180);
        }
    }
}

document.getElementById('username').addEventListener('input', function() {
    if (this.value.length > 20) {
        this.value = this.value.slice(0, 20);
    }
});

function resetAll() {
    if (confirm("Are you sure you want to reset everything?")) {
        socket.emit('reset_all');
    }
}
socket.on('reset_all', () => {
    // Clear local caches/state
    taskListCache = [];
    taskAvgCache = [];
    revealedScores = null;
    scoringStarted = false;
    currentTaskIdx = 0;
    myScore = null;

    // 1. Hide scoring section/inputs, clear messages and scores
    document.getElementById('scoring').style.display = ''; // You can set 'block' if you want it visible but empty
    document.getElementById('scoring').innerHTML = ''; // Remove any lingering score/fibo buttons
    document.getElementById('wait-msg').innerText = '';
    document.getElementById('countdown').innerText = '';
    document.getElementById('score-buttons').innerHTML = ''; // Hide Fibonacci scores

    // 2. Hide Next Task button
    document.getElementById('next-btn').style.display = 'none';

    // 3. Clear the task list UI
    renderTaskList();

    // 4. User cards: re-render with no scores
    updateUsersTable(userList, hostName, username, null);

    // 5. Enable Add Task input/button for host
    let addTaskBtn = document.getElementById('add-task-btn');
    let newTaskInput = document.getElementById('new-task');
    if (addTaskBtn) addTaskBtn.disabled = false;
    if (newTaskInput) {
        newTaskInput.disabled = false;
        newTaskInput.value = '';
        newTaskInput.placeholder = "Task name";
    }

    // 6. Ensure Start Scoring is disabled
    let startBtn = document.getElementById('start-scoring-btn');
    if (startBtn) startBtn.disabled = true;

    // 7. Remove all fun emojis
    clearAllFunEmojis && clearAllFunEmojis();
});


