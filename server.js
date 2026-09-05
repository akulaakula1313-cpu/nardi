const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Раздача статических файлов фронтенда
app.use(express.static(__dirname));

// База данных игровых комнат в оперативной памяти сервера
const rooms = {};

function createNewGameState() {
    return {
        board: Array.from({ length: 24 }, (_, i) => {
            if (i === 0) return { count: 15, color: 'WHITE' };
            if (i === 12) return { count: 15, color: 'BLACK' };
            return { count: 0, color: null };
        }),
        currentPlayer: 'WHITE',
        dice: [],
        initialDice: [],
        isFirstMove: { WHITE: true, BLACK: true },
        hasMovedFromHeadThisTurn: 0,
        bearOff: { WHITE: 0, BLACK: 0 },
        gameStatus: 'PLAYING'
    };
}

io.on('connection', (socket) => {
    console.log(`Пользователь подключился: ${socket.id}`);

    // Создание комнаты
    socket.on('createRoom', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString(); // 4 цифры
        rooms[roomCode] = {
            players: { WHITE: socket.id, BLACK: null },
            state: createNewGameState()
        };
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.playerColor = 'WHITE';
        
        socket.emit('roomCreated', { roomCode, state: rooms[roomCode].state });
    });

    // Подключение к существующей комнате
    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('errorMsg', 'Комната с таким кодом не найдена.');
            return;
        }
        if (room.players.BLACK !== null) {
            socket.emit('errorMsg', 'В этой комнате уже нет свободных мест.');
            return;
        }

        room.players.BLACK = socket.id;
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.playerColor = 'BLACK';

        socket.emit('roomJoined', { roomCode, state: room.state });
        io.to(roomCode).emit('gameStateUpdate', room.state);
    });

    // Обработка броска кубиков игроком по сети
    socket.on('rollDice', () => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        const state = room.state;

        if (state.currentPlayer !== socket.playerColor || state.dice.length > 0) return;

        let d1 = Math.floor(Math.random() * 6) + 1;
        let d2 = Math.floor(Math.random() * 6) + 1;

        if (d1 === d2) {
            state.dice = [d1, d1, d1, d1];
        } else {
            state.dice = [d1, d2];
        }
        state.initialDice = [...state.dice];

        io.to(socket.roomCode).emit('gameStateUpdate', state);
    });

    // Совершение хода и синхронизация по сети
    socket.on('makeMove', (move) => {
        const room = rooms[socket.roomCode];
        if (!room) return;
        const state = room.state;
        const player = state.currentPlayer;

        if (player !== socket.playerColor) return;

        // Изменение позиций на доске
        state.board[move.from].count--;
        if (state.board[move.from].count === 0) state.board[move.from].color = null;

        if (move.type === 'MOVE') {
            state.board[move.to].count++;
            state.board[move.to].color = player;
        } else if (move.type === 'BEAROFF') {
            state.bearOff[player]++;
        }

        // Правило головы
        if (move.from === (player === 'WHITE' ? 0 : 12)) {
            state.hasMovedFromHeadThisTurn++;
        }

        // Изъятие кубика
        const idx = state.dice.indexOf(move.die);
        if (idx > -1) state.dice.splice(idx, 1);

        // Проверка условий выигрыша
        if (state.bearOff.WHITE === 15) {
            state.gameStatus = state.bearOff.BLACK > 0 ? 'OIN' : 'MARS';
        } else if (state.bearOff.BLACK === 15) {
            state.gameStatus = state.bearOff.WHITE > 0 ? 'OIN' : 'MARS';
        }

        // Передача хода при отсутствии очков кубика
        if (state.dice.length === 0) {
            state.isFirstMove[player] = false;
            state.hasMovedFromHeadThisTurn = 0;
            state.dice = [];
            state.initialDice = [];
            state.currentPlayer = state.currentPlayer === 'WHITE' ? 'BLACK' : 'WHITE';
        }

        io.to(socket.roomCode).emit('gameStateUpdate', state);
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        console.log(`Пользователь отключился: ${socket.id}`);
        if (socket.roomCode && rooms[socket.roomCode]) {
            io.to(socket.roomCode).emit('errorMsg', 'Оппонент покинул игру.');
            delete rooms[socket.roomCode];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен и стабильно работает на порту ${PORT}`);
});
