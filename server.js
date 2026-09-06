const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname)));

let rooms = {}; // Хранилище активных столов

io.on('connection', (socket) => {
    console.log('Пользователь подключился к серверу:', socket.id);

    // Создание стола онлайн
    socket.on('createRoom', () => {
        let roomId = Math.floor(1000 + Math.random() * 9000).toString(); // 4-значный цифровой код
        rooms[roomId] = {
            id: roomId,
            players: [socket.id],
            gameState: null
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
        console.log(`Создана комната для нард: ${roomId}`);
    });

    // Подключение к существующей комнате по коду
    socket.on('joinRoom', (data) => {
        let room = rooms[data.roomId];
        if (room && room.players.length === 1) {
            room.players.push(socket.id);
            socket.join(data.roomId);
            console.log(`Игрок ${socket.id} успешно вошел в комнату ${data.roomId}`);
            
            // Запуск игры и инициализация базового стейта
            room.gameState = {
                board: Array.from({ length: 24 }, (_, i) => {
                    if (i === 0) return { count: 15, color: 'WHITE' };
                    if (i === 12) return { count: 15, color: 'BLACK' };
                    return { count: 0, color: null };
                }),
                currentPlayer: 'WHITE',
                dice: [],
                originalDiceRoll: [],
                isFirstMove: { 'WHITE': true, 'BLACK': true },
                hasMovedFromHeadThisTurn: 0,
                bearOff: { 'WHITE': 0, 'BLACK': 0 },
                gameStatus: 'PLAYING'
            };

            io.to(data.roomId).emit('gameStarted', room.gameState);
        } else {
            socket.emit('errorMessage', 'Комната не найдена или уже заполнена!');
        }
    });

    // Синхронизация броска костей в комнате
    socket.on('rollDice', (data) => {
        let room = rooms[data.roomId];
        if (room && room.gameState) {
            room.gameState.originalDiceRoll = data.originalDiceRoll;
            room.gameState.dice = data.dice;
            socket.to(data.roomId).emit('gameStateUpdated', room.gameState);
        }
    });

    // Синхронизация хода и состояния игрового поля
    socket.on('updateGameState', (data) => {
        let room = rooms[data.roomId];
        if (room && room.gameState) {
            room.gameState = data.gameState;
            
            // Если у игрока закончились кубики или больше нет легальных ходов, сервер переключает ход
            if (room.gameState.dice.length === 0) {
                room.gameState.isFirstMove[room.gameState.currentPlayer] = false;
                room.gameState.currentPlayer = room.gameState.currentPlayer === 'WHITE' ? 'BLACK' : 'WHITE';
                room.gameState.dice = [];
                room.gameState.originalDiceRoll = [];
                room.gameState.hasMovedFromHeadThisTurn = 0;
            }
            
            io.to(data.roomId).emit('gameStateUpdated', room.gameState);
        }
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
        // Чистка комнат при выходе игрока
        for (let rId in rooms) {
            if (rooms[rId].players.includes(socket.id)) {
                io.to(rId).emit('errorMessage', 'Оппонент покинул сетевую игру.');
                delete rooms[rId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер Длинных Нард успешно запущен на порту ${PORT}`);
});