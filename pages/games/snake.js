// pages/games/snake.js
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaRedo,
  FaExpand,
  FaCompress,
  FaArrowLeft,
  FaBars,
  FaArrowUp,
  FaArrowDown,
  FaArrowLeft as FaArrowLeftIcon,
  FaArrowRight,
} from "react-icons/fa";

// ─── Predefined colors ─────────────────────────────────
const SNAKE_COLORS = [
  { name: "Green", color: "#22c55e" },
  { name: "Blue", color: "#3b82f6" },
  { name: "Purple", color: "#a855f7" },
  { name: "Orange", color: "#f97316" },
  { name: "Cyan", color: "#06b6d4" },
  { name: "White", color: "#f8fafc" },
];
const FOOD_COLORS = [
  { name: "Red", color: "#ef4444" },
  { name: "Pink", color: "#ec4899" },
  { name: "Yellow", color: "#eab308" },
  { name: "Lime", color: "#84cc16" },
  { name: "Amber", color: "#f59e0b" },
  { name: "White", color: "#f8fafc" },
];

export default function SnakeGame() {
  const router = useRouter();
  const canvasRef = useRef(null);

  // ─── Game state ──────────────────────────────────────
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [showMenu, setShowMenu] = useState(false);

  // ─── Colors ──────────────────────────────────────────
  const [snakeColor, setSnakeColor] = useState("#22c55e");
  const [foodColor, setFoodColor] = useState("#ef4444");

  const gridSize = 20;
  const cellSize = 20;
  const snakeRef = useRef([{ x: 10, y: 10 }]);
  const directionRef = useRef({ x: 1, y: 0 });
  const foodRef = useRef({ x: 15, y: 10 });
  const gameIntervalRef = useRef(null);
  const gameOverRef = useRef(false);

  // ─── Food generation ─────────────────────────────────
  const generateFood = (snake) => {
    let pos;
    do {
      pos = {
        x: Math.floor(Math.random() * gridSize),
        y: Math.floor(Math.random() * gridSize),
      };
    } while (snake.some((seg) => seg.x === pos.x && seg.y === pos.y));
    return pos;
  };

  // ─── Start / Reset ───────────────────────────────────
  const startGame = () => {
    const newSnake = [{ x: 10, y: 10 }];
    snakeRef.current = newSnake;
    directionRef.current = { x: 1, y: 0 };
    foodRef.current = generateFood(newSnake);
    setScore(0);
    setGameOver(false);
    gameOverRef.current = false;
    setGameStarted(true);
    setShowSetup(false);
    drawGame();
    if (gameIntervalRef.current) clearInterval(gameIntervalRef.current);
    startLoop();
  };

  const startLoop = () => {
    if (gameIntervalRef.current) clearInterval(gameIntervalRef.current);
    gameIntervalRef.current = setInterval(() => {
      if (!gameOverRef.current) moveSnake();
    }, 150);
  };

  // ─── Movement & collision ────────────────────────────
  const moveSnake = () => {
    const snake = snakeRef.current;
    const head = snake[0];
    const newHead = {
      x: head.x + directionRef.current.x,
      y: head.y + directionRef.current.y,
    };

    if (
      newHead.x < 0 ||
      newHead.x >= gridSize ||
      newHead.y < 0 ||
      newHead.y >= gridSize
    ) {
      endGame();
      return;
    }
    if (snake.some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
      endGame();
      return;
    }

    const newSnake = [newHead, ...snake];
    if (newHead.x === foodRef.current.x && newHead.y === foodRef.current.y) {
      setScore((prev) => prev + 1);
      foodRef.current = generateFood(newSnake);
    } else {
      newSnake.pop();
    }
    snakeRef.current = newSnake;
    drawGame();
  };

  const endGame = () => {
    gameOverRef.current = true;
    setGameOver(true);
    setGameStarted(false);
    if (gameIntervalRef.current) {
      clearInterval(gameIntervalRef.current);
      gameIntervalRef.current = null;
    }
    drawGame();
  };

  // ─── Drawing ─────────────────────────────────────────
  const drawGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = canvas.width / gridSize;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const snake = snakeRef.current;
    snake.forEach((seg, idx) => {
      const isHead = idx === 0;
      const pad = 1;
      ctx.shadowBlur = isHead ? 12 : 6;
      ctx.shadowColor = snakeColor;
      ctx.fillStyle = snakeColor;
      ctx.fillRect(
        seg.x * size + pad,
        seg.y * size + pad,
        size - pad * 2,
        size - pad * 2,
      );

      if (isHead) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        const eyeSize = 3;
        const cx = seg.x * size + size / 2;
        const cy = seg.y * size + size / 2;
        const dir = directionRef.current;
        if (dir.x === 1) {
          ctx.beginPath();
          ctx.arc(cx + 4, cy - 3, eyeSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + 4, cy + 3, eyeSize, 0, Math.PI * 2);
          ctx.fill();
        } else if (dir.x === -1) {
          ctx.beginPath();
          ctx.arc(cx - 4, cy - 3, eyeSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx - 4, cy + 3, eyeSize, 0, Math.PI * 2);
          ctx.fill();
        } else if (dir.y === -1) {
          ctx.beginPath();
          ctx.arc(cx - 3, cy - 4, eyeSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + 3, cy - 4, eyeSize, 0, Math.PI * 2);
          ctx.fill();
        } else if (dir.y === 1) {
          ctx.beginPath();
          ctx.arc(cx - 3, cy + 4, eyeSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx + 3, cy + 4, eyeSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    ctx.shadowBlur = 0;

    ctx.shadowColor = foodColor;
    ctx.shadowBlur = 20;
    ctx.fillStyle = foodColor;
    ctx.beginPath();
    ctx.arc(
      foodRef.current.x * size + size / 2,
      foodRef.current.y * size + size / 2,
      size / 2 - 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  };

  // ─── Direction change (used by buttons & keyboard) ──
  const changeDirection = useCallback((dx, dy) => {
    if (gameOverRef.current) return;
    // Prevent reversing direction
    if (dx !== 0 && directionRef.current.x !== -dx) {
      directionRef.current = { x: dx, y: 0 };
    } else if (dy !== 0 && directionRef.current.y !== -dy) {
      directionRef.current = { x: 0, y: dy };
    }
  }, []);

  // ─── Keyboard ────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e) => {
      if (gameOverRef.current || showSetup) return;
      const key = e.key;
      if (key === "ArrowUp") changeDirection(0, -1);
      else if (key === "ArrowDown") changeDirection(0, 1);
      else if (key === "ArrowLeft") changeDirection(-1, 0);
      else if (key === "ArrowRight") changeDirection(1, 0);
    },
    [showSetup, changeDirection],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ─── Redraw on color change ─────────────────────────
  useEffect(() => {
    drawGame();
  }, [snakeColor, foodColor]);

  useEffect(() => {
    drawGame();
  }, []);

  // ─── Fullscreen ──────────────────────────────────────
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  return (
    <div
      className="flex flex-col items-center min-h-screen p-4"
      style={{ backgroundColor: "var(--white)" }}
    >
      {/* ─── Setup Menu ────────────────────────────────── */}
      <AnimatePresence>
        {showSetup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
              style={{
                backgroundColor: "var(--white)",
                border: "1px solid var(--darkgray, #333)",
                color: "var(--black)",
              }}
            >
              <h2 className="text-2xl font-bold text-center mb-6">🐍 Snake</h2>

              <p
                className="text-sm mb-2 font-medium"
                style={{ color: "var(--black)" }}
              >
                Snake Color
              </p>
              <div className="grid grid-cols-6 gap-2 mb-4">
                {SNAKE_COLORS.map((c) => (
                  <motion.button
                    key={c.color}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setSnakeColor(c.color)}
                    className="w-10 h-10 rounded-full border-2"
                    style={{
                      backgroundColor: c.color,
                      borderColor:
                        snakeColor === c.color
                          ? "var(--white, #fff)"
                          : "transparent",
                      boxShadow:
                        snakeColor === c.color ? `0 0 12px ${c.color}` : "none",
                    }}
                  />
                ))}
              </div>

              <p
                className="text-sm mb-2 font-medium"
                style={{ color: "var(--black)" }}
              >
                Food Color
              </p>
              <div className="grid grid-cols-6 gap-2 mb-6">
                {FOOD_COLORS.map((c) => (
                  <motion.button
                    key={c.color}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setFoodColor(c.color)}
                    className="w-10 h-10 rounded-full border-2"
                    style={{
                      backgroundColor: c.color,
                      borderColor:
                        foodColor === c.color
                          ? "var(--white, #fff)"
                          : "transparent",
                      boxShadow:
                        foodColor === c.color ? `0 0 12px ${c.color}` : "none",
                    }}
                  />
                ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                onClick={startGame}
                className="w-full py-3 rounded-xl font-bold text-lg shadow-lg cursor-pointer"
                style={{
                  backgroundColor: "var(--green, #22c55e)",
                  color: "var(--black)",
                }}
              >
                Start Game
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => router.push("/games")}
                className="w-full py-3 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center my-2 mt-4 cursor-pointer"
                style={{
                  backgroundColor: "var(--red)",
                  color: "var(--white)",
                }}
              >
                <FaArrowLeft className="mx-2" /> Back to Games
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Top Bar ────────────────────────────────────── */}
      {!showSetup && (
        <div className="w-full flex justify-between items-center mb-2 flex-shrink-0">
          <div
            className="text-lg font-black mb-5 tracking-tight"
            style={{ color: "var(--black)" }}
          >
            Score: {score}
          </div>
          <motion.div className="relative">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-full"
              style={{
                backgroundColor: "var(--white)",
                color: "var(--black)",
              }}
            >
              <FaBars size={20} />
            </motion.button>
            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="absolute right-0 mt-2 w-48 rounded-xl shadow-2xl z-50 overflow-hidden"
                  style={{
                    backgroundColor: "var(--white)",
                    border: "1px solid var(--darkgray, #333)",
                  }}
                >
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      startGame();
                    }}
                    className="w-full px-4 py-3 text-left text-sm font-medium flex items-center gap-3"
                    style={{ color: "var(--black)" }}
                  >
                    <FaRedo /> New Game
                  </button>
                  <button
                    onClick={() => {
                      toggleFullscreen();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-3 text-left text-sm font-medium flex items-center gap-3"
                    style={{ color: "var(--black)" }}
                  >
                    {isFullscreen ? <FaCompress /> : <FaExpand />}
                    {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  </button>
                  <button
                    onClick={() => router.push("/games")}
                    className="w-full px-4 py-3 text-left text-sm font-medium flex items-center gap-3"
                    style={{ color: "var(--black)" }}
                  >
                    <FaArrowLeft /> Back to Games
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}

      {/* ─── Canvas ────────────────────────────────────── */}
      <div className="relative touch-none">
        <canvas
          ref={canvasRef}
          width={gridSize * cellSize}
          height={gridSize * cellSize}
          className="rounded-xl shadow-2xl touch-none"
          style={{
            width: "min(85vh, 85vw)",
            height: "min(85vh, 85vw)",
            touchAction: "none",
            border: "2px solid var(--darkgray, #333)",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Game Over overlay */}
        <AnimatePresence>
          {gameOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center rounded-xl"
              style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
            >
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="text-center p-4"
              >
                <h2
                  className="text-4xl font-bold mb-2"
                  style={{ color: "var(--yellow, #fbbf24)" }}
                >
                  Game Over
                </h2>
                <p className="text-xl mb-4" style={{ color: "var(--black)" }}>
                  Score: {score}
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setGameOver(false);
                    setShowSetup(true);
                  }}
                  className="px-6 py-2 rounded-full font-medium shadow-lg"
                  style={{
                    backgroundColor: "var(--red, #3b82f6)",
                    color: "var(--black)",
                  }}
                >
                  Play Again
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Directional Pad (Mobile Controls) ────────── */}
      {!showSetup && (
        <div className="mt-6 sm:flex l:hidden justify-center w-full">
          <div className="grid grid-cols-3 gap-3 w-56">
            {/* Top row: Up */}
            <div></div>
            <button
              onClick={() => changeDirection(0, -1)}
              className="p-4 rounded-full touch-manipulation"
              style={{
                border: "2px solid var(--darkgray, #333)",
                backgroundColor: "var(--white)",
              }}
              aria-label="Up"
            >
              <FaArrowUp
                className="w-6 h-6 text-black"
                style={{
                  color: "var(--black)",
                }}
              />
            </button>
            <div></div>
            {/* Middle row: Left - Down - Right */}
            <button
              onClick={() => changeDirection(-1, 0)}
              className="p-4 rounded-full touch-manipulation"
              style={{
                border: "2px solid var(--darkgray, #333)",
                backgroundColor: "var(--white)",
              }}
              aria-label="Left"
            >
              <FaArrowLeftIcon
                className="w-6 h-6 "
                style={{
                  color: "var(--black)",
                }}
              />
            </button>
            <button
              onClick={() => changeDirection(0, 1)}
              className="p-4 rounded-full bg-white shadow-lg hover:bg-gray-100 active:bg-gray-200 touch-manipulation"
              style={{
                border: "2px solid var(--darkgray, #333)",
                backgroundColor: "var(--white)",
              }}
              aria-label="Down"
            >
              <FaArrowDown
                className="w-6 h-6 "
                style={{
                  color: "var(--black)",
                }}
              />
            </button>
            <button
              onClick={() => changeDirection(1, 0)}
              className="p-4 rounded-full touch-manipulation"
              style={{
                border: "2px solid var(--darkgray, #333)",
                backgroundColor: "var(--white)",
              }}
              aria-label="Right"
            >
              <FaArrowRight
                className="w-6 h-6 "
                style={{
                  color: "var(--black)",
                }}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
