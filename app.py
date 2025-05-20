import eventlet
eventlet.monkey_patch()
import logging
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
import os

import time
import threading

from dotenv import load_dotenv
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,  # Change to INFO or WARNING to reduce verbosity
    format='%(asctime)s %(levelname)s %(name)s: %(message)s'
)
logger = logging.getLogger("SprintPlanningApp")

logger.info(">>> Flask-SocketIO server starting up!")

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, async_mode="eventlet")
logger.info(f"SocketIO async mode: {socketio.async_mode}")



ROOM = "main"
rooms = {ROOM: {
    'users': {}, 'tasks': [], 'current': 0, 'scores': [], 'avg': [],
    'scoring_started': False
}}

@app.route('/')
def index():
    logger.debug("Rendering index.html")
    return render_template('index.html')

@socketio.on('join')
def on_join(data):
    username = data['username']
    join_room(ROOM)
    logger.info(f"User '{username}' attempting to join.")
    # Prevent duplicate username
    if username in rooms[ROOM]['users'].values():
        logger.warning(f"Username '{username}' already taken.")
        emit('username_taken', {}, room=request.sid)
        return
    rooms[ROOM]['users'][request.sid] = username
    user_list = list(rooms[ROOM]['users'].values())
    host = user_list[0] if user_list else ""
    logger.info(f"User '{username}' joined. Current users: {user_list}")
    emit('joined', {
        'users': user_list,
        'username': username,
        'host': host,
        'scoring_started': rooms[ROOM]['scoring_started'],
        'current': rooms[ROOM]['current'],
        'tasks': rooms[ROOM]['tasks']
    }, room=request.sid)
    emit('joined', {'users': user_list, 'host': host}, room=ROOM, include_self=False)
    emit('task_list', {
        'tasks': rooms[ROOM]['tasks'],
        'avg': rooms[ROOM]['avg'],
        'current': rooms[ROOM]['current']
    }, room=request.sid)

@socketio.on('add_task')
def add_task(data):
    task = data['task']
    logger.debug(f"Adding task: {task}")
    existing_tasks = [t.lower() for t in rooms[ROOM]['tasks']]
    if task.lower() in existing_tasks:
        logger.warning(f"Task '{task}' already exists.")
        emit('task_error', {'error': 'Task already exists.'}, room=request.sid)
        return
    rooms[ROOM]['tasks'].append(task)
    rooms[ROOM]['scores'].append({})
    rooms[ROOM]['avg'].append(None)
    logger.info(f"Task '{task}' added. Tasks: {rooms[ROOM]['tasks']}")
    emit('task_list', {
        'tasks': rooms[ROOM]['tasks'],
        'avg': rooms[ROOM]['avg'],
        'current': rooms[ROOM]['current']
    }, room=ROOM)

@socketio.on('delete_task')
def delete_task(data):
    idx = data.get('index')
    logger.debug(f"Deleting task at index: {idx}")
    if idx is not None and 0 <= idx < len(rooms[ROOM]['tasks']):
        logger.info(f"Task '{rooms[ROOM]['tasks'][idx]}' deleted.")
        del rooms[ROOM]['tasks'][idx]
        del rooms[ROOM]['scores'][idx]
        del rooms[ROOM]['avg'][idx]
        if rooms[ROOM]['current'] >= len(rooms[ROOM]['tasks']):
            rooms[ROOM]['current'] = max(0, len(rooms[ROOM]['tasks']) - 1)
        emit('task_list', {
            'tasks': rooms[ROOM]['tasks'],
            'avg': rooms[ROOM]['avg'],
            'current': rooms[ROOM]['current']
        }, room=ROOM)

@socketio.on('start_scoring')
def start_scoring(_):
    if not rooms[ROOM]['tasks']:
        logger.warning("No tasks to score.")
        return  # No tasks to score
    rooms[ROOM]['current'] = 0
    rooms[ROOM]['scoring_started'] = True
    logger.info("Scoring started.")
    emit('score_task', {
        'task': rooms[ROOM]['tasks'][0],
        'current': 0
    }, room=ROOM)
    emit('task_list', {
        'tasks': rooms[ROOM]['tasks'],
        'avg': rooms[ROOM]['avg'],
        'current': rooms[ROOM]['current']
    }, room=ROOM)
    emit('scoring_started', {}, room=ROOM)

@socketio.on('submit_score')
def submit_score(data):
    score = int(data['score'])
    sid = request.sid
    username = rooms[ROOM]['users'][sid]
    idx = rooms[ROOM]['current']
    logger.debug(f"User '{username}' submitted score {score} for task {idx}")
    rooms[ROOM]['scores'][idx][username] = score
    if len(rooms[ROOM]['scores'][idx]) == len(rooms[ROOM]['users']):
        logger.info(f"All scores submitted for task {idx}. Revealing in 3 seconds.")
        def reveal():
            for i in range(3, 0, -1):
                socketio.emit('countdown', {'count': i}, room=ROOM)
                time.sleep(1)
            scores = rooms[ROOM]['scores'][idx]
            avg = sum(scores.values()) / len(scores) if scores else 0
            rooms[ROOM]['avg'][idx] = avg
            logger.info(f"Scores revealed for task {idx}: {scores}, average: {avg}")
            socketio.emit('reveal_scores', {
                'scores': scores,
                'average': avg,
                'idx': idx
            }, room=ROOM)
            socketio.emit('task_list', {
                'tasks': rooms[ROOM]['tasks'],
                'avg': rooms[ROOM]['avg'],
                'current': rooms[ROOM]['current']
            }, room=ROOM)
        threading.Thread(target=reveal).start()
    else:
        logger.debug(f"Waiting for more scores for task {idx}.")
        emit('wait', {}, room=sid)
    emit('task_list', {
        'tasks': rooms[ROOM]['tasks'],
        'avg': rooms[ROOM]['avg'],
        'current': rooms[ROOM]['current']
    }, room=sid)

@socketio.on('next_task')
def next_task(_):
    rooms[ROOM]['current'] += 1
    idx = rooms[ROOM]['current']
    logger.info(f"Moving to next task: {idx}")
    if idx < len(rooms[ROOM]['tasks']):
        emit('score_task', {
            'task': rooms[ROOM]['tasks'][idx],
            'current': idx
        }, room=ROOM)
        emit('task_list', {
            'tasks': rooms[ROOM]['tasks'],
            'avg': rooms[ROOM]['avg'],
            'current': idx
        }, room=ROOM)
    else:
        rooms[ROOM]['scoring_started'] = False
        logger.info("Scoring stopped. All tasks completed.")
        emit('scoring_stopped', {}, room=ROOM)
        emit('done', {}, room=ROOM)

@socketio.on('fun_emoji')
def fun_emoji(data):
    sid = request.sid
    username = None
    for k, v in rooms[ROOM]['users'].items():
        if k == sid:
            username = v
            break
    if username:
        logger.debug(f"User '{username}' sent fun emoji: {data['type']}")
        socketio.emit('show_fun_emoji', {'username': username, 'type': data['type']}, room=ROOM)

@socketio.on('remove_fun_emoji')
def remove_fun_emoji(_):
    sid = request.sid
    username = None
    for k, v in rooms[ROOM]['users'].items():
        if k == sid:
            username = v
            break
    if username:
        logger.debug(f"User '{username}' removed fun emoji.")
        socketio.emit('remove_fun_emoji', {'username': username}, room=ROOM)

@socketio.on('disconnect')
def on_disconnect():
    for sid in list(rooms[ROOM]['users']):
        if sid == request.sid:
            username = rooms[ROOM]['users'][sid]
            del rooms[ROOM]['users'][sid]
            user_list = list(rooms[ROOM]['users'].values())
            host = user_list[0] if user_list else ""
            logger.info(f"User '{username}' disconnected. Remaining users: {user_list}")
            emit('joined', {'users': user_list, 'host': host,
                            'scoring_started': rooms[ROOM]['scoring_started'],
                            'current': rooms[ROOM]['current'],
                            'tasks': rooms[ROOM]['tasks']
                            }, room=ROOM)
            break

@socketio.on('reaction_fly')
def reaction_fly(data):
    emoji = data['emoji']
    to_user = data['to']
    logger.debug(f"Reaction fly: {emoji} to {to_user}")
    socketio.emit('reaction_fly', {'emoji': emoji, 'to': to_user}, room=ROOM)

@socketio.on('reset_all')
def reset_all():
    sid = request.sid
    username = rooms[ROOM]['users'].get(sid)
    user_list = list(rooms[ROOM]['users'].values())
    host = user_list[0] if user_list else ""
    if username != host:
        return  # Only host can reset

    # Wipe all room state!
    rooms[ROOM]['tasks'] = []
    rooms[ROOM]['scores'] = []
    rooms[ROOM]['avg'] = []
    rooms[ROOM]['current'] = 0
    rooms[ROOM]['scoring_started'] = False

    # Notify everyone: tasks are gone, scoring stopped, state reset
    emit('reset_all', {}, room=ROOM)
    emit('task_list', {
        'tasks': [],
        'avg': [],
        'current': 0
    }, room=ROOM)
    emit('scoring_stopped', {}, room=ROOM)

if __name__ == '__main__':    
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)

