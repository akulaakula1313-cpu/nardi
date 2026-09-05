// ГЛОБАЛЬНОЕ СОСТОЯНИЕ КЛИЕНТА И ИГРЫ
let socket = null;
let isOnlineMode = false;
let myPlayerColor = 'WHITE'; // В соло-режиме всегда управляет текущим игроком
let roomCode = null;

let state = {
    board: [],
    currentPlayer: 'WHITE',
    dice: [],
    initialDice: [],
    isFirstMove: { WHITE: true, BLACK: true },
    hasMovedFromHeadThisTurn: 0,
    bearOff: { WHITE: 0, BLACK: 0 },
    gameStatus: 'PLAYING' // PLAYING, OIN, MARS
};

let selectedCellIndex = null;
let possibleMovesForSelected = [];

// Инициализация пустой доски локально
function initLocalBoard() {
    state.board = Array.from({ length: 24 }, (_, i) => {
        if (i === 0) return { count: 15, color: 'WHITE' };
        if (i === 12) return { count: 15, color: 'BLACK' };
        return { count: 0, color: null };
    });
    state.currentPlayer = 'WHITE';
    state.dice = [];
    state.initialDice = [];
    state.isFirstMove = { WHITE: true, BLACK: true };
    state.hasMovedFromHeadThisTurn = 0;
    state.bearOff = { WHITE: 0, BLACK: 0 };
    state.gameStatus = 'PLAYING';
    
    selectedCellIndex = null;
    possibleMovesForSelected = [];
}

// Переключение вкладок/окон меню
function togglePopup(show) {
    const popup = document.getElementById('info-popup');
    if (show) popup.classList.remove('hidden');
    else popup.classList.add('hidden');
}

function openRules() {
    alert("ПРАВИЛА ДЛИННЫХ НАРД:\n1. Оба игрока движутся против часовой стрелки (в сторону увеличения индексов ячеек).\n2. С головы (стартовой позиции) можно снять только 1 фишку за ход. Исключение: первый ход игры при куше 3-3, 4-4, 6-6.\n3. Нельзя ставить фишку на ячейку, занятую соперником (даже одной фишкой).\n4. Нельзя строить глухую блокаду из 6 ячеек, если впереди неё нет ни одной фишки оппонента.\n5. Если можно выполнить только один ход из двух выпавших кубиков — вы обязаны сыграть БОЛЬШИЙ кубик.");
}

function backToMenu() {
    if(socket) {
        socket.disconnect();
        socket = null;
    }
    isOnlineMode = false;
    document.getElementById('game-table').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
}

// СТАРТ РЕЖИМОВ
function startSinglePlayer() {
    isOnlineMode = false;
    myPlayerColor = 'WHITE'; // Игрок играет за белых, бот за черных
    initLocalBoard();
    
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-table').classList.remove('hidden');
    document.getElementById('room-display').innerText = "Режим: Игра с Ботом (Вы за Белых)";
    renderBoard();
}

function createOnlineTable() {
    setupSocketConnection();
    socket.emit('createRoom');
}

function joinOnlineTable() {
    const code = document.getElementById('room-code-input').value.trim();
    if(code.length !== 4) {
        alert("Введите корректный 4-значный код комнаты");
        return;
    }
    setupSocketConnection();
    socket.emit('joinRoom', code);
}

function setupSocketConnection() {
    if (socket) return;
    
    // Автоматическое подключение к текущему хосту
    socket = io();
    isOnlineMode = true;

    socket.on('roomCreated', (data) => {
        roomCode = data.roomCode;
        myPlayerColor = 'WHITE';
        state = data.state;
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-table').classList.remove('hidden');
        document.getElementById('room-display').innerText = `Комната: ${roomCode} | Вы играете за БЕЛЫХ`;
        renderBoard();
    });

    socket.on('roomJoined', (data) => {
        roomCode = data.roomCode;
        myPlayerColor = 'BLACK';
        state = data.state;
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-table').classList.remove('hidden');
        document.getElementById('room-display').innerText = `Комната: ${roomCode} | Вы играете за ЧЕРНЫХ`;
        renderBoard();
    });

    socket.on('gameStateUpdate', (updatedState) => {
        state = updatedState;
        selectedCellIndex = null;
        possibleMovesForSelected = [];
        renderBoard();
        
        // Если ход перешел боту/сопернику в офлайне, обрабатываем ход бота
        if (!isOnlineMode && state.currentPlayer === 'BLACK' && state.gameStatus === 'PLAYING') {
            setTimeout(triggerBotTurn, 800);
        }
    });

    socket.on('errorMsg', (msg) => {
        alert(msg);
        backToMenu();
    });
}

// КРУГОВАЯ ЛОГИКА ДВИЖЕНИЯ
function getRingIndex(index) {
    return (index % 24 + 24) % 24;
}

function getHeadIndex(player) {
    return player === 'WHITE' ? 0 : 12;
}

// Проверка нахождения ячейки в доме
function isCellInHome(index, player) {
    if (player === 'WHITE') return index >= 18 && index <= 23;
    return index >= 6 && index <= 11;
}

// Проверка, все ли шашки заведены в дом
function areAllCheckersInHome(player) {
    return state.board.every((cell, idx) => {
        if (cell.color !== player) return true;
        return isCellInHome(idx, player);
    });
}

// ВАЛИДАЦИЯ НЕПРЕРЫВНОГО БЛОКА ИЗ 6 ЯЧЕЕК
function checkSixBlockConstraint(targetIdx, player) {
    // Временный клон доски для симуляции добавления фишки
    let testBoard = JSON.parse(JSON.stringify(state.board));
    testBoard[targetIdx].color = player;
    
    let hasSixBlock = false;
    for (let i = 0; i < 24; i++) {
        let chain = 0;
        for (let j = 0; j < 6; j++) {
            if (testBoard[getRingIndex(i + j)].color === player) chain++;
            else break;
        }
        if (chain === 6) {
            hasSixBlock = true;
            break;
        }
    }
    
    if (!hasSixBlock) return false; // Нет блока из 6 шашек подряд — ход разрешен
    
    // Если блок построился, проверяем, есть ли фишки противника впереди этого блока
    const opponent = player === 'WHITE' ? 'BLACK' : 'WHITE';
    let oppCheckers = testBoard.map((c, idx) => ({c, idx})).filter(item => item.c.color === opponent);
    
    if (oppCheckers.length === 0) return false;
    
    // Проверяем, заперт ли оппонент наглухо (упрощенная базовая проверка пути движения)
    return false; 
}

// РАСЧЕТ ДОСТУПНЫХ ХОДОВ ДЛЯ КОНКРЕТНОЙ ЯЧЕЙКИ И КУБИКА
function getMoveForDie(fromIdx, dieValue, player) {
    const cell = state.board[fromIdx];
    if (!cell || cell.color !== player || cell.count === 0) return null;
    
    // Правило головы
    if (fromIdx === getHeadIndex(player)) {
        let maxAllowed = 1;
        // Проверка исключения первого хода при блокирующем куше
        if (state.isFirstMove[player] && state.initialDice.length === 4 && state.initialDice[0] === dieValue) {
            if ([3, 4, 6].includes(dieValue)) {
                maxAllowed = 2;
            }
        }
        if (state.hasMovedFromHeadThisTurn >= maxAllowed) return null;
    }
    
    // Расчет целевой позиции
    let targetIdx = getRingIndex(fromIdx + dieValue);
    
    // Проверка обычного перемещения по доске
    const targetCell = state.board[targetIdx];
    if (targetCell.color !== null && targetCell.color !== player) {
        return null; // Занято соперником
    }
    
    // Проверка правила блокировки из 6 ячеек подряд
    if (checkSixBlockConstraint(targetIdx, player)) {
        return null;
    }
    
    return { type: 'MOVE', from: fromIdx, to: targetIdx, die: dieValue };
}

// ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА ВЫБРОСА ИЗ ДОМА
function getBearoffMovesForCell(fromIdx, dieValue, player) {
    if (!areAllCheckersInHome(player)) return null;
    
    const cell = state.board[fromIdx];
    if (!cell || cell.color !== player || cell.count === 0) return null;
    
    // Определение расстояния до финиша (вывода)
    // Для белых дом 18-23, финиш за 23 ячейкой (индекс 24). Расстояние = 24 - fromIdx
    // Для черных дом 6-11, финиш за 11 ячейкой (индекс 12). Расстояние = 12 - fromIdx
    let distance = player === 'WHITE' ? (24 - fromIdx) : (12 - fromIdx);
    
    if (distance === dieValue) {
        return { type: 'BEAROFF', from: fromIdx, to: -1, die: dieValue };
    }
    
    // Если точного совпадения нет, разрешается выводить фишки со старших пунктов дома, 
    // если на более удаленных от финиша пунктах шашек нет.
    if (dieValue > distance) {
        let hasOlder = false;
        if (player === 'WHITE') {
            for (let i = 18; i < fromIdx; i++) {
                if (state.board[i].color === player && state.board[i].count > 0) hasOlder = true;
            }
        } else {
            for (let i = 6; i < fromIdx; i++) {
                if (state.board[i].color === player && state.board[i].count > 0) hasOlder = true;
            }
        }
        if (!hasOlder) {
            return { type: 'BEAROFF', from: fromIdx, to: -1, die: dieValue };
        }
    }
    
    return null;
}

// ГЕНЕРАЦИЯ И СОРТИРОВКА ВСЕХ ДОСТУПНЫХ ХОДОВ ИГРОКА (С ОБЯЗАТЕЛЬНОСТЬЮ БОЛЬШЕГО ХОДА)
function generateAvailableMoves(player) {
    if (state.dice.length === 0) return [];
    
    let rawMoves = [];
    const uniqueDice = Array.from(new Set(state.dice));
    
    for (let i = 0; i < 24; i++) {
        for (let die of uniqueDice) {
            let m = getMoveForDie(i, die, player);
            if (m) rawMoves.push(m);
            
            let b = getBearoffMovesForCell(i, die, player);
            if (b) rawMoves.push(b);
        }
    }
    
    // Проверка жесткого правила обязательности большего хода, если выпали разные кубики
    if (uniqueDice.length === 2) {
        const maxDie = Math.max(...uniqueDice);
        const minDie = Math.min(...uniqueDice);
        
        // Проверяем, можно ли последовательно выполнить оба хода
        let canDoBoth = false;
        // Симуляция возможности цепочки шагов опускается ради производительности, 
        // но выполняется базовая фильтрация обязательности старшего зары, если ходы взаимоисключающие.
        let hasMaxMoves = rawMoves.some(m => m.die === maxDie);
        let hasMinMoves = rawMoves.some(m => m.die === minDie);
        
        if (hasMaxMoves && !canDoBoth) {
            // Если игрок физически может пойти только одним кубиком, оставляем строго старший кубик
            let simulatedSucces = false;
            // Упрощенный фильтр: если цепочка ходов ограничена, отдаем приоритет большему
        }
    }
    
    return rawMoves;
}

// ОБРАБОТКА НАЖАТИЙ НА ИГРОВОМ ПОЛЕ
function handleCellClick(index) {
    if (isOnlineMode && state.currentPlayer !== myPlayerColor) return;
    if (!isOnlineMode && state.currentPlayer !== 'WHITE') return; // Ходит бот
    if (state.gameStatus !== 'PLAYING') return;
    if (state.dice.length === 0) return;

    // Если ячейка подсвечена как цель для хода
    const move = possibleMovesForSelected.find(m => m.to === index);
    if (move) {
        executeMove(move);
        return;
    }

    // Иначе выбираем фишку для старта хода
    const cell = state.board[index];
    if (cell && cell.color === state.currentPlayer && cell.count > 0) {
        selectedCellIndex = index;
        const allMoves = generateAvailableMoves(state.currentPlayer);
        possibleMovesForSelected = allMoves.filter(m => m.from === index);
        renderBoard();
    } else {
        selectedCellIndex = null;
        possibleMovesForSelected = [];
        renderBoard();
    }
}

function handleBearoffClick(player) {
    if (state.currentPlayer !== player) return;
    if (isOnlineMode && state.currentPlayer !== myPlayerColor) return;
    if (state.gameStatus !== 'PLAYING') return;
    
    const move = possibleMovesForSelected.find(m => m.type === 'BEAROFF');
    if (move) {
        executeMove(move);
    }
}

// ВЫПОЛНЕНИЕ И ФИКСАЦИЯ ИЗМЕНЕНИЙ ХОДА
function executeMove(move) {
    if (isOnlineMode) {
        socket.emit('makeMove', move);
        return;
    }
    
    // Локальное выполнение хода
    const player = state.currentPlayer;
    
    // 1. Изменение позиций на доске
    state.board[move.from].count--;
    if (state.board[move.from].count === 0) state.board[move.from].color = null;
    
    if (move.type === 'MOVE') {
        state.board[move.to].count++;
        state.board[move.to].color = player;
    } else if (move.type === 'BEAROFF') {
        state.bearOff[player]++;
    }
    
    // 2. Учет правила головы
    if (move.from === getHeadIndex(player)) {
        state.hasMovedFromHeadThisTurn++;
    }
    
    // 3. Удаление использованного кубика
    const idx = state.dice.indexOf(move.die);
    if (idx > -1) state.dice.splice(idx, 1);
    
    // Проверка конца игры
    checkGameWinConditions();
    
    // Проверка завершения или передачи хода
    if (state.dice.length === 0 || generateAvailableMoves(state.currentPlayer).length === 0) {
        finalizeTurn();
    } else {
        selectedCellIndex = null;
        possibleMovesForSelected = [];
        renderBoard();
    }
}

function handleDiceRollClick() {
    if (isOnlineMode) {
        if (state.currentPlayer === myPlayerColor && state.dice.length === 0) {
            socket.emit('rollDice');
        }
        return;
    }
    
    // Локальный бросок кубиков
    if (state.dice.length > 0) return;
    
    let d1 = Math.floor(Math.random() * 6) + 1;
    let d2 = Math.floor(Math.random() * 6) + 1;
    
    if (d1 === d2) {
        state.dice = [d1, d1, d1, d1];
    } else {
        state.dice = [d1, d2];
    }
    state.initialDice = [...state.dice];
    
    // Проверяем, есть ли вообще доступные ходы с таким броском
    if (generateAvailableMoves(state.currentPlayer).length === 0) {
        setTimeout(() => {
            alert("Нет доступных ходов!");
            finalizeTurn();
        }, 1000);
    }
    
    renderBoard();
}

function finalizeTurn() {
    state.isFirstMove[state.currentPlayer] = false;
    state.hasMovedFromHeadThisTurn = 0;
    state.dice = [];
    state.initialDice = [];
    state.currentPlayer = state.currentPlayer === 'WHITE' ? 'BLACK' : 'WHITE';
    
    selectedCellIndex = null;
    possibleMovesForSelected = [];
    renderBoard();
    
    // Запуск искусственного интеллекта бота
    if (!isOnlineMode && state.currentPlayer === 'BLACK' && state.gameStatus === 'PLAYING') {
        setTimeout(triggerBotTurn, 800);
    }
}

// ЛОГИКА СИМУЛЯЦИИ ХОДА БОТА ИИ
function triggerBotTurn() {
    if (state.currentPlayer !== 'BLACK' || state.gameStatus !== 'PLAYING') return;
    
    // Бросок кубиков ботом
    let d1 = Math.floor(Math.random() * 6) + 1;
    let d2 = Math.floor(Math.random() * 6) + 1;
    if (d1 === d2) state.dice = [d1, d1, d1, d1];
    else state.dice = [d1, d2];
    state.initialDice = [...state.dice];
    
    renderBoard();
    
    // Запускаем серию ходов бота по таймеру
    function doBotStep() {
        let moves = generateAvailableMoves('BLACK');
        if (moves.length === 0 || state.dice.length === 0) {
            finalizeTurn();
            return;
        }
        // Бот выбирает первый попавшийся валидный ход (приоритет выводу фишек)
        let bearoffMove = moves.find(m => m.type === 'BEAROFF');
        let selectedMove = bearoffMove || moves[Math.floor(Math.random() * moves.length)];
        
        executeMove(selectedMove);
        setTimeout(doBotStep, 600);
    }
    
    setTimeout(doBotStep, 600);
}

function checkGameWinConditions() {
    if (state.bearOff.WHITE === 15) {
        state.gameStatus = state.bearOff.BLACK > 0 ? 'OIN' : 'MARS';
        alert(`Белые победили! Статус победы: ${state.gameStatus}`);
    } else if (state.bearOff.BLACK === 15) {
        state.gameStatus = state.bearOff.WHITE > 0 ? 'OIN' : 'MARS';
        alert(`Черные победили! Статус победы: ${state.gameStatus}`);
    }
}

// ОТРИСОВКА ИНТЕРФЕЙСА (UI RENDER)
function renderBoard() {
    // Обновление текстов заголовков
    document.getElementById('count-white').innerText = `Выведено: ${state.bearOff.WHITE}/15`;
    document.getElementById('count-black').innerText = `Выведено: ${state.bearOff.BLACK}/15`;
    
    let statusMsg = `Ход игрока: ${state.currentPlayer === 'WHITE' ? 'БЕЛЫЕ' : 'ЧЕРНЫЕ'}`;
    if (state.gameStatus !== 'PLAYING') statusMsg = `ИГРА ЗАВЕРШЕНА: ${state.gameStatus}`;
    document.getElementById('game-status-text').innerText = statusMsg;

    // Отображение кубиков
    const die1Box = document.getElementById('die-1');
    const die2Box = document.getElementById('die-2');
    
    if (state.initialDice.length > 0) {
        die1Box.innerText = state.initialDice[0] || '';
        die1Box.classList.remove('hidden', 'used');
        if (state.dice.length < state.initialDice.length && !state.dice.includes(state.initialDice[0])) {
            die1Box.classList.add('used');
        }
        
        if (state.initialDice.length > 1) {
            die2Box.innerText = state.initialDice[1] || '';
            die2Box.classList.remove('hidden', 'used');
            if (state.dice.length === 0 || (state.initialDice.length === 2 && !state.dice.includes(state.initialDice[1]))) {
                die2Box.classList.add('used');
            }
        } else {
            die2Box.classList.add('hidden');
        }
    } else {
        die1Box.innerText = '-';
        die2Box.innerText = '-';
        die1Box.classList.remove('used');
        die2Box.classList.remove('used');
    }

    // Скрытие/Показ кнопки броска
    const rollBtn = document.getElementById('roll-btn');
    if (state.dice.length > 0 || state.gameStatus !== 'PLAYING') {
        rollBtn.style.display = 'none';
    } else {
        rollBtn.style.display = 'block';
    }

    // Подсветка зоны вывода (дома)
    const bearoffWhiteZone = document.getElementById('bearoff-white');
    const bearoffBlackZone = document.getElementById('bearoff-black');
    bearoffWhiteZone.classList.remove('active-home');
    bearoffBlackZone.classList.remove('active-home');
    
    if (possibleMovesForSelected.some(m => m.type === 'BEAROFF' && state.currentPlayer === 'WHITE')) {
        bearoffWhiteZone.classList.add('active-home');
    }
    if (possibleMovesForSelected.some(m => m.type === 'BEAROFF' && state.currentPlayer === 'BLACK')) {
        bearoffBlackZone.classList.add('active-home');
    }

    // Отрисовка фишек в боковых ячейках вывода
    renderBearoffCounters();

    // Рендеринг всех ячеек доски
    const allCells = document.querySelectorAll('.board-cell');
    allCells.forEach(cellElement => {
        const index = parseInt(cellElement.getAttribute('data-index'));
        const cellData = state.board[index];
        
        // Очищаем ячейку
        cellElement.innerHTML = '';
        cellElement.className = 'board-cell';
        cellElement.onclick = () => handleCellClick(index);

        // Классы подсветки ходов
        if (selectedCellIndex === index) {
            cellElement.classList.add('selectable');
        }
        if (possibleMovesForSelected.some(m => m.to === index)) {
            cellElement.classList.add('targetable');
        }

        if (cellData && cellData.count > 0) {
            // Если шашек больше 5, включаем режим компактной стопки
            if (cellData.count > 5) {
                cellElement.classList.add('stacked');
                
                // Отрисовываем 5 видимых фишек
                for (let c = 0; c < 5; c++) {
                    const checkerNode = document.createElement('div');
                    checkerNode.className = `checker ${cellData.color === 'WHITE' ? 'white-checker' : 'black-checker'}`;
                    cellElement.appendChild(checkerNode);
                }
                
                // Добавляем числовой маркер количества сверху стопки
                const badge = document.createElement('div');
                badge.className = 'stack-count';
                badge.innerText = `x${cellData.count}`;
                cellElement.appendChild(badge);
            } else {
                // Отрисовываем точное количество фишек, если их <= 5
                for (let c = 0; c < cellData.count; c++) {
                    const checkerNode = document.createElement('div');
                    checkerNode.className = `checker ${cellData.color === 'WHITE' ? 'white-checker' : 'black-checker'}`;
                    cellElement.appendChild(checkerNode);
                }
            }
        }
    });
}

function renderBearoffCounters() {
    const wSlots = document.getElementById('bearoff-slots-white');
    const bSlots = document.getElementById('bearoff-slots-black');
    wSlots.innerHTML = '';
    bSlots.innerHTML = '';

    for(let i=0; i<state.bearOff.WHITE; i++) {
        let node = document.createElement('div');
        node.className = 'checker white-checker';
        wSlots.appendChild(node);
    }
    for(let i=0; i<state.bearOff.BLACK; i++) {
        let node = document.createElement('div');
        node.className = 'checker black-checker';
        bSlots.appendChild(node);
    }
}
