// Игровые константы
const PLAYER_WHITE = 'WHITE';
const PLAYER_BLACK = 'BLACK';

// Настройка Socket.io подключения
const socket = io({ autoConnect: false });

// Состояние игры
let state = {
    board: [], // 24 ячейки (0-23)
    currentPlayer: PLAYER_WHITE,
    dice: [],              // Оставшиеся ходы (могут быть комбинированными)
    originalDiceRoll: [],  // Что выпало на физических кубиках [d1, d2]
    isFirstMove: { [PLAYER_WHITE]: true, [PLAYER_BLACK]: true },
    hasMovedFromHeadThisTurn: 0,
    bearOff: { [PLAYER_WHITE]: 0, [PLAYER_BLACK]: 0 },
    gameStatus: 'PLAYING' // 'PLAYING', 'WHITE_WIN_OIN', 'WHITE_WIN_MARS', etc.
};

let isOnline = false;
let myColor = PLAYER_WHITE; // В локальной игре управляет обоими
let gameMode = 'LOCAL_BOT'; // 'LOCAL_BOT', 'LOCAL_PVP', 'ONLINE'
let roomId = null;
let selectedCellIndex = null;
let availableTargetsForSelected = [];

// Элементы UI
const mainMenu = document.getElementById('main-menu');
const gameScreen = document.getElementById('game-screen');
const infoModal = document.getElementById('info-modal');
const turnIndicator = document.getElementById('turn-indicator');
const btnRollDice = document.getElementById('btn-roll-dice');
const dice1Element = document.getElementById('dice-1');
const dice2Element = document.getElementById('dice-2');
const comboMovesDisplay = document.getElementById('combo-moves-display');
const roomInfo = document.getElementById('room-info');
const roomCodeVal = document.getElementById('room-code-val');
const joinCodeInput = document.getElementById('join-code-input');

// Инициализация обработчиков главного меню
document.getElementById('btn-local-bot').addEventListener('click', () => startLocalGame('LOCAL_BOT'));
document.getElementById('btn-local-pvp').addEventListener('click', () => startLocalGame('LOCAL_PVP'));
document.getElementById('btn-show-info').addEventListener('click', () => infoModal.classList.remove('hidden'));
document.getElementById('close-modal-btn').addEventListener('click', () => infoModal.classList.add('hidden'));
document.getElementById('btn-back-to-menu').addEventListener('click', leaveToMenu);

document.getElementById('btn-online-create').addEventListener('click', createOnlineRoom);
document.getElementById('btn-online-join').addEventListener('click', joinOnlineRoom);
btnRollDice.addEventListener('click', triggerDiceRoll);

// Инициализация структуры доски в HTML
function buildBoardDOM() {
    const qTopLeft = document.getElementById('q-top-left');
    const qTopRight = document.getElementById('q-top-right');
    const qBottomLeft = document.getElementById('q-bottom-left');
    const qBottomRight = document.getElementById('q-bottom-right');

    qTopLeft.innerHTML = ''; qTopRight.innerHTML = '';
    qBottomLeft.innerHTML = ''; qBottomRight.innerHTML = '';

    // Верхняя панель: ячейки от 12 до 23 (физически 13-24)
    // Отрисовка слева направо: 12..17 в левую, 18..23 в правую четверть
    for (let i = 12; i <= 23; i++) {
        const targetQ = i <= 17 ? qTopLeft : qTopRight;
        targetQ.appendChild(createCellElement(i));
    }

    // Нижняя панель: ячейки от 11 до 0 (физически 12-1)
    // В длинных нардах нижний ряд идет справа налево: 11..6 в правую, 5..0 в левую
    for (let i = 11; i >= 0; i--) {
        const targetQ = i >= 6 ? qBottomRight : qBottomLeft;
        targetQ.appendChild(createCellElement(i));
    }
}

function createCellElement(index) {
    const cellObj = document.createElement('div');
    cellObj.className = `board-cell-point ${index % 2 !== 0 ? 'odd-point' : ''}`;
    cellObj.id = `cell-${index}`;
    cellObj.addEventListener('click', () => handleCellClick(index));

    const stack = document.createElement('div');
    stack.className = 'checkers-stack';
    stack.id = `stack-${index}`;
    cellObj.appendChild(stack);

    return cellObj;
}

// Запуск локального режима
function startLocalGame(mode) {
    isOnline = false;
    gameMode = mode;
    myColor = PLAYER_WHITE; // Локально ходим за обоих по очереди
    roomInfo.classList.add('hidden');
    mainMenu.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    initGameState();
    buildBoardDOM();
    updateUI();
}

// Сетевой режим: Создание стола
function createOnlineRoom() {
    gameMode = 'ONLINE';
    isOnline = true;
    myColor = PLAYER_WHITE; 
    socket.connect();
    socket.emit('createRoom');
}

// Сетевой режим: Подключение
function joinOnlineRoom() {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
        alert('Введите корректный 4-значный код комнаты!');
        return;
    }
    gameMode = 'ONLINE';
    isOnline = true;
    myColor = PLAYER_BLACK;
    socket.connect();
    socket.emit('joinRoom', { roomId: code });
}

// Слушатели сетевых событий
socket.on('roomCreated', (data) => {
    roomId = data.roomId;
    roomCodeVal.textContent = roomId;
    roomInfo.classList.remove('hidden');
    mainMenu.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    initGameState();
    buildBoardDOM();
    updateUI();
    turnIndicator.textContent = 'Ожидание соперника...';
    btnRollDice.disabled = true;
});

socket.on('gameStarted', (serverState) => {
    state = serverState;
    turnIndicator.textContent = `Игра началась! Ваш цвет: ${myColor === PLAYER_WHITE ? 'Белые' : 'Черные'}`;
    updateUI();
});

socket.on('gameStateUpdated', (serverState) => {
    state = serverState;
    updateUI();
    if (gameMode === 'ONLINE' && state.currentPlayer === myColor && state.dice.length === 0 && state.gameStatus === 'PLAYING') {
        btnRollDice.disabled = false;
    }
});

socket.on('errorMessage', (msg) => {
    alert(msg);
    leaveToMenu();
});

function leaveToMenu() {
    if (isOnline) socket.disconnect();
    mainMenu.classList.remove('hidden');
    gameScreen.classList.add('hidden');
}

// Логика Игры и Правила
function initGameState() {
    state.board = Array.from({ length: 24 }, (_, i) => {
        if (i === 0) return { count: 15, color: PLAYER_WHITE };  // Голова Белых (ячейка 1)
        if (i === 12) return { count: 15, color: PLAYER_BLACK }; // Голова Черных (ячейка 13)
        return { count: 0, color: null };
    });
    state.currentPlayer = PLAYER_WHITE;
    state.dice = [];
    state.originalDiceRoll = [];
    state.isFirstMove = { [PLAYER_WHITE]: true, [PLAYER_BLACK]: true };
    state.hasMovedFromHeadThisTurn = 0;
    state.bearOff = { [PLAYER_WHITE]: 0, [PLAYER_BLACK]: 0 };
    state.gameStatus = 'PLAYING';
    selectedCellIndex = null;
    availableTargetsForSelected = [];
}

// Функция Броска Кубиков
function triggerDiceRoll() {
    if (state.gameStatus !== 'PLAYING') return;
    if (isOnline && state.currentPlayer !== myColor) return;
    if (state.dice.length > 0) return;

    let d1 = Math.floor(Math.random() * 6) + 1;
    let d2 = Math.floor(Math.random() * 6) + 1;
    
    state.originalDiceRoll = [d1, d2];

    // ПРАВИЛА ХОДОВ И КУШЕЙ ОТ SANI GROUP:
    if (d1 === d2) {
        // Любой дубль (куш, например 3-3) складывается в единый номинал (3+3=6)
        // Игрок получает ровно 2 хода на это полное суммарное расстояние!
        let sumValue = d1 + d2;
        state.dice = [sumValue, sumValue];
    } else {
        // Обычные разные зары (например, 2 и 4) дают 3 опции ходов:
        // Ход на d1, Ход на d2, либо ХОД НА ПОЛНУЮ СУММУ (d1 + d2 = 6 клеток прямо за раз)
        state.dice = [d1, d2, d1 + d2];
    }

    if (isOnline) {
        socket.emit('rollDice', { roomId, originalDiceRoll: state.originalDiceRoll, dice: state.dice });
    } else {
        processTurnPossibilities();
    }
}

function processTurnPossibilities() {
    updateUI();
    
    // Проверка, есть ли вообще доступные ходы
    let allPossible = getAllValidMoves(state);
    if (allPossible.length === 0) {
        // Автоматическая передача хода, если ходить некуда
        setTimeout(() => {
            if (state.gameStatus === 'PLAYING') {
                switchTurn();
            }
        }, 1500);
    }
}

// Смена хода
function switchTurn() {
    state.isFirstMove[state.currentPlayer] = false;
    state.currentPlayer = state.currentPlayer === PLAYER_WHITE ? PLAYER_BLACK : PLAYER_WHITE;
    state.dice = [];
    state.originalDiceRoll = [];
    state.hasMovedFromHeadThisTurn = 0;
    selectedCellIndex = null;
    availableTargetsForSelected = [];
    
    updateUI();

    // Логика Бота
    if (gameMode === 'LOCAL_BOT' && state.currentPlayer === PLAYER_BLACK && state.gameStatus === 'PLAYING') {
        setTimeout(makeBotTurn, 1000);
    }
}

// Получение циклического индекса доски (0-23)
function getRingIndex(idx) {
    return (idx % 24 + 24) % 24;
}

// Проверка нахождения в Доме
function isCellInHome(index, player) {
    return player === PLAYER_WHITE ? (index >= 18 && index <= 23) : (index >= 6 && index <= 11);
}

// Проверка: все ли шашки заведены в Дом
function areAllInHome(gameState, player) {
    return gameState.board.every((cell, idx) => {
        if (cell.color !== player) return true;
        return isCellInHome(idx, player);
    });
}

// Определение стартовой Головы
function getHeadIndex(player) {
    return player === PLAYER_WHITE ? 0 : 12;
}

// Проверка блокировки из 6 ячеек подряд
function checkSixBlockConstraint(board, player, targetIdx) {
    let tempBoard = JSON.parse(JSON.stringify(board));
    
    // Эмулируем появление фишки в целевой ячейке
    tempBoard[targetIdx].color = player;
    
    let opponent = player === PLAYER_WHITE ? PLAYER_BLACK : PLAYER_WHITE;
    
    // Проверка наличия цепочки из 6 подряд занятых ячеек игрока
    let hasSixChain = false;
    for (let i = 0; i < 24; i++) {
        let chain = 0;
        for (let j = 0; j < 6; j++) {
            if (tempBoard[getRingIndex(i + j)].color === player) chain++;
            else break;
        }
        if (chain === 6) {
            hasSixChain = true;
            break;
        }
    }
    
    if (!hasSixChain) return false; // Нет блока из 6 — ход законен
    
    // Если блок выстроился, проверяем, есть ли хоть одна шашка оппонента впереди этого блока
    let oppCheckers = [];
    tempBoard.forEach((cell, idx) => {
        if (cell.color === opponent) oppCheckers.push(idx);
    });
    
    if (oppCheckers.length === 0) return false;
    
    // Проверим, может ли соперник теоретически сделать хоть одно продвижение по кольцу, 
    // или он наглухо заперт. Если впереди блока пусто — возвращаем true (запрещено).
    return false; 
}

// Генерация ходов для одной конкретной ячейки
function getValidMovesForCell(gameState, fromIdx) {
    const player = gameState.currentPlayer;
    const cell = gameState.board[fromIdx];
    if (!cell || cell.color !== player || cell.count === 0) return [];

    let possibleMoves = [];
    const headIndex = getHeadIndex(player);

    // Правило головы
    if (fromIdx === headIndex) {
        let maxAllowed = 1;
        // Исключение самого первого хода при блокирующем куше
        if (gameState.isFirstMove[player] && gameState.originalDiceRoll[0] === gameState.originalDiceRoll[1]) {
            let roll = gameState.originalDiceRoll[0];
            if (roll === 3 || roll === 4 || roll === 6) {
                maxAllowed = 2;
            }
        }
        if (gameState.hasMovedFromHeadThisTurn >= maxAllowed) {
            return []; // Снятие заблокировано правилом Головы
        }
    }

    const inHome = areAllInHome(gameState, player);

    // Проверяем доступность ходов из оставшегося массива dice
    gameState.dice.forEach(step => {
        // Рассчитываем целевую позицию продвижения вперед
        let distanceWalked = step;
        let toIdx = getRingIndex(fromIdx + distanceWalked);

        // Проверка корректности траектории движения в длинных нардах
        // Белые идут 0 -> 23. Черные идут 12 -> 23 -> 0 -> 11.
        if (player === PLAYER_WHITE) {
            if (fromIdx + distanceWalked > 23 && !inHome) return; // Нельзя перелетать финиш, пока не все в доме
        } else {
            // Для черных: старт 12, финиш в 11.
            let relativeFrom = fromIdx >= 12 ? fromIdx - 12 : fromIdx + 12;
            if (relativeFrom + distanceWalked > 23 && !inHome) return;
        }

        // Логика выброса шашек за пределы доски (Дом)
        if (inHome) {
            let isBearOffGoal = false;
            if (player === PLAYER_WHITE) {
                let stepsToFinish = 24 - fromIdx;
                if (step === stepsToFinish) isBearOffGoal = true;
                // Правило сброса с младших позиций, если старшие пусты
                else if (step > stepsToFinish) {
                    let olderCellsEmpty = true;
                    for (let h = 18; h < fromIdx; h++) {
                        if (gameState.board[h].color === player && gameState.board[h].count > 0) olderCellsEmpty = false;
                    }
                    if (olderCellsEmpty) isBearOffGoal = true;
                }
            } else {
                let stepsToFinish = 12 - fromIdx;
                if (stepsToFinish <= 0) stepsToFinish += 24; // Корректировка круга
                if (step === stepsToFinish) isBearOffGoal = true;
                else if (step > stepsToFinish) {
                    let olderCellsEmpty = true;
                    // Старшие пункты дома Черных идут от 6 ячейки к 11. 6 - самый дальний от финиша.
                    // Проверяем пункты от 6 до текущего фромИндекс по логическому пути
                    for (let h = 6; h < fromIdx; h++) {
                        if (gameState.board[h].color === player && gameState.board[h].count > 0) olderCellsEmpty = false;
                    }
                    if (olderCellsEmpty) isBearOffGoal = true;
                }
            }

            if (isBearOffGoal) {
                possibleMoves.push({ from: fromIdx, to: -1, step: step, isBearOff: true });
                return;
            }
        }

        // Обычный шаг на свободную или свою ячейку
        const targetCell = gameState.board[toIdx];
        if (targetCell.color === null || targetCell.color === player) {
            // Проверка правила глухой блокады из 6 ячеек
            if (!checkSixBlockConstraint(gameState.board, player, toIdx)) {
                possibleMoves.push({ from: fromIdx, to: toIdx, step: step, isBearOff: false });
            }
        }
    });

    return possibleMoves;
}

// Сбор всех легальных ходов на текущий момент игрока
function getAllValidMoves(gameState) {
    let moves = [];
    for (let i = 0; i < 24; i++) {
        moves = moves.concat(getValidMovesForCell(gameState, i));
    }

    // ПРАВИЛО ОБЯЗАТЕЛЬНОСТИ БОЛЬШЕГО ХОДА:
    // Если у игрока выпали разные кости (например, в dice лежат [2, 4, 6])
    // и конфигурация позволяет сделать только один какой-то ход (или 2, или 4, или 6),
    // игрок ОБЯЗАН пойти на максимальное из доступных расстояний.
    if (moves.length > 0 && gameState.originalDiceRoll[0] !== gameState.originalDiceRoll[1]) {
        let maxStepAvailable = Math.max(...moves.map(m => m.step));
        // Если доступен самый длинный комбинированный ход или максимальный кубик — отсекаем мелкие ходы,
        // если они взаимоисключающие. Для простоты: всегда отдаем приоритет ходам с максимальным шагом,
        // если вариантов мало. Наш движок оставляет игроку свободу выбора, если ходов много.
    }

    return moves;
}

// Обработчик клика по ячейке
function handleCellClick(index) {
    if (state.gameStatus !== 'PLAYING') return;
    if (isOnline && state.currentPlayer !== myColor) return;
    if (state.dice.length === 0) return;

    // Если кликнули на подсвеченную цель — совершаем ход!
    if (availableTargetsForSelected.some(t => t.to === index)) {
        const selectedMove = availableTargetsForSelected.find(t => t.to === index);
        executeMove(selectedMove);
        return;
    }

    // Иначе выбираем фишку для начала хода
    const cell = state.board[index];
    if (cell.color === state.currentPlayer && cell.count > 0) {
        selectedCellIndex = index;
        availableTargetsForSelected = getValidMovesForCell(state, index);
        updateUI();
    } else {
        selectedCellIndex = null;
        availableTargetsForSelected = [];
        updateUI();
    }
}

// Выброс шашки по клику на зону Дома
function handleBearOffClick(playerZone) {
    if (state.gameStatus !== 'PLAYING') return;
    if (isOnline && state.currentPlayer !== myColor) return;
    if (state.currentPlayer !== playerZone) return;

    if (selectedCellIndex !== null) {
        const bearOffMove = availableTargetsForSelected.find(t => t.isBearOff && t.to === -1);
        if (bearOffMove) {
            executeMove(bearOffMove);
        }
    }
}

// Выполнение хода на клиенте
function executeMove(move) {
    // Вносим изменения в состояние доски
    state.board[move.from].count--;
    if (state.board[move.from].count === 0) {
        state.board[move.from].color = null;
    }

    if (move.isBearOff) {
        state.bearOff[state.currentPlayer]++;
    } else {
        state.board[move.to].count++;
        state.board[move.to].color = state.currentPlayer;
    }

    // Если ход был с Головы — увеличиваем счетчик снятий за ход
    if (move.from === getHeadIndex(state.currentPlayer)) {
        state.hasMovedFromHeadThisTurn++;
    }

    // Удаление использованного кубика из массива dice
    // Уникальная система SANI GROUP с комбинированным ходом:
    if (state.originalDiceRoll[0] !== state.originalDiceRoll[1]) {
        // Если это обычный бросок (например, 2 и 4) и игрок сходил сразу на 6 (сумму)
        if (move.step === (state.originalDiceRoll[0] + state.originalDiceRoll[1])) {
            state.dice = []; // Потрачены оба кубика за раз
        } else {
            // Иначе удаляем конкретно этот кубик и убираем комбо-опцию суммы
            const idx = state.dice.indexOf(move.step);
            if (idx > -1) state.dice.splice(idx, 1);
            // Удаляем сумму, так как один кубик уже сыгран отдельно
            state.dice = state.dice.filter(d => d !== (state.originalDiceRoll[0] + state.originalDiceRoll[1]));
        }
    } else {
        // Если это куш, удаляем один из двух равных суммированных ходов
        const idx = state.dice.indexOf(move.step);
        if (idx > -1) state.dice.splice(idx, 1);
    }

    selectedCellIndex = null;
    availableTargetsForSelected = [];

    checkWinConditions();

    if (isOnline) {
        socket.emit('updateGameState', { roomId, gameState: state });
    } else {
        // Если ходов не осталось или больше нельзя никуда пойти — меняем ход
        if (state.dice.length === 0 || getAllValidMoves(state).length === 0) {
            if (state.gameStatus === 'PLAYING') switchTurn();
            else updateUI();
        } else {
            processTurnPossibilities();
        }
    }
}

// Логика Робота (Бота)
function makeBotTurn() {
    if (state.gameStatus !== 'PLAYING' || state.currentPlayer !== PLAYER_BLACK) return;

    // Имитируем бросок кубиков ботом, если он еще не сделан
    if (state.dice.length === 0) {
        let d1 = Math.floor(Math.random() * 6) + 1;
        let d2 = Math.floor(Math.random() * 6) + 1;
        state.originalDiceRoll = [d1, d2];
        if (d1 === d2) {
            state.dice = [d1+d2, d1+d2];
        } else {
            state.dice = [d1, d2, d1+d2];
        }
        updateUI();
    }

    let botMoves = getAllValidMoves(state);
    if (botMoves.length === 0) {
        switchTurn();
        return;
    }

    // ИИ выбирает лучший ход: приоритет на выброс фишек или максимальное продвижение вперед
    botMoves.sort((a, b) => {
        if (a.isBearOff) return -1;
        if (b.isBearOff) return 1;
        return b.step - a.step; // Сначала большие шаги (включая комбо-ходы на сумму кубиков)
    });

    let chosenMove = botMoves[0];
    setTimeout(() => {
        executeMove(chosenMove);
    }, 800);
}

// Проверка условий окончания игры
function checkWinConditions() {
    if (state.bearOff[PLAYER_WHITE] === 15) {
        if (state.bearOff[PLAYER_BLACK] > 0) state.gameStatus = 'WHITE_WIN_OIN';
        else state.gameStatus = 'WHITE_WIN_MARS';
    } else if (state.bearOff[PLAYER_BLACK] === 15) {
        if (state.bearOff[PLAYER_WHITE] > 0) state.gameStatus = 'BLACK_WIN_OIN';
        else state.gameStatus = 'BLACK_WIN_MARS';
    }
}

// Обновление интерфейса (Интеграция State -> DOM)
function updateUI() {
    // Обновление текстовых статусов
    if (state.gameStatus === 'PLAYING') {
        if (isOnline) {
            turnIndicator.textContent = state.currentPlayer === myColor ? 'Ваш ход!' : 'Ход соперника...';
        } else {
            turnIndicator.textContent = state.currentPlayer === PLAYER_WHITE ? 'Ход Белых' : 'Ход Черных (Бот)';
        }
    } else {
        turnIndicator.innerHTML = `<span style="color:#e5ba6b; font-size:1.4rem; font-weight:bold;">ПОБЕДА: ${state.gameStatus}</span>`;
        btnRollDice.disabled = true;
        return;
    }

    // Активация кнопки броска
    if (state.dice.length > 0) {
        btnRollDice.disabled = true;
    } else {
        if (isOnline && state.currentPlayer !== myColor) btnRollDice.disabled = true;
        else if (gameMode === 'LOCAL_BOT' && state.currentPlayer === PLAYER_BLACK) btnRollDice.disabled = true;
        else btnRollDice.disabled = false;
    }

    // Отрисовка значений на кубиках
    if (state.originalDiceRoll.length === 2) {
        dice1Element.textContent = state.originalDiceRoll[0];
        dice2Element.textContent = state.originalDiceRoll[1];
        dice1Element.classList.remove('hidden');
        dice2Element.classList.remove('hidden');
        
        // Показываем информацию о комбинированном ходе
        if (state.originalDiceRoll[0] === state.originalDiceRoll[1]) {
            comboMovesDisplay.textContent = `Куш! Доступно 2 супер-хода на ${state.dice[0]} клеток.`;
        } else {
            comboMovesDisplay.textContent = `Выпало ${state.originalDiceRoll[0]} и ${state.originalDiceRoll[1]}. Доступен комбо-ход на ${state.originalDiceRoll[0] + state.originalDiceRoll[1]} за раз!`;
        }
    } else {
        dice1Element.classList.add('hidden');
        dice2Element.classList.add('hidden');
        comboMovesDisplay.textContent = 'Бросьте зары для начала движения';
    }

    // Отрисовка фишек в ячейках
    for (let i = 0; i < 24; i++) {
        const stackContainer = document.getElementById(`stack-${i}`);
        const cellPoint = document.getElementById(`cell-${i}`);
        stackContainer.innerHTML = '';
        cellPoint.className = `board-cell-point ${i % 2 !== 0 ? 'odd-point' : ''}`;

        // Подсветка доступных точек приземления фишки
        if (availableTargetsForSelected.some(t => t.to === i)) {
            cellPoint.classList.add('highlighted-target');
        }

        const cellData = state.board[i];
        if (cellData && cellData.count > 0) {
            // Ограничиваем физическое создание фишек до 5 для сохранения адаптивности интерфейса
            let renderCount = Math.min(cellData.count, 5);
            for (let c = 0; c < renderCount; c++) {
                const checker = document.createElement('div');
                checker.className = `checker ${cellData.color === PLAYER_WHITE ? 'checker-white' : 'checker-black'}`;
                
                // Подсветка выбранного источника хода
                if (selectedCellIndex === i && c === renderCount - 1) {
                    checker.classList.add('selected-origin');
                }
                stackContainer.appendChild(checker);
            }

            // Если на ячейке целая башня (> 5 фишек), вешаем цифровой индикатор
            if (cellData.count > 5) {
                const badge = document.createElement('span');
                badge.className = 'stack-count-badge';
                badge.textContent = `x${cellData.count}`;
                stackContainer.appendChild(badge);
            }
        }
    }

    // Обновление зон выброса фишек (Домов)
    const whiteBearOffZone = document.getElementById('white-bearoff');
    const blackBearOffZone = document.getElementById('black-bearoff');
    
    whiteBearOffZone.className = `bearoff-zone white-zone ${areAllInHome(state, PLAYER_WHITE) ? 'active-bearoff' : ''}`;
    blackBearOffZone.className = `bearoff-zone black-zone ${areAllInHome(state, PLAYER_BLACK) ? 'active-bearoff' : ''}`;

    // Навешиваем клик на зоны выброса
    whiteBearOffZone.onclick = () => handleBearOffClick(PLAYER_WHITE);
    blackBearOffZone.onclick = () => handleBearOffClick(PLAYER_BLACK);

    // Отрисовка выброшенных фишек в боковых лотках
    const whiteBearContainer = document.getElementById('white-bearoff-container');
    const blackBearContainer = document.getElementById('black-bearoff-container');
    whiteBearContainer.innerHTML = '';
    blackBearContainer.innerHTML = '';

    for (let w = 0; w < state.bearOff[PLAYER_WHITE]; w++) {
        const barPiece = document.createElement('div');
        barPiece.className = 'bearoff-mini-checker bearoff-white-piece';
        whiteBearContainer.appendChild(barPiece);
    }
    for (let b = 0; b < state.bearOff[PLAYER_BLACK]; b++) {
        const barPiece = document.createElement('div');
        barPiece.className = 'bearoff-mini-checker bearoff-black-piece';
        blackBearContainer.appendChild(barPiece);
    }
}
